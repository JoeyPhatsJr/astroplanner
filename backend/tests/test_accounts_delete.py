"""Accounts Task 5: deleting an account removes the user's rows and preview files, and nothing else.

Copy strings are written out here on purpose (not imported from the routes) so a typo in a constant fails.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select

from app.accounts.models import User, UserSession
from app.accounts.owned import OWNED_MODELS
from app.astrolog.models import FinalImage
from app.db import AppMeta, Database, ObservingSession, SessionTarget
from app.processing.models import ProcessingRun, comparison_keys

from .conftest import TEST_PASSWORD, client_for
from .test_accounts import FakeClock
from .test_accounts_claim import _seed_unowned
from .test_astrolog_import import commit, make_location
from .test_ownership_astrolog import SUBS, jpeg, lib_rows, stack_item
from .test_ownership_processing import start_run
from .test_processing_runs import RUNS
from .test_processing_stacks import _fits, _post

COOKIE = "astroplanner_session"
DELETE = "/api/auth/delete"
SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password."
WRONG_PASSWORD = {"detail": "That password isn’t right."}


def populate(c, loc) -> dict:
    """A plan with a target, an import with a stack, a final picture, and a run with a Siril stack and a Seestar
    picture. Returns the routes that serve each stored key, keyed by storage key."""
    plan = c.post("/api/sessions", json={"title": "Plan", "local_night_date": "2026-11-02", "location_id": loc})
    assert plan.status_code == 201, plan.text
    r = c.post(f"/api/sessions/{plan.json()['id']}/targets", json={"target_id": "m31"})
    assert r.status_code == 201, r.text

    r = commit(c, SUBS + [stack_item()], loc)
    assert r.status_code == 200, r.text
    [row] = [x for x in lib_rows(c) if x["kind"] == "catalog"]
    lt = row["id"]
    stack_id = c.get(f"/api/astrolog/targets/{lt}").json()["stacks"][0]["id"]
    up = c.post(f"/api/astrolog/targets/{lt}/final-image", files={"file": ("final.jpg", jpeg())},
                data={"stack_id": stack_id})
    assert up.status_code == 200, up.text
    img = up.json()["id"]

    rid = start_run(c)["id"]
    assert _post(c, rid, "siril", _fits()).status_code == 200
    r = c.post(f"{RUNS}/{rid}/pictures/seestar", files={"file": ("seestar.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text

    urls: dict[str, str] = {}
    with c.app.state.db.session() as s:
        fi = s.get(FinalImage, img)
        urls[fi.preview_key] = f"/api/astrolog/images/{img}/preview"
        urls[fi.thumb_key] = f"/api/astrolog/images/{img}/thumb"
        run = s.get(ProcessingRun, rid)
        urls.update({k: f"{RUNS}/{rid}/images/{k}" for k in comparison_keys(run)})
    assert len(urls) == 6, urls  # final picture 2, Siril stack 2, Seestar picture 2
    return urls


def counts(c, user_id: str) -> dict[str, int]:
    """Rows ``user_id`` has in every owned table, its sign-in sessions, its user row and its plans' targets."""
    with c.app.state.db.session() as s:
        out = {m.__tablename__: s.scalar(select(func.count()).select_from(m).where(m.owner_id == user_id))
               for m in OWNED_MODELS}
        out["user_sessions"] = s.scalar(select(func.count()).select_from(UserSession)
                                        .where(UserSession.user_id == user_id))
        out["users"] = s.scalar(select(func.count()).select_from(User).where(User.id == user_id))
        out["session_targets"] = s.scalar(
            select(func.count()).select_from(SessionTarget).join(ObservingSession)
            .where(ObservingSession.owner_id == user_id))
    return out


def stored_files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def app_meta(c) -> dict[str, str | None]:
    with c.app.state.db.session() as s:
        return {m.key: m.value for m in s.scalars(select(AppMeta))}


