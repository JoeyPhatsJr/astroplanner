"""End-to-end API behaviour with a stubbed weather provider (no network)."""

from __future__ import annotations

from datetime import datetime

from .conftest import PHILLY_PARAMS


def _ts(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def test_health_and_about(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["catalog_targets"] >= 20
    about = client.get("/api/about").json()
    assert any(s["name"] == "OpenNGC" and s["license"] == "CC-BY-SA-4.0" for s in about["data_sources"])


def test_catalog_has_20plus_sourced_unique_targets(client):
    r = client.get("/api/targets").json()
    ids = [t["id"] for t in r["targets"]]
    assert len(ids) >= 20 and len(ids) == len(set(ids))
    assert all(t["source_url"].startswith("https://github.com/mattiaverga/OpenNGC") for t in r["targets"])
    assert {t["category"] for t in r["targets"]} == {"galaxy", "nebula", "cluster"}


def test_catalog_search_and_filter(client):
    # "orion" matches M42 (Orion Nebula) and IC 434 (OpenNGC common name "Orion B")
    assert [t["id"] for t in client.get("/api/targets", params={"query": "orion"}).json()["targets"]] == ["m42", "ic434"]
    assert [t["id"] for t in client.get("/api/targets", params={"query": "whirlpool"}).json()["targets"]] == ["m51"]
    assert client.get("/api/targets", params={"query": "NGC 224"}).json()["targets"][0]["id"] == "m31"
    gal = client.get("/api/targets", params={"category": "galaxy"}).json()["targets"]
    assert gal and all(t["category"] == "galaxy" for t in gal)


def test_tonight_with_forecast(client):
    j = client.get("/api/tonight", params=PHILLY_PARAMS).json()
    assert j["forecast"]["status"] == "ok" and j["forecast"]["source"]["provider"] == "Open-Meteo"
    s = j["score"]
    assert s["kind"] == "heuristic" and s["total"] is not None
    assert abs(s["total"] - sum(c["points"] for c in s["components"])) <= 0.051
    nc = j["night_clear"]
    assert nc is None or set(nc) == {"start_utc", "end_utc", "minutes", "rule"}
    assert "night_clear" in j


def test_tonight_when_provider_fails(make_client, failing_provider):
    with make_client(failing_provider) as c:
        j = c.get("/api/tonight", params=PHILLY_PARAMS).json()
        assert j["forecast"]["status"] == "error" and j["forecast"]["hourly"] == []
        assert j["score"]["total"] is None and j["score"]["status"] == "no_weather"
        assert j["night_clear"] is None
        recs = c.get("/api/recommendations", params=PHILLY_PARAMS).json()
        scored = [r for r in recs["results"] if r["score"]["total"] is not None]
        assert scored and all(r["score"]["max_total"] == 75 for r in scored)


def test_recommendations_only_recommend_dark_hours(client):
    j = client.get("/api/recommendations", params={**PHILLY_PARAMS, "equipment_id": "seestar-s30"}).json()
    night = client.get("/api/night", params=PHILLY_PARAMS).json()
    dark = [(_ts(d["start_utc"]), _ts(d["end_utc"])) for d in night["dark_intervals"]]
    observable = [r for r in j["results"] if r["visibility"]["can_observe"]]
    assert observable and j["observable_count"] == len(observable)
    for r in observable:
        w = r["visibility"]["best_window"]
        s, e = _ts(w["start_utc"]), _ts(w["end_utc"])
        assert any(ds - 1 <= s and e <= de + 1 for ds, de in dark)
        assert w["minutes"] >= 30 and r["visibility"]["max_alt_dark_deg"] >= 30
    # ranked: all observable first
    statuses = [r["visibility"]["status"] for r in j["results"]]
    assert statuses[: len(observable)] == ["observable"] * len(observable)


def test_visibility_endpoint_and_validation(client):
    r = client.get("/api/targets/m42/visibility", params=PHILLY_PARAMS)
    assert r.status_code == 200
    j = r.json()
    assert len(j["visibility"]["series"]["alt_deg"]) == len(j["visibility"]["series"]["t_ms"])
    assert client.get("/api/targets/nope/visibility", params=PHILLY_PARAMS).status_code == 404
    assert client.get("/api/night", params={**PHILLY_PARAMS, "timezone": "Mars/Olympus"}).status_code == 422
    assert client.get("/api/night", params={**PHILLY_PARAMS, "lat": 95}).status_code == 422


def test_seed_data_and_preset_immutability(client):
    eq = client.get("/api/equipment").json()
    s30 = next(e for e in eq if e["id"] == "seestar-s30")
    assert s30["aperture_mm"] == 30 and s30["focal_length_mm"] == 150 and s30["fov_deg"] == 2.46
    assert s30["fov_definition"] == "unknown" and s30["is_verified"] and s30["is_preset"]
    assert s30["focal_ratio"] == 5.0
    assert client.patch("/api/equipment/seestar-s30", json={"fov_deg": 3}).status_code == 403
    assert client.delete("/api/equipment/seestar-s30").status_code == 403
    copy = client.post("/api/equipment/seestar-s30/duplicate").json()
    assert not copy["is_preset"] and not copy["is_verified"]
    assert client.patch(f"/api/equipment/{copy['id']}", json={"fov_deg": 2.5}).json()["fov_deg"] == 2.5
    locs = client.get("/api/locations").json()
    assert len(locs) == 1 and locs[0]["is_sample"] and "Sample" in locs[0]["label"]


def test_location_validation_and_edit(client):
    bad = client.post("/api/locations", json={"label": "X", "latitude_deg": 10, "longitude_deg": 10, "timezone": "Nowhere/City"})
    assert bad.status_code == 422
    loc = client.post("/api/locations", json={"label": "Backyard", "latitude_deg": 32.2, "longitude_deg": -110.9,
                                               "elevation_m": 760, "timezone": "America/Phoenix"}).json()
    assert loc["is_sample"] is False
    sample = client.patch("/api/locations/sample-location", json={"label": "Home"}).json()
    assert sample["is_sample"] is False and sample["label"] == "Home"


def test_session_lifecycle_persists_across_restart(make_client, clear_provider, tmp_path):
    db_path = tmp_path / "persist.db"
    with make_client(clear_provider, db_path) as c:
        s = c.post("/api/sessions", json={"title": "Night of 2 Nov", "local_night_date": "2026-11-02",
                                           "location_id": "sample-location", "equipment_id": "seestar-s30"}).json()
        sid = s["id"]
        for tid in ["m31", "m42", "m45"]:
            s = c.post(f"/api/sessions/{sid}/targets", json={"target_id": tid}).json()
        assert [t["target_id"] for t in s["targets"]] == ["m31", "m42", "m45"]
        assert c.post(f"/api/sessions/{sid}/targets", json={"target_id": "m31"}).status_code == 409
        assert c.post(f"/api/sessions/{sid}/targets", json={"target_id": "zzz"}).status_code == 422
        ids = [t["id"] for t in s["targets"]]
        s = c.put(f"/api/sessions/{sid}/targets/order", json={"session_target_ids": [ids[2], ids[0], ids[1]]}).json()
        assert [t["target_id"] for t in s["targets"]] == ["m45", "m31", "m42"]
        assert c.put(f"/api/sessions/{sid}/targets/order", json={"session_target_ids": ids[:2]}).status_code == 422
        s = c.delete(f"/api/sessions/{sid}/targets/{ids[0]}").json()  # remove m31
        assert [t["target_id"] for t in s["targets"]] == ["m45", "m42"]
        assert [t["sort_order"] for t in s["targets"]] == [0, 1]
        c.patch(f"/api/sessions/{sid}", json={"notes": "bring dew heater"})
        assert c.delete("/api/locations/sample-location").status_code == 409  # in use

    with make_client(clear_provider, db_path) as c2:  # fresh app, same database file
        s = c2.get(f"/api/sessions/{sid}").json()
        assert [t["target_id"] for t in s["targets"]] == ["m45", "m42"] and s["notes"] == "bring dew heater"
        assert c2.delete(f"/api/sessions/{sid}").status_code == 204
        assert c2.get(f"/api/sessions/{sid}").status_code == 404


def test_session_timestamps_require_timezone(client):
    s = client.post("/api/sessions", json={"title": "T", "local_night_date": "2026-11-02"}).json()
    r = client.post(f"/api/sessions/{s['id']}/targets", json={"target_id": "m31", "planned_start_utc": "2026-11-03T01:00:00"})
    assert r.status_code == 422
    r = client.post(f"/api/sessions/{s['id']}/targets", json={"target_id": "m31", "planned_start_utc": "2026-11-03T01:00:00Z"})
    assert r.json()["targets"][0]["planned_start_utc"] == "2026-11-03T01:00:00Z"


def test_app_starts_when_frontend_dist_exists_without_assets(tmp_path, monkeypatch, make_client, clear_provider):
    """M10: a half-built frontend/dist (index.html but no assets/) must not crash startup."""
    import app.main as main

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>AstroPlanner</title>", encoding="utf-8")
    monkeypatch.setattr(main, "FRONTEND_DIST", dist)
    with make_client(clear_provider) as c:
        assert c.get("/api/health").status_code == 200
        assert "AstroPlanner" in c.get("/tonight").text
