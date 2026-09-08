#!/bin/sh
# =====================================================================
#  ОБНОВЛЕНИЕ ПРОСМОТРОВ НА СЕРВЕРЕ (Linux / VPS)
#
#  Спрашивает у YouTube просмотры всех выпусков и кладёт их
#  в assets/views.json. Сайт читает этот файл и показывает свежие числа.
#  Ключ остаётся на сервере и в браузер не попадает.
#
#  Установка:
#    1. положить рядом с сайтом .env со строкой youtubeApiKey=ВАШ_КЛЮЧ
#    2. chmod +x tools/update-views.sh
#    3. проверить руками:  ./tools/update-views.sh
#    4. добавить в crontab (crontab -e), запуск каждый час в :05 —
#       не ровно в :00, потому что в круглый час у всех пик нагрузки:
#
#       5 * * * * /путь/к/сайту/tools/update-views.sh >> /tmp/spotter-views.log 2>&1
#
#  Нужны: curl и python3 (есть практически на любом сервере).
# =====================================================================

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/.env"
OUT_FILE="$ROOT/assets/views.json"
CONFIG="$ROOT/js/config.js"

[ -f "$ENV_FILE" ] || { echo "Нет файла .env рядом с сайтом: $ENV_FILE"; exit 1; }
[ -f "$CONFIG" ]   || { echo "Нет js/config.js: $CONFIG"; exit 1; }

KEY=$(sed -n 's/^[[:space:]]*youtubeApiKey[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}[[:space:]]*$/\1/p' "$ENV_FILE")
[ -n "$KEY" ] || { echo "В .env нет строки youtubeApiKey=..."; exit 1; }

# Идентификаторы роликов берём из самого конфига: добавили выпуск —
# скрипт подхватит его сам, править ничего не нужно.
IDS=$(grep -o 'watch?v=[A-Za-z0-9_-]\{11\}' "$CONFIG" | cut -d= -f2 | sort -u | paste -sd, -)
[ -n "$IDS" ] || { echo "В config.js не нашлось ссылок на YouTube"; exit 1; }

RESPONSE=$(curl -sS --max-time 30 \
  "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=$IDS&key=$KEY") || {
    echo "Запрос к YouTube не прошёл"; exit 1; }

# Пишем во временный файл и подменяем одним движением: если скрипт упадёт
# на середине, посетитель не увидит обрезанный JSON.
TMP="$OUT_FILE.tmp"
printf '%s' "$RESPONSE" | python3 -c '
import json, sys, datetime
data = json.load(sys.stdin)
if "error" in data:
    print("YouTube вернул ошибку:", data["error"].get("message", "?"), file=sys.stderr)
    sys.exit(1)
views = {}
for item in data.get("items", []):
    try:
        views[item["id"]] = int(item["statistics"]["viewCount"])
    except (KeyError, ValueError):
        pass
if not views:
    print("Просмотры не получены", file=sys.stderr)
    sys.exit(1)
out = {"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "views": views}
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
print("Обновлено выпусков:", len(views))
' "$TMP"

mv "$TMP" "$OUT_FILE"
echo "Записано: $OUT_FILE"
