#!/usr/bin/env bash
# M0 feasibility check for Library Search on the target machine (Panasonic CF-30, Ubuntu 16.04 i386).
# Needs no internet. Prints PASS / FAIL / INFO lines and saves the same text as a report file.
#   bash library-search-app/scripts/m0-check.sh
#   bash m0-check.sh --app <path/to/library-search> --kit <kit folder> --no-gui
# Report: library-search-app/m0-report-<date>.txt (or $M0_REPORT_DIR). Paste it into NOTES.md.

APP_BIN=""
KIT=""
GUI=1
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP_BIN="$2"; shift 2;;
    --kit) KIT="$2"; shift 2;;
    --no-gui) GUI=0; shift;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown option: $1"; exit 2;;
  esac
done

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"
APPDIR=""
d="$SELF_DIR"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ "$(basename "$d")" = "library-search-app" ]; then APPDIR="$d"; break; fi
  d="$(dirname "$d")"
done
[ -z "$APPDIR" ] && APPDIR="$(dirname "$SELF_DIR")"
[ -z "$KIT" ] && KIT="$(dirname "$APPDIR")"

REPORT_DIR="${M0_REPORT_DIR:-$APPDIR}"
[ -w "$REPORT_DIR" ] || REPORT_DIR="${TMPDIR:-/tmp}"
REPORT="$REPORT_DIR/m0-report-$(date +%Y%m%d-%H%M).txt"
exec > >(tee -a "$REPORT") 2>&1

TMP="$(mktemp -d 2>/dev/null || echo /tmp/m0-$$)"
mkdir -p "$TMP"
KS_PID=""
cleanup() { [ -n "$KS_PID" ] && kill "$KS_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

NPASS=0; NFAIL=0
pass() { echo "PASS  $*"; NPASS=$((NPASS + 1)); }
fail() { echo "FAIL  $*"; NFAIL=$((NFAIL + 1)); }
info() { echo "INFO  $*"; }
section() { echo; echo "== $* =="; }
indent() { sed 's/^/        /'; }
have() { command -v "$1" >/dev/null 2>&1; }
if have timeout; then TO=(timeout); else TO=(); fi
with_timeout() { local s="$1"; shift; if [ ${#TO[@]} -gt 0 ]; then timeout "$s" "$@"; else "$@"; fi; }

echo "Library Search - M0 check, $(date '+%Y-%m-%d %H:%M')"
echo "Kit folder: $KIT"
echo "App folder: $APPDIR"

# ---------------------------------------------------------------------------------------------------
section "System"
info "kernel: $(uname -srvm)"
if have lsb_release; then info "release: $(lsb_release -ds 2>/dev/null)"
elif [ -f /etc/os-release ]; then info "release: $(. /etc/os-release; echo "$PRETTY_NAME")"; fi
case "$(uname -m)" in
  i?86) pass "32-bit userland ($(uname -m))";;
  *) info "machine is $(uname -m) (the CF-30 should say i686)";;
esac
GLIBC="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[ -z "$GLIBC" ] && GLIBC="$(ldd --version 2>/dev/null | head -n 1 | awk '{print $NF}')"
info "glibc: ${GLIBC:-unknown}"
if [ -r /proc/cpuinfo ]; then
  info "cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//') x $(grep -c '^processor' /proc/cpuinfo)"
  flags="$(grep -m1 '^flags' /proc/cpuinfo)"
  if [ -z "$flags" ]; then
    info "no x86 cpu flags in /proc/cpuinfo (emulator?) - can't check SSE3"
  else
    for f in pni ssse3 sse4_1 pae lm nx; do
      if printf '%s' "$flags" | grep -qw "$f"; then info "cpu flag $f: yes"; else info "cpu flag $f: no"; fi
    done
    if printf '%s' "$flags" | grep -qw pni; then pass "SSE3 present (Chromium 89+ needs it)"
    else fail "no SSE3 (pni) - Chromium/Electron 17 will not run; try the Electron 11 build or Firefox mode"; fi
  fi
fi
if have free; then free -m | indent; fi
if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then
  info "unprivileged user namespaces (Chromium sandbox): $(cat /proc/sys/kernel/unprivileged_userns_clone)"
fi
df -h "$KIT" 2>/dev/null | indent
have lspci && lspci 2>/dev/null | grep -iE 'vga|3d|display' | indent
info "DISPLAY=${DISPLAY:-<none>}  XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-?}"

# ---------------------------------------------------------------------------------------------------
section "Tools"
if have pdftotext; then pass "pdftotext: $(pdftotext -v 2>&1 | head -n 1)"
else fail "pdftotext missing - fix: sudo apt-get install poppler-utils"; fi
if have pdfinfo; then pass "pdfinfo: present"; else fail "pdfinfo missing - fix: sudo apt-get install poppler-utils"; fi
if have evince; then
  pass "evince: $(evince --version 2>/dev/null | head -n 1)"
  EH="$(evince --help-all 2>&1; evince --help 2>&1)"
  if printf '%s' "$EH" | grep -q -- '--page-index'; then pass "evince supports --page-index"
  else fail "evince has no --page-index (PDFs will open at page 1)"; fi
  if printf '%s' "$EH" | grep -q -- '--find'; then pass "evince supports --find"; else info "evince has no --find"; fi
  printf '%s\n' "$EH" | grep -E -- '--page-index|--page-label|--find|--named-dest' | sort -u | indent
else
  fail "evince missing - PDFs will open with xdg-open instead (fix: sudo apt-get install evince)"
fi
if have xdg-open; then pass "xdg-open present"; else fail "xdg-open missing (fix: sudo apt-get install xdg-utils)"; fi
if have firefox; then info "firefox: $(with_timeout 30 firefox --version 2>/dev/null | head -n 1)"; else info "firefox not found (needed only for Firefox mode)"; fi
for t in zenity notify-send curl tar gzip git python3; do
  if have "$t"; then info "$t: $( ($t --version 2>&1 || true) | head -n 1)"; else info "$t: missing"; fi
done

# ---------------------------------------------------------------------------------------------------
section "Library Search app (Electron)"
case "$(uname -m)" in i?86) ARCH=ia32;; x86_64) ARCH=x64;; *) ARCH=ia32;; esac
if [ -z "$APP_BIN" ]; then
  for c in "$APPDIR/dist/library-search-linux-$ARCH/library-search" "$APPDIR"/dist/library-search-linux-*/library-search; do
    if [ -x "$c" ]; then APP_BIN="$c"; break; fi
  done
