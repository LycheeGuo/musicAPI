#!/bin/zsh
set -u
clear
printf '%s\n' 'SPlayer Local YouTube Resolver - Status'
printf '%s\n\n' '======================================='

if curl -fsS --max-time 2 'http://127.0.0.1:9863/health'; then
  echo
  echo
  echo 'STATUS: RUNNING'
  echo
  echo 'Test a song in your browser with:'
  echo 'http://127.0.0.1:9863/resolve?name=简单爱&singer=周杰伦&duration=4:30'
else
  echo 'STATUS: NOT RUNNING'
  echo
  echo 'Run 1-INSTALL.command again.'
  echo
  LOG="$HOME/Library/Application Support/SPlayerYouTubeResolver/logs/resolver-error.log"
  if [[ -f "$LOG" ]]; then
    echo 'Recent error log:'
    tail -n 30 "$LOG"
  fi
fi

echo
read '?Press Enter to close...'
