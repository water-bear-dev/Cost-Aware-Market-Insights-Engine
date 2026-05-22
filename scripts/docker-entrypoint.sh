#!/bin/bash
set -e

# Run syntax check before starting the application
echo "==> Running syntax check before startup..."
./scripts/syntax_check.sh

# Run the CMD
echo "==> Syntax check passed. Starting application..."
exec "$@"
