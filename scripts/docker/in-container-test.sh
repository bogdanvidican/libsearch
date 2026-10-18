#!/usr/bin/env bash
# Runs inside the i386 Ubuntu 16.04 container (see scripts/docker-ia32-test.sh).
#   /w   = library-search-app (read-only)     /out = results folder (writable)
APP=/w/dist/library-search-linux-ia32
BIN="$APP/library-search"
APPRES="$APP/resources/app"
OUT=/out
mkdir -p "$OUT"

RESULTS=()
NFAIL=0
ok()   { echo "PASS  $*"; RESULTS+=("PASS  $*"); }
bad()  { echo "FAIL  $*"; RESULTS+=("FAIL  $*"); NFAIL=$((NFAIL + 1)); }
note() { echo "INFO  $*"; RESULTS+=("INFO  $*"); }
section() { echo; echo "== $* =="; }
vmax() { sort -u -t. -k1,1n -k2,2n -k3,3n | tail -n 1; }
vle() { [ "$(printf '%s\n%s\n' "$1" "$2" | vmax)" = "$2" ]; }  # $1 <= $2

echo "Container: $(. /etc/os-release; echo "$PRETTY_NAME") $(uname -m), $(ldd --version | head -n 1)"
[ -x "$BIN" ] || { echo "FAIL  no packaged app at $BIN (run npm run dist:linux-ia32)"; exit 1; }
cat "$APP/BUILD-INFO.txt" 2>/dev/null

# --- (a) shared libraries ------------------------------------------------------------------------------
section "(a) ldd"
missing="$( (ldd "$BIN"; for so in "$APP"/*.so "$APP"/*.so.*; do [ -f "$so" ] && ldd "$so"; done) 2>&1 | grep 'not found' | sort -u)"
if [ -z "$missing" ]; then ok "ldd: every shared library resolves"
else bad "ldd: missing libraries:"; printf '%s\n' "$missing" | sed 's/^/        /'; fi
ldd "$BIN" >"$OUT/ldd.txt" 2>&1

# --- (b) symbol versions ---------------------------------------------------------------------------------
section "(b) glibc / libstdc++ symbol versions"
SYS_GLIBC="$(ldd --version | head -n 1 | awk '{print $NF}')"
SYMS="$( (objdump -T "$BIN"; for so in "$APP"/*.so "$APP"/*.so.*; do [ -f "$so" ] && objdump -T "$so"; done) 2>/dev/null)"
NEED_GLIBC="$(printf '%s\n' "$SYMS" | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | vmax)"
NEED_CXX="$(printf '%s\n' "$SYMS" | grep -o 'GLIBCXX_[0-9][0-9.]*' | sed 's/GLIBCXX_//' | vmax)"
STDCXX="$(ls /usr/lib/i386-linux-gnu/libstdc++.so.6 2>/dev/null)"
HAVE_CXX=""
[ -n "$STDCXX" ] && HAVE_CXX="$(strings "$STDCXX" | grep -o '^GLIBCXX_[0-9][0-9.]*$' | sed 's/GLIBCXX_//' | vmax)"
printf '%s\n' "$SYMS" | grep -o 'GLIBC_[0-9][0-9.]*' | sort | uniq -c | sort -k2 -V >"$OUT/glibc-symbols.txt"
if [ -n "$NEED_GLIBC" ] && vle "$NEED_GLIBC" "$SYS_GLIBC"; then ok "needs GLIBC_$NEED_GLIBC, xenial has $SYS_GLIBC"
else bad "needs GLIBC_${NEED_GLIBC:-?}, xenial has $SYS_GLIBC"; fi
if [ -z "$NEED_CXX" ]; then ok "no GLIBCXX symbols needed (libc++ is bundled)"
elif [ -n "$HAVE_CXX" ] && vle "$NEED_CXX" "$HAVE_CXX"; then ok "needs GLIBCXX_$NEED_CXX, xenial has $HAVE_CXX"
else bad "needs GLIBCXX_$NEED_CXX, xenial has ${HAVE_CXX:-none}"; fi

