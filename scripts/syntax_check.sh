#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Starting Syntax Check..."
echo "------------------------"

# 1. Check Python Syntax
echo -n "Checking Python syntax in src/... "
python3 -m compileall src/ -q
if [ $? -eq 0 ]; then
    echo -e "${GREEN}PASSED${NC}"
else
    echo -e "${RED}FAILED${NC}"
    exit 1
fi

# 2. Check JavaScript Syntax
if command -v node &> /dev/null; then
    echo -n "Checking JavaScript syntax in static/app.js... "
    node -c static/app.js 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}PASSED${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        # Show the actual error
        node -c static/app.js
        exit 1
    fi
else
    echo -e "Checking JavaScript syntax in static/app.js... ${RED}SKIPPED${NC} (node not installed)"
fi

# 3. Check Docker Compose Syntax
if command -v docker-compose &> /dev/null && [ -f docker-compose.yml ]; then
    echo -n "Checking docker-compose.yml syntax... "
    docker-compose config -q
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}PASSED${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        exit 1
    fi
else
    echo -e "Checking docker-compose.yml syntax... ${RED}SKIPPED${NC} (docker-compose or configuration file not available)"
fi

echo "------------------------"
echo -e "${GREEN}All systems go! Syntax is valid.${NC}"
