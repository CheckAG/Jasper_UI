import numpy as np
from scipy.signal import savgol_filter
from jasper.node import Node, param, register


@register
class BoxcarNode(Node):
    """Moving-average (boxcar) smoothing — AT_3_1."""
    name   = "Boxcar smooth"
    family = "smoothing"
    code   = "AT_3_1"

    window = param.Int("Window", default=9, min=3, max=51, odd=True)

    def apply(self, ys: list[float]) -> list[float]:
        w = max(3, self.window | 1)  # force odd
        kernel = np.ones(w) / w
        return np.convolve(ys, kernel, mode="same").tolist()


@register
class SavGolNode(Node):
    """Savitzky–Golay smoothing / derivative — AT_3_2."""
    name   = "Savitzky–Golay"
    family = "smoothing"
    code   = "AT_3_2"

    window = param.Int("Window",     default=11, min=3,  max=51, odd=True)
    poly   = param.Int("Polynomial", default=2,  min=0,  max=5)
    deriv  = param.Int("Derivative", default=0,  min=0,  max=4)

    def apply(self, ys: list[float]) -> list[float]:
        w = max(self.poly + 2, self.window | 1)  # window must be > poly and odd
        w = min(w, len(ys) if len(ys) % 2 == 1 else len(ys) - 1)  # clamp to data size
        if w < self.poly + 2:
            return ys  # not enough data
        return savgol_filter(ys, w, self.poly, self.deriv).tolist()