fi
if [ -z "$APP_BIN" ] || [ ! -x "$APP_BIN" ]; then
  fail "app not installed (looked in $APPDIR/dist) - install it first: bash 6-install-or-update-search-app.sh <file.tar.gz>"
else
  APP_DIR="$(cd "$(dirname "$APP_BIN")" && pwd)"
  APPRES="$APP_DIR/resources/app"
  info "binary: $APP_BIN"
  [ -f "$APP_DIR/BUILD-INFO.txt" ] && indent <"$APP_DIR/BUILD-INFO.txt"
  have file && info "$(file -b "$APP_BIN" | cut -c1-120)"

  if have ldd; then
    missing="$( (ldd "$APP_BIN"; for so in "$APP_DIR"/*.so "$APP_DIR"/*.so.*; do [ -f "$so" ] && ldd "$so"; done) 2>/dev/null | grep 'not found' | sort -u)"
    if [ -z "$missing" ]; then pass "all shared libraries found (ldd)"
    else fail "missing shared libraries:"; printf '%s\n' "$missing" | indent; fi
  fi
  if have objdump; then
    need="$( (objdump -T "$APP_BIN"; for so in "$APP_DIR"/*.so; do [ -f "$so" ] && objdump -T "$so"; done) 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -u -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
    info "highest glibc version the app needs: ${need:-?} (system has ${GLIBC:-?})"
  fi

  # Node inside Electron
  T0=$(date +%s)
  ELECTRON_RUN_AS_NODE=1 with_timeout 120 "$APP_BIN" -e 'console.log(JSON.stringify({electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, arch: process.arch}))' >"$TMP/node.out" 2>&1
  rc=$?
  if [ $rc -eq 0 ] && grep -q '"node"' "$TMP/node.out"; then pass "Electron runs as Node ($(( $(date +%s) - T0 ))s): $(tail -n 1 "$TMP/node.out")"
  else fail "Electron can't run as Node (exit $rc):"; tail -n 5 "$TMP/node.out" | indent; fi

  # SQLite FTS5 in WebAssembly (the search index)
  if [ -d "$APPRES/node_modules/node-sqlite3-wasm" ]; then
    cat >"$TMP/fts.js" <<'JS'
