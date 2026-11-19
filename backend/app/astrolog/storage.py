"""Preview storage: the local filesystem for development, Supabase Storage for a hosted deploy."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx


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


class StorageError(RuntimeError):
    """The storage service failed (not a missing key)."""


class SupabaseStorage:
    """Stores objects in a private Supabase Storage bucket over its REST API.

    ``key`` is the project's secret key (``sb_secret_…``) or a legacy ``service_role`` JWT. It lives only on the
    server: the browser never talks to Supabase; it fetches previews through this API as before.
    """

    def __init__(self, url: str, key: str, bucket: str, client: httpx.Client | None = None):
        if not url or not key or not bucket:
            raise ValueError("Supabase storage needs a URL, a secret key and a bucket name")
        headers = {"apikey": key}
        if not key.startswith("sb_"):  # a legacy service_role key is a JWT and also goes on Authorization
            headers["Authorization"] = f"Bearer {key}"
        self.base = url.rstrip("/") + "/storage/v1/object"
        self.bucket = bucket
        self.client = client or httpx.Client(timeout=30.0)
        self.headers = headers

    def _url(self, key: str) -> str:
        if not key or key.startswith("/") or ".." in key.split("/"):
            raise ValueError("invalid storage key")
        return f"{self.base}/{quote(self.bucket)}/{quote(key, safe='/')}"

    @staticmethod
    def _fail(what: str, r: httpx.Response) -> StorageError:
        return StorageError(f"Supabase Storage {what} failed with HTTP {r.status_code}")

    def _send(self, what: str, method: str, url: str, **kw) -> httpx.Response:
        try:
            return self.client.request(method, url, **kw)
        except httpx.HTTPError as exc:  # network trouble is a storage failure, never a missing key
            raise StorageError(f"Supabase Storage {what} failed: {type(exc).__name__}") from exc

    def put(self, key: str, data: bytes, content_type: str) -> None:
        r = self._send("upload", "POST", self._url(key), content=data,
                       headers={**self.headers, "Content-Type": content_type, "x-upsert": "true"})
        if r.status_code >= 300:
            raise self._fail("upload", r)

    def get(self, key: str) -> bytes:
        r = self._send("download", "GET", self._url(key), headers=self.headers)
        if r.status_code == 200:
            return r.content
        if _is_not_found(r):
            raise KeyError(key)
        raise self._fail("download", r)

    def delete(self, key: str) -> None:
        self._url(key)  # validate the key the same way as put/get
        r = self._send("delete", "DELETE", f"{self.base}/{quote(self.bucket)}", json={"prefixes": [key]},
                       headers=self.headers)
        if r.status_code >= 300 and not _is_not_found(r):
            raise self._fail("delete", r)


def _is_not_found(r: httpx.Response) -> bool:
    """Supabase Storage reports a missing object as 404, or (older versions) as 400 with statusCode "404"."""
    if r.status_code == 404:
        return True
    if r.status_code == 400:
        try:
            body = r.json()
        except ValueError:
            return False
        return isinstance(body, dict) and (str(body.get("statusCode")) == "404" or body.get("error") == "not_found")
    return False


def storage_from_env(default_root: Path) -> Storage:
    """Supabase Storage when SUPABASE_URL and SUPABASE_SECRET_KEY are set, else files under ``default_root``.

    Setting only one of the two fails loudly instead of silently writing to a disk a free host wipes on restart.
    """
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if url or key:
        if not (url and key):
            raise RuntimeError("Set both SUPABASE_URL and SUPABASE_SECRET_KEY, or neither")
        return SupabaseStorage(url, key, os.environ.get("ASTROPLANNER_STORAGE_BUCKET", "").strip() or "previews")
    return LocalStorage(Path(os.environ.get("ASTROPLANNER_PREVIEWS_DIR") or default_root))
