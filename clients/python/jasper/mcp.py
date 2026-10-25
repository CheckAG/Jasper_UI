"""MCP server for JASPER (stdio, standard library only).

Gives an AI agent the device reference file (jasper://reference) and three
tools: jasper_read, jasper_write (acquisition settings) and jasper_invoke
(capture, burst, live, dark and reference). Every call goes through the
running app's Device API as caller "agent": the same limits, errors and
audit log as a script, and privileged commands are not offered.

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

# Settings an agent may change. workspace.active is left to the person: the
# agent has no way to list workspaces, so it could only guess an id.
WRITABLE = ["acquisition.integration_time_ms", "acquisition.averages"]
# Commands an agent may run. Not connect/disconnect/update_firmware/confirm:
# those are for the person at the machine.
COMMANDS = ["capture", "burst", "start_live", "stop_live",
            "capture_dark", "capture_reference", "clear_dark", "clear_reference"]

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
}, {
    "name": "jasper_write",
    "description": "Set an acquisition setting in the running app; returns the value applied. "
                   "Out-of-range values are refused with the allowed range (device.info has the "
                   "integration limits). A held dark goes stale when either setting changes.",
    "inputSchema": {
        "type": "object",
        "properties": {"name": {"type": "string", "enum": WRITABLE},
                       "value": {"type": "number"}},
        "required": ["name", "value"],
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
}, {
    "name": "jasper_invoke",
    "description": "Run a command in the running app at the current settings. capture: one "
                   "spectrum of acquisition.averages scans, saved in the active workspace as "
                   "<label>_NNN (args label, tag). burst: count captures interval_ms apart "
                   "(args count, interval_ms, label, tag). capture_dark / capture_reference: keep "
                   "the last spectrum (from a capture or the live stream) as the dark or reference. "
                   "clear_dark / clear_reference, start_live / stop_live. Spectra come back as a "
                   "summary (peak, max, points), not every pixel; the saved .jdx file has them all.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "enum": COMMANDS},
            "args": {"type": "object", "properties": {
                "label": {"type": "string"}, "tag": {"type": "string"},
                "count": {"type": "integer", "minimum": 1},
                "interval_ms": {"type": "integer", "minimum": 0}}},
        },
        "required": ["command"],
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False},
}]


def error(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": True}


def call_tool(port: int, method: str, params: dict, timeout: float | None) -> dict:
    """One Device API call as a tools/call result, or an error the agent can act on."""
    try:
        with Client(port=port, caller="agent", timeout=timeout) as j:
            result = j.call(method, params)
        return {"content": [{"type": "text", "text": json.dumps(summarise(result), indent=2)}]}
    except (ConnectionRefusedError, ConnectionError):
        return error(f"JASPER is not running (nothing on 127.0.0.1:{port}). Ask the user to start it.")
    except ApiError as e:
        text = f"{e.message}: {e.detail}"
        return error(text + (f" {json.dumps(e.data)}" if e.data else ""))


def summarise(result):
    """A frame's 3 694 pixels would flood the agent's context: keep what it acts on."""
    if isinstance(result, dict) and isinstance(result.get("frame"), dict):
        frame = {k: v for k, v in result["frame"].items() if k not in ("xs", "ys")}
        ys = result["frame"].get("ys") or []
        frame.update(points=len(ys), max=max(ys, default=None))
        return {**result, "frame": frame}
    return result


def read_tool(port: int, names: list) -> dict:
    """tools/call result for jasper_read: the values, or an error the agent can act on."""
    # A missing or misspelt argument (e.g. "name") is refused, not answered with {}.
    if not names or not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        return error('jasper_read takes {"names": [variable, ...]}, e.g. ["device.info"].')
    return call_tool(port, "read", {"names": names}, timeout=10)


def write_tool(port: int, args: dict) -> dict:
    if args.get("name") not in WRITABLE or "value" not in args:
        return error(f'jasper_write takes {{"name": one of {WRITABLE}, "value": number}}.')
    return call_tool(port, "write", {"name": args["name"], "value": args["value"]}, timeout=10)


def invoke_tool(port: int, args: dict) -> dict:
    if args.get("command") not in COMMANDS:
        return error(f'jasper_invoke takes {{"command": one of {COMMANDS}, "args": {{...}}}}.')
    # No timeout: 64 averages of a 10 s integration, or a long burst, takes minutes.
    return call_tool(port, "invoke", {"command": args["command"], "args": args.get("args") or {}}, timeout=None)


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
                "serverInfo": {"name": "jasper-mcp", "version": "0.2"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        args = params.get("arguments") or {}
        tool = params.get("name")
        if tool == "jasper_read":
            return read_tool(port, args.get("names") or [])
        if tool == "jasper_write":
            return write_tool(port, args)
        if tool == "jasper_invoke":
            return invoke_tool(port, args)
        raise LookupError(f"no tool {tool!r}")
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
