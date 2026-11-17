"""Hosted-deploy seams: Supabase Storage adapter, storage selection from env, and the upload limit."""

from __future__ import annotations

import json

import httpx
import pytest

from app.astrolog.storage import LocalStorage, StorageError, SupabaseStorage, storage_from_env
from app.main import MAX_UPLOAD_BYTES, max_upload_bytes_from_env

URL = "https://proj.supabase.co"


class FakeStorageAPI:
    """An in-memory stand-in for the Supabase Storage REST API, built only for these tests."""

    def __init__(self, legacy_not_found: bool = False):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.requests: list[httpx.Request] = []
        self.legacy_not_found = legacy_not_found

    def not_found(self) -> httpx.Response:
        if self.legacy_not_found:
            return httpx.Response(400, json={"statusCode": "404", "error": "not_found", "message": "Object not found"})
        return httpx.Response(404, json={"error": "not_found"})

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        prefix = "/storage/v1/object/"
        assert req.url.path.startswith(prefix)
        rest = req.url.path[len(prefix):]
        if req.method == "DELETE":
            bucket = rest
            for k in json.loads(req.content)["prefixes"]:
                self.objects.pop(f"{bucket}/{k}", None)
            return httpx.Response(200, json=[])
        if req.method == "POST":
            assert req.headers["x-upsert"] == "true"
            self.objects[rest] = (req.content, req.headers["content-type"])
            return httpx.Response(200, json={"Key": rest})
        if req.method == "GET":
            if rest not in self.objects:
                return self.not_found()
            return httpx.Response(200, content=self.objects[rest][0])
        return httpx.Response(405)


def make(api, key="sb_secret_abc", bucket="previews") -> SupabaseStorage:
    return SupabaseStorage(URL, key, bucket, client=httpx.Client(transport=httpx.MockTransport(api)))


@pytest.mark.parametrize("legacy", [False, True])
def test_supabase_round_trip_and_missing_keys(legacy):
    api = FakeStorageAPI(legacy_not_found=legacy)
    s = make(api)
    s.put("processing/run1/a-preview.jpg", b"jpeg-bytes", "image/jpeg")
    assert api.objects["previews/processing/run1/a-preview.jpg"] == (b"jpeg-bytes", "image/jpeg")
    assert s.get("processing/run1/a-preview.jpg") == b"jpeg-bytes"
    s.put("processing/run1/a-preview.jpg", b"newer", "image/jpeg")  # upsert overwrites
    assert s.get("processing/run1/a-preview.jpg") == b"newer"
    s.delete("processing/run1/a-preview.jpg")
    with pytest.raises(KeyError):
        s.get("processing/run1/a-preview.jpg")
    s.delete("processing/run1/a-preview.jpg")  # a missing key is not an error


def test_secret_key_goes_on_apikey_header_only():
    api = FakeStorageAPI()
    make(api, key="sb_secret_abc").put("x/thumb.jpg", b"1", "image/jpeg")
    req = api.requests[-1]
    assert req.headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in req.headers  # new keys are not JWTs


def test_legacy_service_role_jwt_also_goes_on_authorization():
    api = FakeStorageAPI()
    make(api, key="eyJhbGciOi.legacy.jwt").put("x/thumb.jpg", b"1", "image/jpeg")
    assert api.requests[-1].headers["authorization"] == "Bearer eyJhbGciOi.legacy.jwt"


@pytest.mark.parametrize("bad", ["", "/abs", "a/../b", ".."])
def test_supabase_rejects_unsafe_keys(bad):
    s = make(FakeStorageAPI())
    with pytest.raises(ValueError):
        s.put(bad, b"1", "image/jpeg")


def test_service_errors_are_storage_errors_not_missing_keys():
    s = make(lambda req: httpx.Response(500, json={"error": "boom"}))
    with pytest.raises(StorageError):
        s.get("x/preview.jpg")
    with pytest.raises(StorageError):
        s.put("x/preview.jpg", b"1", "image/jpeg")
    with pytest.raises(StorageError):
        s.delete("x/preview.jpg")


def test_network_errors_are_storage_errors():
    def offline(req):
        raise httpx.ConnectError("offline")
    with pytest.raises(StorageError):
        make(offline).get("x/preview.jpg")


def test_storage_from_env_picks_supabase_only_with_both_settings(monkeypatch, tmp_path):
    for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "ASTROPLANNER_STORAGE_BUCKET", "ASTROPLANNER_PREVIEWS_DIR"):
        monkeypatch.delenv(k, raising=False)
    assert isinstance(storage_from_env(tmp_path), LocalStorage)
    monkeypatch.setenv("SUPABASE_URL", URL)
    with pytest.raises(RuntimeError):  # half-configured must not fall back to a disk that gets wiped
        storage_from_env(tmp_path)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_abc")
    s = storage_from_env(tmp_path)
    assert isinstance(s, SupabaseStorage) and s.bucket == "previews"
    monkeypatch.setenv("ASTROPLANNER_STORAGE_BUCKET", "astro")
    assert storage_from_env(tmp_path).bucket == "astro"


@pytest.mark.parametrize("raw,expected", [
    ("", MAX_UPLOAD_BYTES), ("junk", MAX_UPLOAD_BYTES), ("0", MAX_UPLOAD_BYTES), ("-5", MAX_UPLOAD_BYTES),
    ("500", MAX_UPLOAD_BYTES),  # can only lower the limit
    ("25", 25 * 1024 * 1024), ("4", 4 * 1024 * 1024),
])
def test_upload_limit_from_env(monkeypatch, raw, expected):
    monkeypatch.setenv("ASTROPLANNER_MAX_UPLOAD_MB", raw)
    assert max_upload_bytes_from_env() == expected


def test_limits_endpoint_reports_the_upload_limit(make_client, clear_provider):
    with make_client(clear_provider, max_upload_bytes=4 * 1024 * 1024) as c:
        assert c.get("/api/limits").json() == {"max_upload_mb": 4.0}


def test_storage_outage_is_a_503_with_a_plain_message(make_client, clear_provider, tmp_path):
    from app.astrolog.storage import LocalStorage

    class Broken(LocalStorage):
        def get(self, key):
            raise StorageError("down")

    app_client = make_client(clear_provider, storage=Broken(tmp_path / "p"))
    app = app_client.app

    @app.get("/api/_test_storage")
    def _probe():
        return app.state.storage.get("k")

    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the SPA catch-all when dist/ is built

    with app_client as c:
        r = c.get("/api/_test_storage")
    assert r.status_code == 503
    assert "Image storage is unavailable" in r.json()["detail"]