def test_delete_removes_only_own_rows_and_files(two_users, tmp_path):
    alice, bob = two_users
    root = tmp_path / "previews"
    assert alice.app.state.storage.root == root
    loc = make_location(alice)
    a_urls, b_urls = populate(alice, loc), populate(bob, loc)
    a_id, b_id = alice.user_id, bob.user_id

    before_files = stored_files(root)
    assert set(a_urls) | set(b_urls) <= before_files
    a_before = counts(alice, a_id)
    assert all(n > 0 for n in a_before.values()), a_before
    b_before = counts(bob, b_id)
    assert all(n > 0 for n in b_before.values()), b_before
    locations, equipment = bob.get("/api/locations").json(), bob.get("/api/equipment").json()
    meta = app_meta(alice)
    token = alice.cookies.get(COOKIE)

    r = alice.post(DELETE, json={"password": TEST_PASSWORD, "confirm": "DELETE"})
    assert r.status_code == 204, r.text
    assert f"{COOKIE}=" in r.headers["set-cookie"]
    assert "max-age=0" in [a.strip().lower() for a in r.headers["set-cookie"].split(";")[1:]]

    assert all(n == 0 for n in counts(bob, a_id).values()), counts(bob, a_id)
    assert stored_files(root) == before_files - set(a_urls)  # Alice's keys gone, every other file kept
    assert counts(bob, b_id) == b_before
    for key, url in b_urls.items():
        got = bob.get(url)
        assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg", (key, url, got.text)
    assert bob.get("/api/locations").json() == locations
    assert bob.get("/api/equipment").json() == equipment
    assert app_meta(bob) == meta

    alice.cookies.clear()
    replay = alice.get("/api/auth/me", headers={"Cookie": f"{COOKIE}={token}"})
    assert (replay.status_code, replay.json()) == (401, {"detail": "Sign in to continue."})
    login = alice.post("/api/auth/login", json={"email": "alice@example.com", "password": TEST_PASSWORD})
    assert (login.status_code, login.json()) == (401, {"detail": SIGN_IN_FAILED})


def test_delete_needs_password_and_confirmation(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    urls = populate(alice, loc)
    before = counts(alice, alice.user_id)
    root = alice.app.state.storage.root
    files = stored_files(root)

    for body, expected in (
        ({"password": TEST_PASSWORD, "confirm": "delete"}, (422, {"detail": "Type DELETE to confirm."})),
        ({"password": "not the right password", "confirm": "DELETE"}, (400, WRONG_PASSWORD)),
    ):
        r = alice.post(DELETE, json=body)
        assert (r.status_code, r.json()) == expected, body
        assert counts(alice, alice.user_id) == before
        assert stored_files(root) == files
        assert alice.get("/api/auth/me").status_code == 200
    for url in urls.values():
        assert alice.get(url).status_code == 200


def test_delete_body_is_validated_without_echo(client):
    r = client.post(DELETE, json={"password": TEST_PASSWORD})
    assert r.status_code == 422
    assert TEST_PASSWORD not in r.text and "input" not in r.text
    assert client.get("/api/auth/me").status_code == 200


def test_delete_signed_out_is_401(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        r = c.post(DELETE, json={"password": TEST_PASSWORD, "confirm": "DELETE"})
        assert (r.status_code, r.json()) == (401, {"detail": "Sign in to continue."})


def test_delete_wrong_password_is_throttled(make_app, clear_provider):
    clock = FakeClock()
    app = make_app(clear_provider, clock=clock)
    with client_for(app, "ann@example.com") as a:
        wrong = {"password": "not the right password", "confirm": "DELETE"}
        right = {"password": TEST_PASSWORD, "confirm": "DELETE"}
        for _ in range(5):
            r = a.post(DELETE, json=wrong)
            assert (r.status_code, r.json()) == (400, WRONG_PASSWORD)
        r = a.post(DELETE, json=right)
        locked = {"detail": "That password isn’t right. Try again in a few minutes."}
        assert (r.status_code, r.json()) == (429, locked)
        assert a.get("/api/auth/me").status_code == 200  # nothing was deleted
        clock.advance(minutes=15)
        assert a.post(DELETE, json=right).status_code == 204
        with app.state.db.session() as s:
            assert s.scalar(select(func.count()).select_from(User)) == 0


def test_claim_does_not_rerun_after_delete(tmp_path, make_client, clear_provider):
    path = tmp_path / "claim.db"
    seed_db = Database(f"sqlite:///{path}")
    seed_db.init()
    seeded = _seed_unowned(seed_db)
    seed_db.engine.dispose()

    with make_client(clear_provider, db_path=path, account="alice@example.com") as alice:
        assert alice.get("/api/auth/me").json()["claimed_existing"] is True
        alice_id = alice.user_id
        r = alice.post(DELETE, json={"password": TEST_PASSWORD, "confirm": "DELETE"})
        assert r.status_code == 204, r.text
        db = alice.app.state.db
        with db.session() as s:
            for model, row_id in seeded.items():
                assert s.get(model, row_id) is None, model.__name__

        with client_for(alice.app, "carol@example.com") as carol:
            assert carol.get("/api/auth/me").json()["claimed_existing"] is False
        with db.session() as s:
            for model in OWNED_MODELS:
                assert s.scalar(select(func.count()).select_from(model).where(model.owner_id.is_(None))) == 0
            # The flag survives the delete: still the deleted account's id, so Carol's sign-up never re-ran the claim.
            assert s.get(AppMeta, "accounts_claimed").value == alice_id
