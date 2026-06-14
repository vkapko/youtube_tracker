#!/usr/bin/env bash
set -e

echo "==> Starting Chroma..."
docker compose up -d

echo "==> Starting API and web servers (Ctrl+C to stop both)..."

npm run dev:api &
API_PID=$!

npm run dev:web &
WEB_PID=$!

trap "echo ''; echo 'Stopping...'; kill $API_PID $WEB_PID 2>/dev/null; docker compose stop" EXIT INT TERM

wait $API_PID $WEB_PID
