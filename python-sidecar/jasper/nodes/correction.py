import numpy as np
from scipy.signal import detrend as scipy_detrend
from jasper.node import Node, param, register


@register
class SNVNode(Node):
    """Standard Normal Variate scatter correction — AT_1_1."""
    name   = "SNV"
    family = "correction"
    code   = "AT_1_1"

    def apply(self, ys: list[float]) -> list[float]:
        a = np.array(ys, dtype=np.float64)
        mu = a.mean()
        sd = a.std(ddof=1)
        if sd < 1e-12:
            return ys
        return ((a - mu) / sd).tolist()


@register
class MSCNode(Node):
    """Multiplicative Scatter Correction — AT_1_2.

    Corrects against the mean spectrum of all captures passed in context.
    When applied to a single spectrum, falls back to SNV behavior.
    """
    name   = "MSC"
    family = "correction"
    code   = "AT_1_2"

    def apply(self, ys: list[float], reference: list[float] | None = None) -> list[float]:
        a = np.array(ys, dtype=np.float64)
        if reference is None:
            # No reference — degenerate to mean-centering
            return (a - a.mean()).tolist()
        ref = np.array(reference, dtype=np.float64)
        # Fit a + b * ref = ys  (least-squares)
        coeffs = np.polyfit(ref, a, 1)
        b, intercept = coeffs[0], coeffs[1]
        corrected = (a - intercept) / (b if abs(b) > 1e-12 else 1.0)
        return corrected.tolist()


@register
class DetrendNode(Node):
    """Remove global linear trend (detrend) — AT_1_3."""
    name   = "Detrend"
    family = "correction"
    code   = "AT_1_3"

    def apply(self, ys: list[float]) -> list[float]:
        return scipy_detrend(ys, type="linear").tolist()
