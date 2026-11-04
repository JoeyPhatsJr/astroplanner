"""One rule for a folder name that may be written into a Siril script line or comment.

Used on the way in (``report.py``, the browser-supplied Siril folder names) and on the way out (``scripts.py``),
so a name with a line break can never end a ``#`` comment and start a command of its own.
"""

from __future__ import annotations

__all__ = ["is_plain_folder_name"]

_FORBIDDEN = "/\\~\"'"


def is_plain_folder_name(name: object) -> bool:
    """True for one plain folder name: non-empty, not ``.``/``..``, no surrounding whitespace, printable (so no
    line breaks, tabs or other control characters), none of ``/ \\ ~ " '``, and not starting with ``-``."""
    return (isinstance(name, str) and bool(name) and name == name.strip() and name not in (".", "..")
            and name.isprintable() and not any(c in name for c in _FORBIDDEN) and not name.startswith("-"))
