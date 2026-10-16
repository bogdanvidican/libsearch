#!/usr/bin/env bash
# Installs or updates the Library Search app (step 6). Run it from the kit folder, without sudo.
#   bash 6-install-or-update-search-app.sh                         newest release from GitHub (needs internet)
#   bash 6-install-or-update-search-app.sh <file.tar.gz>           from a file, e.g. copied from a USB stick
#   bash 6-install-or-update-search-app.sh https://.../x.tar.gz    from a direct link
# The app can live anywhere; it doesn't have to be inside the library. It is installed into its own folder:
# the git checkout this script is in, the folder used last time, <kit>/library-search-app, or ~/library-search.
# Options:
#   --dir <folder>       install the app into this folder instead
#   --kit <folder>       also put the 6-* shortcuts into this "Ubuntu CF-30 Kit" folder (normally found automatically)
#   --pin / --no-pin     add the app to the sidebar (launcher) without asking / don't add it
#   --launcher           only (re)create the menu entry + sidebar icon, don't download anything
#   --remove-launcher    remove the menu entry and the sidebar icon (the app itself stays)
# Used by the app when it updates itself (src/server/update.ts):
#   --wait               if the app is open, wait for it to close (2 minutes) instead of stopping
#   --relaunch           start the app again afterwards - the new version, or the old one if the update failed
#   --relaunch-firefox   the same, but the simple version in Firefox
#   --status-file <f>    write the result there: "ok <version>", "busy" (app still open) or "failed <reason>"
# Settings (environment variables):
#   LIBRARY_SEARCH_REPO=owner/name   GitHub repo (default: the "origin" of library-search-app/, else bogdanvidican/libsearch)
#   GITHUB_TOKEN=...                 needed only if the repo is private
#   LIBRARY_SEARCH_ELECTRON=13       pick the fallback build made with an older Electron (file name ends in -e13)

usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; }
die() {
  printf '\n!! %s\n' "$1" >&2
  write_status "failed $(printf '%s' "$1" | head -n 1)"
  relaunch_app
  [ -t 0 ] && read -n 1 -s -r -p "Press any key to close."
  echo
  exit 1
}
write_status() { [ -n "$STATUS_FILE" ] && printf '%s\n' "$1" >"$STATUS_FILE" 2>/dev/null; return 0; }

# --relaunch: start the app again when done - the new version, or the old one when the update failed.
relaunch_app() {
  [ -n "$RELAUNCH" ] && [ -n "$APPDIR" ] || return 0
  local mode="$RELAUNCH" f launch=""
  RELAUNCH=""
  for f in ${DEST:+"$DEST/resources/app/kit/6-search-the-library.sh"} \
      "$APPDIR"/dist/library-search-linux-*/resources/app/kit/6-search-the-library.sh; do
    case "$f" in *.old/*) continue;; esac
    [ -f "$f" ] && { launch="$f"; break; }
  done
  [ -n "$launch" ] || return 0
  echo "Starting Library Search again: $launch"
  unset ELECTRON_RUN_AS_NODE
  if [ "$mode" = "firefox" ]; then nohup bash "$launch" --firefox </dev/null >/dev/null 2>&1 &
  else nohup bash "$launch" </dev/null >/dev/null 2>&1 &
  fi
}

# --- menu entry + sidebar icon (per user, no sudo) ------------------------------------------------------
# Ubuntu 16.04 (Unity) lists apps from ~/.local/share/applications/*.desktop; the sidebar ("launcher") is
# the gsettings list com.canonical.Unity.Launcher favorites. Newer Ubuntu (GNOME) uses org.gnome.shell favorite-apps.
DESKTOP_ID="library-search.desktop"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor"
ICON_PATH="$ICONS_DIR/256x256/apps/library-search.png"

find_icons() { # folder with the app's PNG icons (installed app first, then the repo checkout)
  local d
  for d in "$APPDIR"/dist/library-search-linux-*/resources/app/assets/icons "$APPDIR/assets/icons"; do
    [ -f "$d/256.png" ] && { printf '%s' "$d"; return 0; }
  done
  return 1
}

# Edits a gsettings string list with python3 (on every Ubuntu 16.04): add|remove <schema> <key> <entry>
favorites_edit() {
  local action="$1" schema="$2" key="$3" entry="$4" cur new
  cur="$(gsettings get "$schema" "$key" 2>/dev/null)" || return 1
  new="$(python3 -c '
import ast, sys
cur, entry, action = sys.argv[1].strip(), sys.argv[2], sys.argv[3]
if cur.startswith("@as "):
    cur = cur[4:]
items = [i for i in (ast.literal_eval(cur) if cur else []) if i != entry]
if action == "add":
    # Before Unity markers (running apps, trash, devices) so it sits with the other apps.
    at = next((n for n, i in enumerate(items) if i.startswith("unity://")), len(items))
    items.insert(at, entry)
print(str(items) if items else "@as []")
' "$cur" "$entry" "$action")" || return 1
  [ "$new" = "$cur" ] && return 0
  gsettings set "$schema" "$key" "$new" 2>/dev/null
}

