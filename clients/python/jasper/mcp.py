"""Read-only MCP server for JASPER (stdio, standard library only).

Gives an AI agent the jasper_read tool and the device reference file
(jasper://reference). It reads through the running app's Device API as
caller "agent", so every value is the one the GUI shows. It cannot write,
capture or change anything (Device API reference, Stage 1).

    PYTHONPATH=<repo>/clients/python python3 -m jasper.mcp [--port 8765]
"""

import argparse
import json
import sys
from pathlib import Path

from . import ApiError, Client, PORT

REFERENCE = Path(__file__).with_name("reference.yaml")
VARIABLES = [
    "device.state", "device.info", "device.diagnostics",
    "acquisition.integration_time_ms", "acquisition.averages", "acquisition.live",
    "reference.dark", "reference.dark_stale", "reference.white",
    "processing.mode", "workspace.active",
]

TOOLS = [{
    "name": "jasper_read",
    "description": "Read JASPER spectrometer variables from the running app. "
                   "Read jasper://reference first for what each one means.",
    "inputSchema": {
        "type": "object",
        "properties": {"names": {"type": "array", "minItems": 1,
                                 "items": {"type": "string", "enum": VARIABLES}}},
        "required": ["names"],
    },
    "annotations": {"readOnlyHint": True},
}]


def read_tool(port: int, names: list) -> dict:
    """tools/call result for jasper_read: the values, or an error the agent can act on."""
    # A missing or misspelt argument (e.g. "name") is refused, not answered with {}.
    if not names or not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        return {"content": [{"type": "text", "text": 'jasper_read takes {"names": [variable, ...]}, e.g. ["device.info"].'}],
                "isError": True}
    try:
        with Client(port=port, caller="agent", timeout=10) as j:
            values = j.call("read", {"names": names})
        return {"content": [{"type": "text", "text": json.dumps(values, indent=2)}]}
    except (ConnectionRefusedError, ConnectionError):
        text = f"JASPER is not running (nothing on 127.0.0.1:{port}). Ask the user to start it."
    except ApiError as e:
        text = f"{e.message}: {e.detail}"
    return {"content": [{"type": "text", "text": text}], "isError": True}


def reference(port: int) -> str:
    """The model file, plus the connected unit's own identity and limits when
    the app can say: those, not the file, are what hold for this sensor."""
    text = REFERENCE.read_text(encoding="utf-8")
    try:
        with Client(port=port, caller="agent", timeout=5) as j:
            info = j.read("device.info")
    except (OSError, ApiError):
        return text + "\n# live_device_info: unavailable (JASPER not running)\n"
    # JSON is valid YAML, so the block needs no YAML library.
    return text + "\nlive_device_info: " + json.dumps(info) + "\n"


def handle(msg: dict, port: int):
    """The result for one request, or None for a notification."""
    method, params = msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}, "resources": {}},
                "serverInfo": {"name": "jasper-mcp", "version": "0.1"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        if params.get("name") != "jasper_read":
            raise LookupError(f"no tool {params.get('name')!r}")
        names = (params.get("arguments") or {}).get("names") or []
        return read_tool(port, names)
    if method == "resources/list":
        return {"resources": [{"uri": "jasper://reference", "name": "JASPER device reference",
                               "mimeType": "application/yaml"}]}
    if method == "resources/read":
        if params.get("uri") != "jasper://reference":
            raise LookupError(f"no resource {params.get('uri')!r}")
        return {"contents": [{"uri": "jasper://reference", "mimeType": "application/yaml",
                              "text": reference(port)}]}
    raise NotImplementedError(method)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="jasper.mcp")
    p.add_argument("--port", type=int, default=PORT)
    port = p.parse_args(argv).port
    for line in sys.stdin:
        if not line.strip():
            continue
        msg = json.loads(line)
        if "id" not in msg:
            continue   # notifications (initialized, cancelled) need no reply
        reply = {"jsonrpc": "2.0", "id": msg["id"]}
        try:
            reply["result"] = handle(msg, port)
        except NotImplementedError as e:
            reply["error"] = {"code": -32601, "message": f"method not found: {e}"}
        except LookupError as e:
            reply["error"] = {"code": -32602, "message": str(e)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
