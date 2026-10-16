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

echo
echo "== Summary =="
printf '%s\n' "${RESULTS[@]}"
echo "Logs: $OUT"
[ $NFAIL -eq 0 ]
