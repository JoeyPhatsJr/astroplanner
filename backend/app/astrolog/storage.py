"""Preview storage interface. Local filesystem now; Supabase Storage can implement the same Protocol."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...  # raises KeyError when missing
    def delete(self, key: str) -> None: ...  # missing key is not an error


class LocalStorage:
    """Stores objects as files under ``root``. Keys are relative paths; traversal is rejected."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        root = self.root.resolve()
        if not key or root not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise KeyError(key) from None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
