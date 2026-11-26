@echo off
rem BMU Online — serveri öz kompüterində işə salır və internetə açır (Cloudflare Tunnel).
rem Pəncərəni bağlayana qədər link işləyir. Hər açılışda link dəyişir.
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared;%PATH%"

where cloudflared >nul 2>nul || (
  echo cloudflared tapilmadi. Qurasdirilir...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
)
if not exist node_modules call npm install

start "BMU Online server" cmd /k node server\server.js
timeout /t 2 >nul

echo.
echo ===================================================================
echo  Asagida "https://....trycloudflare.com" linki gorunecek.
echo  Hemin linki dostlarina gonder. Bu pencereni baglama!
echo ===================================================================
echo.
cloudflared tunnel --config "%~dp0tunnel.yml" --url http://localhost:3000
pause
