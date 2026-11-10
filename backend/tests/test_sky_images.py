"""Sky image provider: fakes only, never the network."""

from __future__ import annotations

import io
import threading
import time

import numpy as np
import pytest
from PIL import Image

from app.sky_images import SkyImageProvider, sky_field_arcmin


def make_gif(size=(600, 400), right_band=0.0) -> bytes:
    w, h = size
    rng = np.random.default_rng(1)
    a = rng.integers(20, 200, size=(h, w), dtype=np.uint8)
    if right_band:
        a[:, w - int(w * right_band):] = 255
    out = io.BytesIO()
    Image.fromarray(a, "L").save(out, "GIF")
    return out.getvalue()


class Fetch:
    def __init__(self, body=None, delay=0.0):
        self.body = make_gif() if body is None else body
        self.delay = delay
        self.calls: list[tuple] = []

    def __call__(self, ra, dec, field):
        self.calls.append((ra, dec, field))
        if self.delay:
            time.sleep(self.delay)
        return self.body


def provider(tmp_path, fetch, **kw):
    kw.setdefault("min_interval_s", 0.0)
    return SkyImageProvider(tmp_path / "cache", fetch=fetch, **kw)


@pytest.mark.parametrize("target_id,major,expected", [
    ("m1", 9.27, 40), ("x", 60, 90), ("x", 210, 120), ("x", None, 40), ("ic1396", 170, 120), ("ic1396", None, 120),
])
def test_field_width_rule(target_id, major, expected):
    assert sky_field_arcmin(target_id, major) == expected


def test_miss_then_hit_makes_one_fetch(tmp_path):
    fetch = Fetch()
    p = provider(tmp_path, fetch)
    first = p.get("m31", 10.68, 41.27, 90)
    second = p.get("m31", 10.68, 41.27, 90)
    assert first is not None and first == second
    assert len(fetch.calls) == 1 and fetch.calls[0] == (10.68, 41.27, 90)
    with Image.open(first) as im:
        assert im.format == "JPEG" and max(im.size) <= 480


def test_cache_survives_a_new_provider(tmp_path):
    fetch = Fetch()
    provider(tmp_path, fetch).get("m31", 1, 2, 60)
    again = Fetch()
    assert provider(tmp_path, again).get("m31", 1, 2, 60) is not None
    assert again.calls == []


def test_html_body_is_failure(tmp_path):
    p = provider(tmp_path, Fetch(b"<HTML><TITLE>Error</TITLE>"))
    assert p.get("m31", 1, 2, 60) is None
    assert not (tmp_path / "cache").exists() or list((tmp_path / "cache").iterdir()) == []


def test_fetch_exception_is_failure(tmp_path):
    def boom(ra, dec, field):
        raise OSError("offline")
    assert provider(tmp_path, boom).get("m31", 1, 2, 60) is None


def test_failure_backs_off_then_retries(tmp_path):
    clock = [1000.0]
    fetch = Fetch(b"<HTML>")
    p = provider(tmp_path, fetch, retry_after_s=3600, now=lambda: clock[0], sleep=lambda s: None)
    assert p.get("m31", 1, 2, 60) is None
    clock[0] += 3599
    assert p.get("m31", 1, 2, 60) is None
    assert len(fetch.calls) == 1
    clock[0] += 2
    p.get("m31", 1, 2, 60)
    assert len(fetch.calls) == 2


def test_one_upstream_request_for_concurrent_callers(tmp_path):
    fetch = Fetch(delay=0.2)
    p = provider(tmp_path, fetch)
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(p.get("m31", 1, 2, 60))) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(fetch.calls) == 1
    assert len(results) == 8 and all(r is not None and r == results[0] for r in results)


def test_concurrent_failures_make_one_request(tmp_path):
    fetch = Fetch(b"<HTML>", delay=0.1)
    p = provider(tmp_path, fetch)
    threads = [threading.Thread(target=lambda: p.get("m31", 1, 2, 60)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(fetch.calls) == 1


def test_requests_are_spaced(tmp_path):
    clock = [0.0]
    sleeps: list[float] = []

    def sleep(s):
        sleeps.append(s)
        clock[0] += s

    p = provider(tmp_path, Fetch(), min_interval_s=1.0, now=lambda: clock[0], sleep=sleep)
    assert p.get("m31", 1, 2, 60) is not None
    clock[0] += 0.25
    assert p.get("m42", 3, 4, 60) is not None
    assert sleeps == [pytest.approx(0.75)]


def test_white_edge_band_is_trimmed(tmp_path):
    path = provider(tmp_path, Fetch(make_gif(right_band=0.05))).get("m31", 1, 2, 60)
    assert path is not None
    with Image.open(path) as im:
        a = np.asarray(im.convert("L"), dtype=float)
    assert a[:, -1].mean() < 250 and a[:, 0].mean() < 250


def test_wide_white_band_is_failure(tmp_path):
    assert provider(tmp_path, Fetch(make_gif(right_band=0.2))).get("m31", 1, 2, 60) is None


def test_disabled_never_fetches(tmp_path):
    fetch = Fetch()
    assert provider(tmp_path, fetch, enabled=False).get("m31", 1, 2, 60) is None
    assert fetch.calls == []


def test_unsafe_target_id_is_refused(tmp_path):
    fetch = Fetch()
    assert provider(tmp_path, fetch).get("../evil", 1, 2, 60) is None
    assert fetch.calls == []


def test_catalog_targets_carry_field_width(client):
    t = client.get("/api/targets/m31").json()
    assert t["sky_field_arcmin"] == 120
    assert all(isinstance(x["sky_field_arcmin"], int) for x in client.get("/api/targets").json()["targets"])


def test_route_serves_jpeg(tmp_path, make_client, clear_provider):
    fetch = Fetch()
    with make_client(clear_provider, sky_images=provider(tmp_path, fetch)) as c:
        r = c.get("/api/targets/m31/sky-image")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert r.headers["cache-control"] == "public, max-age=604800"
        assert r.content[:2] == b"\xff\xd8"
        c.get("/api/targets/m31/sky-image")
    assert len(fetch.calls) == 1


def test_route_unknown_target_is_404(tmp_path, make_client, clear_provider):
    fetch = Fetch()
    with make_client(clear_provider, sky_images=provider(tmp_path, fetch)) as c:
        assert c.get("/api/targets/nope/sky-image").status_code == 404
    assert fetch.calls == []


def test_route_unavailable_is_503(tmp_path, make_client, clear_provider):
    with make_client(clear_provider, sky_images=provider(tmp_path, Fetch(b"<HTML>"))) as c:
        assert c.get("/api/targets/m31/sky-image").status_code == 503


def test_default_test_client_never_reaches_network(client):
    assert client.get("/api/targets/m31/sky-image").status_code == 503
