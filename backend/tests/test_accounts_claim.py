"""The first account on an install takes over the rows that existed before accounts, once."""

from __future__ import annotations

from sqlalchemy import select

from app.accounts.models import User
from app.accounts.owned import OWNED_MODELS, claim_unowned
from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import AppMeta, Database, ObservingSession
from app.processing.models import ProcessingRun


def _seed_unowned(db: Database) -> dict[type, str]:
    """One ownerless row in every owned table, linked the way an import links them."""
    with db.session() as s:
        obs = ObservingSession(title="Plan", local_night_date="2026-11-02")
        lt = LibraryTarget(custom_name="X", normalized_key="custom:x", kind="custom")
        s.add_all([obs, lt])
        s.flush()
        cs = CaptureSet(session_id=obs.id, library_target_id=lt.id, device="seestar", equipment_snapshot={})
        s.add(cs)
        s.flush()
        fr = CaptureFrame(capture_set_id=cs.id, date_obs_utc="2026-11-02T01:00:00Z", exptime_s=10.0,
                          source_filename="a.fit", dedup_key="k1")
        st = Stack(library_target_id=lt.id, session_id=obs.id, source_filename="s.fit", provenance="header",
                   dedup_key="sk")
        s.add_all([fr, st])
        s.flush()
        fi = FinalImage(library_target_id=lt.id, stack_id=st.id, source_filename="f.jpg", format="jpeg",
                        preview_key="p", thumb_key="t", width=1, height=1, is_current=True)
        run = ProcessingRun(capture_set_id=cs.id)
        s.add_all([fi, run])
        s.commit()
        rows = (obs, lt, cs, fr, st, fi, run)
        return {type(r): r.id for r in rows}


def _owner(db: Database, model: type, row_id: str) -> str | None:
    with db.session() as s:
        return s.scalar(select(model.owner_id).where(model.id == row_id))


def test_first_account_claims_unowned_rows_once(tmp_path, make_client, client_for, clear_provider):
    path = tmp_path / "claim.db"
    seed_db = Database(f"sqlite:///{path}")
    seed_db.init()
    seeded = _seed_unowned(seed_db)
    assert set(seeded) == set(OWNED_MODELS)  # every owned table is covered
    seed_db.engine.dispose()

    with make_client(clear_provider, db_path=path, account="alice@example.com") as alice:
        me = alice.get("/api/auth/me").json()
        assert me["claimed_existing"] is True
        db = alice.app.state.db
        for model, row_id in seeded.items():
            assert _owner(db, model, row_id) == alice.user_id, model.__name__

        with db.session() as s:
            late = ObservingSession(title="Later", local_night_date="2026-11-03")
            s.add(late)
            s.commit()
            late_id = late.id
        with client_for(alice.app, "bob@example.com") as bob:
            assert bob.get("/api/auth/me").json()["claimed_existing"] is False
        assert _owner(db, ObservingSession, late_id) is None
        for model, row_id in seeded.items():
            assert _owner(db, model, row_id) == alice.user_id, model.__name__
        assert alice.get("/api/auth/me").json()["claimed_existing"] is True


def test_claim_flag_set_on_an_empty_install(make_client, clear_provider):
    with make_client(clear_provider, account="alice@example.com") as alice:
        assert alice.get("/api/auth/me").json()["claimed_existing"] is False
        with alice.app.state.db.session() as s:
            meta = s.get(AppMeta, "accounts_claimed")
            assert meta is not None and meta.value == alice.user_id


def test_claim_runs_once_per_install(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'once.db'}")
    db.init()
    with db.session() as s:
        first = User(email="a@example.com", password_hash="h")
        second = User(email="b@example.com", password_hash="h")
        s.add_all([first, second])
        s.flush()
        assert claim_unowned(s, first) is True
        s.add(ObservingSession(title="Later", local_night_date="2026-11-03"))
        s.flush()
        assert claim_unowned(s, second) is False  # the flag already exists; the user stays usable
        assert second.claimed_existing is False
        s.commit()
        assert s.scalar(select(ObservingSession.owner_id)) is None
