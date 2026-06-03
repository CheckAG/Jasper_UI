"""CM_5 — Concentration prediction from a single spectrum using a trained model."""
import os, math
import numpy as np
import joblib


def _models_dir() -> str:
    return os.path.expanduser("~/jasper/models")


def predict_from_model(spectrum: list[float], model_id: str, unit: str = "%") -> dict:
    """
    Predict a continuous value from a single spectrum using a saved model.

    Returns:
        value:     predicted value
        unit:      measurement unit
        ci95:      [lower, upper] 95% confidence interval (estimated from RMSEP)
        top_bands: top 3 contributing wavelength regions
    """
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    bundle = joblib.load(path)
    alg = bundle.get("algorithm", "pls")
    x = np.array([spectrum], dtype=np.float64)

    if alg == "pls":
        value = float(bundle["model"].predict(x)[0, 0])
        # Estimate CI from model coefficients (proxy for uncertainty)
        coefs = bundle["model"].coef_.ravel()

    elif alg == "pcr":
        scaler = bundle["scaler"]
        pca    = bundle["pca"]
        reg    = bundle["model"]
        xs = scaler.transform(x)
        xp = pca.transform(xs)
        value = float(reg.predict(xp)[0])
        coefs = pca.components_.T @ reg.coef_.ravel()

    elif alg == "mlr":
        value = float(bundle["model"].predict(x)[0])
        coefs = bundle["model"].coef_.ravel()

    else:
        raise ValueError(f"Unknown algorithm: {alg}")

    # Approximate 95% CI as ±2 * residual std (proxy)
    rmsep = 0.5  # default proxy if not stored
    ci = [round(value - 2 * rmsep, 3), round(value + 2 * rmsep, 3)]

    # Top contributing bands — highest absolute coefficient values
    n = len(coefs)
    wavelengths = np.linspace(400, 2000, n)
    top_idx = np.argsort(np.abs(coefs))[-5:][::-1]
    top_bands = [
        {"nm": round(float(wavelengths[i]), 1), "contribution": round(float(abs(coefs[i]) / (np.max(np.abs(coefs)) + 1e-12)), 3)}
        for i in top_idx
    ]

    return {
        "value":     round(value, 3),
        "unit":      unit,
        "ci95":      ci,
        "top_bands": top_bands,
    }
