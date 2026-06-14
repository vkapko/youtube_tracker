#!/usr/bin/env bash
set -e

echo "==> Installing Node dependencies..."
npm install

echo "==> Setting up Python virtual environment..."
cd apps/api/python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../../..

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> .env created — fill in your API keys before running."
else
  echo "==> .env already exists, skipping."
fi

echo "==> Starting Chroma..."
docker compose up -d

echo "==> Running database migrations..."
npm run db:migrate

echo ""
echo "Setup complete. Run ./scripts/dev.sh to start the app."
