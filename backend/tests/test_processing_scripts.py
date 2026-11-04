"""Phase 4 Task 8: the two generated Siril 1.4.5 scripts (spec 2a) and their download route."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.processing.report import separating_cut
from app.processing.rules import MIN_FRAMES_FOR_REJECTION, Facts, advice_for
from app.processing.scripts import COACH_DIR, disk_estimate_bytes, prepare_script, stack_script
from app.processing.report import FrameStat
from app.processing.selection import SelectionOption, as_float32, selection_options

from .test_processing_report import RUNS, api, import_night, night_files, upload  # noqa: F401

GOLDEN = Path(__file__).parent / "golden"
FACTS = Facts(bayer_pattern="GRBG", frame_count=1015, exptime_s=10.0)


def option(id_="round80", filter_="round", value=0.791, percent=80, kept=812, seconds=8120.0) -> SelectionOption:
    return SelectionOption(id_, "label", filter_, value, percent, kept, seconds, "measured", True, "note")


ALL = option("all", "none", None, None, 1001, 10010.0)
PREVIOUS = option("previous", "round", 0.743, None, 654, 6540.0)
ROUND80 = option()
WFWHM80 = option("wfwhm80", "wfwhm", 4.12, 80, 800, 8000.0)
ABSOLUTE = re.compile(r"(^|[\s='\"(])(/|~)")  # a path starting at the root or the home folder


def scripts() -> list[str]:
    return [prepare_script(FACTS)] + [stack_script(o, FACTS) for o in (ALL, PREVIOUS, ROUND80, WFWHM80)]


# ---- the scripts --------------------------------------------------------------------------------

def test_prepare_matches_golden_file():
    assert prepare_script(FACTS) == (GOLDEN / "prepare.ssf").read_text(encoding="utf-8")


def test_stack_round_matches_golden_file():
    assert stack_script(ROUND80, FACTS) == (GOLDEN / "stack_round.ssf").read_text(encoding="utf-8")


def commands(script: str) -> list[str]:
    return [ln for ln in script.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def test_prepare_has_the_verified_shape_and_never_filters():
    s = prepare_script(FACTS)
    assert commands(s) == ["requires 1.4.5", "cd lights", "convert light -out=../process-coach", "cd ../process-coach",
                           "calibrate light -debayer", "register pp_light -2pass", "close"]
    assert "-filter" not in s and "seqapplyreg" not in s and "stack " not in "\n".join(commands(s))
    assert COACH_DIR == "process-coach"


@pytest.mark.parametrize("opt, filt", [
    (ALL, ""), (PREVIOUS, " -filter-round=0.743"), (ROUND80, " -filter-round=80%"), (WFWHM80, " -filter-wfwhm=80%")])
def test_stack_has_the_verified_shape_and_the_option_filter(opt, filt):
    assert commands(stack_script(opt, FACTS)) == [
        "requires 1.4.5", "cd process-coach", f"seqapplyreg pp_light{filt}",
        "stack r_pp_light rej w 3 3 -norm=addscale -output_norm -rgb_equal -out=result_coach", "close"]


def test_percent_options_pass_the_percent_not_the_resolved_value():
    assert "0.791" not in stack_script(ROUND80, FACTS) and "4.12" not in stack_script(WFWHM80, FACTS)
    assert "-filter-round=0.743" in stack_script(PREVIOUS, FACTS)
    assert f"keep {PREVIOUS.kept} frames" in stack_script(PREVIOUS, FACTS)


@pytest.mark.parametrize("i", range(5))
def test_requires_first_and_every_command_preceded_by_a_reason(i):
    s = scripts()[i]
    lines = s.splitlines()
    assert lines[0] == "requires 1.4.5" and s.endswith("\n") and "\r" not in s
    # `requires` must be the first line; its reason is the comment straight after it.
    assert lines[1].startswith("# The line above")
    for prev, ln in zip(lines[1:], lines[2:]):
        if ln.strip() and not ln.startswith("#"):
            assert prev.startswith("# "), f"no reason before {ln!r}"
    assert s.isascii()


@pytest.mark.parametrize("i", range(5))
def test_no_absolute_or_home_paths_and_only_coach_folder_written(i):
    s = scripts()[i]
    for ln in s.splitlines():
        assert "/Users" not in ln and "~" not in ln and not ABSOLUTE.search(ln), ln
    cmds = commands(s)
    outs = [c for c in cmds if "-out=" in c]
    assert all(c.endswith("-out=../process-coach") or c.endswith("-out=result_coach") for c in outs)
    # never move into the developer's own process/ folder or write into lights/
    assert not any(re.search(r"\bprocess\b(?!-)", c) for c in cmds)
    assert [c for c in cmds if c.startswith("cd ")] in (["cd lights", "cd ../process-coach"], ["cd process-coach"])


def test_lights_folder_name_comes_from_facts_and_is_quoted_when_needed():
    s = prepare_script(Facts("GRBG", 10, 10.0, lights_dir="Light frames"))
    assert 'cd "Light frames"' in commands(s)
    for bad in ("../lights", "/abs", "~", "a/b", "", "..", "x\ny", 'a"b'):
        with pytest.raises(ValueError):
            prepare_script(Facts("GRBG", 10, 10.0, lights_dir=bad))


def test_prepare_without_a_shared_bayer_pattern_says_siril_reads_it():
    s = prepare_script(Facts(None, 10, None))
    assert "GRBG" not in s and "calibrate light -debayer" in s


def test_disk_estimate_is_the_probe_formula():
    assert disk_estimate_bytes(1, 400, 300) == 1_442_880
    assert disk_estimate_bytes(1015) == 1015 * (1080 * 1920 * 12 + 2880)
    assert disk_estimate_bytes(0) == 0


# ---- the route ----------------------------------------------------------------------------------

def test_prepare_download_has_exact_headers(api):  # noqa: F811
    run_id = import_night(api)
    r = api.get(f"{RUNS}/{run_id}/scripts/prepare")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.headers["content-disposition"] == 'attachment; filename="astroplanner-prepare.ssf"'
    assert r.text.startswith("requires 1.4.5\n") and "40 frames" in r.text
    assert api.get(f"{RUNS}/{run_id}/scripts/nope").status_code == 404
    assert api.get(f"{RUNS}/missing/scripts/prepare").status_code == 404


def test_stack_download_needs_a_selection(api):  # noqa: F811
    run_id = import_night(api)
    r = api.get(f"{RUNS}/{run_id}/scripts/stack")
    assert r.status_code == 409 and r.json()["detail"] == "Choose which frames to keep first."
    body = upload(api, run_id, night_files()).json()
    assert api.get(f"{RUNS}/{run_id}/scripts/stack").status_code == 409
    assert body["scripts"]["stack_blocked"] == "Choose which frames to keep first."
    prev = next(o for o in body["selection"] if o["id"] == "previous")
    body = api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": "previous"}}).json()
    r = api.get(f"{RUNS}/{run_id}/scripts/stack")
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="astroplanner-stack.ssf"'
    assert f"-filter-round={prev['value']:g}" in r.text and f"keep {prev['kept']} frames" in r.text
    assert body["scripts"] == {
        "prepare_bytes": disk_estimate_bytes(40), "stack_max_bytes": disk_estimate_bytes(40),
        "stack_bytes": disk_estimate_bytes(prev["kept"]), "stack_blocked": None}


def test_run_carries_the_prepare_estimate_before_any_folder(api):  # noqa: F811
    run_id = import_night(api)
    s = api.get(f"{RUNS}/{run_id}").json()["scripts"]
    assert s == {"prepare_bytes": disk_estimate_bytes(40), "stack_max_bytes": disk_estimate_bytes(40),
                 "stack_bytes": None, "stack_blocked": "Choose which frames to keep first."}


def test_convert_and_stack_steps_say_how_to_run_their_script(api):  # noqa: F811
    run_id = import_night(api)
    steps = {s["id"]: s for s in api.get(f"{RUNS}/{run_id}").json()["steps"]}
    assert steps["convert"]["command"] == 'siril-cli -d "<night folder>" -s "<folder you saved it in>/astroplanner-prepare.ssf"'
    assert steps["stack"]["command"] == 'siril-cli -d "<night folder>" -s "<folder you saved it in>/astroplanner-stack.ssf"'


# ---- Task 8 fix round 1 -------------------------------------------------------------------------

def stack_command(script: str) -> str:
    return next(c for c in commands(script) if c.startswith("stack "))


@pytest.mark.parametrize("kept, rej", [(MIN_FRAMES_FOR_REJECTION - 1, "rej n"), (MIN_FRAMES_FOR_REJECTION, "rej w 3 3")])
def test_stack_rejection_and_the_advice_read_the_same_kept_count(kept, rej):
    assert MIN_FRAMES_FOR_REJECTION == 30
    s = stack_script(option(kept=kept), FACTS)
    assert stack_command(s) == f"stack r_pp_light {rej} -norm=addscale -output_norm -rgb_equal -out=result_coach"
    advice = advice_for("stack", Facts("GRBG", 1015, 10.0, selection_kept=kept))
    assert [a.rule_id for a in advice] == ["stack.rejection"] and f"stack ... {rej})" in advice[0].setting
    assert f"{kept} chosen frames" in advice[0].why and advice[0].basis == "siril-docs" and advice[0].heuristic
    lines = s.splitlines()
    i = lines.index(stack_command(s))
    j = i
    while lines[j - 1].startswith("# "):
        j -= 1
    reason = "\n".join(lines[j:i])  # every comment line straight before the stack command
    assert ("without pixel rejection" in reason) is (rej == "rej n") and f"{kept} frames" in reason


def test_chosen_kept_wins_over_the_folder_count(api):  # noqa: F811
    run_id = import_night(api)
    body = upload(api, run_id, night_files()).json()
    kept = {o["id"]: o["kept"] for o in body["selection"]}
    assert kept["previous"] < 30 <= kept["all"]  # 26 and 34 on the 40-frame fixture
    for choice, rej in (("previous", "rej n"), ("all", "rej w 3 3")):
        run = api.patch(f"{RUNS}/{run_id}", json={"choices": {"selection": choice}}).json()
        stack_step = next(s for s in run["steps"] if s["id"] == "stack")
        assert [a["setting"] for a in stack_step["advice"]][0].endswith(f"(stack ... {rej})")
        assert f"{kept[choice]} chosen frames" in stack_step["advice"][0]["why"]
        assert f"stack r_pp_light {rej} " in api.get(f"{RUNS}/{run_id}/scripts/stack").text


def fs(n, roundness):
    return FrameStat(n=n, basename=None, utc=None, aligned=True, kept=None, fwhm=2.0, wfwhm=3.0,
                     roundness=roundness, background=0.01, stars=40, exptime_s=10.0)


def test_previous_counts_like_siril_float32_compare_at_the_cut():
    assert as_float32(0.743) < 0.743  # 0.74299997...
    frames = [fs(1, 0.742), fs(2, 0.743), fs(3, 0.744), fs(4, 0.75)]
    prev = next(o for o in selection_options(frames, 10.0, 0.743, None) if o.id == "previous")
    assert prev.kept == 2  # the frame exactly at 0.743 is dropped by Siril's float32 >= 0.743


def test_separating_cut_is_strictly_below_the_lowest_kept_frame():
    assert separating_cut(0.742286, 0.744081) == 0.743  # the real night's cut is unchanged
    for hi, lo in ((0.7449, 0.745), (0.742286, 0.742287), (0.70, 0.78), (0.5, 0.5000001)):
        v = separating_cut(hi, lo)
        assert hi < v < lo and as_float32(lo) >= v, (hi, lo, v)


def test_prepare_states_both_scripts_disk_and_the_total():
    s = prepare_script(FACTS)
    one = disk_estimate_bytes(1015)
    assert f"about {one / 1e9:.1f} GB in process-coach/" in s
    assert "Script 2 adds up to\n# about 25.3 GB more" in s and "at most all 1015" in s
    assert f"# {2 * one / 1e9:.1f} GB in all." in s and "50.5 GB in all" in s


@pytest.mark.parametrize("i", range(5))
def test_scripts_say_where_siril_cli_looks_for_the_file(i):
    s = scripts()[i]
    assert "full path after -s" in s and "looked up in the night folder, not in the terminal's current folder" in s
    assert "Preferences (Scripts)" in s and "Scripts menu" in s
