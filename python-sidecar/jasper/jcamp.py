"""JCAMP-DX read / write — lossless round-trip with JASPER method sidecar block."""
import json, re, math
from typing import Any


# ── Writer ────────────────────────────────────────────────────────────────────

def write_jcamp(
    xs: list[float],
    ys: list[float],
    metadata: dict[str, Any] | None = None,
    pipeline: list[dict] | None = None,
) -> str:
    """Serialise one spectrum to JCAMP-DX (XYDATA form, uncompressed)."""
    meta = metadata or {}
    lines: list[str] = []

    def tag(name: str, value: Any) -> None:
        lines.append(f"##{name}={value}")

    tag("TITLE",      meta.get("title", "JASPER spectrum"))
    tag("JCAMP-DX",   "5.01")
    tag("DATA TYPE",  "INFRARED SPECTRUM")
    tag("ORIGIN",     meta.get("origin", "JASPER by CheckAg"))
    tag("OWNER",      meta.get("owner", ""))
    tag("DATE",       meta.get("date", ""))
    tag("XUNITS",     "NM")
    tag("YUNITS",     meta.get("yunits", "ABSORBANCE"))
    tag("XFACTOR",    "1.0")
    tag("YFACTOR",    "1.0")
    tag("FIRSTX",     str(xs[0]))
    tag("LASTX",      str(xs[-1]))
    tag("NPOINTS",    str(len(xs)))

    if pipeline:
        tag("$JASPER_METHOD", json.dumps(pipeline))

    if meta:
        safe_meta = {k: v for k, v in meta.items()
                     if k not in ("title", "origin", "owner", "date", "yunits")}
        if safe_meta:
            tag("$JASPER_META", json.dumps(safe_meta))

    tag("XYDATA",    "(X++(Y..Y))")
    for x, y in zip(xs, ys):
        lines.append(f"{x:.4f} {y:.6f}")

    tag("END", "")
    return "\n".join(lines)


def write_jcamp_multi(
    spectra: list[dict],
    pipeline: list[dict] | None = None,
) -> str:
    """
    Serialise multiple spectra into one JCAMP-DX file as a LINK block of
    NTUPLES-style concatenated XYDATA blocks.

    Args:
        spectra: list of {xs, ys, metadata?} dicts
        pipeline: optional pre-processing chain, embedded once in the link header
    """
    blocks: list[str] = []
    blocks.append("##TITLE=JASPER export")
    blocks.append("##JCAMP-DX=5.01")
    blocks.append("##DATA TYPE=LINK")
    blocks.append(f"##BLOCKS={len(spectra)}")
    if pipeline:
        blocks.append(f"##$JASPER_METHOD={json.dumps(pipeline)}")

    for spec in spectra:
        blocks.append(write_jcamp(
            spec["xs"], spec["ys"],
            metadata=spec.get("metadata", {}),
            pipeline=None,  # pipeline lives once in the link header
        ))

    blocks.append("##END= $$ end of link")
    return "\n".join(blocks)


# ── Reader ────────────────────────────────────────────────────────────────────

def read_jcamp(content: str) -> dict:
    """Parse a JCAMP-DX string → {xs, ys, metadata, pipeline}."""
    xs: list[float] = []
    ys: list[float] = []
    meta: dict = {}
    pipeline: list[dict] | None = None

    in_data = False
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith("##END"):
            in_data = False
            continue

        if line.startswith("##XYDATA"):
            in_data = True
            continue

        if line.startswith("##"):
            key_end = line.index("=")
            key   = line[2:key_end].strip().upper()
            value = line[key_end + 1:].strip()

            if key == "$JASPER_METHOD":
                try:
                    pipeline = json.loads(value)
                except Exception:
                    pass
            elif key == "$JASPER_META":
                try:
                    meta.update(json.loads(value))
                except Exception:
                    pass
            else:
                meta[key] = value
            continue

        if in_data:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    xs.append(float(parts[0]))
                    ys.append(float(parts[1]))
                except ValueError:
                    pass

    return {"xs": xs, "ys": ys, "metadata": meta, "pipeline": pipeline}
