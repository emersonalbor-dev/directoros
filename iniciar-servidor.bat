@echo off
title DirectorOS — Servidor Local
echo.
echo  Iniciando servidor DirectorOS en http://localhost:3001
echo  Endpoints disponibles:
echo    /walmart  → ventas Walmart del mes actual
echo    /ml       → ventas MercadoLibre del mes actual
echo.
echo  Deja esta ventana abierta mientras usas el dashboard.
echo  Presiona Ctrl+C para detener el servidor.
echo.
node "%~dp0walmart_server.js"
pause
