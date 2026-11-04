"""Phase 4 final whole-branch review fixes: counts-folder note, one duration rule, wording, parser robustness."""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pytest

from app.processing import measure
from app.processing.report import FolderResult, FrameStat, UploadedText, night_report
from app.processing.rules import Facts
from app.processing.scripts import COACH_DIR, counts_note, format_duration, stack_script
from app.processing.seq import SeqParseError, parse_seq
from app.processing.steps import build_steps

from .processing_fixtures import synthetic_seq
from .test_processing_measure import _fits, _image
from .test_processing_report import NY, RUNS, START, api, import_night, iso, night_files, regs, upload  # noqa: F401
from .test_processing_scripts import ROUND80

COACH_TEXT = ("These counts are from process/. Script 2 applies the same filter to process-coach/, whose alignment "
              "may differ; choose the night folder again after script 1 and pick process-coach to see its own counts.")


# ---- 1. which folder the step-4 counts describe ---------------------------------------------------

def test_counts_note_only_when_the_counts_come_from_another_folder():
    assert counts_note("process") == COACH_TEXT
    assert counts_note(COACH_DIR) is None
    assert counts_note(None) is None


def comments(script: str) -> str:
    return " ".join(ln[2:] for ln in script.splitlines() if ln.startswith("# "))


def test_stack_script_says_which_folder_the_count_came_from():
    other = stack_script(ROUND80, Facts("GRBG", 1015, 10.0, counts_dir="process"))
    assert "Counted in process/, the folder the coach read, it would keep 812 frames (2 h 15 m)." in comments(other)
    assert COACH_TEXT in comments(other)
    same = stack_script(ROUND80, Facts("GRBG", 1015, 10.0, counts_dir=COACH_DIR))
    assert "Counted in process-coach/, the folder the coach read, it would keep 812 frames" in comments(same)
    assert "These counts are from" not in same
    assert all(len(ln) <= 110 for ln in other.splitlines())
    # the commands are the same either way: only the explanation differs
    cmds = lambda s: [ln for ln in s.splitlines() if ln and not ln.startswith("#")]  # noqa: E731
    assert cmds(other) == cmds(same)


@pytest.mark.parametrize("run_dir, differs", [("process", True), (COACH_DIR, False)])
def test_run_out_flags_counts_from_another_folder(api, run_dir, differs):  # noqa: F811
    run_id = import_night(api)
    assert api.get(f"{RUNS}/{run_id}").json()["selection_counts"] is None  # no folder read yet
    body = upload(api, run_id, night_files(), run_dir=run_dir).json()
    sc = body["selection_counts"]
    assert sc == {"run_dir": run_dir, "script_dir": COACH_DIR, "differs": differs,
                  "note": COACH_TEXT if differs else None}
    api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": "all"}})
    text = api.get(f"{RUNS}/{run_id}/scripts/stack").text
    assert (COACH_TEXT in comments(text)) is differs
    assert f"Counted in {run_dir}/, the folder the coach read, it would keep 34 frames" in comments(text)


# ---- 2. one duration rule: floor, AstroLog's format -----------------------------------------------

@pytest.mark.parametrize("seconds, text", [
    (8510.0, "2 h 21 m"), (8519.9, "2 h 21 m"), (6540.0, "1 h 49 m"), (3600.0, "1 h 0 m"),
    (3599.6, "59 m 59 s"), (200.0, "3 m 20 s"), (120.0, "2 m"), (45.0, "45 s")])
def test_format_duration_floors_like_astrolog(seconds, text):
    assert format_duration(seconds) == text


def test_stack_script_851_frames_reads_2_h_21_m():
    opt = ROUND80.__class__(**{**ROUND80.__dict__, "kept": 851, "seconds": 8510.0})
    assert "(2 h 21 m)" in stack_script(opt, Facts("GRBG", 1015, 10.0))


