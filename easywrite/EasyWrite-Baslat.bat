@echo off
chcp 65001 >nul
title EasyWrite
cd /d "%~dp0"
echo EasyWrite baslatiliyor: http://localhost:8765
echo Uygulamayi yukledikten sonra bu pencereyi kapatabilirsiniz.
start "" http://localhost:8765
where py >nul 2>nul && (py -m http.server 8765 --bind 127.0.0.1 & goto :eof)
where python >nul 2>nul && (python -m http.server 8765 --bind 127.0.0.1 & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p 8765 -a 127.0.0.1 -c-1 & goto :eof)
echo.
echo Python bulunamadi. https://www.python.org/downloads/ adresinden kurup tekrar deneyin.
pause
