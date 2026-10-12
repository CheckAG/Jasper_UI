"""Thin client for the JASPER Device API (standard library only).

The app listens on 127.0.0.1:8765 while it runs: one JSON object per line
each way. Every call goes through the same dispatcher as the GUI, so limits,
numbers and the audit log are the same.

    # from clients/python, or with it on PYTHONPATH
    from jasper import Client
    with Client() as j:
        j.write("acquisition.integration_time_ms", 50)
        out = j.invoke("capture", tag="NE-01")
        print(out["saved"]["file"])
"""

import json
import socket

PORT = 8765


class ApiError(Exception):
    """An error reply: `code`, `message` (e.g. LIMIT_EXCEEDED), `detail`, `data`."""

    def __init__(self, error: dict):
        self.code = error.get("code")
        self.message = error.get("message")
        self.detail = error.get("detail", "")
        self.data = error.get("data")
        super().__init__(f"{self.message}: {self.detail}")


class Client:
    """One connection. `caller` goes in the audit log: script, cli or agent."""

    def __init__(self, host: str = "127.0.0.1", port: int = PORT, caller: str = "script",
                 timeout: float | None = None):
        # No timeout by default: a capture of many long scans can take minutes.
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._rx = self._sock.makefile("r", encoding="utf-8")
        self._caller = caller
        self._id = 0

    def call(self, method: str, params: dict):
        self._id += 1
        msg = {"jsonrpc": "2.0", "id": self._id, "caller": self._caller,
               "method": method, "params": params}
        self._sock.sendall((json.dumps(msg) + "\n").encode())
        line = self._rx.readline()
        if not line:
            raise ConnectionError("JASPER closed the connection")
        reply = json.loads(line)
        if "error" in reply:
            raise ApiError(reply["error"])
        return reply["result"]

    def read(self, *names: str):
        """One name → its value; several → {name: value}."""
        if len(names) == 1:
            return self.call("read", {"name": names[0]})
        return self.call("read", {"names": list(names)})

    def write(self, name: str, value):
        """Returns {name, value} as applied."""
        return self.call("write", {"name": name, "value": value})

    def invoke(self, command: str, **args):
        return self.call("invoke", {"command": command, "args": args})

    def close(self):
        self._rx.close()
        self._sock.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
