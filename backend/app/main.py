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
from .processing.routes import router as processing_router
from .variables.routes import router as variables_router
from .db import Database
from .weather import OpenMeteoProvider

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


DEFAULT_PREVIEWS_DIR = Path(__file__).resolve().parents[1] / "data" / "previews"
MAX_UPLOAD_BYTES = 150 * 1024 * 1024


def create_app(db: Database | None = None, weather: OpenMeteoProvider | None = None,
               storage: Storage | None = None, max_upload_bytes: int = MAX_UPLOAD_BYTES) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db.init()
        yield

    app = FastAPI(title="AstroPlanner API", version="0.1.0", lifespan=lifespan)
    app.state.db = db or Database()
    app.state.weather = weather or OpenMeteoProvider()
    app.state.storage = storage or LocalStorage(Path(os.environ.get("ASTROPLANNER_PREVIEWS_DIR") or DEFAULT_PREVIEWS_DIR))
    app.state.max_upload_bytes = max_upload_bytes

    origins = [o.strip() for o in os.environ.get("ASTROPLANNER_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    # Content-Disposition is exposed so a cross-origin frontend can read the Siril script's file name.
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["Content-Disposition"])
    app.include_router(router)
    app.include_router(astrolog_router)
    app.include_router(variables_router)
    app.include_router(processing_router)

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
