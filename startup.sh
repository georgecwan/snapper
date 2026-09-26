#!/bin/sh
set -eu
cd "$(dirname "$0")"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
mkdir -p .grok
nohup npm run dev >>.grok/snapper-dev.log 2>&1 </dev/null &
