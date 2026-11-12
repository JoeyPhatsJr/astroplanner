"""FastAPI application factory.

Run locally:  uvicorn app.main:app --reload  (from backend/)
"""

from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .accounts.routes import router as auth_router
from .accounts.throttle import Throttle
from .api import router
from .astrolog.routes import open_router as astrolog_open_router, router as astrolog_router
from .astrolog.storage import LocalStorage, Storage
from .processing.routes import router as processing_router
from .variables.routes import router as variables_router
from .db import Database
from .sky_images import SkyImageProvider
from .weather import OpenMeteoProvider

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


DEFAULT_PREVIEWS_DIR = Path(__file__).resolve().parents[1] / "data" / "previews"
MAX_UPLOAD_BYTES = 150 * 1024 * 1024

# Every state-changing /api/ request must carry this header. A cross-site form cannot set it, and with
# SameSite=Lax cookies that blocks cross-site requests made with the user's session.
CSRF_HEADER, CSRF_VALUE = "X-Requested-With", "AstroPlanner"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(db: Database | None = None, weather: OpenMeteoProvider | None = None,
               storage: Storage | None = None, max_upload_bytes: int = MAX_UPLOAD_BYTES,
               sky_images: SkyImageProvider | None = None,
               clock: Callable[[], datetime] | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db.init()
        yield

    app = FastAPI(title="AstroPlanner API", version="0.1.0", lifespan=lifespan)
    app.state.db = db or Database()
    app.state.weather = weather or OpenMeteoProvider()
    app.state.storage = storage or LocalStorage(Path(os.environ.get("ASTROPLANNER_PREVIEWS_DIR") or DEFAULT_PREVIEWS_DIR))
    app.state.sky_images = sky_images or SkyImageProvider.from_env()
    app.state.max_upload_bytes = max_upload_bytes
    app.state.clock = clock or _utc_now
    app.state.login_throttle = Throttle(app.state.clock)
    app.state.signup_throttle = Throttle(app.state.clock)

    # Registered before CORS so CORS stays the outermost middleware.
    @app.middleware("http")
    async def require_csrf_header(request: Request, call_next):
        if (request.method in UNSAFE_METHODS and request.url.path.startswith("/api/")
                and request.headers.get(CSRF_HEADER) != CSRF_VALUE):
            return JSONResponse({"detail": "Missing X-Requested-With header."}, status_code=403)
        return await call_next(request)

    origins = [o.strip() for o in os.environ.get("ASTROPLANNER_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    # Content-Disposition is exposed so a cross-origin frontend can read the Siril script's file name.
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["Content-Disposition"])
    app.include_router(auth_router)
    app.include_router(router)
    app.include_router(astrolog_router)
    app.include_router(astrolog_open_router)
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
