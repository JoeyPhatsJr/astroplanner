"""Saved places and custom equipment are private to their owner (migration 0008_private_places).

Sample places and preset equipment are shared and read-only. Someone else's place or profile answers exactly like
a missing one (the same status and body) everywhere an id is accepted: lists, changes, plans, recommendations,
target visibility and the AstroLog import.
"""

from __future__ import annotations

from sqlalchemy import select, text

from app.accounts.models import User
from app.db import Database, EquipmentProfile, ObservingLocation, ObservingSession, SAMPLE_FALLBACK_ID

from .conftest import PHILLY_PARAMS, client_for
from .test_astrolog_import import COMMIT, PREVIEW, canon_items, commit, make_location, ngc_subs, preview

PLACE = {"label": "Home", "latitude_deg": 40.005, "longitude_deg": -75.0, "elevation_m": 50,
         "timezone": "America/New_York"}
SCOPE = {"name": "My refractor", "aperture_mm": 80, "focal_length_mm": 480}


def _place(c, **over) -> str:
    r = c.post("/api/locations", json=PLACE | over)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scope(c) -> str:
    r = c.post("/api/equipment", json=SCOPE)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _same(a, b) -> bool:
    """Two responses that cannot be told apart."""
    return (a.status_code, a.json()) == (b.status_code, b.json())


# ---- lists and changes -------------------------------------------------------------------------

def test_each_account_sees_only_its_own_places_and_equipment(two_users, client_for):
    alice, bob = two_users
    a_loc, a_eq = _place(alice), _scope(alice)
    b_loc = _place(bob, label="Bob's field")

    a_places = {x["id"] for x in alice.get("/api/locations").json()}
    b_places = {x["id"] for x in bob.get("/api/locations").json()}
    assert a_places == {"sample-location", a_loc} and b_places == {"sample-location", b_loc}
    assert a_eq in {x["id"] for x in alice.get("/api/equipment").json()}
    assert a_eq not in {x["id"] for x in bob.get("/api/equipment").json()}
    assert all(x["is_preset"] for x in bob.get("/api/equipment").json())  # Bob has no profile of his own
    for row in alice.get("/api/locations").json() + alice.get("/api/equipment").json():
        assert "owner_id" not in row  # never sent

    with client_for(alice.app, None) as anon:
        assert [x["id"] for x in anon.get("/api/locations").json()] == ["sample-location"]
        assert all(x["is_preset"] for x in anon.get("/api/equipment").json())


def test_someone_elses_place_or_profile_reads_like_a_missing_one(two_users):
    alice, bob = two_users
    a_loc, a_eq = _place(alice), _scope(alice)
    pairs = [
        (bob.patch(f"/api/locations/{a_loc}", json={"label": "Mine"}),
         bob.patch("/api/locations/nope", json={"label": "Mine"})),
        (bob.delete(f"/api/locations/{a_loc}"), bob.delete("/api/locations/nope")),
        (bob.patch(f"/api/equipment/{a_eq}", json={"notes": "mine"}),
         bob.patch("/api/equipment/nope", json={"notes": "mine"})),
        (bob.delete(f"/api/equipment/{a_eq}"), bob.delete("/api/equipment/nope")),
        (bob.post(f"/api/equipment/{a_eq}/duplicate"), bob.post("/api/equipment/nope/duplicate")),
    ]
    for foreign, missing in pairs:
        assert foreign.status_code == 404 and _same(foreign, missing), (foreign.request.url, foreign.json())
    loc = next(x for x in alice.get("/api/locations").json() if x["id"] == a_loc)
    assert loc["label"] == "Home"
    assert any(x["id"] == a_eq for x in alice.get("/api/equipment").json())


def test_every_new_place_and_profile_has_its_creator_as_owner(client):
    loc, eq = _place(client), _scope(client)
    dup = client.post("/api/equipment/seestar-s30/duplicate").json()["id"]
    with client.app.state.db.session() as s:
        assert s.get(ObservingLocation, loc).owner_id == client.user_id
        assert {s.get(EquipmentProfile, i).owner_id for i in (eq, dup)} == {client.user_id}
        assert s.get(ObservingLocation, "sample-location").owner_id is None
        assert s.get(EquipmentProfile, "seestar-s30").owner_id is None


def test_owner_can_change_and_delete_their_own(client):
    loc, eq = _place(client), _scope(client)
    assert client.patch(f"/api/locations/{loc}", json={"label": "Moved"}).json()["label"] == "Moved"
    assert client.patch(f"/api/equipment/{eq}", json={"aperture_mm": 90}).json()["aperture_mm"] == 90
    assert client.delete(f"/api/locations/{loc}").status_code == 204
    assert client.delete(f"/api/equipment/{eq}").status_code == 204


