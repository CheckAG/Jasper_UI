"""Classification models — CM_3: SIMCA, KNN, PLS-DA."""
import os, uuid
import numpy as np
import joblib
from sklearn.decomposition import PCA
from sklearn.neighbors import KNeighborsClassifier
from sklearn.cross_decomposition import PLSRegression
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import cross_val_predict
from sklearn.metrics import accuracy_score, confusion_matrix


def _models_dir() -> str:
    d = os.path.expanduser("~/jasper/models")
    os.makedirs(d, exist_ok=True)
    return d


def train_simca(
    spectra: list[list[float]],
    labels: list[str],
    n_components: int = 3,
    model_id: str | None = None,
    **_,
) -> dict:
    """SIMCA: per-class PCA models."""
    X = np.array(spectra, dtype=np.float64)
    classes = sorted(set(labels))
    class_models: dict = {}

    for cls in classes:
        idx = [i for i, l in enumerate(labels) if l == cls]
        Xc = X[idx]
        n_comp = min(n_components, Xc.shape[0], Xc.shape[1])
        scaler = StandardScaler()
        Xcs = scaler.fit_transform(Xc)
        pca = PCA(n_components=n_comp)
        pca.fit(Xcs)
        class_models[cls] = {"pca": pca, "scaler": scaler}

    # Predict: assign to class with lowest reconstruction error
    preds = []
    for x in X:
        best_cls, best_err = None, float("inf")
        for cls, cm in class_models.items():
            xs = cm["scaler"].transform([x])
            scores = cm["pca"].transform(xs)
            recon = cm["pca"].inverse_transform(scores)
            err = float(np.mean((xs - recon) ** 2))
            if err < best_err:
                best_err = err
                best_cls = cls
        preds.append(best_cls)

    cm_matrix = confusion_matrix(labels, preds, labels=classes)
    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"models": class_models, "classes": classes, "algorithm": "simca"}, path)

    return {
        "model_id":         model_id,
        "algorithm":        "simca",
        "file_path":        path,
        "classes":          classes,
        "accuracy":         float(accuracy_score(labels, preds)),
        "confusion_matrix": cm_matrix.tolist(),
        "labels":           labels,
        "predicted":        preds,
    }


def train_knn(
    spectra: list[list[float]],
    labels: list[str],
    k: int = 5,
    model_id: str | None = None,
    **_,
) -> dict:
    X = np.array(spectra, dtype=np.float64)
    n_neighbors = min(k, len(labels) - 1)
    model = KNeighborsClassifier(n_neighbors=max(1, n_neighbors))
    preds = cross_val_predict(model, X, labels, cv=min(5, len(labels)))
    model.fit(X, labels)

    classes = sorted(set(labels))
    cm_matrix = confusion_matrix(labels, preds, labels=classes)
    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"model": model, "algorithm": "knn"}, path)

    return {
        "model_id":         model_id,
        "algorithm":        "knn",
        "file_path":        path,
        "classes":          classes,
        "accuracy":         float(accuracy_score(labels, preds)),
        "confusion_matrix": cm_matrix.tolist(),
        "labels":           labels,
        "predicted":        list(preds),
    }


def train_plsda(
    spectra: list[list[float]],
    labels: list[str],
    n_components: int = 3,
    model_id: str | None = None,
    **_,
) -> dict:
    X = np.array(spectra, dtype=np.float64)
    le = LabelEncoder()
    y = le.fit_transform(labels).astype(float)
    n_comp = min(n_components, X.shape[0] - 1, X.shape[1])

    model = PLSRegression(n_components=n_comp)
    y_cv = cross_val_predict(model, X, y, cv=min(5, len(y))).ravel()
    model.fit(X, y)
    preds = le.inverse_transform(np.round(y_cv).astype(int).clip(0, len(le.classes_) - 1))

    classes = list(le.classes_)
    cm_matrix = confusion_matrix(labels, preds, labels=classes)
    model_id = model_id or str(uuid.uuid4())[:8]
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    joblib.dump({"model": model, "encoder": le, "algorithm": "plsda"}, path)

    return {
        "model_id":         model_id,
        "algorithm":        "plsda",
        "file_path":        path,
        "classes":          classes,
        "accuracy":         float(accuracy_score(labels, preds)),
        "confusion_matrix": cm_matrix.tolist(),
        "labels":           labels,
        "predicted":        list(preds),
    }


def train_classifier(spectra, labels, algorithm="knn", **kwargs) -> dict:
    if algorithm == "simca":
        return train_simca(spectra, labels, **kwargs)
    if algorithm == "plsda":
        return train_plsda(spectra, labels, **kwargs)
    return train_knn(spectra, labels, **kwargs)


def run_classify(spectrum: list[float], model_id: str) -> dict:
    path = os.path.join(_models_dir(), f"{model_id}.joblib")
    bundle = joblib.load(path)
    alg = bundle.get("algorithm", "knn")

    x = np.array([spectrum], dtype=np.float64)

    if alg == "knn":
        pred = bundle["model"].predict(x)[0]
        probs = bundle["model"].predict_proba(x)[0].tolist()
        return {"predicted_class": str(pred), "probabilities": probs}

    if alg == "simca":
        best_cls, best_err = None, float("inf")
        for cls, cm in bundle["models"].items():
            xs = cm["scaler"].transform(x)
            scores = cm["pca"].transform(xs)
            recon = cm["pca"].inverse_transform(scores)
            err = float(np.mean((xs - recon) ** 2))
            if err < best_err:
                best_err = err
                best_cls = cls
        return {"predicted_class": best_cls, "error": best_err}

    if alg == "plsda":
        y_pred = bundle["model"].predict(x)[0, 0]
        classes = list(bundle["encoder"].classes_)
        idx = int(round(y_pred))
        idx = max(0, min(idx, len(classes) - 1))
        return {"predicted_class": classes[idx], "score": float(y_pred)}

    return {"predicted_class": "unknown"}
