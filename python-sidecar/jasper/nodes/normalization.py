import numpy as np
from jasper.node import Node, register


@register
class NormNode(Node):
    """Normalize by peak maximum — AT_2."""
    name   = "Normalize (peak)"
    family = "normalization"
    code   = "AT_2"

    def apply(self, ys: list[float]) -> list[float]:
        a   = np.array(ys, dtype=np.float64)
        mx  = np.max(np.abs(a))
        if mx < 1e-12:
            return ys
        return (a / mx).tolist()
