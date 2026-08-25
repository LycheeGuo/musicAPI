#!/bin/zsh
set -euo pipefail

clear
printf '%s\n' 'SPlayer Local YouTube Resolver - Mac Installer'
printf '%s\n\n' '================================================'

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'This installer is for macOS only.'
  read '?Press Enter to close...'
  exit 1
fi

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo 'Node.js was not found.'
  echo 'Please install Node.js 22 or newer, then run this installer again.'
  echo 'Opening the Node.js download page...'
  open 'https://nodejs.org/en/download'
  read '?Press Enter to close...'
  exit 1
fi

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js $($NODE_BIN -v) is too old. Node.js 22+ is required."
  open 'https://nodejs.org/en/download'
  read '?Press Enter to close...'
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$HOME/Library/Application Support/SPlayerYouTubeResolver"
APP_DIR="$APP_ROOT/app"
LOG_DIR="$APP_ROOT/logs"
PLIST="$HOME/Library/LaunchAgents/com.lycheeguo.splayer-youtube-resolver.plist"
LABEL='com.lycheeguo.splayer-youtube-resolver'
UID_NOW="$(id -u)"

mkdir -p "$APP_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
cp "$SCRIPT_DIR/package.json" "$APP_DIR/package.json"
cp "$SCRIPT_DIR/resolver.mjs" "$APP_DIR/resolver.mjs"
cp "$SCRIPT_DIR/matcher.mjs" "$APP_DIR/matcher.mjs"

cd "$APP_DIR"
echo 'Installing YouTube resolver dependency...'
"$NPM_BIN" install --omit=dev --no-audit --no-fund

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

NODE_XML="$(xml_escape "$NODE_BIN")"
APP_XML="$(xml_escape "$APP_DIR")"
OUT_XML="$(xml_escape "$LOG_DIR/resolver.log")"
ERR_XML="$(xml_escape "$LOG_DIR/resolver-error.log")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_XML</string>
    <string>$APP_XML/resolver.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_XML</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$OUT_XML</string>
  <key>StandardErrorPath</key>
  <string>$ERR_XML</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$UID_NOW" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_NOW" "$PLIST"
launchctl kickstart -k "gui/$UID_NOW/$LABEL" >/dev/null 2>&1 || true

echo 'Waiting for the resolver to start...'
OK=0
for i in {1..20}; do
  if curl -fsS --max-time 1 'http://127.0.0.1:9863/health' >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done

echo
if (( OK == 1 )); then
  echo 'INSTALL SUCCESS'
  echo 'Resolver: http://127.0.0.1:9863'
  echo 'It will start automatically when you log in to this Mac.'
  echo
  curl -fsS 'http://127.0.0.1:9863/health' || true
else
  echo 'The service was installed but did not become healthy.'
  echo "Please send this log to ChatGPT: $LOG_DIR/resolver-error.log"
  echo
  tail -n 30 "$LOG_DIR/resolver-error.log" 2>/dev/null || true
fi

echo
read '?Press Enter to close...'
