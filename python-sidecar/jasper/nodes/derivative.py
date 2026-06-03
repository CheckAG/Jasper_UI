import numpy as np
from jasper.node import Node, param, register


@register
class DerivNode(Node):
    """Nth-order derivative via finite differences — AT_4_2."""
    name   = "Derivative"
    family = "derivative"
    code   = "AT_4_2"

    order = param.Int("Order", default=1, min=1, max=4)

    def apply(self, ys: list[float]) -> list[float]:
        a = np.array(ys, dtype=np.float64)
        for _ in range(self.order):
            a = np.gradient(a)
        return a.tolist()
