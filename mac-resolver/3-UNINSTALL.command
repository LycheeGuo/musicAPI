#!/bin/zsh
set -u
clear
printf '%s\n' 'SPlayer Local YouTube Resolver - Uninstall'
printf '%s\n\n' '=========================================='

APP_ROOT="$HOME/Library/Application Support/SPlayerYouTubeResolver"
PLIST="$HOME/Library/LaunchAgents/com.lycheeguo.splayer-youtube-resolver.plist"
LABEL='com.lycheeguo.splayer-youtube-resolver'
UID_NOW="$(id -u)"

launchctl bootout "gui/$UID_NOW" "$PLIST" >/dev/null 2>&1 || true
launchctl kill SIGTERM "gui/$UID_NOW/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$APP_ROOT"

echo 'UNINSTALL SUCCESS'
echo 'The local resolver and LaunchAgent were removed.'
echo
read '?Press Enter to close...'
