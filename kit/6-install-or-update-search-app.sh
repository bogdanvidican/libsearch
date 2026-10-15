#!/usr/bin/env bash
# Installs or updates the Library Search app (step 6). Run it from the kit folder, without sudo.
#   bash 6-install-or-update-search-app.sh                         newest release from GitHub (needs internet)
#   bash 6-install-or-update-search-app.sh <file.tar.gz>           from a file, e.g. copied from a USB stick
#   bash 6-install-or-update-search-app.sh https://.../x.tar.gz    from a direct link
# Options:
#   --kit <folder>       the "Ubuntu CF-30 Kit" folder (normally found automatically)
# Settings (environment variables):
#   LIBRARY_SEARCH_REPO=owner/name   GitHub repo (default: the "origin" of library-search-app/, else bogdanvidican/libsearch)
#   GITHUB_TOKEN=...                 needed only if the repo is private
#   LIBRARY_SEARCH_ELECTRON=13       pick the fallback build made with an older Electron (file name ends in -e13)

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }
die() { printf '\n!! %s\n' "$1" >&2; [ -t 0 ] && read -n 1 -s -r -p "Press any key to close."; echo; exit 1; }

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"

KIT=""
SRC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --kit) KIT="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) SRC="$1"; shift;;
  esac
done

if [ "$(id -u)" = "0" ]; then
  die "Please run this without sudo:  bash 6-install-or-update-search-app.sh
(Files installed by root can't be updated by the app later.)"
fi

looks_like_kit() {
  [ -f "$1/0-README-start-here.md" ] || [ -f "$1/booklist-main.txt" ] || \
  [ -f "$1/5-start-offline-library-in-firefox.sh" ] || [ -d "$1/library-search-app" ]
}
if [ -z "$KIT" ]; then
  d="$SELF_DIR"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ "$(basename "$d")" = "library-search-app" ]; then KIT="$(dirname "$d")"; break; fi
    d="$(dirname "$d")"
  done
fi
[ -z "$KIT" ] && looks_like_kit "$SELF_DIR" && KIT="$SELF_DIR"
[ -z "$KIT" ] && looks_like_kit "$PWD" && KIT="$PWD"
[ -z "$KIT" ] && die "Can't find the kit folder. Open a terminal in the 'Ubuntu CF-30 Kit' folder and run this there,
or add:  --kit \"/path/to/Ubuntu CF-30 Kit\""
[ -d "$KIT" ] || die "Kit folder not found: $KIT"
KIT="$(cd "$KIT" && pwd)"
APPDIR="$KIT/library-search-app"

# Resolve a relative file argument before anything else changes.
if [ -n "$SRC" ] && [ -f "$SRC" ]; then SRC="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"; fi

case "$(uname -m)" in i?86) ARCH=ia32;; x86_64) ARCH=x64;; *) ARCH=ia32;; esac
ARCH="${LIBRARY_SEARCH_ARCH:-$ARCH}"
if [ "$ARCH" = "x64" ] && [ -z "$LIBRARY_SEARCH_ARCH" ]; then ARCH=ia32; fi  # only 32-bit builds are published
SUFFIX=""
[ -n "$LIBRARY_SEARCH_ELECTRON" ] && SUFFIX="-e$LIBRARY_SEARCH_ELECTRON"
ASSET_RE="library-search-linux-$ARCH-v[0-9][0-9.]*$SUFFIX\\.tar\\.gz\$"

mkdir -p "$APPDIR/dist" || die "Can't create $APPDIR/dist (is the disk read-only or full?)"
WORK="$APPDIR/dist/.install-$$"
rm -rf "$WORK"
mkdir -p "$WORK/x" || die "Can't write to $APPDIR/dist"
trap 'rm -rf "$WORK"' EXIT

sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

