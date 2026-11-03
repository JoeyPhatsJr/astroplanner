"""Phase 3 Task 4: mission progress from AstroLog nights."""

from __future__ import annotations

from datetime import date

from app.variables.missions import monthly_count, weekly_streak

D = date.fromisoformat
# 2026-11-02 is a Monday: ISO week 45 is Nov 2-8, week 44 Oct 26-Nov 1, week 43 Oct 19-25.
W44, W45, W46 = D("2026-10-28"), D("2026-11-04"), D("2026-11-11")


def test_streak_three_weeks_ending_this_week():
    assert weekly_streak([W44, W45, W46], today=D("2026-11-12")) == 3


def test_streak_survives_current_week_without_night_yet():
    assert weekly_streak([W44, W45, W46], today=D("2026-11-16")) == 3  # week 47, nothing yet


def test_streak_breaks_on_gap():
    assert weekly_streak([W44, W46], today=D("2026-11-12")) == 1


def test_streak_two_weeks_without_night_is_zero():
    assert weekly_streak([W44], today=D("2026-11-23")) == 0


def test_sunday_night_shot_after_local_midnight_counts_for_its_session_week():
    # Session local_night_date is Sunday 2026-11-08 (frames at 00:30 Monday local): week 45, not 46.
    sunday = D("2026-11-08")
    assert weekly_streak([sunday], today=D("2026-11-09")) == 1
    assert weekly_streak([W44, sunday], today=D("2026-11-08")) == 2


def test_monthly_count():
    nights = [D(f"2026-{m:02d}-10") for m in (6, 7, 8, 9, 10, 11)]
    assert monthly_count(nights, today=D("2026-11-20")) == 6
    assert monthly_count([D("2026-11-01"), D("2026-11-20")], today=D("2026-11-20")) == 1
    assert monthly_count([D("2026-04-30")], today=D("2026-11-20")) == 0  # older than six months
    assert monthly_count([D("2026-06-01")], today=D("2026-11-20")) == 1  # oldest included month

