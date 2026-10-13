"""Self-check for the MCP server: python3 clients/python/test_mcp.py

Runs `python -m jasper.mcp` as an agent's MCP host would, against a stand-in
for the app's socket, then against nothing at all.
"""

import json
import socket
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).parent


def fake_app() -> int:
    """A socket that answers every read the way the app does; returns its port."""
    srv = socket.create_server(("127.0.0.1", 0))

    def serve():
        while True:   # one connection per tool call or resource read
            conn, _ = srv.accept()
            with conn, conn.makefile("r") as rx:
                for line in rx:
                    msg = json.loads(line)
                    assert msg["caller"] == "agent" and msg["method"] == "read", msg
                    p = msg["params"]
                    result = ({n: "idle" for n in p["names"]} if "names" in p
                              else {"sensor": "TCD1304", "pixels": 3694})
                    reply = {"jsonrpc": "2.0", "id": msg["id"], "result": result}
                    conn.sendall((json.dumps(reply) + "\n").encode())

    threading.Thread(target=serve, daemon=True).start()
    return srv.getsockname()[1]


def session(port: int, *requests: dict) -> list:
    lines = "".join(json.dumps(r) + "\n" for r in requests)
    out = subprocess.run([sys.executable, "-m", "jasper.mcp", "--port", str(port)], cwd=HERE,
                         input=lines, capture_output=True, text=True, timeout=20, check=True).stdout
    return [json.loads(l) for l in out.splitlines()]


def main():
    read = {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "jasper_read", "arguments": {"names": ["device.state"]}}}
    init, listed, ref, val = session(
        fake_app(),
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "resources/read", "params": {"uri": "jasper://reference"}},
        read,
    )
    assert init["result"]["serverInfo"]["name"] == "jasper-mcp"
    assert [t["name"] for t in listed["result"]["tools"]] == ["jasper_read"]
    text = ref["result"]["contents"][0]["text"]
    assert "reference_version" in text and 'live_device_info: {"sensor": "TCD1304", "pixels": 3694}' in text
    assert json.loads(val["result"]["content"][0]["text"]) == {"device.state": "idle"}

    # Nothing listening: the agent gets an error it can explain, not a crash.
    closed = socket.create_server(("127.0.0.1", 0))
    port = closed.getsockname()[1]
    closed.close()
    down, nope = session(port, read, {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                                      "params": {"name": "jasper_write", "arguments": {}}})
    assert down["result"]["isError"] and "not running" in down["result"]["content"][0]["text"]
    assert nope["error"]["code"] == -32602

    # A misspelt argument is an error the agent can correct, not an empty answer.
    (wrong,) = session(port, {"jsonrpc": "2.0", "id": 6, "method": "tools/call",
                              "params": {"name": "jasper_read", "arguments": {"name": "device.info"}}})
    assert wrong["result"]["isError"] and '"names"' in wrong["result"]["content"][0]["text"]
    print("ok")


if __name__ == "__main__":
    main()
