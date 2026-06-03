"""PCA exploration — CM_2."""
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


def run_pca(spectra: list[list[float]], labels: list[str], n_components: int = 5) -> dict:
    """
    Run PCA on a set of spectra.

    Args:
        spectra:     List of ys arrays (one per capture)
        labels:      Corresponding label strings
        n_components: Number of principal components to compute

    Returns dict with:
        scores:             [[pc1, pc2, ...] per sample]
        loadings:           [[loading per wavelength] per PC]
        explained_variance: fraction of variance per PC
        labels:             echo back for frontend correlation
    """
    X = np.array(spectra, dtype=np.float64)
    n_comp = min(n_components, X.shape[0], X.shape[1])

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    pca = PCA(n_components=n_comp)
    scores = pca.fit_transform(Xs)

    return {
        "scores":             scores.tolist(),
        "loadings":           pca.components_.tolist(),
        "explained_variance": pca.explained_variance_ratio_.tolist(),
        "labels":             labels,
    }
