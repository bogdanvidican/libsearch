#!/usr/bin/env bash
# Community Rebuild Library downloader - Ubuntu 16.04+ version.
# Run from a terminal:   bash 2-download-pdf-books.sh
# Safe to re-run: finished files are skipped, partial ones resume.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
UA="Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0"
LOG="2-download-log.txt"; FAILED="2-failed-downloads.txt"

# ---- preflight ---------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is missing. Install it with:  sudo apt-get install curl"; exit 1
fi
[ -f booklist-main.txt ] || { echo "booklist-main.txt not found next to this script."; exit 1; }
curl -sS -o /dev/null --connect-timeout 20 -A "$UA" https://www.gutenberg.org/ 2>/tmp/crl_test.$$; rc=$?
if [ $rc -eq 60 ] || [ $rc -eq 35 ] || [ $rc -eq 77 ]; then
  echo "!! This computer's security certificates are too old to open modern HTTPS sites (curl error $rc)."
  echo "   Run once:   sudo bash 1-fix-https-certificates.sh   then start this script again."
  rm -f /tmp/crl_test.$$; exit 1
elif [ $rc -ne 0 ]; then
  echo "!! Can't reach the internet (curl error $rc): $(cat /tmp/crl_test.$$)"; rm -f /tmp/crl_test.$$; exit 1
fi
rm -f /tmp/crl_test.$$
free_mb=$(df -Pm . | awk 'NR==2{print $4}')
echo "Free space here: ${free_mb} MB (the PDF library needs about 2000 MB)."
[ "$free_mb" -lt 2500 ] && echo "!! Low on space - downloads may stop part way."

: > "$FAILED"; echo "=== Run $(date) ===" >> "$LOG"
ok=0; bad=0; skip=0

valid() { # file -> 0 if its content matches its extension (sites with bot checks return HTML or nothing)
  local f="$1" head
  [ -s "$f" ] || return 1
  head=$(head -c 1024 "$f" | tr -d '\0')
  case "$f" in
    *.pdf|*.PDF|*.pdf.part|*.PDF.part) printf '%s' "$head" | grep -q '%PDF' ;;
    *.epub|*.epub.part) [ "$(head -c 2 "$f")" = "PK" ] ;;
    *) printf '%s' "$head" | grep -qiv '<html' ;;
  esac
}

fetch() { # folder filename url
  local dir="$1" name="$2" url="$3" out="$1/$2"
  mkdir -p "$dir"
  if [ -f "$out" ] && [ ! -f "$out.part" ] && valid "$out"; then skip=$((skip+1)); return; fi
  [ -f "$out" ] && mv -f "$out" "$out.bad"            # earlier empty/HTML download - set aside
  echo "-> $out"
  if { curl -sS -L --fail --retry 3 --retry-delay 3 --connect-timeout 30 -A "$UA" -C - -o "$out.part" "$url" 2>>"$LOG" \
       || curl -sS -L --fail --retry 2 --connect-timeout 30 -A "$UA" -o "$out.part" "$url" 2>>"$LOG"; } \
     && valid "$out.part"; then
    mv "$out.part" "$out"; rm -f "$out.bad"; ok=$((ok+1))
  else
    rm -f "$out.part" "$out.bad"; bad=$((bad+1))
    printf '%s|%s|%s\n' "$dir" "$name" "$url" >> "$FAILED"; echo "   FAILED (will be listed for Firefox)"
  fi
}

resolve() { # page link -> absolute url
  local page="$1" l="$2" origin base
  l=$(printf '%s' "$l" | sed -e 's/&amp;/\&/g' -e 's/ /%20/g')
  origin=$(printf '%s' "$page" | sed -E 's#^(https?://[^/]+).*#\1#')
  base=$(printf '%s' "$page" | sed -E 's#[^/]*$##')
  case "$l" in
    http*) echo "$l";; //*) echo "https:$l";; /*) echo "$origin$l";; *) echo "$base$l";;
  esac
}

