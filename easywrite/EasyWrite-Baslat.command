#!/bin/sh
# macOS / Linux: EasyWrite'ı yerel sunucuda başlatır
cd "$(dirname "$0")"
URL=http://localhost:8765
echo "EasyWrite başlatılıyor: $URL (yükledikten sonra bu pencereyi kapatabilirsiniz)"
( sleep 1; (open "$URL" || xdg-open "$URL") >/dev/null 2>&1 ) &
if command -v python3 >/dev/null; then exec python3 -m http.server 8765 --bind 127.0.0.1
elif command -v npx >/dev/null; then exec npx --yes http-server -p 8765 -a 127.0.0.1 -c-1
else echo "Python 3 bulunamadı."; fi
