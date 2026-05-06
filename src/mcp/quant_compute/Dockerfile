FROM python:3.12-slim AS base
WORKDIR /app

# Install isolated math dependencies and MCP
RUN pip install --no-cache-dir pandas numpy mcp

# Create non-root user for security
RUN groupadd -r mcpuser && useradd -r -g mcpuser mcpuser

# Copy ONLY the server script (no AWS keys, no core app logic)
COPY server.py .

RUN chown -R mcpuser:mcpuser /app
USER mcpuser

# Run stdio MCP server
CMD ["python", "server.py"]
