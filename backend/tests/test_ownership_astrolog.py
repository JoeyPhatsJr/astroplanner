"""Accounts Task 3: plans, nights and AstroLog belong to their owner.

Signed out, every owned route answers 401; another user's row answers the same 404 as a missing one (with a valid
body, so the answer is the ownership check and not a 422); two people importing identical files never collide.
"""

from __future__ import annotations

import io
import re

from fastapi.routing import APIRoute, iter_route_contexts
from PIL import Image
from sqlalchemy import select

from app.accounts.owned import OWNED_MODELS
from app.astrolog.models import LibraryTarget
from app.processing.models import ProcessingRun

from .astrolog_fixtures import siril_stack_header
from .conftest import client_for
from .test_astrolog_import import PREVIEW, commit, fits_item, make_location, ngc_subs, preview, sub

OWNED_PREFIXES = ("/api/sessions", "/api/astrolog")
OPEN_ROUTES = {"/api/astrolog/history"}
SIGN_IN = {"detail": "Sign in to continue."}
LIB = "/api/astrolog/library"
SUBS = ngc_subs([11, 12, 13])


def stack_item() -> dict:
    return fits_item("NGC 7635_654x10sec_T32degC_2026-09-11.fit", siril_stack_header())


def jpeg() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (60, 40), (5, 5, 90)).save(b, "JPEG")
    return b.getvalue()


def owned_routes(app) -> list[tuple[str, str]]:
    """(method, path) of every owned APIRoute in ``app.routes``, path parameters filled with ``x``.

    This FastAPI keeps included routers as lazy ``_IncludedRouter`` entries, so ``app.routes`` is flattened with
    ``iter_route_contexts`` (what FastAPI's own OpenAPI builder uses); a plain loop would find no routes at all.
    """
    out = []
    for r in iter_route_contexts(app.routes):
        if isinstance(r.original_route, APIRoute) and r.path.startswith(OWNED_PREFIXES) and r.path not in OPEN_ROUTES:
            path = re.sub(r"\{[^}]+\}", "x", r.path)
            out += [(m, path) for m in sorted(r.methods - {"HEAD", "OPTIONS"})]
    return out


def lib_rows(c) -> list[dict]:
    r = c.get(LIB)
    assert r.status_code == 200, r.text
    return r.json()


# ---- signed out ---------------------------------------------------------------------------------

def test_owned_routes_require_sign_in(make_app, clear_provider):
    app = make_app(clear_provider)
    routes = owned_routes(app)
    assert len(routes) >= 20, routes
    with client_for(app, None) as anon:
        for method, path in routes:
            r = anon.request(method, path)
            assert (r.status_code, r.json()) == (401, SIGN_IN), (method, path, r.status_code, r.text)


# ---- plans --------------------------------------------------------------------------------------

def test_plans_are_private(two_users):
    alice, bob = two_users
    s = alice.post("/api/sessions", json={"title": "Alice's night", "local_night_date": "2026-11-02"})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    r = alice.post(f"/api/sessions/{sid}/targets", json={"target_id": "m31"})
    assert r.status_code == 201, r.text
    st = r.json()["targets"][0]["id"]
    before = alice.get(f"/api/sessions/{sid}").json()

    assert [x["id"] for x in alice.get("/api/sessions").json()] == [sid]
    assert bob.get("/api/sessions").json() == []
    base = f"/api/sessions/{sid}"
    denied = [
        bob.get(base),
        bob.patch(base, json={"title": "Bob's now"}),
        bob.delete(base),
        bob.post(f"{base}/targets", json={"target_id": "m42"}),
        bob.patch(f"{base}/targets/{st}", json={"notes": "mine"}),
        bob.put(f"{base}/targets/order", json={"session_target_ids": [st]}),
        bob.delete(f"{base}/targets/{st}"),
    ]
    for r in denied:
        assert (r.status_code, r.json()) == (404, {"detail": "Session not found"}), (r.request.method, r.request.url)
    assert alice.get(f"/api/sessions/{sid}").json() == before
    assert bob.get("/api/sessions").json() == []


# ---- imports ------------------------------------------------------------------------------------

