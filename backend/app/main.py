"""FastAPI application factory.

Run locally:  uvicorn app.main:app --reload  (from backend/)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .astrolog.routes import router as astrolog_router
from .astrolog.storage import LocalStorage, Storage
from .variables.aavso import FixtureProvider, VsxProvider
from .variables.cache import observer_salt
from .variables.routes import router as variables_router
from .db import Database
from .weather import OpenMeteoProvider

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


DEFAULT_PREVIEWS_DIR = Path(__file__).resolve().parents[1] / "data" / "previews"
MAX_UPLOAD_BYTES = 150 * 1024 * 1024


def select_aavso_mode(environ) -> str:
    """Which AAVSO source the environment asks for: fixture wins over live; default is off (fallback)."""
    if (environ.get("ASTROPLANNER_AAVSO_FIXTURE_DIR") or "").strip():
        return "fixture"
    if environ.get("ASTROPLANNER_AAVSO_ENABLED") == "1":
        return "live"
    return "off"


def build_aavso_provider(environ, db: Database):
    """The real or fixture provider the environment asks for (None when off); needs a migrated DB for the salt."""
    mode = select_aavso_mode(environ)
    if mode == "off":
        return None
    with db.session() as s:
        salt = observer_salt(s)
    if mode == "live":
        return VsxProvider(salt=salt)
    return FixtureProvider(Path(environ["ASTROPLANNER_AAVSO_FIXTURE_DIR"].strip()), salt=salt)


def aavso_mode_of(provider) -> str:
    """What ``app.state.aavso`` actually is: live | fixture | injected (any other test double) | off."""
    if provider is None:
        return "off"
    if isinstance(provider, VsxProvider):
        return "live"
    if isinstance(provider, FixtureProvider):
        return "fixture"
    return "injected"


def create_app(db: Database | None = None, weather: OpenMeteoProvider | None = None,
               storage: Storage | None = None, max_upload_bytes: int = MAX_UPLOAD_BYTES,
               aavso=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db.init()
        if app.state.aavso is None:  # an injected provider wins over the environment
            app.state.aavso = build_aavso_provider(os.environ, app.state.db)
            app.state.aavso_mode = aavso_mode_of(app.state.aavso)
        yield

    app = FastAPI(title="AstroPlanner API", version="0.1.0", lifespan=lifespan)
    app.state.db = db or Database()
    app.state.weather = weather or OpenMeteoProvider()
    app.state.storage = storage or LocalStorage(Path(os.environ.get("ASTROPLANNER_PREVIEWS_DIR") or DEFAULT_PREVIEWS_DIR))
    app.state.max_upload_bytes = max_upload_bytes
    # Off by default. The env-selected provider is built at startup, once migrations have created app_meta (salt).
    app.state.aavso = aavso
    app.state.aavso_mode = aavso_mode_of(aavso)

    origins = [o.strip() for o in os.environ.get("ASTROPLANNER_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)
    app.include_router(astrolog_router)
    app.include_router(variables_router)

    # Optional single-process mode: serve the built frontend if present (a half-built dist must not crash startup).
    if (FRONTEND_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")
    if (FRONTEND_DIST / "index.html").is_file():

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            candidate = FRONTEND_DIST / path
            if path and candidate.is_file() and FRONTEND_DIST in candidate.resolve().parents:
                return FileResponse(candidate)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app


app = create_app()
