"""Phase 4 Task 7: frame-selection options. Counts must equal what Siril's -filter-* will keep (spec 2a)."""

from __future__ import annotations

import math

import pytest
from sqlalchemy import select

from app.astrolog.models import CaptureSet
from app.processing.report import FrameStat
from app.processing.selection import KEEP_PERCENT, LastChoice, selection_options

from .test_astrolog_import import commit, make_location, sub
from .test_processing_report import RUNS, api, even_times, import_night, make_report, night_files, upload  # noqa: F401


def fixture_frames():
    folder, rep = make_report()
    cut = next(f for f in rep.findings if f.id == "round_cut").value
    return folder.frames, cut


def by_id(opts):
    return {o.id: o for o in opts}


def test_all_and_previous_on_the_40_frame_night():
    frames, cut = fixture_frames()
    assert cut == 0.74
    o = by_id(selection_options(frames, 10.0, cut, None))
    assert [x.id for x in o.values()] == ["all", "previous", "round80", "wfwhm80"]
    assert o["all"].kept == 34 and o["all"].seconds == 340.0 and o["all"].filter == "none"
    assert o["previous"].value == 0.74 and o["previous"].kept == 26 and o["previous"].seconds == 260.0
    assert o["previous"].filter == "round" and o["previous"].basis == "measured"
    assert "0.74" in o["previous"].label
    assert all(x.heuristic for x in (o["round80"], o["wfwhm80"])) and KEEP_PERCENT == 80


def test_percent_options_follow_siril_rule_with_unaligned_frames():
    """Spec 2a. N = 40 frames, n = 34 aligned (6 unaligned sort first as zero roundness).

    Hand-computed: roundness 80 % -> index floor(20*39/100) = 7 of the 40 sorted values; indices 0-5 are the six
    zeros, so index 7 is the 2nd-lowest aligned roundness. The 8 dropped frames are 0.63..0.70 (0.63, 0.64, ...),
    so the threshold is 0.64 and 33 aligned frames pass (all but the 0.63 one), which is 97 % of 34.
    wFWHM 80 % -> only the n = 34 aligned count: index floor(80*33/100) = 26, the 27th-lowest wFWHM; wFWHM rises
    with the frame number so exactly 27 aligned frames are <= it.
    """
    frames, cut = fixture_frames()
    o = by_id(selection_options(frames, 10.0, cut, None))
    assert o["round80"].kept == 33 and o["round80"].value == pytest.approx(0.64)
    assert o["round80"].kept > 0.8 * 34 and o["round80"].percent == 80 and o["round80"].filter == "round"
    assert o["round80"].seconds == 330.0
    assert "counted over all 40 frames" in o["round80"].note
    assert o["wfwhm80"].kept == 27 and o["wfwhm80"].seconds == 270.0 and o["wfwhm80"].filter == "wfwhm"
    assert o["wfwhm80"].percent == 80


def fs(n, roundness, wfwhm=None, aligned=True, exptime=None):
    return FrameStat(n=n, basename=f"f{n}", utc=None, aligned=aligned, kept=None,
                     fwhm=wfwhm, wfwhm=wfwhm if aligned else None,
                     roundness=roundness if aligned else None, background=None, stars=None, exptime_s=exptime)


