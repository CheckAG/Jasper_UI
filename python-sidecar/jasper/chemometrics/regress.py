"""Regression models — CM_4: PLS, PCR, MLR."""
import os, uuid, math
import numpy as np
import joblib
from sklearn.cross_decomposition import PLSRegression
from sklearn.decomposition import PCA
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_predict
from sklearn.preprocessing import StandardScaler


def _models_dir() -> str:
    d = os.path.expanduser("~/jasper/models")
    os.makedirs(d, exist_ok=True)
    return d


def _rmsep(y_true, y_pred) -> float:
    return float(math.sqrt(np.mean((np.array(y_true) - np.array(y_pred)) ** 2)))


def _r2(y_true, y_pred) -> float:
    yt = np.array(y_true)
    yp = np.array(y_pred)
    ss_res = np.sum((yt - yp) ** 2)
    ss_tot = np.sum((yt - yt.mean()) ** 2)
    return float(1 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0


def train_pls(
    spectra: list[list[float]],
    targets: list[float],
    n_components: int = 4,
    model_id: str | None = None,
    created_by: str = "User",
) -> dict:
    X = np.array(spectra, dtype=np.float64)
    y = np.array(targets, dtype=np.float64)
    n_comp = min(n_components, X.shape[0] - 1, X.shape[1])

    model = PLSRegression(n_components=n_comp)
    y_cv  = cross_val_predict(model, X, y, cv=min(5, len(y))).ravel()
    model.fit(X, y)

    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"model": model, "algorithm": "pls", "scaler": None}, path)

    return {
        "model_id":    model_id,
        "algorithm":   "pls",
        "file_path":   path,
        "n_components": n_comp,
        "rmsep":       _rmsep(y, y_cv),
        "r2":          _r2(y, y_cv),
        "bias":        float(np.mean(y_cv - y)),
        "predicted":   y_cv.tolist(),
        "actual":      y.tolist(),
    }


def train_pcr(
    spectra: list[list[float]],
    targets: list[float],
    n_components: int = 4,
    model_id: str | None = None,
    created_by: str = "User",
) -> dict:
    X = np.array(spectra, dtype=np.float64)
    y = np.array(targets, dtype=np.float64)
    n_comp = min(n_components, X.shape[0] - 1, X.shape[1])

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    pca = PCA(n_components=n_comp)
    Xp = pca.fit_transform(Xs)
    reg = LinearRegression()
    y_cv = cross_val_predict(reg, Xp, y, cv=min(5, len(y))).ravel()
    reg.fit(Xp, y)

    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"model": reg, "pca": pca, "scaler": scaler, "algorithm": "pcr"}, path)

    return {
        "model_id":    model_id,
        "algorithm":   "pcr",
        "file_path":   path,
        "n_components": n_comp,
        "rmsep":       _rmsep(y, y_cv),
        "r2":          _r2(y, y_cv),
        "bias":        float(np.mean(y_cv - y)),
        "predicted":   y_cv.tolist(),
        "actual":      y.tolist(),
    }


def train_mlr(
    spectra: list[list[float]],
    targets: list[float],
    model_id: str | None = None,
    created_by: str = "User",
) -> dict:
    X = np.array(spectra, dtype=np.float64)
    y = np.array(targets, dtype=np.float64)

    reg = LinearRegression()
    y_cv = cross_val_predict(reg, X, y, cv=min(5, len(y))).ravel()
    reg.fit(X, y)

    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"model": reg, "algorithm": "mlr", "scaler": None}, path)

    return {
        "model_id":    model_id,
        "algorithm":   "mlr",
        "file_path":   path,
        "n_components": X.shape[1],
        "rmsep":       _rmsep(y, y_cv),
        "r2":          _r2(y, y_cv),
        "bias":        float(np.mean(y_cv - y)),
        "predicted":   y_cv.tolist(),
        "actual":      y.tolist(),
    }


def run_regression(spectra, targets, algorithm="pls", n_components=4, **kwargs) -> dict:
    """Dispatch to the right regression trainer."""
    if algorithm == "pcr":
        return train_pcr(spectra, targets, n_components, **kwargs)
    if algorithm == "mlr":
        return train_mlr(spectra, targets, **kwargs)
    return train_pls(spectra, targets, n_components, **kwargs)
