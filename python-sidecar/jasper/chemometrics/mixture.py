"""CM_6 — Multilinear mixture analysis."""
import os
import numpy as np
import joblib
from sklearn.linear_model import LinearRegression


def _models_dir() -> str:
    return os.path.expanduser("~/jasper/models")


# Default component reference spectra (synthetic — replace with real library)
COMPONENT_LIBRARY = {
    "c1": {"name": "Protein",  "color": "#1f5dff"},
    "c2": {"name": "Starch",   "color": "#06b6c4"},
    "c3": {"name": "Moisture", "color": "#6b4ee0"},
    "c4": {"name": "Lipid",    "color": "#d97706"},
}


def _synthetic_reference(component_id: str, n_points: int = 320) -> np.ndarray:
    """Generate a plausible synthetic reference spectrum for a component."""
    xs = np.linspace(400, 2000, n_points)
    # Each component has different dominant peaks
    spectra = {
        "c1": 0.3 * np.exp(-((xs - 1450) / 80)**2) + 0.2 * np.exp(-((xs - 950) / 60)**2),
        "c2": 0.4 * np.exp(-((xs - 1200) / 100)**2) + 0.15 * np.exp(-((xs - 1750) / 80)**2),
        "c3": 0.5 * np.exp(-((xs - 1940) / 60)**2) + 0.3 * np.exp(-((xs - 1450) / 80)**2),
        "c4": 0.35 * np.exp(-((xs - 1730) / 70)**2) + 0.1 * np.exp(-((xs - 1160) / 90)**2),
    }
    ref = spectra.get(component_id, np.ones(n_points) * 0.1)
    return ref / (ref.max() + 1e-12)


def analyze_mixture(
    ys: list[float],
    component_ids: list[str],
    reference_spectra: dict[str, list[float]] | None = None,
) -> dict:
    """
    Quantitative mixture analysis using non-negative least squares.

    Args:
        ys:                 Sample spectrum
        component_ids:      IDs of components to quantify
        reference_spectra:  Optional dict of {component_id: ys} reference spectra.
                            If None, uses synthetic library references.

    Returns:
        components: list of {id, name, fraction, color}
        residual:   unexplained fraction
    """
    y = np.array(ys, dtype=np.float64)
    n = len(y)

    refs = []
    for cid in component_ids:
        if reference_spectra and cid in reference_spectra:
            ref = np.array(reference_spectra[cid], dtype=np.float64)
        else:
            ref = _synthetic_reference(cid, n)
        refs.append(ref)

    R = np.column_stack(refs)  # (n_wavelengths, n_components)

    # Non-negative least squares via scipy
    from scipy.optimize import nnls
    fractions, residual_norm = nnls(R, y)

    total = fractions.sum()
    if total > 1e-12:
        fractions_norm = fractions / total
    else:
        fractions_norm = np.ones(len(component_ids)) / len(component_ids)

    # Residual fraction
    residual = float(1 - np.dot(fractions_norm, fractions_norm).clip(0, 1))
    residual = max(0.0, min(0.2, residual_norm / (np.linalg.norm(y) + 1e-12)))

    result_components = []
    for i, cid in enumerate(component_ids):
        lib = COMPONENT_LIBRARY.get(cid, {"name": cid, "color": "#6b7280"})
        result_components.append({
            "id":       cid,
            "name":     lib["name"],
            "fraction": round(float(fractions_norm[i]) * (1 - residual), 4),
            "color":    lib["color"],
        })

    return {
        "components": result_components,
        "residual":   round(residual, 4),
    }
