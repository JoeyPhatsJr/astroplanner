"""The How it works page states score weights from a JSON file; keep it identical to scoring.py."""

from __future__ import annotations

import json
from pathlib import Path

from app.scoring import TARGET_WEIGHTS, TONIGHT_WEIGHTS

WEIGHTS_JSON = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "site" / "scoreWeights.json"


def test_score_weights_json_matches_scoring():
    data = json.loads(WEIGHTS_JSON.read_text())
    assert data["tonight"] == {k: int(v) for k, v in TONIGHT_WEIGHTS.items()}
    assert data["target"] == {k: int(v) for k, v in TARGET_WEIGHTS.items()}