def test_unclaimed_legacy_rows_are_shown_to_no_one(two_users):
    """An ownerless row that is neither sample nor preset (left from before accounts, after the claim ran)."""
    alice, bob = two_users
    with alice.app.state.db.session() as s:
        s.add(ObservingLocation(id="legacy", label="Old", latitude_deg=1, longitude_deg=2, timezone="UTC"))
        s.add(EquipmentProfile(id="legacy-eq", name="Old scope"))
        s.commit()
    for c in (alice, bob):
        assert "legacy" not in {x["id"] for x in c.get("/api/locations").json()}
        assert "legacy-eq" not in {x["id"] for x in c.get("/api/equipment").json()}
        assert c.patch("/api/locations/legacy", json={"label": "x"}).status_code == 404
        assert c.delete("/api/equipment/legacy-eq").status_code == 404


# ---- ids accepted elsewhere --------------------------------------------------------------------

def test_plans_accept_only_shared_or_own_places_and_equipment(two_users):
    alice, bob = two_users
    a_loc, a_eq = _place(alice), _scope(alice)
    body = {"title": "Plan", "local_night_date": "2026-11-02"}

    for field, foreign in (("location_id", a_loc), ("equipment_id", a_eq)):
        f = bob.post("/api/sessions", json=body | {field: foreign})
        m = bob.post("/api/sessions", json=body | {field: "nope"})
        assert f.status_code == 404 and _same(f, m), f.json()
    assert bob.get("/api/sessions").json() == []

    plan = bob.post("/api/sessions", json=body | {"location_id": "sample-location", "equipment_id": "seestar-s30"})
    assert plan.status_code == 201, plan.text
    pid = plan.json()["id"]
    for field, foreign in (("location_id", a_loc), ("equipment_id", a_eq)):
        f = bob.patch(f"/api/sessions/{pid}", json={field: foreign})
        m = bob.patch(f"/api/sessions/{pid}", json={field: "nope"})
        assert f.status_code == 404 and _same(f, m), f.json()
    after = bob.get(f"/api/sessions/{pid}").json()
    assert (after["location_id"], after["equipment_id"]) == ("sample-location", "seestar-s30")

    own = alice.post("/api/sessions", json=body | {"location_id": a_loc, "equipment_id": a_eq})
    assert own.status_code == 201, own.text


def test_recommendations_and_visibility_accept_only_shared_or_own_equipment(two_users, client_for):
    alice, bob = two_users
    a_eq = _scope(alice)
    for path in ("/api/recommendations", "/api/targets/m31/visibility"):
        assert alice.get(path, params=PHILLY_PARAMS | {"equipment_id": a_eq}).status_code == 200
        assert bob.get(path, params=PHILLY_PARAMS | {"equipment_id": "seestar-s30"}).status_code == 200
        f = bob.get(path, params=PHILLY_PARAMS | {"equipment_id": a_eq})
        m = bob.get(path, params=PHILLY_PARAMS | {"equipment_id": "nope"})
        assert f.status_code == 404 and _same(f, m), (path, f.json())
        with client_for(alice.app, None) as anon:
            r = anon.get(path, params=PHILLY_PARAMS | {"equipment_id": a_eq})
            assert r.status_code == 404 and _same(r, m)
            assert anon.get(path, params=PHILLY_PARAMS | {"equipment_id": "seestar-s30"}).status_code == 200


def test_import_accepts_only_shared_or_own_places(two_users):
    alice, bob = two_users
    a_loc = make_location(alice)
    items = ngc_subs([11, 12])
    for route, body in ((PREVIEW, {"items": items}), (COMMIT, {"items": items})):
        f = bob.post(route, json=body | {"location_id": a_loc})
        m = bob.post(route, json=body | {"location_id": "nope"})
        assert f.status_code == 404 and _same(f, m), (route, f.json())
    assert bob.get("/api/sessions").json() == []
    assert commit(bob, items, "sample-location").status_code == 200  # the shared sample is fine


def test_import_never_matches_or_suggests_someone_elses_place(two_users):
    """Without a location_id the preview matches header coordinates to saved places: only the user's own."""
    alice, bob = two_users
    a_loc = make_location(alice)  # 40.005, -75.0: the synthetic headers' site is 40.0, -75.0
    items = ngc_subs([11, 12])
    mine = preview(alice, items)
    assert mine["location_id"] == a_loc and a_loc in {c["id"] for c in mine["location_candidates"]}
    theirs = preview(bob, items)
    assert theirs["location_id"] is None and theirs["needs_location"] is True
    assert theirs["location_candidates"] == []
    b_loc = make_location(bob, label="Bob's field")
    assert preview(bob, items)["location_id"] == b_loc


def test_canon_import_links_only_the_importers_own_canon_profile(two_users):
    """The seeded Canon profile is an ordinary row; the first account claims it. Bob's Canon import must not
    link or copy Alice's copy of it."""
    alice, bob = two_users
    with alice.app.state.db.session() as s:
        assert s.get(EquipmentProfile, "canon-t3-18-55").owner_id == alice.user_id
    assert alice.patch("/api/equipment/canon-t3-18-55", json={"notes": "Alice's private note"}).status_code == 200
    for c in (alice, bob):
        loc = make_location(c)
        p = preview(c, canon_items(), location_id=loc)
        r = commit(c, canon_items(), loc, canon_set_names={p["groups"][0]["group_key"]: "Milky Way"})
        assert r.status_code == 200, r.text
    with alice.app.state.db.session() as s:
        from app.astrolog.models import CaptureSet
        sets = {cs.owner_id: cs for cs in s.scalars(select(CaptureSet))}
        assert sets[alice.user_id].equipment_id == "canon-t3-18-55"
        assert sets[alice.user_id].equipment_snapshot["notes"] == "Alice's private note"
        assert sets[bob.user_id].equipment_id is None and not sets[bob.user_id].equipment_snapshot


