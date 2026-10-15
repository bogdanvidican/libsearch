#!/usr/bin/env bash
# Tests the linux-ia32 build in an i386 Ubuntu 16.04 container - the closest stand-in for the CF-30 on a Mac.
#   bash scripts/docker-ia32-test.sh               package first if dist/ has no build, then test
#   bash scripts/docker-ia32-test.sh --repackage   always re-package first
# Results and logs: dist/docker-ia32/
# Under QEMU (Apple Silicon) everything is slow; the GUI step is informational only.
cd "$(dirname "$0")/.." || exit 1
APPDIR="$PWD"
IMAGE=library-search-xenial-i386
BIN="dist/library-search-linux-ia32/library-search"

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed/running."; exit 1; }
if [ "$1" = "--repackage" ] || [ ! -x "$BIN" ]; then
  node scripts/package.mjs --platform linux --arch ia32 || exit 1
fi

echo "Building $IMAGE (first time takes a few minutes)..."
docker build --platform linux/386 -q -t "$IMAGE" -f scripts/docker/Dockerfile.xenial-i386 scripts/docker >/dev/null || {
  echo "docker build failed"; exit 1; }

OUT="$APPDIR/dist/docker-ia32"
rm -rf "$OUT" && mkdir -p "$OUT" && chmod 777 "$OUT"

# Build the fixture index on the host with the packaged indexer: QEMU can't run pdftotext from Electron's Node,
# and this also checks that an index made on the Mac works on the ia32 build.
IDX="dist/library-search-linux-ia32/resources/app/build/indexer/indexer.js"
if [ -d tests/fixtures/library ] && [ -f "$IDX" ] && [ "$(wc -c <"$IDX")" -gt 2000 ] && command -v pdftotext >/dev/null 2>&1; then
  cp -R tests/fixtures/library "$OUT/host-lib"
  if node "$IDX" --library-root "$OUT/host-lib" --data-dir "$OUT/host-data" --json >"$OUT/host-indexer.log" 2>&1; then
    echo "host index built: $(grep '"type":"progress"' "$OUT/host-indexer.log" | tail -n 1 | cut -c1-160)"
  else
    echo "host indexer failed (see $OUT/host-indexer.log)"; rm -rf "$OUT/host-data"
  fi
  chmod -R a+rwX "$OUT"
else
  echo "host index skipped (no fixtures, placeholder indexer or no pdftotext)"
fi
# On an x86_64 host (Linux CI, Intel Mac) i386 code runs natively: no QEMU limits, so every step is strict.
NATIVE=""
case "$(uname -m)" in x86_64|amd64) NATIVE=1;; esac
[ -n "$NATIVE" ] && echo "x86_64 host: running natively (indexer + GUI steps are strict)"
docker run --rm --platform linux/386 --shm-size=1g -e NATIVE="$NATIVE" \
  --mount "type=bind,source=$APPDIR,target=/w,readonly" \
  --mount "type=bind,source=$OUT,target=/out" \
  "$IMAGE" bash /w/scripts/docker/in-container-test.sh
rc=$?
echo
[ $rc -eq 0 ] && echo "docker ia32 test: PASS" || echo "docker ia32 test: FAIL (see $OUT)"
exit $rc
