#!/usr/bin/env bash
# One-time local setup: Python 3.11+ virtualenv for the backend, npm install for the frontend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  for cand in python3.13 python3.12 python3.11 python3; do
    if command -v "$cand" >/dev/null && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
      PY="$cand"; break
    fi
  done
fi
if [[ -z "$PY" ]]; then
  echo "Python 3.11+ is required (Astropy 8). Install it, or set PYTHON=/path/to/python3.11" >&2; exit 1
fi
echo "Using $($PY --version)"

cd "$ROOT/backend"
[[ -d .venv ]] || "$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements-dev.txt

cd "$ROOT/frontend"
npm install

echo "Setup complete. Start the app with ./scripts/dev.sh"
