#!/usr/bin/env bash
# Opens "Library Search": one search box for every book, Wikipedia, Khan Academy and the Q&A sites. Works offline.
#   bash 6-search-the-library.sh             the app (starts the Kiwix reader by itself when needed)
#   bash 6-search-the-library.sh --firefox   simple version in Firefox (use it if the app won't open)
# Problems are written to library-search-app/logs/launcher.log

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"

# --- where is the app? It can be installed anywhere - not only inside the library / kit folder -----------
#  1. this script ships inside the installed app:  <home>/dist/library-search-<os>-<arch>/resources/app/kit/
#  2. a git checkout of the repo:                   <home>/kit/
#  3. the folder remembered by 6-install-or-update-search-app.sh (~/.config/library-search/app-home)
#  4. the kit layout:                               <kit>/library-search-app
find_app_home() {
  case "$SELF_DIR" in
    */dist/library-search-*/resources/app/kit|*/dist/library-search-*/Resources/app/kit)
      printf '%s\n' "${SELF_DIR%%/dist/library-search-*}"; return 0;;
  esac
  if [ -f "$SELF_DIR/../package.json" ] && grep -q '"name": "library-search"' "$SELF_DIR/../package.json" 2>/dev/null; then
    (cd "$SELF_DIR/.." && pwd); return 0
  fi
  local saved="${XDG_CONFIG_HOME:-$HOME/.config}/library-search/app-home"
  if [ -f "$saved" ] && [ -d "$(cat "$saved")" ]; then cat "$saved"; return 0; fi
  if [ -d "$SELF_DIR/library-search-app" ]; then printf '%s\n' "$SELF_DIR/library-search-app"; return 0; fi
  return 1
}
APPDIR="$(find_app_home)"
LOGDIR="$APPDIR/logs"
if [ -z "$APPDIR" ] || ! mkdir -p "$LOGDIR" 2>/dev/null || [ ! -w "$LOGDIR" ]; then
  LOGDIR="${XDG_DATA_HOME:-$HOME/.local/share}/library-search/logs"
  mkdir -p "$LOGDIR" 2>/dev/null || LOGDIR="${TMPDIR:-/tmp}"
fi
LOG="$LOGDIR/launcher.log"
RUNLOG="$LOGDIR/last-run.log"
# keep the log small
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1000000 ]; then tail -c 200000 "$LOG" >"$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"; fi

in_terminal() { [ -t 0 ] && [ -t 1 ]; }

# zenity text is Pango markup: escape & < > (folder names like "02 Water & Sanitation")
markup() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

show_error() { # title, message
  printf '\n%s\n%s\n\n' "$1" "$2" >&2
  if ! in_terminal; then
    if command -v zenity >/dev/null 2>&1; then zenity --error --title="$1" --text="$(markup "$2")" --width=460 2>/dev/null
    elif command -v notify-send >/dev/null 2>&1; then notify-send "$1" "$2"
    elif command -v xmessage >/dev/null 2>&1; then xmessage -center "$1: $2"
    fi
  fi
}

ask_yes_no() { # title, question, yes-label, no-label  -> 0 = yes
  if in_terminal; then
    printf '\n%s\n%s [y/N] ' "$1" "$2"
    read -r answer
    case "$answer" in y|Y|yes|Yes) return 0;; *) return 1;; esac
  elif command -v zenity >/dev/null 2>&1; then
    zenity --question --title="$1" --text="$(markup "$2")" --ok-label="$3" --cancel-label="$4" --width=460 2>/dev/null
  else
    show_error "$1" "$2"
    return 1
  fi
}

# --- find the app ------------------------------------------------------------------------------------
case "$(uname -m)" in i?86) ARCH=ia32;; x86_64) ARCH=x64;; aarch64) ARCH=arm64;; armv7l) ARCH=armv7l;; *) ARCH=ia32;; esac
APP_CMD=()   # how to start the Electron app
NODE_CMD=()  # how to run a script with the Node inside Electron (needs ELECTRON_RUN_AS_NODE=1)
APPRES=""    # folder holding build/, node_modules/, kit/
OS="$(uname -s)"
for c in "$APPDIR/dist/library-search-linux-$ARCH/library-search" "$APPDIR"/dist/library-search-linux-*/library-search; do
  [ "$OS" = "Linux" ] || break
  if [ -x "$c" ]; then APP_CMD=("$c"); NODE_CMD=("$c"); APPRES="$(dirname "$c")/resources/app"; break; fi
