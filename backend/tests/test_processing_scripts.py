"""Phase 4 Task 8: the two generated Siril 1.4.5 scripts (spec 2a) and their download route."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.processing.rules import Facts
from app.processing.scripts import COACH_DIR, disk_estimate_bytes, prepare_script, stack_script
from app.processing.selection import SelectionOption

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
        "prepare_bytes": disk_estimate_bytes(40), "stack_bytes": disk_estimate_bytes(prev["kept"]),
        "stack_blocked": None}


def test_run_carries_the_prepare_estimate_before_any_folder(api):  # noqa: F811
    run_id = import_night(api)
    s = api.get(f"{RUNS}/{run_id}").json()["scripts"]
    assert s == {"prepare_bytes": disk_estimate_bytes(40), "stack_bytes": None,
                 "stack_blocked": "Choose which frames to keep first."}


def test_convert_and_stack_steps_say_how_to_run_their_script(api):  # noqa: F811
    run_id = import_night(api)
    steps = {s["id"]: s for s in api.get(f"{RUNS}/{run_id}").json()["steps"]}
    assert steps["convert"]["command"] == 'siril-cli -d "<night folder>" -s astroplanner-prepare.ssf'
    assert steps["stack"]["command"] == 'siril-cli -d "<night folder>" -s astroplanner-stack.ssf'
