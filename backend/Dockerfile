# AstroPlanner API for a container host (Render's free web service; see docs/DEPLOY.md).
# Build from backend/:  docker build -t astroplanner-api backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

RUN useradd --create-home --uid 10001 astro && mkdir -p /app/data && chown astro /app/data
USER astro

# Render sets PORT. One worker on purpose: the sign-in throttles and the sky-image lock live in memory.
# --proxy-headers + --forwarded-allow-ips='*': the host's proxy terminates TLS, so trust its
# X-Forwarded-Proto (the session cookie is marked Secure only on https) and X-Forwarded-For (sign-up throttle).
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
