#!/usr/bin/env bash
# OPTIONAL: offline encyclopedias (Kiwix .zim files) + the kiwix-serve reader for Ubuntu 16.04.
# Run it inside your library folder, or name the folder:  bash 3-download-offline-wikipedia.sh "/path/to/your library"
# Then read them in the Library Search app, or with:  bash 5-start-offline-library-in-firefox.sh
# It downloads the encyclopedias marked "yes" in booklists/encyclopedias.txt (the app lets you pick others).
# Re-run to resume interrupted downloads.
KIT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
. "$KIT_DIR/library-folder.sh" && pick_library "$@" || exit 1
shift "$LIBRARY_SHIFT"; cd "$LIBRARY" || exit 1
DIR="15 Offline Encyclopedias (Kiwix)"; mkdir -p "$DIR"
KIWIX="${LIBRARY_KIT_MIRROR:-https://download.kiwix.org}"   # a local server in the app's tests
MIRROR="$KIWIX/zim"
command -v curl >/dev/null || { echo "Install curl first:  sudo apt-get install curl"; exit 1; }

# FAT32 USB sticks cannot hold files over 4 GB (Wikipedia is 46 GB). Warn early.
fstype=$(stat -f -c %T "$DIR")
if [ "$fstype" = "msdos" ] || [ "$fstype" = "vfat" ]; then
  echo "!! This drive is FAT32: files over 4 GB will fail. Reformat it as ext4 or exFAT, or the big files will be skipped."
  FAT=1
fi
echo "Free space here: $(df -Ph "$DIR" | awk 'NR==2{print $4}')  (everything enabled below needs about 80 GB)"

# 1) The reader: kiwix-tools is a static build, so it runs on old Ubuntu.
case "$(uname -m)" in x86_64) ARCH=x86_64;; i?86) ARCH=i586;; aarch64) ARCH=aarch64;; armv7l|armv6l) ARCH=armhf;; *) ARCH=x86_64;; esac
if [ ! -x "$DIR/kiwix-tools/kiwix-serve" ]; then
  T=$(curl -sL "$KIWIX/release/kiwix-tools/" | grep -oE "kiwix-tools_linux-${ARCH}-[0-9.]+\.tar\.gz" | sort -uV | tail -1)
  [ -z "$T" ] && T="kiwix-tools_linux-${ARCH}-3.7.0.tar.gz"   # last version confirmed to have a 32-bit (i586) build
  echo "-> reader: $T"
  if curl -L --fail -o "$DIR/kiwix-tools.tar.gz" "$KIWIX/release/kiwix-tools/$T"; then
    mkdir -p "$DIR/kiwix-tools" && tar -xzf "$DIR/kiwix-tools.tar.gz" -C "$DIR/kiwix-tools" --strip-components=1 && rm -f "$DIR/kiwix-tools.tar.gz"
  else echo "!! could not download kiwix-tools"; fi
fi

# 2) The content. get <folder> <filename-prefix> <approx GB>  (picks the newest matching file)
get() {
  local f
  if [ -n "$FAT" ] && [ "$3" -ge 4 ]; then echo "-- skipping $2 (over 4 GB, FAT32 drive)"; return; fi
  f=$(curl -sL "$MIRROR/$1/" | grep -oE "$2[0-9-]+\.zim" | sort -u | tail -1)
  if [ -z "$f" ]; then echo "!! nothing found for $2"; return; fi
  echo "-> $f (~$3 GB)"
  curl -L --fail --retry 5 -C - -o "$DIR/$f" "$MIRROR/$1/$f" || echo "!! failed $f (re-run to resume)"
}

# Which ones: the "yes" lines of booklists/encyclopedias.txt (it comes with the app, next to this script):
#   Z|<mirror folder>|<file name prefix>|<about GB>|yes|<title>
# To choose others, use the app: Library -> Get books -> Encyclopedias.
LIST="$KIT_DIR/booklists/encyclopedias.txt"
[ -f "$LIST" ] || { echo "!! $LIST is missing - install the app again."; exit 1; }
while IFS='|' read -r t dir prefix gb on title; do
  [ "$t" = "Z" ] && [ "$on" = "yes" ] || continue
  echo "== $title"
  get "$dir" "$prefix" "$gb" </dev/null
done < <(sed $'1s/^\xef\xbb\xbf//' "$LIST" | tr -d '\r' | grep -v '^#')
# Khan Academy (168 GB): use  bash 4-download-khan-academy.sh  instead (better resume + checks)

echo; echo "Done. To read: bash \"$KIT_DIR/5-start-offline-library-in-firefox.sh\" \"$LIBRARY\""
read -n 1 -s -r -p "Press any key to close."; echo
