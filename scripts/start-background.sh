#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="/data/data/com.termux/files/home/bnb"
PID_FILE="$APP_DIR/run/server.pid"
LOG_FILE="$APP_DIR/logs/server.log"
BUILD_LOG="$APP_DIR/logs/build.log"

cd "$APP_DIR"
mkdir -p run logs

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "BNB LP Analyzer sudah berjalan (PID $pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Membantu proses tetap hidup ketika layar Android mati.
termux-wake-lock 2>/dev/null || true

printf '\n[%s] Building application\n' "$(date -Iseconds)" >> "$BUILD_LOG"
npm run build >> "$BUILD_LOG" 2>&1

printf '\n[%s] Starting background server\n' "$(date -Iseconds)" >> "$LOG_FILE"
nohup node dist/app/server.js >> "$LOG_FILE" 2>&1 < /dev/null &
pid=$!
echo "$pid" > "$PID_FILE"

sleep 2
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Server gagal dijalankan. Periksa $LOG_FILE" >&2
  exit 1
fi

port="${PORT:-$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}"
port="${port:-3000}"
if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health/live" >/dev/null; then
  echo "BNB LP Analyzer berjalan di background (PID $pid, port $port)."
else
  echo "Proses berjalan (PID $pid), tetapi health check belum tersedia. Periksa $LOG_FILE"
fi