def test_identical_imports_do_not_collide(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    items = SUBS + [stack_item()]
    libs = {}
    for c in (alice, bob):
        p = preview(c, items, location_id=loc)
        assert [g["new_frames"] for g in p["groups"]] == [len(SUBS)]
        assert [st["new"] for st in p["stacks"]] == [True]
        r = commit(c, items, loc, unsorted_groups=[p["groups"][0]["group_key"]])
        assert r.status_code == 200, r.text
        assert (r.json()["inserted_frames"], r.json()["inserted_stacks"]) == (len(SUBS), 1)
        rows = lib_rows(c)
        assert sorted((row["kind"], row["catalog_target_id"]) for row in rows) == [
            ("catalog", "ngc7635"), ("unsorted", None)]
        libs[c.user_id] = {row["id"] for row in rows}
    assert not (libs[alice.user_id] & libs[bob.user_id])

    again = commit(alice, items, loc)
    assert again.status_code == 200, again.text
    assert (again.json()["inserted_frames"], again.json()["inserted_stacks"]) == (0, 0)
    with alice.app.state.db.session() as s:
        owners = sorted(lt.owner_id for lt in s.scalars(select(LibraryTarget)))
    assert owners == sorted([alice.user_id] * 2 + [bob.user_id] * 2)


def test_import_attaches_only_own_plans(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    plan = alice.post("/api/sessions", json={"title": "Bubble", "local_night_date": "2026-09-11", "location_id": loc})
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]
    assert preview(alice, SUBS, location_id=loc)["groups"][0]["plan_session_ids"] == [plan_id]
    assert preview(bob, SUBS, location_id=loc)["groups"][0]["plan_session_ids"] == []

    bad = commit(bob, SUBS, loc, plan_session_id=plan_id)
    assert (bad.status_code, bad.json()) == (422, {"detail": "plan_session_id does not exist."})

    r = commit(bob, SUBS, loc)
    assert r.status_code == 200, r.text
    [bob_night] = r.json()["session_ids"]
    assert bob_night != plan_id
    [night] = bob.get("/api/sessions").json()
    assert (night["id"], night["source"], night["status"]) == (bob_night, "imported", "completed")
    mine = alice.get(f"/api/sessions/{plan_id}").json()
    assert (mine["status"], mine["source"]) == ("planned", "planned")
    assert [s["id"] for s in alice.get("/api/sessions").json()] == [plan_id]


# ---- targets and pictures -----------------------------------------------------------------------

def test_targets_and_pictures_are_private(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    assert commit(alice, SUBS + [stack_item()], loc).status_code == 200
    [row] = lib_rows(alice)
    lt = row["id"]
    page = alice.get(f"/api/astrolog/targets/{lt}").json()
    stack_id = page["stacks"][0]["id"]
    up = alice.post(f"/api/astrolog/targets/{lt}/final-image", files={"file": ("final.jpg", jpeg())},
                    data={"stack_id": stack_id})
    assert up.status_code == 200, up.text
    img = up.json()["id"]

    assert lib_rows(bob) == []
    target_404 = {"detail": "Target not found"}
    for r in (bob.get(f"/api/astrolog/targets/{lt}"),
              bob.patch(f"/api/astrolog/targets/{lt}", json={"custom_name": "Bob's"}),
              bob.post(f"/api/astrolog/targets/{lt}/link-variable", json={"star_id": "var:ss-cyg"}),
              bob.post(f"/api/astrolog/targets/{lt}/final-image", files={"file": ("final.jpg", jpeg())}),
              bob.post(f"/api/astrolog/targets/{lt}/stack-link", json={"final_image_id": img, "stack_id": stack_id})):
        assert (r.status_code, r.json()) == (404, target_404), (r.request.method, r.request.url)
    for which in ("preview", "thumb"):
        url = f"/api/astrolog/images/{img}/{which}"
        r = bob.get(url)
        assert (r.status_code, r.json()) == (404, {"detail": "Image not found"})
        with client_for(alice.app, None) as anon:
            r = anon.get(url)
            assert (r.status_code, r.json()) == (401, SIGN_IN)
        r = alice.get(url)
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"

    after = alice.get(f"/api/astrolog/targets/{lt}").json()
    assert after["final_image"]["id"] == img and after["final_image"]["stack_id"] == stack_id
    assert after["target"] == page["target"]


def test_stack_and_image_lookups_check_owner(two_users):
    """Bob's own target cannot borrow Alice's stack or picture: the same 404s as missing ones."""
    alice, bob = two_users
    loc = make_location(alice)
    assert commit(alice, SUBS + [stack_item()], loc).status_code == 200
    [a_row] = lib_rows(alice)
    a_stack = alice.get(f"/api/astrolog/targets/{a_row['id']}").json()["stacks"][0]["id"]
    a_img = alice.post(f"/api/astrolog/targets/{a_row['id']}/final-image",
                       files={"file": ("final.jpg", jpeg())}).json()["id"]
    assert commit(bob, [sub("Blob B", "2026-09-12T03:11:24")], loc).status_code == 200
    [b_row] = lib_rows(bob)
    b_img = bob.post(f"/api/astrolog/targets/{b_row['id']}/final-image", files={"file": ("final.jpg", jpeg())})
    assert b_img.status_code == 200, b_img.text

    r = bob.post(f"/api/astrolog/targets/{b_row['id']}/final-image", files={"file": ("final.jpg", jpeg())},
                 data={"stack_id": a_stack})
    assert (r.status_code, r.json()) == (422, {"detail": "stack_id does not belong to this target"})
    r = bob.post(f"/api/astrolog/targets/{b_row['id']}/stack-link", json={"final_image_id": a_img})
    assert (r.status_code, r.json()) == (404, {"detail": "Final image not found for this target"})
    r = bob.post(f"/api/astrolog/targets/{b_row['id']}/stack-link",
                 json={"final_image_id": b_img.json()["id"], "stack_id": a_stack})
    assert (r.status_code, r.json()) == (404, {"detail": "Stack not found for this target"})


def test_unsorted_is_per_owner(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    for c, name in ((alice, "Blob A"), (bob, "Blob B")):
        assert commit(c, [sub(name, "2026-09-12T03:11:24")], loc).status_code == 200
        [row] = lib_rows(c)
        assert row["kind"] == "custom"
        r = c.patch(f"/api/astrolog/targets/{row['id']}", json={"kind": "unsorted"})
        assert r.status_code == 200, r.text
        assert r.json()["target"]["kind"] == "unsorted"
    with alice.app.state.db.session() as s:
        unsorted = list(s.scalars(select(LibraryTarget).where(LibraryTarget.normalized_key == "unsorted")))
    assert sorted(lt.owner_id for lt in unsorted) == sorted([alice.user_id, bob.user_id])
    assert len({lt.id for lt in unsorted}) == 2
    for c in (alice, bob):
        [row] = lib_rows(c)
        assert row["kind"] == "unsorted"
        assert c.get(f"/api/astrolog/targets/{row['id']}").json()["frames_total"] == 1


def test_history_is_personal(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    assert commit(alice, [sub("M 27", "2026-09-12T00:28:00")], loc).status_code == 200
    h = alice.get("/api/astrolog/history")
    assert h.status_code == 200 and set(h.json()) == {"m27"}
    assert h.json()["m27"]["seconds"] == 10.0
    assert bob.get("/api/astrolog/history").json() == {}
    with client_for(alice.app, None) as anon:
        r = anon.get("/api/astrolog/history")
        assert (r.status_code, r.json()) == (200, {})


def test_preview_is_signed_in_only(make_app, clear_provider):
    """The preview reads dedup keys and plans, so it is owned even though it writes nothing."""
    app = make_app(clear_provider)
    with client_for(app, None) as anon:
        r = anon.post(PREVIEW, json={"items": SUBS})
        assert (r.status_code, r.json()) == (401, SIGN_IN)


def test_every_write_sets_the_owner(two_users):
    """Plans, nights, targets, Unsorted, capture sets, frames, stacks and pictures all carry the writer's id.

    ``ProcessingRun`` is written by the Processing Coach and gets its owner in Task 4.
    """
    alice, _ = two_users
    loc = make_location(alice)
    assert alice.post("/api/sessions", json={"title": "Plan", "local_night_date": "2026-10-01"}).status_code == 201
    assert commit(alice, SUBS + [stack_item(), sub("Blob A", "2026-09-12T03:20:24")], loc).status_code == 200
    rows = {row["display_name"]: row["id"] for row in lib_rows(alice)}
    assert alice.post(f"/api/astrolog/targets/{rows['Bubble Nebula']}/final-image",
                      files={"file": ("final.jpg", jpeg())}).status_code == 200
    assert alice.patch(f"/api/astrolog/targets/{rows['Blob A']}", json={"kind": "unsorted"}).status_code == 200
    with alice.app.state.db.session() as s:
        assert s.scalars(select(LibraryTarget).where(LibraryTarget.normalized_key == "unsorted")).one()
        for model in (m for m in OWNED_MODELS if m is not ProcessingRun):
            owners = list(s.scalars(select(model.owner_id)))
            assert owners and set(owners) == {alice.user_id}, model.__name__
