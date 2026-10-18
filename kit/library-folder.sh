#!/usr/bin/env bash
# Sourced by the download scripts 2-5 (does nothing on its own). The scripts live inside the app; what they
# download goes in the library folder, which must be outside the app so deleting or reinstalling the app keeps it.
#   pick_library "$@"   sets LIBRARY (absolute) and LIBRARY_SHIFT (1 when the first argument was the folder, else 0)
# The library folder is the first argument when that is an existing folder, else the current folder when it
# already holds numbered topic folders ("01 Medicine", "15 Offline Encyclopedias (Kiwix)"). A first argument with
# a "/" that is no folder stops it (a typo must not send the downloads elsewhere). Needs KIT_DIR.

# The app's folder: the one holding dist/ (installed app) or the git checkout. Unknown layout: the kit folder itself.
app_home() {
  local kit
  kit="$(cd "$KIT_DIR" 2>/dev/null && pwd -P)" || return 1
  case "$kit" in
    */dist/library-search-*/resources/app/kit|*/dist/library-search-*/Resources/app/kit)
      printf '%s\n' "${kit%%/dist/library-search-*}"; return 0;;
  esac
  if grep -q '"name": "library-search"' "$kit/../package.json" 2>/dev/null; then (cd "$kit/.." && pwd -P); return 0; fi
  printf '%s\n' "$kit"
}

pick_library() {
  local lib home
  LIBRARY=""
  LIBRARY_SHIFT=0
  if [ -n "$1" ] && [ -d "$1" ]; then
    lib="$1"; LIBRARY_SHIFT=1
  elif [ "${1#*/}" != "$1" ]; then  # has a "/", so it was meant as a folder - but there is none (a typo?)
    echo "!! There is no folder \"$1\". Check the name, or start this inside your library folder without naming it."
    return 1
  elif ls -d [0-9][0-9]\ */ >/dev/null 2>&1; then
    lib="."
  else
    echo "!! Which folder is your library? Start this inside it, or name it:"
    echo "   bash \"$KIT_DIR/$(basename "$0")\" \"/path/to/your library\""
    echo "(The library folder holds the topic folders like \"01 Medicine\". A new, empty folder is fine too - name it.)"
    return 1
  fi
  lib="$(cd "$lib" && pwd -P)" || return 1
  home="$(app_home)"
  if [ -n "$home" ]; then
    case "$lib/" in
      "$home"/*)
        echo "!! \"$lib\" is inside the app's folder ($home). Books kept there would be lost when the app is deleted or reinstalled. Name a library folder outside the app."
        return 1;;
    esac
  fi
  LIBRARY="$lib"
}
