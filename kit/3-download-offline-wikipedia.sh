#!/usr/bin/env bash
# OPTIONAL: offline encyclopedias (Kiwix .zim files) + the kiwix-serve reader for Ubuntu 16.04.
# Run:  bash 3-download-offline-wikipedia.sh      Then read them with:  bash 5-start-offline-library-in-firefox.sh
# Put a # in front of any "get" line you don't want. Re-run to resume interrupted downloads.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
DIR="15 Offline Encyclopedias (Kiwix)"; mkdir -p "$DIR"
MIRROR="https://download.kiwix.org/zim"
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
  T=$(curl -sL https://download.kiwix.org/release/kiwix-tools/ | grep -oE "kiwix-tools_linux-${ARCH}-[0-9.]+\.tar\.gz" | sort -uV | tail -1)
  [ -z "$T" ] && T="kiwix-tools_linux-${ARCH}-3.7.0.tar.gz"   # last version confirmed to have a 32-bit (i586) build
  echo "-> reader: $T"
  if curl -L --fail -o "$DIR/kiwix-tools.tar.gz" "https://download.kiwix.org/release/kiwix-tools/$T"; then
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

get wikipedia      wikipedia_en_medicine_maxi_            2   # WikiMed
get other          appropedia_en_all_maxi_                1   # appropriate technology
get ifixit         ifixit_en_all_                         3   # repair guides
get wikibooks      wikibooks_en_all_maxi_                 6   # how-to books
get wikipedia      wikipedia_ro_all_maxi_                 9   # Romanian Wikipedia
get wikipedia      wikipedia_en_top1m_maxi_              46   # English Wikipedia, top 1M articles
get stack_exchange diy.stackexchange.com_en_all_          2
get stack_exchange gardening.stackexchange.com_en_all_    1
get stack_exchange electronics.stackexchange.com_en_all_  4
get stack_exchange mechanics.stackexchange.com_en_all_    1
get stack_exchange cooking.stackexchange.com_en_all_      1
get stack_exchange woodworking.stackexchange.com_en_all_  1
get stack_exchange homebrew.stackexchange.com_en_all_     1
get stack_exchange outdoors.stackexchange.com_en_all_     1
get stack_exchange ham.stackexchange.com_en_all_          1
get stack_exchange unix.stackexchange.com_en_all_         2
get stack_exchange askubuntu.com_en_all_                  3   # Ask Ubuntu
get stack_exchange superuser.com_en_all_                  4   # Super User (PC + Linux troubleshooting)
get phet           phet_en_all_                           1   # science simulations
get libretexts     libretexts.org_en_k12_                 1   # K-12 textbooks
# get wikipedia    wikipedia_en_all_maxi_               119   # ALL English Wikipedia with images
# Khan Academy (168 GB): use  bash 4-download-khan-academy.sh  instead (better resume + checks)

echo; echo "Done. To read: bash 5-start-offline-library-in-firefox.sh"
read -n 1 -s -r -p "Press any key to close."; echo
