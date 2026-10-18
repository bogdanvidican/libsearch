#!/usr/bin/env bash
# Khan Academy (English, all subjects, ~168 GB) for offline use in Firefox via kiwix-serve - Ubuntu 16.04+.
# Run it inside your library folder, or name the folder:  bash 4-download-khan-academy.sh "/path/to/your library"
# Read it in the Library Search app, or with:  bash 5-start-offline-library-in-firefox.sh
# Safe to stop (Ctrl+C) and re-run: the download resumes where it left off.
KIT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
. "$KIT_DIR/library-folder.sh" && pick_library "$@" || exit 1
shift "$LIBRARY_SHIFT"; cd "$LIBRARY" || exit 1
DIR="15 Offline Encyclopedias (Kiwix)"; mkdir -p "$DIR"
LANGCODE="${1:-en}"     # optional, after the folder: bash 4-download-khan-academy.sh es   (Spanish 150 GB, French 94 GB)
KIWIX="${LIBRARY_KIT_MIRROR:-https://download.kiwix.org}"   # a local server in the app's tests
MIRROR="$KIWIX/zim/other"
command -v curl >/dev/null || { echo "Install curl first:  sudo apt-get install curl"; exit 1; }

# 1) Drive checks
fstype=$(stat -f -c %T "$DIR")
case "$fstype" in msdos|vfat)
  echo "!! This drive is FAT32 and can't hold a 168 GB file."
  echo "   Use an ext4, exFAT or NTFS drive (exFAT on 16.04: sudo apt-get install exfat-fuse exfat-utils)."
  exit 1;; esac

FILE=$(curl -sL "$MIRROR/" | grep -oE "khanacademy_${LANGCODE}_all_[0-9-]+\.zim" | sort -u | tail -1)
[ -z "$FILE" ] && { echo "!! Couldn't find the Khan Academy file on $MIRROR (internet or certificate problem?"
                    echo "   If certificates: sudo bash \"$KIT_DIR/1-fix-https-certificates.sh\")"; exit 1; }
OUT="$DIR/$FILE"
TOTAL=$(curl -sIL "$MIRROR/$FILE" | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v+0}')
HAVE=$( [ -f "$OUT" ] && stat -c %s "$OUT" || echo 0 )
NEED_MB=$(( (TOTAL - HAVE) / 1048576 ))
FREE_MB=$(df -Pm "$DIR" | awk 'NR==2{print $4}')
echo "File: $FILE   size: $((TOTAL/1073741824)) GB   already have: $((HAVE/1073741824)) GB"
echo "Still needed: $((NEED_MB/1024)) GB   free on this drive: $((FREE_MB/1024)) GB"
if [ "$TOTAL" -gt 0 ] && [ "$FREE_MB" -lt "$NEED_MB" ]; then echo "!! Not enough space on this drive."; exit 1; fi

# 2) The reader (kiwix-serve, static build that runs on old Ubuntu)
case "$(uname -m)" in x86_64) ARCH=x86_64;; i?86) ARCH=i586;; aarch64) ARCH=aarch64;; armv7l|armv6l) ARCH=armhf;; *) ARCH=x86_64;; esac
if [ ! -x "$DIR/kiwix-tools/kiwix-serve" ]; then
  T=$(curl -sL "$KIWIX/release/kiwix-tools/" | grep -oE "kiwix-tools_linux-${ARCH}-[0-9.]+\.tar\.gz" | sort -uV | tail -1)
  [ -z "$T" ] && T="kiwix-tools_linux-${ARCH}-3.7.0.tar.gz"   # last version confirmed to have a 32-bit (i586) build
  echo "-> reader: $T"
  curl -L --fail -o "$DIR/kiwix-tools.tar.gz" "$KIWIX/release/kiwix-tools/$T" \
   && mkdir -p "$DIR/kiwix-tools" && tar -xzf "$DIR/kiwix-tools.tar.gz" -C "$DIR/kiwix-tools" --strip-components=1 \
   && rm -f "$DIR/kiwix-tools.tar.gz" || echo "!! could not get kiwix-serve (re-run later)"
fi

# 3) Download with automatic resume. Stalled connections (<10 KB/s for 2 min) are restarted.
try=0
while :; do
  HAVE=$( [ -f "$OUT" ] && stat -c %s "$OUT" || echo 0 )
  if [ "$TOTAL" -gt 0 ] && [ "$HAVE" -ge "$TOTAL" ]; then echo "Download complete: $OUT"; break; fi
  try=$((try+1)); [ $try -gt 200 ] && { echo "!! Gave up after 200 attempts - re-run to continue."; exit 1; }
  echo "== attempt $try ($(date +%H:%M)) - resuming at $((HAVE/1073741824)) GB"
  curl -L --fail -C - --speed-limit 10240 --speed-time 120 --connect-timeout 30 -o "$OUT" "$MIRROR/$FILE"
  rc=$?
  [ $rc -eq 0 ] && [ "$TOTAL" -eq 0 ] && break
  [ $rc -ne 0 ] && sleep 20
done

# 4) Sanity check: a valid ZIM file starts with the bytes 5A 49 4D 04
if [ "$(head -c 4 "$OUT" | od -An -tx1 | tr -d ' \n')" = "5a494d04" ]; then
  echo "File looks valid. Open it in the Library Search app, or:  bash \"$KIT_DIR/5-start-offline-library-in-firefox.sh\" \"$LIBRARY\""
else
  echo "!! The file doesn't look like a ZIM file - delete it and re-run."
fi
read -n 1 -s -r -p "Press any key to close."; echo
