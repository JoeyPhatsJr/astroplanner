#!/usr/bin/env bash
# Start the FastAPI backend (port 8000) and the Vite frontend (port 5173) together.
# First run: ./scripts/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]]; then
  echo "Backend not set up. Run ./scripts/setup.sh first." >&2; exit 1
fi
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Frontend not set up. Run ./scripts/setup.sh first." >&2; exit 1
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
(cd "$ROOT/frontend" && npm run dev -- --host 127.0.0.1 --port 5173) &

echo "AstroPlanner: http://127.0.0.1:5173  (API docs: http://127.0.0.1:8000/docs)"
wait
