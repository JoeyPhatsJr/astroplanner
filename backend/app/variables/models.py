"""Phase 3 (Variable Hunter) tables: cached AAVSO observations, fetch log, alert dismissals.

Privacy: an observation row keeps only what the light curve and the alert rule need. The AAVSO
observer code is stored only as a salted hash; observer names, countries, comments and chart IDs
are dropped by the provider before anything reaches the database.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class VariableObservation(Base):
    __tablename__ = "variable_observations"
    __table_args__ = (UniqueConstraint("star_id", "obs_id", name="uq_variable_observation"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    star_id: Mapped[str] = mapped_column(String(32), index=True)
    obs_id: Mapped[str] = mapped_column(String(40))  # AAVSO obsID: the de-duplication key
    jd: Mapped[float] = mapped_column(Float, index=True)
    mag: Mapped[float] = mapped_column(Float)
    uncert: Mapped[float | None] = mapped_column(Float, nullable=True)
    band: Mapped[str] = mapped_column(String(16))
    fainter_than: Mapped[bool] = mapped_column(Boolean)
    obs_type: Mapped[str] = mapped_column(String(16))
    val: Mapped[str] = mapped_column(String(4))  # AAVSO validation flag
    observer_hash: Mapped[str] = mapped_column(String(16))


class VariableFetch(Base):
    """One request to the provider: its JD range, outcome and row count (the coverage log)."""

    __tablename__ = "variable_fetches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    star_id: Mapped[str] = mapped_column(String(32), index=True)
    path: Mapped[str] = mapped_column(String(8))  # "alert" | "history"
    from_jd: Mapped[float] = mapped_column(Float)
    to_jd: Mapped[float] = mapped_column(Float)
    started_at: Mapped[str] = mapped_column(String)  # ISO 8601 UTC, like the other tables
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    rows: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)


class VariableAlertDismissal(Base):
    __tablename__ = "variable_alert_dismissals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    star_id: Mapped[str] = mapped_column(String(32), unique=True)
    dismissed_at: Mapped[str] = mapped_column(String)
    alert_since_jd: Mapped[float] = mapped_column(Float)
