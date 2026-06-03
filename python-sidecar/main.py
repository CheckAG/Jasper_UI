#!/usr/bin/env python3
"""
JASPER Python sidecar — JSON-RPC dispatcher over stdin / stdout.

Protocol:
    request  → {"id": <str|int>, "method": <str>, "params": <dict>}
    response ← {"id": <str|int>, "result": <any>}
    error    ← {"id": <str|int>, "error": <str>}

One JSON object per line. Stderr is passed through to the Tauri log.
"""
import sys
import json
import traceback
import os
import time

# ── Ensure package is importable when run from any CWD ───────────────────────
sys.path.insert(0, os.path.dirname(__file__))

# ── Lazy imports (so startup is instant; heavy imports on first call) ─────────
_nodes_loaded = False
_chem_loaded  = False

def _ensure_nodes():
    global _nodes_loaded
    if not _nodes_loaded:
        import jasper.nodes  # noqa: F401 — triggers registration
        _nodes_loaded = True

def _ensure_chem():
    global _chem_loaded
    if not _chem_loaded:
        import jasper.chemometrics  # noqa: F401
        _chem_loaded = True


# ── Input bounds — reject pathological payloads before they hit numpy ─────────
MAX_POINTS  = 65_536   # samples per spectrum
MAX_SPECTRA = 10_000   # spectra per request

def _check_ys(ys, name="spectrum"):
    if not isinstance(ys, list):
        raise ValueError(f"{name} must be a list")
    if len(ys) > MAX_POINTS:
        raise ValueError(f"{name} too large: {len(ys)} > {MAX_POINTS} points")

def _check_spectra(spectra, name="spectra"):
    if not isinstance(spectra, list):
        raise ValueError(f"{name} must be a list")
    if len(spectra) > MAX_SPECTRA:
        raise ValueError(f"{name}: {len(spectra)} > {MAX_SPECTRA} spectra")
    for s in spectra:
        _check_ys(s, "spectrum")


# ── Handlers ──────────────────────────────────────────────────────────────────

def handle_ping(_params: dict) -> dict:
    return {"pong": True, "version": "1.0", "python": sys.version}


def handle_get_node_manifest(_params: dict) -> list:
    _ensure_nodes()
    from jasper.node import all_nodes
    return [cls.manifest() for cls in all_nodes()]


def handle_reload_plugins(params: dict) -> dict:
    """Scan a plugins directory, import any Node subclasses, return full manifest."""
    _ensure_nodes()
    from jasper.node import load_plugins, all_nodes
    plugin_dir = params.get("dir") or os.path.expanduser("~/jasper/plugins")
    loaded = load_plugins(plugin_dir)
    return {
        "loaded":   loaded,
        "dir":      plugin_dir,
        "manifest": [cls.manifest() for cls in all_nodes()],
    }


def handle_apply_pipeline(params: dict) -> dict:
    """
    Execute a pre-processing pipeline on a set of captures.

    params:
        nodes:    list of {id, kind, enabled, params}
        captures: list of {id, ys}

    Returns:
        nodes:      input list with `output_preview` added to each node
        final:      final ys after all enabled nodes
        duration_ms: execution time
    """
    _ensure_nodes()
    from jasper.node import get_node

    nodes    = params.get("nodes", [])
    captures = params.get("captures", [])

    if not captures:
        return {"nodes": nodes, "final": [], "duration_ms": 0}

    _check_spectra([c.get("ys", []) for c in captures], "captures")

    # Use the first capture as the reference spectrum for MSC
    reference_ys = captures[0]["ys"] if captures else None

    t0 = time.perf_counter()

    # Apply pipeline to the first capture (for preview); all captures for batch
    current = list(captures[0]["ys"])
    result_nodes = []

    for node_spec in nodes:
        if not node_spec.get("enabled", True):
            result_nodes.append({**node_spec, "output_preview": current})
            continue

        kind_code = node_spec.get("code", "").upper()
        NodeCls   = get_node(kind_code)

        if NodeCls is None:
            result_nodes.append({**node_spec, "output_preview": current})
            continue

        node_params = node_spec.get("params", {})
        instance    = NodeCls(**node_params)

        # MSC needs a reference spectrum
        if kind_code == "AT_1_2" and reference_ys is not None:
            current = instance.apply(current, reference=reference_ys)
        else:
            current = instance.apply(current)

        result_nodes.append({**node_spec, "output_preview": current})

    duration_ms = round((time.perf_counter() - t0) * 1000, 2)
    return {"nodes": result_nodes, "final": current, "duration_ms": duration_ms}


def handle_run_pca(params: dict) -> dict:
    _ensure_chem()
    _check_spectra(params.get("spectra", []))
    from jasper.chemometrics.pca import run_pca
    return run_pca(**params)


def handle_train_regression(params: dict) -> dict:
    _ensure_chem()
    _check_spectra(params.get("spectra", []))
    from jasper.chemometrics.regress import run_regression
    return run_regression(**params)


def handle_train_classifier(params: dict) -> dict:
    _ensure_chem()
    _check_spectra(params.get("spectra", []))
    from jasper.chemometrics.classify import train_classifier
    return train_classifier(**params)


def handle_predict(params: dict) -> dict:
    _ensure_chem()
    _check_ys(params.get("spectrum", []))
    from jasper.chemometrics.predict import predict_from_model
    return predict_from_model(**params)


def handle_analyze_mixture(params: dict) -> dict:
    _ensure_chem()
    _check_ys(params.get("ys", []))
    from jasper.chemometrics.mixture import analyze_mixture
    return analyze_mixture(**params)


def handle_write_jcamp(params: dict) -> str:
    from jasper.jcamp import write_jcamp
    return write_jcamp(**params)


def handle_write_jcamp_multi(params: dict) -> str:
    from jasper.jcamp import write_jcamp_multi
    return write_jcamp_multi(**params)


def handle_read_jcamp(params: dict) -> dict:
    from jasper.jcamp import read_jcamp
    return read_jcamp(**params)


# ── Dispatch table ────────────────────────────────────────────────────────────

HANDLERS = {
    "ping":              handle_ping,
    "get_node_manifest": handle_get_node_manifest,
    "reload_plugins":    handle_reload_plugins,
    "apply_pipeline":    handle_apply_pipeline,
    "run_pca":           handle_run_pca,
    "train_regression":  handle_train_regression,
    "train_classifier":  handle_train_classifier,
    "predict":           handle_predict,
    "analyze_mixture":   handle_analyze_mixture,
    "write_jcamp":       handle_write_jcamp,
    "write_jcamp_multi": handle_write_jcamp_multi,
    "read_jcamp":        handle_read_jcamp,
}


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    print(json.dumps({"ready": True, "methods": list(HANDLERS.keys())}), flush=True)

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        req_id = None
        try:
            req    = json.loads(raw_line)
            req_id = req.get("id")
            method = req.get("method", "")
            params = req.get("params", {})

            handler = HANDLERS.get(method)
            if handler is None:
                raise ValueError(f"Unknown method: {method!r}")

            result = handler(params)
            print(json.dumps({"id": req_id, "result": result}), flush=True)

        except Exception as exc:
            tb = traceback.format_exc()
            print(json.dumps({"id": req_id, "error": str(exc), "trace": tb}), flush=True)
            print(f"[jasper-sidecar] ERROR: {exc}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