const { Database } = require(process.env.M0_SQLITE);
const db = new Database(process.env.M0_DB);
db.exec("create virtual table t using fts5(x, tokenize='porter unicode61 remove_diacritics 2')");
db.run('insert into t(x) values (?)', ['Bring the water to a rolling boil for one minute.']);
const r = db.all("select snippet(t, 0, '[', ']', '...', 8) as s, bm25(t) as b from t where t match ?", ['"boiling" "water"']);
const v = db.get('select sqlite_version() as v').v;
db.close();
if (!r.length) { console.log('no match'); process.exit(1); }
console.log('sqlite ' + v + ': ' + r[0].s);
JS
    T0=$(date +%s)
    M0_SQLITE="$APPRES/node_modules/node-sqlite3-wasm" M0_DB="$TMP/m0.sqlite" ELECTRON_RUN_AS_NODE=1 \
      with_timeout 120 "$APP_BIN" "$TMP/fts.js" >"$TMP/fts.out" 2>&1
    rc=$?
    if [ $rc -eq 0 ] && grep -q '^sqlite' "$TMP/fts.out"; then pass "SQLite FTS5 (WASM) works ($(( $(date +%s) - T0 ))s): $(tail -n 1 "$TMP/fts.out")"
    else fail "SQLite FTS5 (WASM) test failed (exit $rc):"; tail -n 5 "$TMP/fts.out" | indent; fi
  else
    fail "node-sqlite3-wasm missing in $APPRES/node_modules"
  fi

  # GUI launch
  if [ "$GUI" = "1" ]; then
    XV=()
    if [ -z "$DISPLAY" ]; then
      if have xvfb-run; then XV=(xvfb-run -a -s "-screen 0 1024x768x24"); info "no DISPLAY - using xvfb-run"
      else info "no DISPLAY and no xvfb-run - skipping GUI launch tests"; GUI=0; fi
    fi
  fi
  if [ "$GUI" = "1" ]; then
    for variant in "--disable-gpu" "--disable-gpu --no-sandbox"; do
      T0=$(date +%s)
      # shellcheck disable=SC2086
      with_timeout 180 "${XV[@]}" "$APP_BIN" --self-test $variant --library-root "$KIT" --data-dir "$TMP/data" >"$TMP/gui.log" 2>&1
      rc=$?
      secs=$(( $(date +%s) - T0 ))
      if [ $rc -eq 0 ]; then pass "app window self-test with '$variant' (${secs}s)"
      elif [ $rc -eq 124 ]; then fail "app window self-test with '$variant' timed out after ${secs}s"
      else fail "app window self-test with '$variant' failed (exit $rc, ${secs}s)"; fi
      tail -n 12 "$TMP/gui.log" | cut -c1-200 | indent
    done
  fi
fi

