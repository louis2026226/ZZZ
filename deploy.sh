#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
export VITE_SOCKET_URL="${VITE_SOCKET_URL:-http://8.134.168.87:3000}"

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if [ -d "$ROOT/.git" ]; then
  cd "$ROOT" && git pull
fi

cd "$ROOT/client"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run build

cd "$ROOT/server"
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

cd "$ROOT"
if pm2 describe room-game >/dev/null 2>&1; then
  pm2 restart room-game
else
  pm2 start ecosystem.config.cjs --only room-game
fi
if pm2 describe room-game-watch >/dev/null 2>&1; then
  pm2 restart room-game-watch
elif [ -f "$ROOT/ecosystem.config.cjs" ]; then
  pm2 start ecosystem.config.cjs --only room-game-watch 2>/dev/null || true
fi
pm2 save

echo "OK: open http://8.134.168.87:3000 (Ctrl+F5)"
