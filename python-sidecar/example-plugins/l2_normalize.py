"""
Example JASPER plugin — drop a copy into ~/jasper/plugins/ and click
"⟳ Plugins" in the Analyze workspace to load it.

A plugin is just a Node subclass decorated with @register. The param
descriptors automatically generate the inspector form in the UI.
"""
import numpy as np
from jasper.node import Node, param, register


@register
class L2NormalizeNode(Node):
    name   = "Vector normalize (L2)"
    family = "normalization"
    code   = "PLUGIN_L2"

    scale = param.Float("Scale", default=1.0, min=0.1, max=10.0)

    def apply(self, ys: list[float]) -> list[float]:
        a = np.array(ys, dtype=np.float64)
        norm = np.linalg.norm(a)
        if norm < 1e-12:
            return ys
        return (a / norm * self.scale).tolist()
