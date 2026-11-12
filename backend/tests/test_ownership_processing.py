"""Accounts Task 4: Processing Coach runs belong to their owner.

Another user's run (or capture set) answers the same 404 as a missing one. Every denied request carries a valid
body or file, so the answer is the ownership check and not a 422. The signed-out 401 sweep, which includes the
processing image and script URLs, is ``test_owned_routes_require_sign_in`` in test_ownership_astrolog.py.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.astrolog.models import CaptureSet
from app.processing.models import ProcessingRun, comparison_keys

from .astrolog_fixtures import seestar_sub_header
from .test_astrolog_import import commit, fits_item, make_location
from .test_ownership_astrolog import jpeg
from .test_processing_report import START, basename, iso, night_files, upload
from .test_processing_runs import RUNS, seestar_night
from .test_processing_stacks import _fits, _post

RUN_404 = {"detail": "Run not found"}


def own_set_id(c) -> str:
    """The one capture set ``c``'s user owns (the shared helpers pick the first set of anyone's)."""
    with c.app.state.db.session() as s:
        return s.scalars(select(CaptureSet.id).where(CaptureSet.owner_id == c.user_id)).one()


def start_run(c) -> dict:
    r = c.post(RUNS, json={"capture_set_id": own_set_id(c)})
    assert r.status_code == 200, r.text
    return r.json()


def forty_frame_night(c, loc) -> None:
    """The 40-frame synthetic night whose Siril folder (``night_files``) offers frame selections."""
    items = [fits_item(basename(i), seestar_sub_header(date_obs=iso(START + timedelta(seconds=15 * (i - 1)))[:-1]))
             for i in range(1, 41)]
    r = commit(c, items, loc)
    assert r.status_code == 200, r.text


def test_runs_are_private(two_users):
    alice, bob = two_users
    seestar_night(alice, make_location(alice))
    run = start_run(alice)
    rid = run["id"]
    up = _post(alice, rid, "siril", _fits())
    assert up.status_code == 200, up.text
    with alice.app.state.db.session() as s:
        row = s.get(ProcessingRun, rid)
        assert row.owner_id == alice.user_id
        keys = comparison_keys(row)
    assert len(keys) == 2 and all(k.startswith(f"processing/{rid}/siril-") for k in keys)
    before = alice.get(f"{RUNS}/{rid}").json()
    stored = sorted(p for p in alice.app.state.storage.root.rglob("*") if p.is_file())

    base = f"{RUNS}/{rid}"
    denied = [
        bob.get(base),
        bob.patch(base, json={"step_states": {"report": "done"}}),
        upload(bob, rid, night_files()),
        _post(bob, rid, "siril", _fits(seed=4)),
        bob.post(f"{base}/pictures/seestar", files={"file": ("seestar.jpg", jpeg(), "image/jpeg")}),
        bob.get(f"{base}/scripts/prepare"),
        *(bob.get(f"{base}/images/{k}") for k in sorted(keys)),
    ]
    for r in denied:
        assert (r.status_code, r.json()) == (404, RUN_404), (r.request.method, r.request.url, r.text)

    r = bob.post(RUNS, json={"capture_set_id": run["capture_set_id"]})
    assert (r.status_code, r.json()) == (404, {"detail": "Capture set not found"})

    assert alice.get(base).json() == before
    assert sorted(p for p in alice.app.state.storage.root.rglob("*") if p.is_file()) == stored
    for k in keys:
        assert alice.get(f"{base}/images/{k}").status_code == 200
    with alice.app.state.db.session() as s:
        assert list(s.scalars(select(ProcessingRun.owner_id))) == [alice.user_id]


def test_last_time_never_reads_another_users_run(two_users):
    alice, bob = two_users
    loc = make_location(alice)
    seestar_night(alice, loc)
    a_run = start_run(alice)
    forty_frame_night(bob, loc)
    b_run = start_run(bob)
    assert upload(bob, b_run["id"], night_files()).status_code == 200
    r = bob.patch(f"{RUNS}/{b_run['id']}", json={"choices": {"selection": "previous"}})
    assert r.status_code == 200, r.text
    assert r.json()["choices"]["selection"] == "previous"

    assert alice.get(f"{RUNS}/{a_run['id']}").json()["selection_last_time"] is None
    with alice.app.state.db.session() as s:
        devices = {cs.owner_id: cs.device for cs in s.scalars(select(CaptureSet))}
    assert devices == {alice.user_id: "Seestar S30", bob.user_id: "Seestar S30"}  # same device: only the owner differs


def test_comparison_keys_lists_only_stored_keys():
    run = ProcessingRun(comparison={
        "siril_stack": {"preview_key": "p1", "thumb_key": "t1", "measurement": {}},
        "seestar_picture": {"preview_key": "p2", "thumb_key": None, "edited": None},
        "note": "not a dict",
    })
    assert comparison_keys(run) == {"p1", "t1", "p2"}
    assert comparison_keys(ProcessingRun(comparison=None)) == set()