download() { # url, output, [extra curl args...]
  local url="$1" out="$2"; shift 2
  echo "Downloading $url"
  if ! curl -fL --retry 3 --progress-bar "$@" -o "$out" "$url"; then
    die "Download failed. Check the internet connection. If it mentions certificates, run once:
    sudo bash 1-fix-https-certificates.sh
Or copy the .tar.gz on a USB stick and run:  bash 6-install-or-update-search-app.sh <file.tar.gz>"
  fi
}

# --- 1. get the release file --------------------------------------------------------------------------
TARBALL="$WORK/release.tar.gz"
if [ -n "$SRC" ] && [ -f "$SRC" ]; then
  echo "Installing from file: $SRC"
  if [ -f "$SRC.sha256" ]; then
    want="$(awk '{print $1}' "$SRC.sha256")"
    have="$(sha256_of "$SRC")"
    [ "$want" = "$have" ] || die "The file is damaged (checksum doesn't match $SRC.sha256). Copy it again."
    echo "Checksum OK"
  fi
  TARBALL="$SRC"
elif [ -n "$SRC" ]; then
  case "$SRC" in
    http://*|https://*) download "$SRC" "$TARBALL";;
    *) die "No such file: $SRC";;
  esac
else
  command -v curl >/dev/null 2>&1 || die "curl is missing:  sudo apt-get install curl"
  REPO="$LIBRARY_SEARCH_REPO"
  if [ -z "$REPO" ] && command -v git >/dev/null 2>&1 && [ -d "$APPDIR/.git" ]; then
    url="$(git -C "$APPDIR" config --get remote.origin.url 2>/dev/null)"
    REPO="$(printf '%s\n' "$url" | sed -n 's#^.*github\.com[:/]\{1,\}\([^/]*/[^/]*\)$#\1#p' | sed 's#\.git$##')"
  fi
  [ -n "$REPO" ] || REPO="bogdanvidican/libsearch"
  [ -n "$REPO" ] || die "Don't know which GitHub repo to download from. Either:
  - give the file:     bash 6-install-or-update-search-app.sh library-search-linux-ia32-vX.Y.Z.tar.gz
  - or name the repo:  LIBRARY_SEARCH_REPO=owner/library-search-app bash 6-install-or-update-search-app.sh"

  echo "Looking for the newest release of $REPO ..."
  AUTH_HEADER=""
  [ -n "$GITHUB_TOKEN" ] && AUTH_HEADER="Authorization: token $GITHUB_TOKEN"
  if [ -n "$AUTH_HEADER" ]; then
    curl -fsSL -H "$AUTH_HEADER" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/releases/latest" -o "$WORK/release.json"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/releases/latest" -o "$WORK/release.json"
  fi || die "Couldn't read the release list from GitHub ($REPO).
If the repo is private: GITHUB_TOKEN=<token> bash 6-install-or-update-search-app.sh
If it mentions certificates, run once:  sudo bash 1-fix-https-certificates.sh"

  # api_url <TAB> browser_url <TAB> name   (python3 is on every Ubuntu 16.04; grep fallback for public repos)
  if command -v python3 >/dev/null 2>&1; then
    ASSET="$(python3 -c '
import json, re, sys
pat = re.compile(sys.argv[1])
with open(sys.argv[2], encoding="utf-8") as f:
    data = json.load(f)
for a in data.get("assets", []):
    if pat.search(a.get("name", "")):
        print(a["url"] + "\t" + a["browser_download_url"] + "\t" + a["name"])
        break
