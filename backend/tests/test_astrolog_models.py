from __future__ import annotations

import pytest
import sqlalchemy
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import Database, EquipmentProfile, ObservingSession
from app.main import create_app

CANON = "canon-t3-18-55"


def _db(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'a.db'}")
    db.init()
    return db


def test_phase2_tables_exist(tmp_path):
    names = set(sqlalchemy.inspect(_db(tmp_path).engine).get_table_names())
    assert {"library_targets", "capture_sets", "capture_frames", "stacks", "final_images", "app_meta"} <= names


def test_session_source_default_and_target_fk_column(tmp_path):
    db = _db(tmp_path)
    insp = sqlalchemy.inspect(db.engine)
    assert "library_target_id" in {c["name"] for c in insp.get_columns("session_targets")}
    with db.session() as s:
        o = ObservingSession(title="t", local_night_date="2026-11-02")
        s.add(o)
        s.commit()
        assert o.source == "planned"


def test_duplicate_dedup_key_rejected(tmp_path):
    db = _db(tmp_path)
    with db.session() as s:
        obs = ObservingSession(title="t", local_night_date="2026-11-02")
        lt = LibraryTarget(custom_name="X", normalized_key="x", kind="custom")
        s.add_all([obs, lt])
        s.flush()
        cs = CaptureSet(session_id=obs.id, library_target_id=lt.id, device="seestar", equipment_snapshot={})
        s.add(cs)
        s.flush()

        def frame():
            return CaptureFrame(capture_set_id=cs.id, date_obs_utc="2026-11-02T01:00:00Z", exptime_s=10.0,
                                source_filename="a.fit", dedup_key="same")
        s.add(frame())
        s.commit()
        s.add(frame())
        with pytest.raises(IntegrityError):
            s.commit()


def test_stack_and_final_image_models(tmp_path):
    db = _db(tmp_path)
    with db.session() as s:
        lt = LibraryTarget(custom_name="X", normalized_key="x", kind="custom")
        s.add(lt)
        s.flush()
        st = Stack(library_target_id=lt.id, source_filename="s.fit", provenance="header", dedup_key="k")
        s.add(st)
        s.flush()
        s.add(FinalImage(library_target_id=lt.id, stack_id=st.id, source_filename="f.jpg", format="jpeg",
                         preview_key="p", thumb_key="t", width=1, height=1, is_current=True))
        s.commit()


def test_canon_profile_seeded_once_and_editable(tmp_path):
    db = _db(tmp_path)
    db.init()  # idempotent
    with db.session() as s:
        rows = s.scalars(select(EquipmentProfile).where(EquipmentProfile.id == CANON)).all()
        assert len(rows) == 1
        eq = rows[0]
        assert eq.name == "Canon EOS Rebel T3 + EF-S 18–55 mm"
        assert eq.focal_length_mm == 18
        assert eq.fov_deg == pytest.approx(72.7, abs=0.1)
        assert eq.fov_definition == "diagonal"
        assert eq.is_verified is False and eq.is_preset is False
        assert "18–55" in eq.notes and "approximate" in eq.notes.lower()
    with TestClient(create_app(db=db)) as c:
        assert c.patch(f"/api/equipment/{CANON}", json={"notes": "mine"}).status_code == 200


def test_canon_not_recreated_after_delete(tmp_path):
    db = _db(tmp_path)
    with TestClient(create_app(db=db)) as c:
        assert c.delete(f"/api/equipment/{CANON}").status_code == 204
    db.init()
    with db.session() as s:
        assert s.get(EquipmentProfile, CANON) is None
