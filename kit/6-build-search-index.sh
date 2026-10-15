#!/usr/bin/env bash
# Builds or updates the book search index from a terminal (the app's Library screen has the same button).
#   bash 6-build-search-index.sh          only new or changed books (fast after the first time)
#   bash 6-build-search-index.sh --full   read every book again
# The first build reads every PDF: about 30-90 minutes on the CF-30. Safe to stop with Ctrl+C -
# run it again and it carries on where it stopped.

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

pause() { [ -t 0 ] && read -n 1 -s -r -p "Press any key to close."; echo; }

case "$(uname -m)" in i?86) ARCH=ia32;; x86_64) ARCH=x64;; *) ARCH=ia32;; esac
NODE_CMD=(); APPRES=""
OS="$(uname -s)"
for c in "$APPDIR/dist/library-search-linux-$ARCH/library-search" "$APPDIR"/dist/library-search-linux-*/library-search; do
  [ "$OS" = "Linux" ] || break
  if [ -x "$c" ]; then NODE_CMD=("$c"); APPRES="$(dirname "$c")/resources/app"; break; fi
done
if [ -z "$APPRES" ]; then
  for c in "$APPDIR"/dist/library-search-darwin-*/library-search.app/Contents/MacOS/library-search; do
    [ "$OS" = "Darwin" ] || break
    if [ -x "$c" ]; then NODE_CMD=("$c"); APPRES="$(dirname "$(dirname "$c")")/Resources/app"; break; fi
  done
fi
if [ -z "$APPRES" ] && [ -f "$APPDIR/build/indexer/indexer.js" ]; then
  # developer checkout
  if command -v node >/dev/null 2>&1; then NODE_CMD=(node); else NODE_CMD=("$APPDIR/node_modules/.bin/electron"); fi
  APPRES="$APPDIR"
fi
if [ -z "$APPRES" ]; then
  echo "Library Search is not installed yet. Run first:  bash 6-install-or-update-search-app.sh"
  pause; exit 1
fi
if ! command -v pdftotext >/dev/null 2>&1; then
  echo "pdftotext is missing, so PDFs can't be read. Install it (once, needs internet or the Ubuntu DVD):"
  echo "    sudo apt-get install poppler-utils"
  pause; exit 1
fi

echo "Building the search index for the library folders chosen in the app (or found next to it)."
echo "Change them on the app's Library page."
echo "Press Ctrl+C to stop; run this again later to continue."
echo

# Ctrl+C goes to the indexer too; it finishes the current book and exits. Keep this script alive to say so.
trap 'echo' INT
nice -n 10 env ELECTRON_RUN_AS_NODE=1 "${NODE_CMD[@]}" "$APPRES/build/indexer/indexer.js" "$@"
rc=$?
trap - INT
echo
case $rc in
  0) echo "Done. Open the search with:  bash 6-search-the-library.sh";;
  3|130) echo "Stopped. Run this again to continue where it stopped.";;
  *) echo "The index build failed (code $rc). The messages above say why.";;
esac
pause
exit $rc