' "$ASSET_RE" "$WORK/release.json")"
  else
    b="$(tr ',' '\n' <"$WORK/release.json" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(http[^"]*\)"$/\1/' | grep -E "$ASSET_RE" | head -1)"
    [ -n "$b" ] && ASSET="$(printf '\t%s\t%s' "$b" "$(basename "$b")")"
  fi
  [ -n "$ASSET" ] || die "The newest release of $REPO has no file matching $ASSET_RE"
  API_URL="$(printf '%s' "$ASSET" | cut -f1)"
  WEB_URL="$(printf '%s' "$ASSET" | cut -f2)"
  echo "Found $(printf '%s' "$ASSET" | cut -f3)"
  if [ -n "$AUTH_HEADER" ] && [ -n "$API_URL" ]; then
    # Private repo: ask the API for a signed download link, then fetch it without the token
    # (curl 7.47 would send the token to the storage server, which rejects it).
    signed="$(curl -sS -o /dev/null -w '%{redirect_url}' -H "$AUTH_HEADER" -H "Accept: application/octet-stream" "$API_URL")"
    [ -n "$signed" ] || die "GitHub didn't give a download link (is GITHUB_TOKEN allowed to read $REPO?)"
    download "$signed" "$TARBALL"
  else
    download "$WEB_URL" "$TARBALL"
  fi
fi

# --- 2. check and unpack -----------------------------------------------------------------------------
gzip -t "$TARBALL" 2>/dev/null || die "The file is not a valid .tar.gz (incomplete download or wrong file): $TARBALL"
TOP="$(tar -tzf "$TARBALL" 2>/dev/null | head -n 1 | cut -d/ -f1)"
case "$TOP" in
  library-search-linux-*) ;;
  *) die "This doesn't look like a Library Search release (top folder: '$TOP')";;
esac
echo "Unpacking..."
tar -xzf "$TARBALL" -C "$WORK/x" || die "Unpacking failed (disk full?)"
NEW="$WORK/x/$TOP"
[ -f "$NEW/library-search" ] || die "The release is missing the program file (library-search)"
chmod +x "$NEW/library-search" 2>/dev/null
[ -f "$NEW/chrome-sandbox" ] && chmod +x "$NEW/chrome-sandbox"
[ -f "$NEW/chrome_crashpad_handler" ] && chmod +x "$NEW/chrome_crashpad_handler"
NEW_VER="$(cat "$NEW/app-version.txt" 2>/dev/null || echo '?')"

DEST="$APPDIR/dist/$TOP"
OLD_VER="not installed"
[ -f "$DEST/app-version.txt" ] && OLD_VER="$(cat "$DEST/app-version.txt")"

if command -v pgrep >/dev/null 2>&1 && pgrep -f "$DEST/library-search" >/dev/null 2>&1; then
  die "Library Search is running. Close it (and its Firefox version, if open), then run this again."
fi

# --- 3. swap in the new version (the old one stays as .old until everything worked) ---------------------
rm -rf "$DEST.old"
if [ -d "$DEST" ]; then mv "$DEST" "$DEST.old" || die "Couldn't move the old version out of the way"; fi
if ! mv "$NEW" "$DEST"; then
  [ -d "$DEST.old" ] && mv "$DEST.old" "$DEST"
  die "Couldn't put the new version in place; the old one was kept."
fi

# --- 4. launchers into the kit folder (temp file + rename, so updating this very script is safe) --------
copied=0
for f in "$DEST/resources/app/kit"/6-*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  tmp="$KIT/.$name.tmp.$$"
  if cp "$f" "$tmp" && chmod +x "$tmp" && mv -f "$tmp" "$KIT/$name"; then
    copied=$((copied + 1))
  else
    rm -f "$tmp"
    echo "!! couldn't copy $name to $KIT"
  fi
done
rm -rf "$DEST.old"

echo
echo "Library Search: $OLD_VER -> $NEW_VER"
echo "Installed in:   $DEST"
echo "Launchers:      $copied file(s) copied to $KIT"
echo
echo "Start it: double-click \"6 · Search the library\" or run:  bash 6-search-the-library.sh"
echo "(First time double-clicking: right-click it -> Properties -> Permissions -> \"Allow executing file as program\".)"
if [ "$OLD_VER" = "not installed" ]; then
  echo "On first start the app offers to build the book index (about an hour on the CF-30)."
fi
exit 0