# --- (c) M0 check script ----------------------------------------------------------------------------------
section "(c) m0-check.sh"
mkdir -p /tmp/kit
M0_REPORT_DIR="$OUT" bash /w/scripts/m0-check.sh --app "$BIN" --kit /tmp/kit --no-gui >"$OUT/m0-check.log" 2>&1
grep -E '^(PASS|FAIL)' "$OUT/m0-check.log" | sed 's/^/        /'
note "m0-check.sh ran: $(grep -c '^PASS' "$OUT/m0-check.log") PASS / $(grep -c '^FAIL' "$OUT/m0-check.log") FAIL (full log: m0-check.log)"

# --- (d) indexer + server smoke test on the fixture library -------------------------------------------------
# QEMU user-mode (Docker on Apple Silicon) cannot spawn child processes from Electron's Node (segfault), so the
# ia32 indexer (which runs pdftotext) is informational here. The server is tested against an index that
# docker-ia32-test.sh built on the host from the same fixture copy (/out/host-lib + /out/host-data):
# that also proves an index built on the Mac works on the CF-30.
section "(d) index + search smoke test"
is_real() { [ -f "$1" ] && [ "$(wc -c <"$1")" -gt 2000 ]; }
FIX=/w/tests/fixtures/library
SERVER_PID=""
if [ ! -d "$FIX" ]; then
  note "skipped: $FIX does not exist yet"
