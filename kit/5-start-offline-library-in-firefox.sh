#!/usr/bin/env bash
# Serves every downloaded .zim file and opens it in Firefox at http://localhost:8080
# Works with no internet. Other devices on the same Wi-Fi/LAN can open http://<this-computer's-IP>:8080
# Run it inside your library folder, or name the folder:  bash 5-start-offline-library-in-firefox.sh "/path/to/your library"
KIT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
. "$KIT_DIR/library-folder.sh" && pick_library "$@" || exit 1
shift "$LIBRARY_SHIFT"; cd "$LIBRARY" || exit 1
DIR="15 Offline Encyclopedias (Kiwix)"
KS="$DIR/kiwix-tools/kiwix-serve"
[ -x "$KS" ] || { echo "kiwix-serve not found - run first:  bash \"$KIT_DIR/3-download-offline-wikipedia.sh\" \"$LIBRARY\""; exit 1; }
ZIMS=$(ls "$DIR"/*.zim 2>/dev/null)
[ -z "$ZIMS" ] && { echo "No .zim files in '$DIR' yet."; exit 1; }
PORT=8080
"$KS" --port=$PORT "$DIR"/*.zim &
PID=$!
sleep 3
command -v firefox >/dev/null && firefox "http://localhost:$PORT" >/dev/null 2>&1 &
echo "Library running at http://localhost:$PORT"
echo "Other devices on your network:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "Close this window (or press Ctrl+C) to stop it."
trap 'kill $PID 2>/dev/null' EXIT INT TERM
wait $PID