# ---- account deletion --------------------------------------------------------------------------

def test_deleting_an_account_removes_its_places_even_if_an_older_plan_of_another_names_them(two_users):
    """Before places were private any plan could name any place. Such a plan loses the reference; the deletion
    goes through and the other account's plan stays."""
    alice, bob = two_users
    a_loc, a_eq = _place(alice), _scope(alice)
    plan = bob.post("/api/sessions", json={"title": "Old plan", "local_night_date": "2026-11-02"}).json()["id"]
    with alice.app.state.db.session() as s:  # written directly: the API no longer allows it
        s.execute(text("UPDATE sessions SET location_id = :l, equipment_id = :e WHERE id = :p"),
                  {"l": a_loc, "e": a_eq, "p": plan})
        s.commit()
    from .conftest import TEST_PASSWORD
    r = alice.post("/api/auth/delete", json={"password": TEST_PASSWORD, "confirm": "DELETE"})
    assert r.status_code == 204, r.text
    with bob.app.state.db.session() as s:
        assert s.get(ObservingLocation, a_loc) is None and s.get(EquipmentProfile, a_eq) is None
        row = s.get(ObservingSession, plan)
        assert row is not None and (row.location_id, row.equipment_id, row.owner_id) == (None, None, bob.user_id)
        assert s.get(ObservingLocation, "sample-location") is not None
        assert s.get(EquipmentProfile, "seestar-s30") is not None


# ---- first-account claim and seed --------------------------------------------------------------

def test_first_account_claims_legacy_places_and_equipment_but_not_samples_or_presets(tmp_path, make_client,
                                                                                    clear_provider):
    path = tmp_path / "claim.db"
    db = Database(f"sqlite:///{path}")
    db.init()
    with db.session() as s:
        s.add(ObservingLocation(id="home", label="Home", latitude_deg=40, longitude_deg=-75, timezone="UTC"))
        s.add(EquipmentProfile(id="mine", name="Mine"))
        s.commit()
    db.engine.dispose()
    with make_client(clear_provider, db_path=path, account="alice@example.com") as alice:
        # Only plans, nights and AstroLog count for the account page's "added to this account" note.
        assert alice.get("/api/auth/me").json()["claimed_existing"] is False
        with alice.app.state.db.session() as s:
            assert s.get(ObservingLocation, "home").owner_id == alice.user_id
            assert s.get(EquipmentProfile, "mine").owner_id == alice.user_id
            assert s.get(EquipmentProfile, "canon-t3-18-55").owner_id == alice.user_id
            assert s.get(ObservingLocation, "sample-location").owner_id is None
            assert s.get(EquipmentProfile, "seestar-s30").owner_id is None
        assert {"home", "sample-location"} == {x["id"] for x in alice.get("/api/locations").json()}
        with client_for(alice.app, "bob@example.com") as bob:
            assert [x["id"] for x in bob.get("/api/locations").json()] == ["sample-location"]
            assert "mine" not in {x["id"] for x in bob.get("/api/equipment").json()}


def test_seed_brings_back_the_sample_when_its_id_is_someones_own_place(tmp_path):
    """A sample edited before samples were read-only became that person's place, keeping the sample's id."""
    db = Database(f"sqlite:///{tmp_path / 'seed.db'}")
    db.init()
    with db.session() as s:
        s.add(User(id="u1", email="u1@example.com", password_hash="h"))
        s.flush()
        home = s.get(ObservingLocation, "sample-location")
        home.label, home.is_sample, home.owner_id = "Home", False, "u1"
        s.commit()
    db.seed()
    db.seed()  # idempotent: one sample, not two
    with db.session() as s:
        home = s.get(ObservingLocation, "sample-location")
        assert (home.label, home.is_sample, home.owner_id) == ("Home", False, "u1")
        samples = list(s.scalars(select(ObservingLocation).where(ObservingLocation.is_sample.is_(True))))
        assert [x.id for x in samples] == [SAMPLE_FALLBACK_ID]
        assert (samples[0].label, samples[0].owner_id) == ("Philadelphia, PA (sample)", None)
    db.engine.dispose()


def test_seed_keeps_the_s30_preset_exactly_and_shared(client):
    from app.db import SEESTAR_S30
    with client.app.state.db.session() as s:
        s30 = s.get(EquipmentProfile, "seestar-s30")
        assert {k: getattr(s30, k) for k in SEESTAR_S30} == SEESTAR_S30
        assert s30.owner_id is None