scrape() { # folder page regex
  local dir="$1" page="$2" re="$3" html links
  echo "== Scanning $page"
  html=$(curl -sL --connect-timeout 30 -A "$UA" "$page") || { printf '%s|(page)|%s\n' "$dir" "$page" >> "$FAILED"; bad=$((bad+1)); return; }
  links=$(printf '%s' "$html" | grep -oE "$re" | sed -E 's/^href="//; s/"$//' | sort -u)
  if [ -z "$links" ]; then printf '%s|(page)|%s\n' "$dir" "$page" >> "$FAILED"; bad=$((bad+1)); return; fi
  while IFS= read -r l; do
    u=$(resolve "$page" "$l")
    n=$(printf '%s' "$u" | sed -E 's/[?#].*$//; s#.*/##; s/%20/_/g')
    case "$n" in *.pdf|*.PDF) ;; *) n="$n.pdf";; esac
    sub="$dir"; parent=$(printf '%s' "$u" | sed -E 's/[?#].*$//; s#/[^/]*$##; s#.*/##')
    case "$page" in *hesperian*) sub="$dir/$parent";; esac
    fetch "$sub" "$n" "$u"
  done <<< "$links"
}

archive_item() { # folder identifier
  local dir="$1" id="$2" files
  echo "== archive.org: $id"
  files=$(curl -sL -A "$UA" "https://archive.org/metadata/$id" | grep -oE '"name":"[^"]*\.pdf"' | sed -E 's/"name":"//; s/"$//' | grep -vE '_text\.pdf$')
  [ -z "$files" ] && { printf '%s|(page)|https://archive.org/details/%s\n' "$dir" "$id" >> "$FAILED"; bad=$((bad+1)); return; }
  while IFS= read -r f; do
    fetch "$dir" "$(basename "$f")" "https://archive.org/download/$id/$(printf '%s' "$f" | sed 's/ /%20/g')"
  done <<< "$files"
}

while IFS='|' read -r t a b c; do
  case "$t" in
    F) fetch "$a" "$b" "$c";;
    S) scrape "$a" "$b" "$c";;
    A) archive_item "$a" "$b";;
  esac
done < <(cat booklist-main.txt $( [ -f booklist-linux.txt ] && echo booklist-linux.txt ) | grep -v '^#' | tr -d '\r')

# ---- failures -> a clickable page for Firefox (a real browser gets past most bot checks) ----
HTML="2-failed-downloads-open-in-firefox.html"
{
  echo '<!doctype html><meta charset="utf-8"><title>Downloads to finish in Firefox</title>'
  echo '<style>body{font:16px sans-serif;max-width:900px;margin:2em auto;padding:0 1em}li{margin:.6em 0}code{background:#eee;padding:0 .3em}</style>'
  echo '<h1>Finish these in Firefox</h1><p>Click each link. If the PDF opens in Firefox, use its download arrow (top right).'
  echo 'Save it into the folder shown, inside the Community Rebuild Library folder. "(page)" links open a page: use its download button.</p><ol>'
  grep -v '^$' "$FAILED" | grep -v 'hesperian.org/.*_bm\.pdf' | while IFS='|' read -r d n u; do
    printf '<li><a href="%s" target="_blank">%s</a><br>save into: <code>%s</code></li>\n' "$u" "$n" "$d"
  done
  echo '</ol>'
} > "$HTML"

echo
echo "Done. Downloaded: $ok   Already had: $skip   Failed: $bad"
if [ "$bad" -gt 0 ]; then
  echo "Some sites block scripts. Opening $HTML in Firefox - click each link to save it by hand."
  command -v firefox >/dev/null && (firefox "$(readlink -f "$HTML")" >/dev/null 2>&1 &)
fi
echo "Other items that need a manual click are listed in 0-README-start-here.md"
read -n 1 -s -r -p "Press any key to close."; echo
