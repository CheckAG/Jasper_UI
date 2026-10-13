"""Command line for the JASPER Device API.

    python -m jasper read device.state acquisition.integration_time_ms
    python -m jasper write acquisition.averages 8
    python -m jasper invoke capture tag=NE-01
    python -m jasper invoke update_firmware path=/abs/fw.srec   # waits for a person to approve in the app
    python -m jasper watch spectrum-frame capture-saved   # one JSON line per event

Values are parsed as JSON when they can be (8 → number, true → bool),
otherwise taken as text. Prints the result as JSON; exits 1 on an API error.
"""

import argparse
import json
import sys

from . import ApiError, Client, PORT


def value(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return text


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="jasper", description="JASPER Device API client")
    p.add_argument("--port", type=int, default=PORT)
    sub = p.add_subparsers(dest="method", required=True)
    r = sub.add_parser("read", help="read one or more variables")
    r.add_argument("names", nargs="+")
    w = sub.add_parser("write", help="write a variable")
    w.add_argument("name")
    w.add_argument("value", type=value)
    i = sub.add_parser("invoke", help="run a command, args as key=value")
    i.add_argument("command")
    i.add_argument("args", nargs="*")
    e = sub.add_parser("watch", help="print events as they happen, one JSON line each")
    e.add_argument("events", nargs="+")
    a = p.parse_args(argv)

    try:
        with Client(port=a.port, caller="cli") as j:
            if a.method == "watch":
                j.subscribe(*a.events)
                for name, payload in j.events():
                    print(json.dumps({"event": name, "params": payload}), flush=True)
            elif a.method == "read":
                out = j.read(*a.names)
            elif a.method == "write":
                out = j.write(a.name, a.value)
            else:
                kv = dict(s.split("=", 1) for s in a.args)
                out = j.invoke(a.command, **{k: value(v) for k, v in kv.items()})
    except KeyboardInterrupt:
        return 0
    except ConnectionRefusedError:
        print(f"JASPER is not running (nothing on 127.0.0.1:{a.port})", file=sys.stderr)
        return 1
    except ApiError as e:
        print(json.dumps({"code": e.code, "message": e.message, "detail": e.detail, "data": e.data}),
              file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
