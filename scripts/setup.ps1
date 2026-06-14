$ErrorActionPreference = "Stop"

Write-Host "==> Installing Node dependencies..."
npm install

Write-Host "==> Setting up Python virtual environment..."
Push-Location apps/api/python
python -m venv .venv
& .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
Pop-Location

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "==> .env created — fill in your API keys before running."
} else {
    Write-Host "==> .env already exists, skipping."
}

Write-Host "==> Starting Chroma..."
docker compose up -d

Write-Host "==> Running database migrations..."
npm run db:migrate

Write-Host ""
Write-Host "Setup complete. Run .\scripts\dev.ps1 to start the app."