else
  if ! is_real "$APPRES/build/indexer/indexer.js"; then
    note "ia32 indexer skipped: indexer.js in the package is still a placeholder"
  else
    rm -rf /tmp/lib /tmp/data && cp -r "$FIX" /tmp/lib && mkdir -p /tmp/data
    T0=$(date +%s)
    ELECTRON_RUN_AS_NODE=1 timeout 900 "$BIN" "$APPRES/build/indexer/indexer.js" \
      --library-root /tmp/lib --data-dir /tmp/data --json >"$OUT/indexer.log" 2>&1
    rc=$?
    last="$(grep '"type":"progress"' "$OUT/indexer.log" | tail -n 1)"
    if [ $rc -eq 0 ] && printf '%s' "$last" | grep -q '"phase":"done"'; then ok "ia32 indexer finished in $(( $(date +%s) - T0 ))s: $(printf '%s' "$last" | cut -c1-200)"
    elif [ -z "$NATIVE" ] && grep -q 'qemu: uncaught target signal' "$OUT/indexer.log"; then note "ia32 indexer crashed inside QEMU when starting pdftotext (exit $rc) - known QEMU user-mode limit; verify on the CF-30"
    else bad "ia32 indexer exit $rc: $(tail -n 3 "$OUT/indexer.log" | cut -c1-300)"; fi
  fi

  if ! is_real "$APPRES/build/server/server.js"; then
    note "server skipped: server.js in the package is still a placeholder"
  elif [ ! -d /out/host-data ]; then
    note "server skipped: no host-built index in /out/host-data (host indexer step failed or was skipped)"
  else
    rm -rf /tmp/hlib /tmp/hdata && cp -r /out/host-lib /tmp/hlib && cp -r /out/host-data /tmp/hdata
    ELECTRON_RUN_AS_NODE=1 "$BIN" "$APPRES/build/server/server.js" --mode browser --port 8090 \
      --library-root /tmp/hlib --data-dir /tmp/hdata --no-kiwix-autostart >"$OUT/server.log" 2>&1 &
    SERVER_PID=$!
    ready=""
    for _ in $(seq 1 180); do
      grep -q 'LIBRARY_SEARCH_READY' "$OUT/server.log" && ready=1 && break
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 1
    done
    if [ -z "$ready" ]; then
      bad "server did not print LIBRARY_SEARCH_READY: $(tail -n 3 "$OUT/server.log" | cut -c1-300)"
    else
      ok "server ready: $(grep -m1 LIBRARY_SEARCH_READY "$OUT/server.log")"
      TOKEN="$(curl -s --max-time 30 http://127.0.0.1:8090/ | grep -o 'name="ls-token" content="[^"]*"' | sed 's/.*content="//; s/"$//')"
      if [ -n "$TOKEN" ]; then ok "token found in index.html"; else bad "no ls-token meta in index.html"; fi
      st="$(curl -s --max-time 60 -H "X-Token: $TOKEN" http://127.0.0.1:8090/api/status)"
      printf '%s\n' "$st" >"$OUT/status.json"
      if printf '%s' "$st" | grep -q '"docs":[1-9]'; then ok "/api/status reports indexed docs"
      else bad "/api/status: $(printf '%s' "$st" | cut -c1-300)"; fi
      T0=$(date +%s)
      sr="$(curl -s --max-time 60 -H "X-Token: $TOKEN" 'http://127.0.0.1:8090/api/search?q=water')"
      printf '%s\n' "$sr" >"$OUT/search-water.json"
      if printf '%s' "$sr" | grep -q '"results":\[{'; then ok "/api/search?q=water returned hits ($(( $(date +%s) - T0 ))s, ia32 server on a Mac-built index)"
      else bad "/api/search?q=water: $(printf '%s' "$sr" | cut -c1-300)"; fi
    fi
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  fi
fi

# --- (e) GUI launch (best effort under QEMU) ------------------------------------------------------------------
# Chromium starts GPU/renderer child processes, which QEMU user-mode can't do; --single-process is tried as well.
section "(e) GUI self-test under Xvfb (informational)"
mkdir -p /tmp/lib /tmp/data
GUI_VARIANTS=("--disable-gpu --no-sandbox" "--disable-gpu --no-sandbox --in-process-gpu --no-zygote --single-process")
if ! is_real "$APPRES/build/main/main.js"; then note "GUI skipped: main.js in the package is still a placeholder"; GUI_VARIANTS=(); fi
GUI_OK=""
for variant in "${GUI_VARIANTS[@]}"; do
  T0=$(date +%s)
  # shellcheck disable=SC2086
  timeout 300 xvfb-run -a -s "-screen 0 1024x768x24" "$BIN" --self-test $variant \
    --library-root /tmp/lib --data-dir /tmp/data >"$OUT/gui.log" 2>&1
  rc=$?
  secs=$(( $(date +%s) - T0 ))
  cp "$OUT/gui.log" "$OUT/gui-$(printf '%s' "$variant" | tr -c 'a-z' '_' | cut -c1-60).log"
  if [ $rc -eq 0 ]; then GUI_OK="$variant ($(grep -o '"ok":true.*' "$OUT/gui.log" | cut -c1-160))"; note "GUI self-test passed with '$variant' (${secs}s)"
  elif [ $rc -eq 124 ]; then note "GUI self-test timed out with '$variant' after ${secs}s"
  else note "GUI self-test with '$variant': exit $rc after ${secs}s: $(grep -v '^\s*$' "$OUT/gui.log" | grep -v 'bus.cc' | tail -n 2 | tr '\n' ' ' | cut -c1-240)"; fi
done

# On an x86 host nothing is emulated, so the window must really open.
if [ -n "$NATIVE" ] && [ ${#GUI_VARIANTS[@]} -gt 0 ]; then
  if [ -n "$GUI_OK" ]; then ok "GUI self-test (native i386): $GUI_OK"; else bad "GUI self-test failed natively (see gui-*.log)"; fi
fi

# --- (f) self-update: the install step the app runs when it closes, with xenial's bash / tar / pgrep -----------
section "(f) update install (6-install-or-update-search-app.sh --wait --status-file)"
V="$(cat "$APP/app-version.txt" 2>/dev/null)"
TB="/w/dist/library-search-linux-ia32-v$V.tar.gz"
if [ ! -f "$TB" ]; then
  note "update install skipped: no $TB"
else
  U=/tmp/upd
  rm -rf "$U" && mkdir -p "$U/home/dist/.update" "$U/user"
  cp "$TB" "$U/home/dist/.update/"
  [ -f "$TB.sha256" ] && cp "$TB.sha256" "$U/home/dist/.update/"
  SRC="$U/home/dist/.update/$(basename "$TB")"
  DEST="$U/home/dist/library-search-linux-ia32"
  INSTALL=(bash "$APPRES/kit/6-install-or-update-search-app.sh" "$SRC" --dir "$U/home" --wait --no-pin --status-file "$U/status")
  # The app was opened again (a process runs $DEST/library-search): wait, then leave it alone.
  mkdir -p "$DEST" && echo 0.0.1 >"$DEST/app-version.txt"
  bash -c 'sleep 120; exit 0' "$DEST/library-search" &
  FAKE=$!
  HOME="$U/user" LIBRARY_SEARCH_WAIT_SECONDS=3 "${INSTALL[@]}" >"$OUT/update-busy.log" 2>&1
  rc=$?
  kill "$FAKE" 2>/dev/null
  if [ $rc -eq 2 ] && [ "$(cat "$U/status" 2>/dev/null)" = "busy" ] && [ "$(cat "$DEST/app-version.txt")" = "0.0.1" ]; then
    ok "update waits while the app is open and then leaves it alone (busy)"
  else bad "update busy case: exit $rc, status '$(cat "$U/status" 2>/dev/null)' (see update-busy.log)"; fi
  # The app is closed: the new version goes in.
  HOME="$U/user" "${INSTALL[@]}" >"$OUT/update-install.log" 2>&1
  rc=$?
  if [ $rc -eq 0 ] && [ "$(cat "$U/status" 2>/dev/null)" = "ok $V" ] && [ -x "$DEST/library-search" ] && [ ! -e "$DEST.old" ]; then
    ok "update installed with xenial's bash/tar: $(cat "$U/status")"
  else bad "update install: exit $rc, status '$(cat "$U/status" 2>/dev/null)' (see update-install.log)"; fi
fi

# --- (g) the kit's download script with xenial's bash 4.3 + curl 7.47 ------------------------------------------
# It works on a library folder outside the app and reads the app's book lists plus the library's own
# booklist-local.txt. A small server on Electron's Node stands in for the internet.
section "(g) 2-download-pdf-books.sh with xenial's bash + curl"
G=/tmp/kit-g
L="/tmp/Community Rebuild Library/Library & Co (g)"
rm -rf "$G" "/tmp/Community Rebuild Library" && cp -r "$APPRES/kit" "$G" && mkdir -p "$L/01 Medicine"
echo 'F|02 Water & Sanitation|Main_Book.pdf|http://127.0.0.1:18090/pdf/main%20(1).pdf?a=1&b=2' >"$G/booklists/booklist-main.txt"
echo 'F|16 Linux & Ubuntu|Linux_Book.pdf|http://127.0.0.1:18090/pdf/linux.pdf' >"$G/booklists/booklist-linux.txt"
echo 'F|99 Mine|Local_Book.pdf|http://127.0.0.1:18090/pdf/local.pdf' >"$L/booklist-local.txt"
ELECTRON_RUN_AS_NODE=1 "$BIN" -e '
require("http").createServer(function (q, s) {
  if (q.url.indexOf("/pdf/") === 0) s.end("%PDF-1.4\n%test\n"); else s.end("ok");
}).listen(18090, "127.0.0.1");' >"$OUT/kit-server.log" 2>&1 &
KIT_SERVER=$!
for _ in $(seq 1 120); do
  [ "$(curl -s --max-time 5 http://127.0.0.1:18090/ 2>/dev/null)" = "ok" ] && break
  kill -0 "$KIT_SERVER" 2>/dev/null || break
  sleep 1
done
LIBRARY_KIT_CHECK_URL=http://127.0.0.1:18090/ timeout 300 bash "$G/2-download-pdf-books.sh" "$L" </dev/null >"$OUT/kit-download.log" 2>&1
rc=$?
kill "$KIT_SERVER" 2>/dev/null
missing=""
for f in "02 Water & Sanitation/Main_Book.pdf" "16 Linux & Ubuntu/Linux_Book.pdf" "99 Mine/Local_Book.pdf"; do
  [ "$(head -c 4 "$L/$f" 2>/dev/null)" = "%PDF" ] || missing="$missing [$f]"
done
if [ $rc -eq 0 ] && [ -z "$missing" ]; then
  ok "2-download-pdf-books.sh: the app's lists + the library's booklist-local.txt downloaded into the library (bash $BASH_VERSION, $(curl --version | head -n 1 | cut -d' ' -f1-2))"
else bad "2-download-pdf-books.sh: exit $rc, not downloaded:${missing:- none} (see kit-download.log)"; fi

# --- (h) the app's own book downloader (build/downloader/downloader.js) on Electron's Node ---------------------
# --min-free-mb 0: no df (QEMU can't start other programs from Electron's Node; natively df is tested on the host).
section "(h) in-app book downloads (downloader.js)"
H=/tmp/dl-h
L="$H/Library & Co (h)"
rm -rf "$H" && mkdir -p "$L/01 Medicine"
printf '%s\n' 'F|01 Medicine|Good.pdf|http://127.0.0.1:18091/pdf/good.pdf' \
  'F|01 Medicine|Check.pdf|http://127.0.0.1:18091/html/check.pdf' \
  'F|01 Medicine|Refused.pdf|http://127.0.0.1:18091/403.pdf' >"$H/list.txt"
ELECTRON_RUN_AS_NODE=1 "$BIN" -e '
require("http").createServer(function (q, s) {
  if (q.url.indexOf("/pdf/") === 0) s.end("%PDF-1.4\n%test\n");
  else if (q.url.indexOf("/html/") === 0) s.end("<html><body>Checking your browser</body></html>");
  else if (q.url === "/403.pdf") { s.statusCode = 403; s.end(); }
  else s.end("ok");
}).listen(18091, "127.0.0.1");' >"$OUT/dl-server.log" 2>&1 &
DL_SERVER=$!
for _ in $(seq 1 120); do
  [ "$(curl -s --max-time 5 http://127.0.0.1:18091/ 2>/dev/null)" = "ok" ] && break
  kill -0 "$DL_SERVER" 2>/dev/null || break
  sleep 1
done
ELECTRON_RUN_AS_NODE=1 timeout 300 "$BIN" "$APPRES/build/downloader/downloader.js" --job books --library "$L" --list "$H/list.txt" \
  --check-url http://127.0.0.1:18091/ --archive-base http://127.0.0.1:18091 --min-free-mb 0 --json >"$OUT/downloader.log" 2>&1
rc=$?
kill "$DL_SERVER" 2>/dev/null
NOTES_FILE="$L/library-search-downloads.json"
if [ $rc -eq 0 ] && [ "$(head -c 4 "$L/01 Medicine/Good.pdf" 2>/dev/null)" = "%PDF" ] \
  && grep -q '"code": "not-a-book"' "$NOTES_FILE" 2>/dev/null && grep -q '"code": "http-403"' "$NOTES_FILE" 2>/dev/null \
  && [ ! -e "$L/01 Medicine/Check.pdf" ]; then
  ok "in-app downloader: the book is in the library; the bot check and the 403 are listed with reasons"
else bad "in-app downloader: exit $rc (see downloader.log): $(tail -n 2 "$OUT/downloader.log" | cut -c1-200)"; fi

# --- (i) HTTPS with Electron's own certificate store (Ubuntu 16.04's are outdated; the app doesn't use them) --
section "(i) HTTPS with Electron's own certificates"
tls="$(ELECTRON_RUN_AS_NODE=1 timeout 60 "$BIN" -e '
require("https").get("https://www.gutenberg.org/", { headers: { "User-Agent": "Mozilla/5.0" } }, function (r) {
  console.log("status " + r.statusCode); r.resume();
}).on("error", function (e) { console.log("error " + (e.code || e.message)); });' 2>&1 | tail -n 1)"
case "$tls" in
  "status "*) ok "TLS to www.gutenberg.org works with Electron's own certificates ($tls)";;
  *CERT*|*SSL*|*UNABLE_TO*|*SELF_SIGNED*) bad "TLS to www.gutenberg.org failed: $tls";;
  *) note "TLS check skipped (no internet in the container?): $tls";;
esac

echo
echo "== Summary =="
printf '%s\n' "${RESULTS[@]}"
echo "Logs: $OUT"
[ $NFAIL -eq 0 ]