has_schema() { gsettings list-schemas 2>/dev/null | grep -qx "$1"; }

sidebar() { # add|remove
  command -v gsettings >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 || return 1
  if has_schema com.canonical.Unity.Launcher; then
    favorites_edit "$1" com.canonical.Unity.Launcher favorites "application://$DESKTOP_ID"
  elif has_schema org.gnome.shell; then
    favorites_edit "$1" org.gnome.shell favorite-apps "$DESKTOP_ID"
  else
    return 1
  fi
}

# Quotes a path for an Exec= line (desktop entry spec: double quotes; % must be doubled).
exec_quote() {
  case "$1" in *'"'*|*'`'*|*'$'*|*'\'*) return 1;; esac
  printf '"%s"' "$(printf '%s' "$1" | sed 's/%/%%/g')"
}

install_launcher() {
  local icons size q
  icons="$(find_icons)" || { echo "!! No app icons found - install the app first."; return 1; }
  for size in 16 24 32 48 64 128 256 512; do
    [ -f "$icons/$size.png" ] || continue
    mkdir -p "$ICONS_DIR/${size}x${size}/apps" && cp -f "$icons/$size.png" "$ICONS_DIR/${size}x${size}/apps/library-search.png"
  done
  if [ -f "$icons/library-search.svg" ]; then
    mkdir -p "$ICONS_DIR/scalable/apps" && cp -f "$icons/library-search.svg" "$ICONS_DIR/scalable/apps/library-search.svg"
  fi
  local launch=""
  for f in "$APPDIR"/dist/library-search-linux-*/resources/app/kit/6-search-the-library.sh "$APPDIR/kit/6-search-the-library.sh"; do
    [ -f "$f" ] && { launch="$f"; break; }
  done
  [ -n "$launch" ] || { echo "!! The app isn't installed yet - nothing to put in the menu."; return 1; }
  q="$(exec_quote "$launch")" || {
    echo "!! The app folder path contains \" \` \$ or \\ - can't make a menu entry for it. Rename the folder."; return 1; }
  mkdir -p "$APPS_DIR"
  cat >"$APPS_DIR/.$DESKTOP_ID.tmp" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Library Search
GenericName=Offline library
Comment=Search all the books, Wikipedia, Khan Academy and Q&A sites - works without internet
Keywords=search;books;library;wikipedia;khan;medicine;offline;
Exec=bash $q
Icon=$ICON_PATH
Terminal=false
Categories=Education;
StartupNotify=true
StartupWMClass=Library Search
EOF
  chmod +x "$APPS_DIR/.$DESKTOP_ID.tmp" && mv -f "$APPS_DIR/.$DESKTOP_ID.tmp" "$APPS_DIR/$DESKTOP_ID"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$ICONS_DIR" >/dev/null 2>&1
  echo "Menu entry:     Library Search (search for it in the Dash / app menu)"

  local want="$PIN"
  if [ -z "$want" ]; then
    if [ -t 0 ]; then
      printf 'Add Library Search to the sidebar? [Y/n] '
      read -r ans
      case "$ans" in n|N|no|No) want=no;; *) want=yes;; esac
    else
      want=no
    fi
  fi
  if [ "$want" = "yes" ]; then
    if sidebar add; then echo "Sidebar:        added (drag it to move it; right-click -> Unlock from Launcher to remove)"
    else echo "Sidebar:        couldn't add it automatically - open the Dash, find Library Search, drag it to the sidebar"; fi
  fi
}

