"""Phase 4 Task 5: night report from Siril sequence files, and the folder upload endpoint."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from astropy.coordinates import EarthLocation
from astropy.time import Time
import astropy.units as u
from sqlalchemy import select

from app import astronomy
from app.processing import report as rp
from app.processing.models import ProcessingRun
from app.processing.report import UploadedText, build_folder, night_report
from app.processing.rules import Facts, advice_for
from app.processing.seq import RegData

from .astrolog_fixtures import seestar_sub_header
from .processing_fixtures import SENTINEL_DIR, synthetic_conversion, synthetic_seq
from .test_astrolog_import import commit, fits_item, make_location

NY = "America/New_York"
RUNS = "/api/processing/runs"
START = datetime(2026, 9, 12, 3, 0, tzinfo=timezone.utc)  # 23:00 EDT on the 11th

# The 40-frame synthetic night: 6 frames Siril could not align, 8 aligned but left out of the stack.
UNALIGNED = (5, 6, 7, 18, 30, 31)
DROPPED = (2, 9, 12, 15, 22, 25, 33, 38)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def basename(i: int) -> str:
    # The local time written in the name is deliberately wrong: times must come from DATE-OBS only.
    return f"Light_NGC 7635_10.0s_LP_20260101-1200{i:02d}.fit"


def regs(n: int, unaligned, dropped, stars=lambda i: 30 + i % 15) -> list[RegData | None]:
    out: list[RegData | None] = []
    d = k = 0
    for i in range(1, n + 1):
        if i in unaligned:
            out.append(None)
            continue
        if i in dropped:
            rnd = round(0.63 + 0.01 * d, 4)  # 0.63 .. 0.70
            d += 1
        else:
            rnd = round(0.78 + 0.002 * k, 4)  # 0.78 and up
            k += 1
        out.append(RegData(fwhm=round(2.0 + 0.01 * i, 4), wfwhm=round(3.0 + 0.01 * i, 4), roundness=rnd,
                           quality=0.0, background=0.017, stars=stars(i)))
    return out


def night_files(n=40, unaligned=UNALIGNED, dropped=DROPPED, with_kept=True, stars=lambda i: 30 + i % 15,
                stale=False) -> list[UploadedText]:
    rr = regs(n, unaligned, dropped, stars)
    files = [
        UploadedText("process/light_.seq", synthetic_seq("light_", [(True, None)] * n, layer=None)),
        UploadedText("process/pp_light_.seq", synthetic_seq("pp_light_", [(r is not None, r) for r in rr])),
        UploadedText("process/light_conversion.txt", synthetic_conversion([basename(i) for i in range(1, n + 1)])),
    ]
    if with_kept:
        kept = [(i, r) for i, r in enumerate(rr, start=1) if r is not None and i not in dropped]
        rows = [(True, r) for _, r in kept]
        if stale:
            r0 = rows[0][1]
            rows[0] = (True, RegData(r0.fwhm + 1, r0.wfwhm, r0.roundness, 0.0, r0.background, r0.stars))
        files.append(UploadedText("process/r_pp_light_.seq",
                                  synthetic_seq("r_pp_light_", rows, filenums=[i for i, _ in kept])))
    return files


def even_times(n=40, start=START, step_s=15) -> dict[str, str]:
    return {basename(i): iso(start + timedelta(seconds=step_s * (i - 1))) for i in range(1, n + 1)}


def make_report(files=None, times=None, tz=NY, calibration_dirs=(), **kw):
    folder = build_folder(files if files is not None else night_files(), list(calibration_dirs),
                          times if times is not None else even_times())
    return folder, night_report(folder, 10.0, tz, **kw)


def finding(rep, fid):
    got = [f for f in rep.findings if f.id == fid]
    return got[0] if got else None


# ---- the split night: 20 frames from 00:30 EDT (10 kept), 25 frames from 01:30 EDT (23 kept) ----

SPLIT_START = datetime(2026, 9, 12, 4, 30, tzinfo=timezone.utc)  # 00:30 EDT


def _spread_out(part: list[int], keep: int) -> list[int]:
    """The frames of `part` left out when `keep` of them are kept, spread evenly through it."""
    m = len(part)
    return [f for j, f in enumerate(part) if (j + 1) * keep // m == j * keep // m]


def split_night(first_kept=10, second_kept=23):
    """45 frames, 3 minutes apart from 00:30 EDT: frames 1-20 before 01:30 EDT (05:30Z), 21-45 from then on."""
    n = 45
    left_out = _spread_out(list(range(1, 21)), first_kept) + _spread_out(list(range(21, 46)), second_kept)
    unaligned = set(left_out[::2])
    dropped = set(left_out) - unaligned
    files = night_files(n, unaligned, dropped)
    times = {basename(i): iso(SPLIT_START + timedelta(minutes=3 * (i - 1))) for i in range(1, n + 1)}
    return files, times


# ---- tests: totals, sequence choice, bins ------------------------------------------------------

def test_report_totals():
    folder, rep = make_report()
    assert rep.totals["captured"] == 40
    assert rep.totals["aligned"] == 34
    assert rep.totals["kept"] == 26
    assert rep.totals["captured_s"] == 400.0
    assert rep.totals["aligned_s"] == 340.0
    assert rep.totals["kept_s"] == 260.0
    assert rep.time_unknown == 0
    aligned = [f for f in folder.frames if f.aligned]
    assert rep.medians["stars"] == float(np.median([f.stars for f in aligned]))
    assert rep.medians["fwhm"] == pytest.approx(float(np.median([f.fwhm for f in aligned])))
    assert rep.ranges["stars"] == [min(f.stars for f in aligned), max(f.stars for f in aligned)]
    unaligned = [f for f in folder.frames if not f.aligned]
    assert len(unaligned) == 6 and all(f.fwhm is None and f.stars is None and f.kept is False for f in unaligned)
    assert rep.units["background"] == "Siril units, relative"


def test_report_uses_per_frame_exptime_where_known():
    folder = build_folder(night_files(), [], even_times(), frame_exptimes={basename(1): 30.0})
    rep = night_report(folder, 10.0, NY)
    assert rep.totals["captured_s"] == 420.0


def test_registration_seq_choice():
    folder, rep = make_report()
    assert folder.registration_seq == "pp_light_"
    assert folder.kept_seq == "r_pp_light_"
    assert folder.seq_version == 6 and folder.matched == 40 and folder.run_dir == "process"
    assert [f.n for f in folder.frames] == list(range(1, 41))
    assert folder.frames[0].basename == basename(1)

    folder, rep = make_report(files=night_files(with_kept=False))
    assert folder.kept_seq is None
    assert all(f.kept is None for f in folder.frames)
    assert rep.totals["kept"] is None and rep.totals["kept_s"] is None
    assert all(b.kept is None for b in rep.bins)
    assert finding(rep, "round_cut") is None


def test_no_registered_sequence_is_an_error():
    files = [f for f in night_files() if "pp_light_" not in f.path]
    with pytest.raises(rp.FolderError, match="registration"):
        build_folder(files, [], even_times())


def test_missing_conversion_is_an_error():
    files = [f for f in night_files() if "conversion" not in f.path]
    with pytest.raises(rp.FolderError, match="light_conversion.txt"):
        build_folder(files, [], even_times())


def test_unmatched_frames_are_explicit():
    times = {k: v for k, v in even_times().items() if int(k[-6:-4]) <= 30}  # frames 1-30 imported
    folder, rep = make_report(times=times)
    assert folder.matched == 30
    assert rep.totals["matched"] == 30 and rep.totals["unmatched"] == 10
    assert rep.totals["captured"] == 40  # still counted: they may be this night's frames never imported
    um = finding(rep, "unmatched")
    assert um.title == "10 of this folder's 40 frames don't match this night's imported frames"
    assert um.detail.startswith("They are counted in the totals but not in the time chart.")
    assert um.basis == "measured" and um.heuristic is False
    assert sum(b.captured for b in rep.bins) == 30

    _, rep = make_report()
    assert rep.totals["matched"] == 40 and rep.totals["unmatched"] == 0
    assert finding(rep, "unmatched") is None


def test_percent_never_rounds_to_all_or_none():
    assert rp._pct(249, 250) == 99  # 99.6 % is not "100 %"
    assert rp._pct(1, 250) == 1  # 0.4 % is not "0 %"
    assert rp._pct(250, 250) == 100 and rp._pct(0, 250) == 0
    assert rp._pct(1, 2) == 50 and rp._pct(23, 25) == 92


def test_bins_local_labels():
    times = {basename(i): iso(START + timedelta(minutes=2 * (i - 1))) for i in range(1, 41)}  # 03:00Z..04:18Z
    _, rep = make_report(times=times)
    assert rep.bins[0].label_local == "23:00"
    assert [b.label_local for b in rep.bins] == ["23:00", "23:30", "00:00"]
    assert [b.start_utc for b in rep.bins] == sorted(b.start_utc for b in rep.bins)
    assert rep.bins[0].start_utc == "2026-09-12T03:00:00Z"
    assert sum(b.captured for b in rep.bins) == 40
    assert sum(b.aligned for b in rep.bins) == 34
    assert sum(b.kept for b in rep.bins) == 26


def test_bins_fill_gaps_and_skip_unknown_times():
    times = even_times()
    times[basename(40)] = iso(START + timedelta(hours=2))  # 05:00Z, leaving 03:30 to 04:30 empty
    del times[basename(39)]
    folder, rep = make_report(times=times)
    assert rep.time_unknown == 1 and folder.matched == 39
    assert [b.label_local for b in rep.bins] == ["23:00", "23:30", "00:00", "00:30", "01:00"]
    assert [b.captured for b in rep.bins] == [38, 0, 0, 0, 1]


def test_bins_across_dst_end():
    start = datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc)  # 01:00 EDT; 06:00Z is 01:00 EST
    times = {basename(i): iso(start + timedelta(minutes=4 * (i - 1))) for i in range(1, 39)}  # to 07:28Z
    _, rep = make_report(files=night_files(38, UNALIGNED, DROPPED), times=times)
    ones = [b for b in rep.bins if b.label_local == "01:00"]
    assert len(ones) == 2 and ones[0].start_utc != ones[1].start_utc
    assert [b.start_utc for b in ones] == ["2026-11-01T05:00:00Z", "2026-11-01T06:00:00Z"]
    assert [b.label_local for b in rep.bins] == ["01:00", "01:30", "01:00", "01:30", "02:00"]


def test_bins_without_timezone_are_utc():
    _, rep = make_report(tz=None)
    assert rep.timezone is None and rep.bins[0].label_local == "03:00"


# ---- tests: findings -------------------------------------------------------------------------

def test_findings():
    _, rep = make_report(calibration_dirs=["flats"])
    na = finding(rep, "not_aligned")
    assert na.title == "6 frames couldn't be aligned" and na.basis == "measured" and na.heuristic is False

    rc = finding(rep, "round_cut")
    assert rc.title.endswith("all had roundness below 0.74")
    assert rc.value == 0.74 and rc.basis == "measured" and rc.heuristic is False

    ls = finding(rep, "low_stars")
    assert ls is not None and ls.heuristic is True and ls.basis == "measured"

    cal = finding(rep, "calibration")
    assert cal is not None and "flats" in cal.title

    assert finding(rep, "time_split") is None  # the whole night sits in one bin
    for f in rep.findings:
        assert f.basis in ("measured", "siril-docs", "tutorial-default", "taste")
        assert isinstance(f.heuristic, bool)


def test_findings_absent_when_not_supported():
    _, rep = make_report(files=night_files(stars=lambda i: 80), calibration_dirs=[])
    assert finding(rep, "low_stars") is None
    assert finding(rep, "calibration") is None
    _, rep = make_report(files=night_files(unaligned=()))
    assert finding(rep, "not_aligned") is None
    # One kept frame rounder-than-cut is not needed; one dropped frame rounder than a kept one breaks the cut.
    files = night_files()
    pp = next(f for f in files if f.path.endswith("/pp_light_.seq"))
    rr = regs(40, UNALIGNED, DROPPED)
    r2 = rr[1]  # frame 2 is dropped; make it rounder than every kept frame
    rr[1] = RegData(r2.fwhm, r2.wfwhm, 0.99, 0.0, r2.background, r2.stars)
    files[files.index(pp)] = UploadedText(pp.path, synthetic_seq("pp_light_", [(r is not None, r) for r in rr]))
    _, rep = make_report(files=files)
    assert finding(rep, "round_cut") is None


def test_round_cut_value_keeps_the_statement_true():
    """The 2 dp midpoint is used only when it lies between the groups; otherwise more decimals."""
    assert rp.separating_cut(0.70, 0.78) == 0.74
    assert rp.separating_cut(0.742286, 0.744081) == 0.743  # 0.74 would not be above every dropped frame
    v = rp.separating_cut(0.7449, 0.7451)
    assert 0.7449 < v <= 0.7451


def test_time_split_finding():
    files, times = split_night()
    _, rep = make_report(files=files, times=times)
    ts = finding(rep, "time_split")
    assert ts.title == "Before 01:30, 50 % of frames reached the stack; from 01:30 on, 92 %"
    assert ts.basis == "measured" and ts.heuristic is True
    assert "Possible causes" not in ts.detail  # no altitude function given: no cause

    files, times = split_night(first_kept=14)  # 70 %: above SPLIT_LOW
    _, rep = make_report(files=files, times=times)
    assert finding(rep, "time_split") is None

    files, times = split_night(second_kept=20)  # 80 %: below SPLIT_HIGH
    _, rep = make_report(files=files, times=times)
    assert finding(rep, "time_split") is None


def test_time_split_reverse_direction():
    files, times = split_night(first_kept=18, second_kept=12)
    _, rep = make_report(files=files, times=times)
    ts = finding(rep, "time_split")
    assert ts.title == "Before 01:30, 90 % of frames reached the stack; from 01:30 on, 48 %"


def _alt(ra, dec, lat=40.005, lon=-75.0):
    return lambda utcs: astronomy.altitude_deg(ra, dec, lat, lon, utcs)


def test_possible_cause_low_altitude():
    files, times = split_night()
    rising = _alt(70.0, 20.0)  # below 30 deg until about 01:45 EDT on this night
    _, rep = make_report(files=files, times=times, altitude=rising)
    ts = finding(rep, "time_split")
    m = re.search(r"Possible causes: the target was below 30° until (\d\d):(\d\d)\.$", ts.detail)
    assert m, ts.detail
    # Independently check the minute: at HH:MM the target is at/above 30 deg, a minute earlier below.
    local = datetime(2026, 9, 12, int(m.group(1)), int(m.group(2)))
    utc = (local + timedelta(hours=4)).replace(tzinfo=timezone.utc)
    a_at, a_before = rising([iso(utc), iso(utc - timedelta(minutes=1))])
    assert a_at >= rp.LOW_ALT_DEG > a_before
    assert "Possible causes" not in ts.title and "below" not in ts.title

    high = _alt(350.19, 61.21)  # the Bubble Nebula region: high all night
    _, rep = make_report(files=files, times=times, altitude=high)
    assert "Possible causes" not in finding(rep, "time_split").detail

    for f in rep.findings:
        assert not re.search(r"\b(cloud|clouds|dew|wind)\b", f"{f.title} {f.detail}", re.I)
    _, rep = make_report(files=files, times=times, altitude=rising)
    for f in rep.findings:
        assert not re.search(r"\b(cloud|clouds|dew|wind)\b", f"{f.title} {f.detail}", re.I)
        assert "Possible causes" not in f.title


def test_low_altitude_cause_needs_the_good_part_high():
    files, times = split_night()
    late = _alt(75.0, 20.0)  # rises through 30 deg only around 02:10 EDT: most of the good part was low too
    _, rep = make_report(files=files, times=times, altitude=late)
    assert "Possible causes" not in finding(rep, "time_split").detail


def test_low_altitude_cause_when_setting():
    files, times = split_night(first_kept=18, second_kept=12)
    setting = _alt(295.0, 10.0)  # sinks below 30 deg a little after 01:00 EDT
    _, rep = make_report(files=files, times=times, altitude=setting)
    ts = finding(rep, "time_split")
    m = re.search(r"Possible causes: the target was below 30° from (\d\d):(\d\d) on\.$", ts.detail)
    assert m, ts.detail
    local = datetime(2026, 9, 12, int(m.group(1)), int(m.group(2)))
    utc = (local + timedelta(hours=4)).replace(tzinfo=timezone.utc)
    a_at, a_before = setting([iso(utc), iso(utc - timedelta(minutes=1))])
    assert a_before >= rp.LOW_ALT_DEG > a_at


def test_altitude_deg_transit():
    lat, lon, dec, ra = 40.09, -75.0, 61.36, 90.0
    t0 = Time("2026-09-12T00:00:00", scale="utc")
    lst = t0.sidereal_time("apparent", longitude=lon * u.deg).deg
    transit = t0 + ((ra - lst) % 360.0) / 15.0 / 1.00273790935 * u.hour
    alt = astronomy.altitude_deg(ra, dec, lat, lon, [transit.isot + "Z"])
    assert alt.shape == (1,)
    assert abs(alt[0] - (90 - abs(lat - dec))) < 0.1
    # Sanity: twelve sidereal hours later it is at lower culmination, far lower.
    later = transit + 12 / 1.00273790935 * u.hour
    assert astronomy.altitude_deg(ra, dec, lat, lon, [later.isot + "Z"])[0] < alt[0] - 50
    assert EarthLocation  # imported for parity with astronomy's frame


# ---- report-based advice rules ---------------------------------------------------------------

def test_report_rules():
    _, rep = make_report()
    facts = Facts(bayer_pattern="GRBG", frame_count=40, exptime_s=10.0, report=rep)
    align = advice_for("align", facts)
    assert [a.rule_id for a in align] == ["align.two_pass"]
    assert align[0].heuristic is True and align[0].basis == "measured" and "-2pass" in align[0].setting
    # Explains what the coach's script already does; not presented as a choice to make.
    assert align[0].setting.startswith("The coach's script registers in two passes")
    assert f"median of {rep.medians['stars']:g} stars" in align[0].why
    assert "always" in align[0].why and "nothing to change" in align[0].why.lower()
    stack = advice_for("stack", facts)
    # 26 kept frames: under the 30-frame rule. Since Task 8 fix round 1 the stack script then averages without
    # rejection, and the advice says so (it used to show no advice while the script still clipped).
    assert [a.rule_id for a in stack] == ["stack.rejection"] and "rej n" in stack[0].setting
    assert stack[0].heuristic is True and "26 kept frames" in stack[0].why

    _, rep = make_report(files=night_files(80, unaligned=(), dropped=(), stars=lambda i: 80),
                         times=even_times(80))
    facts = Facts(bayer_pattern="GRBG", frame_count=80, exptime_s=10.0, report=rep)
    assert advice_for("align", facts) == []
    st = advice_for("stack", facts)
    assert [a.rule_id for a in st] == ["stack.rejection"]
    assert st[0].basis == "siril-docs" and st[0].source_url.startswith("https://")
    assert "rej w 3 3" in st[0].setting


# ---- API ---------------------------------------------------------------------------------------

@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def import_night(c, n=40, start=START, step_s=15, **header) -> str:
    loc = make_location(c)
    items = [fits_item(basename(i), seestar_sub_header(
        date_obs=iso(start + timedelta(seconds=step_s * (i - 1)))[:-1], **header)) for i in range(1, n + 1)]
    r = commit(c, items, loc)
    assert r.status_code == 200, r.text
    from app.astrolog.models import CaptureSet
    with c.app.state.db.session() as s:
        cs = s.scalars(select(CaptureSet)).one().id
    r = c.post(RUNS, json={"capture_set_id": cs})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def upload(c, run_id, files, calibration_dirs=(), run_dir="process"):
    return c.post(f"{RUNS}/{run_id}/siril-folder", json={
        "run_dir": run_dir, "files": [{"path": f.path, "text": f.text} for f in files],
        "calibration_dirs": list(calibration_dirs)})


def run_row(c) -> dict:
    with c.app.state.db.session() as s:
        r = s.scalars(select(ProcessingRun)).one()
        return {"folder": r.folder, "frame_stats": r.frame_stats, "choices": r.choices,
                "step_states": r.step_states, "comparison": r.comparison}


def test_upload_folder_gives_report(api):
    run_id = import_night(api)
    r = upload(api, run_id, night_files(), calibration_dirs=["flats"])
    assert r.status_code == 200, r.text
    body = r.json()
    rep = body["report"]
    assert rep["totals"]["captured"] == 40 and rep["totals"]["kept"] == 26 and rep["totals"]["kept_s"] == 260.0
    assert rep["bins"][0]["label_local"] == "23:00"
    assert {f["id"] for f in rep["findings"]} >= {"not_aligned", "round_cut", "low_stars", "calibration"}
    assert body["folder"]["run_dir"] == "process" and body["folder"]["registration_seq"] == "pp_light_"
    steps = {s["id"]: s for s in body["steps"]}
    assert steps["report"]["blocked"] is None and steps["select"]["blocked"] is None
    assert [a["rule_id"] for a in steps["align"]["advice"]] == ["align.two_pass"]
    again = api.get(f"{RUNS}/{run_id}").json()
    assert again["report"] == rep


def test_folder_not_this_night(api):
    run_id = import_night(api)
    times_off = night_files()
    conv = [basename(i) if i <= 10 else f"Other_{i}.fit" for i in range(1, 41)]
    files = [f if "conversion" not in f.path else UploadedText(f.path, synthetic_conversion(conv)) for f in times_off]
    before = run_row(api)
    r = upload(api, run_id, files)
    assert r.status_code == 422
    assert r.json()["detail"] == "This Siril folder doesn't look like this night's frames (10 of 40 match)"
    assert run_row(api) == before
    assert api.get(f"{RUNS}/{run_id}").json()["report"] is None


def test_unsupported_version_422(api):
    run_id = import_night(api)
    files = night_files()
    pp = next(f for f in files if f.path.endswith("/pp_light_.seq"))
    files[files.index(pp)] = UploadedText(pp.path, pp.text.replace(" 0 6 0 0 0", " 0 5 0 0 0"))
    r = upload(api, run_id, files)
    assert r.status_code == 422 and "version" in r.json()["detail"]


def test_stale_kept_reports_unknown(api):
    run_id = import_night(api)
    r = upload(api, run_id, night_files(stale=True))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report"]["totals"]["kept"] is None
    assert "re-run" in body["folder"]["kept_error"]
    assert all(b["kept"] is None for b in body["report"]["bins"])


def test_no_paths_or_coords_stored(api):
    run_id = import_night(api)
    r = upload(api, run_id, night_files(), calibration_dirs=["flats"], run_dir="/Users/someone/ZZ_PATH/process")
    assert r.status_code == 200, r.text
    dumped = json.dumps(run_row(api))
    assert "ZZ_PATH" not in dumped and SENTINEL_DIR not in dumped
    assert not re.search(r'"/', dumped)
    assert "40.005" not in dumped and "349.0" not in dumped and "61.2" not in dumped
    assert run_row(api)["folder"]["run_dir"] == "process"
    out = json.dumps(r.json())
    assert "ZZ_PATH" not in out and "40.005" not in out


def test_upload_low_altitude_cause_from_app_computation(api):
    """A custom target low in the east early on: the cause comes from the app's own altitude computation."""
    files, times = split_night()
    loc = make_location(api)
    items = [fits_item(b, seestar_sub_header(object="Blob Q", date_obs=t[:-1], RA=70.0, DEC=20.0))
             for b, t in times.items()]
    assert commit(api, items, loc).status_code == 200
    from app.astrolog.models import CaptureSet
    with api.app.state.db.session() as s:
        cs = s.scalars(select(CaptureSet)).one().id
    run_id = api.post(RUNS, json={"capture_set_id": cs}).json()["id"]
    r = upload(api, run_id, files)
    assert r.status_code == 200, r.text
    ts = next(f for f in r.json()["report"]["findings"] if f["id"] == "time_split")
    assert re.search(r"Possible causes: the target was below 30° until 01:4\d\.$", ts["detail"])
    assert "70.0" not in json.dumps(run_row(api))


def test_run_dir_with_newline_is_rejected_and_run_unchanged(api):
    run_id = import_night(api)
    before = run_row(api)
    r = upload(api, run_id, night_files(), run_dir="process\nstack r_pp_light rej n")
    assert r.status_code == 422, r.text
    assert "folder" in r.json()["detail"].lower()
    assert run_row(api) == before


@pytest.mark.parametrize("bad", ["process\r", "pro\rcess", "-x", "a'b", "a\"b", "~x", "a\tb"])
def test_run_dir_unsafe_names_rejected(api, bad):
    run_id = import_night(api)
    assert upload(api, run_id, night_files(), run_dir=bad).status_code == 422


def test_calibration_dir_with_newline_is_dropped(api):
    run_id = import_night(api)
    r = upload(api, run_id, night_files(), calibration_dirs=["flats", "darks\nclose", "-bad", "ok name"])
    assert r.status_code == 200, r.text
    assert run_row(api)["folder"]["calibration_dirs"] == ["flats", "ok name"]
