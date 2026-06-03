"""
JASPER Node base class and parameter descriptor system.

Every pre-processing transform is a Node subclass.
The param descriptors auto-generate the UI inspector form in the frontend.

Usage:
    from jasper.node import Node, param

    class SavGol(Node):
        name   = "Savitzky–Golay"
        family = "smoothing"
        code   = "AT_3_2"

        window = param.Int("Window", default=11, min=3, max=51, odd=True)
        poly   = param.Int("Polynomial", default=2, min=0, max=5)
        deriv  = param.Int("Derivative", default=0, min=0, max=4)

        def apply(self, ys: list[float]) -> list[float]:
            from scipy.signal import savgol_filter
            return savgol_filter(ys, self.window, self.poly, self.deriv).tolist()
"""

from __future__ import annotations
from typing import Any


class ParamDescriptor:
    """Base class for node parameter descriptors."""
    def __init__(self, label: str, default: Any, **kwargs):
        self.label   = label
        self.default = default
        self.meta    = kwargs

    def to_dict(self) -> dict:
        return {"label": self.label, "default": self.default, **self.meta}


class _ParamFactory:
    @staticmethod
    def Int(label: str, default: int = 0, **kwargs) -> ParamDescriptor:
        return ParamDescriptor(label, default, type="int", **kwargs)

    @staticmethod
    def Float(label: str, default: float = 0.0, **kwargs) -> ParamDescriptor:
        return ParamDescriptor(label, default, type="float", **kwargs)

    @staticmethod
    def Choice(label: str, options: list[str], default: str = "", **kwargs) -> ParamDescriptor:
        return ParamDescriptor(label, default or options[0], type="choice", options=options, **kwargs)


param = _ParamFactory()


class NodeMeta(type):
    """Metaclass that collects param descriptors from class body."""
    def __new__(mcs, name, bases, namespace):
        descriptors = {}
        for k, v in list(namespace.items()):
            if isinstance(v, ParamDescriptor):
                descriptors[k] = v

        cls = super().__new__(mcs, name, bases, namespace)
        cls._param_descriptors = descriptors
        return cls


class Node(metaclass=NodeMeta):
    """Base class for all JASPER pre-processing nodes."""
    name:   str = "Node"
    family: str = "transform"
    code:   str = ""

    def __init__(self, **params):
        # Apply param defaults, then override with provided values
        for k, desc in self._param_descriptors.items():
            setattr(self, k, params.get(k, desc.default))

    def apply(self, ys: list[float]) -> list[float]:
        """Apply this transform to a spectrum's y-values. Override in subclasses."""
        return ys

    @classmethod
    def manifest(cls) -> dict:
        """Return JSON-serialisable descriptor for the frontend form."""
        return {
            "kind":   cls.code.lower().replace("_", "-") if cls.code else cls.name.lower(),
            "name":   cls.name,
            "family": cls.family,
            "code":   cls.code,
            "params": {k: v.to_dict() for k, v in cls._param_descriptors.items()},
        }


# ── Plugin registry ───────────────────────────────────────────────────────────

_REGISTRY: dict[str, type[Node]] = {}


def register(cls: type[Node]) -> type[Node]:
    """Decorator: register a Node subclass under its code."""
    _REGISTRY[cls.code] = cls
    return cls


def get_node(code: str) -> type[Node] | None:
    return _REGISTRY.get(code)


def all_nodes() -> list[type[Node]]:
    return list(_REGISTRY.values())


def load_plugins(plugin_dir: str) -> int:
    """Import every *.py in plugin_dir; Node subclasses self-register via @register.

    Returns the number of plugin files successfully loaded.
    """
    import os, sys, glob, importlib.util

    if not os.path.isdir(plugin_dir):
        return 0

    loaded = 0
    for path in sorted(glob.glob(os.path.join(plugin_dir, "*.py"))):
        mod_name = "jasper_plugin_" + os.path.splitext(os.path.basename(path))[0]
        spec = importlib.util.spec_from_file_location(mod_name, path)
        if not (spec and spec.loader):
            continue
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            loaded += 1
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"[plugin] failed to load {path}: {exc}", file=sys.stderr, flush=True)
    return loaded