def test_all_aligned_means_plain_percent_and_ties_are_kept():
    # 10 aligned, roundness 1..10 /10, with two frames tied at the threshold.
    r = [0.1, 0.2, 0.3, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    frames = [fs(i + 1, v, wfwhm=3.0 + i * 0.1) for i, v in enumerate(r)]
    o = by_id(selection_options(frames, 10.0, None, None))
    # roundness 80 %: index floor(20*9/100) = 1 -> 0.2; passing >= 0.2 is 9 frames
    assert o["round80"].kept == 9 and "counted over all" not in o["round80"].note
    # wfwhm 80 %: index floor(80*9/100) = 7 -> 8th lowest; 8 frames
    assert o["wfwhm80"].kept == 8
    assert "previous" not in o
    tied = [fs(i + 1, v, wfwhm=3.0) for i, v in enumerate([0.2, 0.5, 0.5, 0.5, 0.9])]
    t = by_id(selection_options(tied, 10.0, None, None))
    assert t["wfwhm80"].kept == 5  # every wFWHM ties at the threshold -> all kept


def test_seconds_use_per_frame_exptime_with_fallback():
    frames = [fs(1, 0.9, 3.0, exptime=30.0), fs(2, 0.9, 3.1), fs(3, 0.9, 3.2, exptime=20.0)]
    o = by_id(selection_options(frames, 10.0, None, None))
    assert o["all"].seconds == 60.0


def test_duplicates_are_removed_and_no_aligned_frames_gives_nothing():
    frames = [fs(i + 1, 0.8 + i * 0.01, wfwhm=3.0 + i * 0.1) for i in range(5)]
    # previous cut 0.8 keeps all 5, roundness 80 % (index 0) keeps all 5: same filter and kept -> one option
    ids = [x.id for x in selection_options(frames, 10.0, 0.8, None)]
    assert "previous" in ids and "round80" not in ids
    assert selection_options([fs(1, 0, aligned=False)], 10.0, None, None) == []


# ---- API ---------------------------------------------------------------------------------------

def last_of(c, run_id):
    return c.get(f"{RUNS}/{run_id}").json()


def test_run_offers_options_and_patch_validates(api):  # noqa: F811
    run_id = import_night(api)
    assert last_of(api, run_id)["selection"] == []
    body = upload(api, run_id, night_files()).json()
    ids = [o["id"] for o in body["selection"]]
    assert ids == ["all", "previous", "round80", "wfwhm80"]
    assert body["choices"] == {} and body["selection_last_time"] is None  # nothing pre-selected
    for bad in ("nope", 5, None):
        assert api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": bad}}).status_code == 422
    assert api.patch(f"{RUNS}/{run_id}", json={"choices": {"mystery": 1}}).status_code == 422
    assert api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection_summary": {}}}).status_code == 422
    r = api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": "previous"}})
    assert r.status_code == 200 and r.json()["choices"]["selection"] == "previous"
    # re-reading the folder changes the counts, so an old choice is cleared rather than kept silently
    again = upload(api, run_id, night_files()).json()
    assert again["choices"] == {}


def test_selection_rejected_without_a_report(api):  # noqa: F811
    run_id = import_night(api)
    assert api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": "all"}}).status_code == 422


def second_night(c, device=None):
    loc = make_location(c, label="Second")
    items = [sub("NGC 7635", f"2026-10-12T03:{m:02d}:24") for m in (11, 12, 13)]
    assert commit(c, items, loc).status_code == 200
    with c.app.state.db.session() as s:
        ids = [x.id for x in s.scalars(select(CaptureSet)).all()]
    return ids


def test_last_time_note_only_for_same_device_and_never_preselects(api):  # noqa: F811
    run_id = import_night(api)
    upload(api, run_id, night_files())
    api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": "previous"}})
    ids = second_night(api)
    other = next(i for i in ids if i != last_of(api, run_id)["capture_set_id"])
    run2 = api.post(RUNS, json={"capture_set_id": other}).json()
    lt = run2["selection_last_time"]
    assert lt is not None and lt["night_date"] == "2026-09-11" and lt["kept"] == 26
    assert lt["option_label"].startswith("Same as your last run") and lt["target_name"]
    assert run2["choices"] == {} and run2["selection"] == []
    # the first run sees no "last time" from the second (it has chosen nothing)
    assert last_of(api, run_id)["selection_last_time"] is None
    # a different device: no note
    with api.app.state.db.session() as s:
        s.get(CaptureSet, last_of(api, run_id)["capture_set_id"]).device = "Other Camera"
        s.commit()
    assert api.get(f"{RUNS}/{run2['id']}").json()["selection_last_time"] is None
