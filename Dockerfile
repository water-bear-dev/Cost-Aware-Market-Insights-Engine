FROM python:3.12-slim AS base
WORKDIR /app

# Ensure output is not buffered
ENV PYTHONUNBUFFERED=1

# Install nodejs for JS syntax validation
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy source, static, and script files
COPY src/ ./src/
COPY static/ ./static/
COPY scripts/ ./scripts/

# Ensure entrypoint and syntax checks are executable
RUN chmod +x ./scripts/syntax_check.sh ./scripts/docker-entrypoint.sh

# Run syntax check during build to catch errors early
RUN ./scripts/syntax_check.sh

# Set ownership to appuser
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# We don't have curl by default in slim, so we need a healthcheck that uses python
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
