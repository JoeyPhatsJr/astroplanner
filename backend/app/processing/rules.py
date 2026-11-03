"""Advice rules. Every piece of advice carries where it came from; there is no score and no winner.

basis:
  measured          - derived from the user's own files (headers, Siril output)
  siril-docs        - what Siril's documentation says; requires source_url (https)
  tutorial-default  - a common starting value from tutorials, not derived from this night
  taste             - a stylistic choice
`heuristic` is True when the advice is a rule of thumb rather than a derived fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from .models import StepId

Basis = Literal["measured", "siril-docs", "tutorial-default", "taste"]

SIRIL_COMMANDS_URL = "https://siril.readthedocs.io/en/stable/Commands.html"


@dataclass(frozen=True)
class Advice:
    rule_id: str
    setting: str
    why: str
    basis: Basis
    heuristic: bool
    source_url: str | None = None


@dataclass(frozen=True)
class Facts:
    bayer_pattern: str | None  # the one pattern shared by every frame's header, else None
    frame_count: int
    exptime_s: float | None
    # Filled by later tasks; typed loosely until their dataclasses exist.
    report: Any | None = None  # Report
    siril_stack: Any | None = None  # StackMeasurement
    seestar_stack: Any | None = None  # StackMeasurement


@dataclass(frozen=True)
class Rule:
    id: str
    step: StepId
    basis: Basis
    heuristic: bool
    source_url: str | None
    applies: Callable[[Facts], bool]
    advise: Callable[[Facts], Advice]


def _debayer_measured(f: Facts) -> Advice:
    return Advice(
        rule_id="convert.debayer",
        setting=f"Debayer with pattern {f.bayer_pattern} (from your frame headers)",
        why=f"Every one of your {f.frame_count} frames reports the same Bayer pattern in its header, "
            "so the colour reconstruction can use it directly.",
        basis="measured", heuristic=False)


def _debayer_docs(f: Facts) -> Advice:
    return Advice(
        rule_id="convert.debayer",
        setting="Siril reads the pattern from each frame's `BAYERPAT` header",
        why="The frame headers do not agree on, or do not carry, a usable Bayer pattern, so the coach cannot "
            "state one; Siril's debayering reads the header itself and tells you what it found in its log.",
        basis="siril-docs", heuristic=False, source_url=SIRIL_COMMANDS_URL)


RULES: tuple[Rule, ...] = (
    Rule("convert.debayer", "convert", "measured", False, None,
         lambda f: f.bayer_pattern is not None, _debayer_measured),
    Rule("convert.debayer", "convert", "siril-docs", False, SIRIL_COMMANDS_URL,
         lambda f: f.bayer_pattern is None, _debayer_docs),
)


def advice_for(step: StepId, facts: Facts) -> list[Advice]:
    return [r.advise(facts) for r in RULES if r.step == step and r.applies(facts)]