# ---------------------------------------------------------------------------------------------------
section "Kiwix (offline Wikipedia etc.)"
KDIR=""
for c in "$KIT"/*[Kk]iwix*; do [ -d "$c" ] && KDIR="$c" && break; done
KS=""
[ -n "$KDIR" ] && [ -x "$KDIR/kiwix-tools/kiwix-serve" ] && KS="$KDIR/kiwix-tools/kiwix-serve"
[ -z "$KS" ] && have kiwix-serve && KS="$(command -v kiwix-serve)"
if [ -n "$KS" ]; then pass "kiwix-serve: $KS"; info "version: $("$KS" --version 2>&1 | tr '\n' ' ' | cut -c1-200)"
else info "kiwix-serve not found (run 3-download-offline-wikipedia.sh)"; fi
ZIMS=()
if [ -n "$KDIR" ]; then for z in "$KDIR"/*.zim; do [ -f "$z" ] && ZIMS+=("$z"); done; fi
info "ZIM files: ${#ZIMS[@]}"
SMALLEST=""
if [ ${#ZIMS[@]} -gt 0 ]; then
  ls -sh "${ZIMS[@]}" 2>/dev/null | sed "s#$KDIR/##" | indent
  SMALLEST="$(ls -S "${ZIMS[@]}" 2>/dev/null | tail -n 1)"
fi

BASE=""
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/ 2>/dev/null)"
if [ -n "$code" ] && [ "$code" != "000" ]; then
  info "something answers on port 8080 (HTTP $code) - testing it"
  BASE="http://127.0.0.1:8080"
elif [ -n "$KS" ] && [ -n "$SMALLEST" ]; then
  info "port 8080 not running - starting a test kiwix-serve on port 18080 with $(basename "$SMALLEST")"
  "$KS" --port=18080 "$SMALLEST" >"$TMP/kiwix.log" 2>&1 &
  KS_PID=$!
  for _ in $(seq 1 30); do
    sleep 1
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:18080/ 2>/dev/null)"
    [ -n "$c" ] && [ "$c" != "000" ] && BASE="http://127.0.0.1:18080" && break
  done
  [ -z "$BASE" ] && { fail "test kiwix-serve didn't start:"; tail -n 5 "$TMP/kiwix.log" | indent; }
else
  info "no kiwix-serve running and nothing to start - skipping endpoint tests"
fi

if [ -n "$BASE" ] && have curl; then
  cat="$(curl -s --max-time 30 "$BASE/catalog/v2/entries?count=3")"
  if printf '%s' "$cat" | grep -q '<entry'; then
    pass "catalog v2 (/catalog/v2/entries) answers"
  else
    fail "catalog v2 missing; trying v1 /catalog/root.xml"
    cat="$(curl -s --max-time 30 "$BASE/catalog/root.xml")"
    printf '%s' "$cat" | grep -q '<entry' && pass "catalog v1 (/catalog/root.xml) answers"
  fi
  printf '%s' "$cat" | head -c 1500 | indent; echo
  NAME="$(printf '%s' "$cat" | tr '\n' ' ' | sed -n 's:.*<entry>.*<name>\([^<]*\)</name>.*:\1:p' | head -n 1)"
  [ -z "$NAME" ] && NAME="$(printf '%s' "$cat" | grep -o '<name>[^<]*</name>' | head -n 1 | sed 's:</\{0,1\}name>::g')"
  [ -z "$NAME" ] && NAME="$(printf '%s' "$cat" | grep -o 'href="/content/[^/"]*' | head -n 1 | sed 's:.*/content/::')"
  info "first book name: ${NAME:-?}"
  if [ -n "$NAME" ]; then
    out="$(curl -s --max-time 60 -w '\n%{http_code} %{time_total}s' "$BASE/search?books.name=$NAME&pattern=water&format=xml&pageLength=3")"
    if printf '%s' "$out" | grep -q '<item'; then pass "new search API (books.name=…&format=xml) answers: $(printf '%s' "$out" | tail -n 1)"
    else fail "new search API (books.name=…&format=xml) gave no <item>: $(printf '%s' "$out" | tail -n 1)"; fi
    printf '%s' "$out" | head -c 1500 | indent; echo
    out="$(curl -s --max-time 60 -w '\n%{http_code} %{time_total}s' "$BASE/search?content=$NAME&pattern=water")"
    info "old search API (content=…): $(printf '%s' "$out" | tail -n 1)"
    printf '%s' "$out" | grep -o '<a href="[^"]*"' | head -n 3 | indent
  fi
fi

# ---------------------------------------------------------------------------------------------------
section "Summary"
echo "PASS: $NPASS   FAIL: $NFAIL"
echo "Report saved to: $REPORT"
echo "Paste it into library-search-app/NOTES.md (CF-30 results section) or send it to the developer."
