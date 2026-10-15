#!/usr/bin/env bash
# Builds or updates the book search index from a terminal (the app's Library screen has the same button).
#   bash 6-build-search-index.sh          only new or changed books (fast after the first time)
#   bash 6-build-search-index.sh --full   read every book again
# The first build reads every PDF: about 30-90 minutes on the CF-30. Safe to stop with Ctrl+C -
# run it again and it carries on where it stopped.

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"
APPDIR=""
d="$SELF_DIR"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ "$(basename "$d")" = "library-search-app" ]; then APPDIR="$d"; break; fi
  d="$(dirname "$d")"
done
if [ -n "$APPDIR" ]; then KIT="$(dirname "$APPDIR")"; else KIT="$SELF_DIR"; APPDIR="$KIT/library-search-app"; fi
cd "$KIT" || exit 1

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

ROOT_ARGS=(--library-root "$KIT")
ROOTS_TXT="$KIT"
PARENT="$(dirname "$KIT")"
if ls -d "$PARENT"/[0-9][0-9]\ */ >/dev/null 2>&1; then ROOT_ARGS+=(--library-root "$PARENT"); ROOTS_TXT="$ROOTS_TXT and $PARENT"; fi

echo "Building the search index for the books in: $ROOTS_TXT"
echo "Index file: $APPDIR/index/library.sqlite"
echo "Press Ctrl+C to stop; run this again later to continue."
echo

# Ctrl+C goes to the indexer too; it finishes the current book and exits. Keep this script alive to say so.
trap 'echo' INT
nice -n 10 env ELECTRON_RUN_AS_NODE=1 "${NODE_CMD[@]}" "$APPRES/build/indexer/indexer.js" \
  "${ROOT_ARGS[@]}" --data-dir "$APPDIR" "$@"
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