done
if [ -z "$APPRES" ]; then
  for c in "$APPDIR"/dist/library-search-darwin-*/library-search.app/Contents/MacOS/library-search; do
    [ "$OS" = "Darwin" ] || break
    if [ -x "$c" ]; then APP_CMD=("$c"); NODE_CMD=("$c"); APPRES="$(dirname "$(dirname "$c")")/Resources/app"; break; fi
  done
fi
if [ -z "$APPRES" ] && [ -x "$APPDIR/node_modules/.bin/electron" ] && [ -f "$APPDIR/build/main/main.js" ]; then
  APP_CMD=("$APPDIR/node_modules/.bin/electron" "$APPDIR"); NODE_CMD=("$APPDIR/node_modules/.bin/electron"); APPRES="$APPDIR"
fi
if [ -z "$APPRES" ]; then
  show_error "Library Search is not installed yet" "Open a terminal in this folder and run:

    bash 6-install-or-update-search-app.sh

(It downloads the app, or installs it from a .tar.gz file on a USB stick.)"
  in_terminal && read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# Library folders are not passed: the app finds them itself (chosen on its Library page, or next to it).

# --- Firefox mode ------------------------------------------------------------------------------------
PORT=8090
run_firefox_mode() {
  local server="$APPRES/build/server/server.js"
  if [ ! -f "$server" ]; then
    show_error "Library Search can't start" "Missing file: $server
Re-install the app:  bash 6-install-or-update-search-app.sh"
    return 1
  fi
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "Library Search is already running at http://localhost:$PORT"
    if command -v firefox >/dev/null 2>&1; then firefox "http://localhost:$PORT" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &
    fi
    return 0
  fi
  echo "Starting Library Search in Firefox at http://localhost:$PORT ..."
  ELECTRON_RUN_AS_NODE=1 "${NODE_CMD[@]}" "$server" --mode browser --port "$PORT" --open-browser \
    "$@" >>"$LOG" 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
  if in_terminal; then
    echo "Library running at http://localhost:$PORT"
    echo "Close this window (or press Ctrl+C) to stop it."
    wait $SERVER_PID
  elif command -v zenity >/dev/null 2>&1; then
    zenity --info --title="Library Search" --width=420 --ok-label="Stop the library" \
      --text="Library Search is open in Firefox at http://localhost:$PORT

Keep this box open while you use it. Click the button to stop it." 2>/dev/null
  else
    wait $SERVER_PID
  fi
}

if [ "$1" = "--firefox" ]; then
  shift
  run_firefox_mode "$@"
  exit $?
fi

# --- app mode ----------------------------------------------------------------------------------------
RC=0
ELAPSED=0
run_app() {
  local start
  start=$(date +%s)
  : >"$RUNLOG"
  "${APP_CMD[@]}" "$@" >>"$RUNLOG" 2>&1
  RC=$?
  ELAPSED=$(( $(date +%s) - start ))
  { echo "=== $(date '+%Y-%m-%d %H:%M:%S') exit=$RC after ${ELAPSED}s: ${APP_CMD[*]} $*"; cat "$RUNLOG"; } >>"$LOG"
}

ARGS=(--disable-gpu "$@")
run_app "${ARGS[@]}"

# Old kernels / copied folders often break Chromium's sandbox: try once more without it.
EXTRA=()
if [ $RC -ne 0 ] && [ $ELAPSED -lt 15 ] && grep -qi 'sandbox' "$RUNLOG"; then
  echo "Retrying without the Chromium sandbox..." >>"$LOG"
  EXTRA=(--no-sandbox)
  run_app "${EXTRA[@]}" "${ARGS[@]}"
fi
# Very old graphics: Chromium gives up when its separate GPU process can't start. Run it inside the app instead.
if [ $RC -ne 0 ] && [ $ELAPSED -lt 15 ] && grep -qi 'GPU process' "$RUNLOG"; then
  echo "Retrying with the GPU work inside the main process..." >>"$LOG"
  EXTRA+=(--in-process-gpu --disable-software-rasterizer)
  run_app "${EXTRA[@]}" "${ARGS[@]}"
fi

if [ $RC -ne 0 ] && [ $ELAPSED -lt 15 ]; then
  details="$(tail -n 6 "$RUNLOG" | cut -c1-160)"
  if ask_yes_no "Library Search could not start" "The search app closed right after starting (error $RC).

Details:
$details

Open the simple version in Firefox instead? It has the same search." "Open in Firefox" "Close"; then
    run_firefox_mode
    exit $?
  fi
  exit $RC
fi
exit 0
