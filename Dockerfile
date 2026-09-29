# --- 1) Build the React frontend ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# No source maps in production
ENV GENERATE_SOURCEMAP=false
RUN npm run build

# --- 2) Python backend that also serves the built frontend ---
FROM python:3.10-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=10000
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app.py backend/email_util.py backend/
COPY --from=frontend /app/frontend/build frontend/build
# Run as an unprivileged user
RUN useradd --create-home --uid 10001 monitormail && chown -R monitormail /app
USER monitormail
WORKDIR /app/backend
EXPOSE 10000
CMD ["python", "app.py"]
