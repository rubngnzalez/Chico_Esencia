@echo off
rem Login de Cloudflare para desplegar el panel (abre el navegador)
set CLOUDFLARE_API_TOKEN=
cd /d "%~dp0"
npx wrangler login
echo.
echo Si dice "Successfully logged in", ya puedes cerrar esta ventana y avisar en el chat.
pause