remove_launcher() {
  sidebar remove >/dev/null 2>&1
  rm -f "$APPS_DIR/$DESKTOP_ID"
  rm -f "$ICONS_DIR"/*/apps/library-search.png "$ICONS_DIR/scalable/apps/library-search.svg"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1
  echo "Removed the Library Search menu entry and sidebar icon. (The app itself is still installed.)"
}

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"

KIT=""
APPDIR_OPT=""
SRC=""
PIN=""           # yes | no | "" (ask)
MODE="install"   # install | launcher | remove-launcher
WAIT=""
RELAUNCH=""      # app | firefox | ""
STATUS_FILE=""
APPDIR=""
DEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --kit) KIT="$2"; shift 2;;
    --dir) APPDIR_OPT="$2"; shift 2;;
    --pin) PIN=yes; shift;;
    --no-pin) PIN=no; shift;;
    --launcher) MODE=launcher; shift;;
    --remove-launcher) MODE=remove-launcher; shift;;
    --wait) WAIT=1; shift;;
    --relaunch) RELAUNCH=app; shift;;
    --relaunch-firefox) RELAUNCH=firefox; shift;;
    --status-file) STATUS_FILE="$2"; shift 2;;
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

# The app's own folder: --dir, else where this script lives (inside the app, a git checkout, the folder used
# last time, or <kit>/library-search-app), else <kit>/library-search-app when run from a kit, else ~/library-search.
if [ -n "$APPDIR_OPT" ]; then APPDIR="$APPDIR_OPT"
elif APPDIR="$(find_app_home)"; then :
elif looks_like_kit "$PWD"; then APPDIR="$PWD/library-search-app"
else APPDIR="$HOME/library-search"; fi
mkdir -p "$APPDIR" 2>/dev/null || die "Can't create the app folder: $APPDIR"
APPDIR="$(cd "$APPDIR" && pwd)"

# Optional: the kit folder, so the 6-* shortcuts sit next to the other numbered scripts.
if [ -z "$KIT" ]; then
  if looks_like_kit "$(dirname "$APPDIR")"; then KIT="$(dirname "$APPDIR")"
  elif looks_like_kit "$SELF_DIR"; then KIT="$SELF_DIR"
  elif looks_like_kit "$PWD"; then KIT="$PWD"; fi
fi
if [ -n "$KIT" ]; then KIT="$(cd "$KIT" 2>/dev/null && pwd)" || die "Kit folder not found: $KIT"; fi

if [ "$MODE" = "remove-launcher" ]; then remove_launcher; exit 0; fi
if [ "$MODE" = "launcher" ]; then install_launcher; exit $?; fi

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

# Every process of the app (window, server, indexer) runs $DEST/library-search. pgrep -f takes a regular
# expression, so the path is escaped (folder names may contain "(", "+", "." ...).
APP_RE="$(printf '%s' "$DEST/library-search" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
app_running() { command -v pgrep >/dev/null 2>&1 && pgrep -f "$APP_RE" >/dev/null 2>&1; }
if [ -n "$WAIT" ] && app_running; then
  echo "Waiting for Library Search to close..."
  waited=0
  while app_running && [ "$waited" -lt "${LIBRARY_SEARCH_WAIT_SECONDS:-120}" ]; do sleep 1; waited=$((waited + 1)); done
fi
if app_running; then
  if [ -n "$WAIT" ]; then
    write_status busy
    echo "Library Search is open, so the update wasn't installed now. It is installed the next time the app closes."
    exit 2
  fi
  die "Library Search is running. Close it (and its Firefox version, if open), then run this again."
fi

# --- 3. swap in the new version (the old one stays as .old until everything worked) ---------------------
rm -rf "$DEST.old"
if [ -d "$DEST" ]; then mv "$DEST" "$DEST.old" || die "Couldn't move the old version out of the way"; fi
if ! mv "$NEW" "$DEST"; then
  [ -d "$DEST.old" ] && mv "$DEST.old" "$DEST"
  die "Couldn't put the new version in place; the old one was kept."
fi

# Remember where the app is, so the kit's shortcuts and the next update find it wherever it lives.
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/library-search"
mkdir -p "$CONF_DIR" 2>/dev/null && printf '%s\n' "$APPDIR" >"$CONF_DIR/app-home"

# --- 4. launchers into the kit folder (temp file + rename, so updating this very script is safe) --------
copied=0
for f in "$DEST/resources/app/kit"/6-*; do
  [ -n "$KIT" ] || break
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

# The kit's double-click launcher uses the app icon too, once it is installed.
echo
install_launcher || true
if [ -n "$KIT" ] && [ -f "$ICON_PATH" ] && [ -f "$KIT/6-search-the-library.desktop" ]; then
  sed -i "s|^Icon=.*|Icon=$ICON_PATH|" "$KIT/6-search-the-library.desktop" 2>/dev/null
fi

echo
echo "Library Search: $OLD_VER -> $NEW_VER"
echo "Installed in:   $DEST"
if [ -n "$KIT" ]; then echo "Launchers:      $copied file(s) copied to $KIT"; fi
echo
echo "Start it: click Library Search in the sidebar, or search for it in the Dash."
if [ -n "$KIT" ]; then
  echo "In the kit folder you can also double-click \"6 · Search the library\" or run:  bash 6-search-the-library.sh"
  echo "(First time double-clicking: right-click it -> Properties -> Permissions -> \"Allow executing file as program\".)"
fi
echo "The first time, the app asks where your library is if it isn't next to the app."
if [ "$OLD_VER" = "not installed" ]; then
  echo "On first start the app offers to build the book index (about an hour on the CF-30)."
fi
echo "Later versions install themselves when the computer is online (Library -> Updates in the app)."
write_status "ok $NEW_VER"
relaunch_app
exit 0
