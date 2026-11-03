"""Curated variable-star catalog and unified target lookup (no network)."""

from __future__ import annotations

import pytest

from app import catalog, targets
from app.astrolog.headers import normalize_object
from app.variables import catalog as vcat

IDS = {"var:ss-cyg", "var:u-gem", "var:r-leo", "var:t-crb"}


def test_four_curated_stars_with_provenance():
    stars = vcat.all_stars()
    assert {s["id"] for s in stars} == IDS
    for s in stars:
        assert s["source_url"].startswith("https://vsx.aavso.org/index.php?view=detail.top&oid=")
        assert s["retrieved"]
        assert s["source"] == "AAVSO VSX"


def test_alert_rules_match_spec():
    def rule(i):
        a = vcat.get_star(i)["alert"]
        return None if a is None else (a["brighter_than"], a["min_observers"])

    assert rule("var:ss-cyg") == (10.0, 2)
    assert rule("var:u-gem") == (11.0, 2)
    assert rule("var:t-crb") == (8.0, 3)
    assert rule("var:r-leo") is None


def test_lookup_resolves_both_kinds():
    dso_id = catalog.all_targets()[0]["id"]
    assert targets.lookup(dso_id) == catalog.get_target(dso_id)
    assert targets.lookup("m27") == catalog.get_target("m27")
    v = targets.lookup("var:t-crb")
    assert v["kind"] == "variable" and v["category"] == "variable"
    assert set(v) == {
        "id", "primary_designation", "name", "category", "kind",
        "constellation", "ra_deg", "dec_deg",
    }
    assert targets.lookup("var:nope") is None
    assert targets.is_variable("var:t-crb") and not targets.is_variable("m27")
    assert not targets.is_variable("var:nope")


def test_dso_catalog_unchanged():
    assert len(catalog.all_targets()) == 58
    assert not any(t["id"].startswith("var:") for t in catalog.all_targets())
    assert catalog.get_target("var:t-crb") is None


def test_alias_index():
    idx = vcat.alias_index()
    assert idx[normalize_object("SS Cygni")] == "var:ss-cyg"
    assert idx[normalize_object("Blaze Star")] == "var:t-crb"
    assert idx[normalize_object("ss_cyg")] == "var:ss-cyg"


def test_slug_and_id_access():
    assert vcat.star_by_slug("ss-cyg")["id"] == "var:ss-cyg"
    assert vcat.get_star("var:ss-cyg")["slug"] == "ss-cyg"
    assert vcat.get_star("ss-cyg") is None
    assert vcat.star_by_slug("nope") is None


def test_t_crb_coordinates_match_vsx():
    s = vcat.get_star("var:t-crb")
    assert s["ra_deg"] == pytest.approx(239.87567, abs=1e-4)
    assert s["dec_deg"] == pytest.approx(25.92017, abs=1e-4)
    assert s["vsx"]["oid"] == 10602
    assert s["vsx"]["variability_type"] == "NR+ELL"
    assert (s["vsx"]["max_mag"], s["vsx"]["min_mag"]) == (2.0, 10.8)
    assert s["history_windows"][0]["key"] == "1946"