# ---- 3. step 1 says the coach reads Siril's record, not the frames --------------------------------

def test_step_one_reads_sirils_record_not_the_frames():
    report = next(s for s in build_steps(Facts("GRBG", 40, 10.0), {}) if s.id == "report")
    assert report.does.startswith("Reads Siril's record of your light frames (the .seq sequence files and the "
                                  "conversion list), never the frames themselves")
    assert "Reads your light frames" not in report.does


# ---- 5. a garbled .seq is a 422, never a 500 -------------------------------------------------------

def garbled(stars: str = "inf") -> str:
    text = synthetic_seq("pp_light_", [(r is not None, r) for r in regs(4, (), ())])
    lines = text.splitlines()
    i = next(j for j, ln in enumerate(lines) if ln.startswith("R1 "))
    tok = lines[i].split()
    tok[6] = stars  # the star count
    lines[i] = " ".join(tok)
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize("stars", ["inf", "-inf", "nan", "1e999"])
def test_non_finite_star_count_is_a_parse_error(stars):
    with pytest.raises(SeqParseError, match="Malformed registration line"):
        parse_seq(garbled(stars))


def test_garbled_seq_upload_is_422(api):  # noqa: F811
    run_id = import_night(api)
    files = [f if not f.path.endswith("/pp_light_.seq") else UploadedText(f.path, garbled()) for f in night_files()]
    r = upload(api, run_id, files)
    assert r.status_code == 422 and "Malformed registration line" in r.json()["detail"]


def test_any_other_parser_failure_is_422(api, monkeypatch):  # noqa: F811
    from app.processing import routes

    def boom(*a, **k):
        raise IndexError("unexpected")

    monkeypatch.setattr(routes, "build_folder", boom)
    run_id = import_night(api)
    r = upload(api, run_id, night_files())
    assert r.status_code == 422
    assert r.json()["detail"].startswith("The coach couldn't read this Siril folder's text files")
    assert api.get(f"{RUNS}/{run_id}").json()["folder"] is None  # the run is left unchanged


# ---- 6. a star-fitting failure is "too few usable stars", not a failed upload ---------------------

def test_star_fit_failure_gives_no_fwhm(monkeypatch):
    def boom(*a, **k):
        raise ValueError("photutils fit failed")

    monkeypatch.setattr(measure, "_fit_stars", boom)
    m, preview, _ = measure.measure_stack(_fits(_image(256, 256).astype(np.float32)), "stack.fit")
    assert m.star_fwhm_px is None and m.stars_measured == 0
    assert m.noise_frac > 0 and preview[:2] == b"\xff\xd8"  # the rest is still measured


# ---- 9, 10. report wording ------------------------------------------------------------------------

def test_low_stars_finding_matches_the_align_advice():
    from .test_processing_report import make_report, finding
    _, rep = make_report()
    ls = finding(rep, "low_stars")
    assert "The coach's script already registers in two passes, which helps when stars are few." in ls.detail
    assert "suggests" not in ls.detail


def test_time_split_counts_use_thousands_separators():
    frames = []
    for i in range(1015):
        kept = (i % 2 == 0) if i < 500 else (i % 20 != 0)  # 50 % before, 95 % after
        frames.append(FrameStat(n=i + 1, basename=f"f{i}.fit", utc=iso(START + timedelta(seconds=10 * i)),
                                aligned=True, kept=kept, fwhm=2.0, wfwhm=3.0, roundness=0.8, background=0.01,
                                stars=100))
    folder = FolderResult(run_dir="process", registration_seq="pp_light_", kept_seq="r_pp_light_", seq_version=6,
                          frames=frames, matched=1015, kept_error=None, calibration_dirs=[])
    rep = night_report(folder, 10.0, NY)
    ts = next(f for f in rep.findings if f.id == "time_split")
    assert ts.detail.startswith("Counted over the 1,015 frames with a known capture time:")
    assert "1015" not in ts.detail
