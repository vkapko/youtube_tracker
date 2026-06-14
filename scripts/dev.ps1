Write-Host "==> Starting Chroma..."
docker compose up -d

Write-Host "==> Opening API and web servers in separate windows..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev:api"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev:web"

Write-Host ""
Write-Host "API:  http://localhost:4000"
Write-Host "Web:  http://localhost:5173"
Write-Host ""
Write-Host "Close the opened windows to stop the servers."
