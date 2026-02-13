@echo off
title Stop Polymarket Bots

echo.
echo   ═══════════════════════════════════════════
echo     STOPPING ALL POLYMARKET BOTS
echo   ═══════════════════════════════════════════
echo.

taskkill /F /FI "WINDOWTITLE eq CopyBot*"    2>nul && echo   [ok] Copy Bot stopped    || echo   [--] Copy Bot not running
taskkill /F /FI "WINDOWTITLE eq SignalBot*"   2>nul && echo   [ok] Signal Bot stopped   || echo   [--] Signal Bot not running
taskkill /F /FI "WINDOWTITLE eq AutoBot*"     2>nul && echo   [ok] Auto Bot stopped     || echo   [--] Auto Bot not running
taskkill /F /FI "WINDOWTITLE eq Dashboard*"   2>nul && echo   [ok] Dashboard stopped    || echo   [--] Dashboard not running

echo.
echo   All bots stopped.
echo.
pause
