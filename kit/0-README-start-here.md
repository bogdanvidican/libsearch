# Community Rebuild Library - Ubuntu 16.04 + Firefox

The download scripts, the book lists and this guide come with the **Library Search** app (step 6). They are in
the app's `kit` folder: `<app folder>/dist/library-search-linux-ia32/resources/app/kit/` (in a git checkout of the
app: `kit/`). Every app update brings the newest versions. Below, `<kit>` stands for that folder.

The books and encyclopedias go in your **library folder**: one folder holding the topic folders (`01 Medicine`, ...,
`15 Offline Encyclopedias (Kiwix)`). Keep it outside the app's folder, so deleting or reinstalling the app never
touches it. Run the scripts inside the library folder, or name the folder after the script:
`bash "<kit>/2-download-pdf-books.sh" "/path/to/your library"`.

Book lists: `booklist-main.txt` (main) + `booklist-linux.txt` (Linux manuals), both in `<kit>/booklists/`, plus
`booklist-local.txt` in your library folder for books of your own (app updates never change it).
Tip: copy any PDF folders already downloaded on another computer (01 Medicine, ...) into the library folder first - the script keeps them.

## Run order
Install the app first (step 6): the other scripts come with it. Then open a terminal in your library folder
(in the file manager: right-click inside the folder -> "Open in Terminal") and run the scripts in number order.

| Step | Script | What it does | Size | Needed? |
| --- | --- | --- | --- | --- |
| 0 | `<kit>/0-README-start-here.md` | This guide | - | read first |
| 6 | `bash 6-install-or-update-search-app.sh` | Installs or updates the **Library Search** app - and with it these scripts and book lists (downloads it, or takes a `.tar.gz` from a USB stick) | ~80 MB | first, then to update |
| 1 | `sudo bash "<kit>/1-fix-https-certificates.sh"` | Updates Ubuntu 16.04's expired security certificates so downloads work | small | once, recommended |
| 2 | `bash "<kit>/2-download-pdf-books.sh"` | In the app: **Library -> Get books**. Downloads the PDF books (reads the app's book lists + your `booklist-local.txt`); anything blocked opens in Firefox as `2-failed-downloads-open-in-firefox.html` | ~2 GB | yes |
| 3 | `bash "<kit>/3-download-offline-wikipedia.sh"` | In the app: **Library -> Get books -> Encyclopedias**. Offline Wikipedia, WikiMed, repair guides, Q&A sites + the Kiwix reader | ~80 GB | optional |
| 4 | `bash "<kit>/4-download-khan-academy.sh"` | In the app: **Encyclopedias** as for step 3. All of Khan Academy (resumes if interrupted) | 168 GB | optional (also fetches the Kiwix reader if step 3 was skipped) |
| 5 | `bash "<kit>/5-start-offline-library-in-firefox.sh"` | Opens everything from steps 3-4 in Firefox at http://localhost:8080 | - | only without the app (the app opens them itself) |
| 6 | **Library Search** in the sidebar or the Dash | **One search box for everything**: all the books plus Wikipedia, Khan Academy and the Q&A sites | - | every time you want to look something up |

Steps 2-4 are safe to re-run: they skip finished files and resume partial ones.

## Panasonic CF-30 notes (32-bit)
- `uname -m` shows i686 on 32-bit Ubuntu. Everything here works on 32-bit: the PDF downloader is plain bash + curl,
  and the Kiwix reader comes as a 32-bit (i586) build - the scripts pick it automatically
  (newest i586 release, or 3.7.0 if a newer one has no 32-bit build).
- Before the big downloads, test the reader with a small file: run the offline-Wikipedia script with only the
  PhET line enabled (~0.1 GB), then open it in the app (or  bash "<kit>/5-start-offline-library-in-firefox.sh"  in Firefox).
  Then try a mid-size one (WikiMed, 2 GB) before committing to Khan Academy (168 GB).
- Disk: this CF-30 has ~443 GB free, so everything fits on the internal disk - PDFs (~2 GB) + offline
  Wikipedia set (~80 GB) + Khan Academy (168 GB) = ~250 GB. To add ALL of English Wikipedia (119 GB), enable it in
  step 3 and comment out the "top 1M articles" line (it's a subset), for ~320 GB total.
  Keep the library folder in your home folder (ext4) - not on a FAT32 USB stick.
- Hard drive (HDD), not SSD: everything still works. Videos stream fine; Wikipedia searches and first page loads
  are a bit slower because the disk has to seek. Two tweaks:
  * Make Linux use RAM before the slow disk swap:  sudo sysctl vm.swappiness=10
    and to keep it after reboot:  echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
  * One spinning disk is a single point of failure. Keep a second copy of the PDF library (~2 GB) on a
    USB stick or another computer; the big Kiwix files can be downloaded again while internet exists.
- Video: the CF-30's CPU decodes video in software, so Khan Academy videos may stutter at full screen;
  a smaller Firefox window helps. Khan articles and other content are unaffected.
- RAM (3.2 GiB): enough for the downloads and for serving everything at once. Downloads stream straight to
  disk, so they use almost no memory. When reading, kiwix-serve plus Firefox fit comfortably; keep Firefox to
  a few tabs. Check swap exists with  free -h  (the "Swap" line should not be 0) so a heavy page can't freeze it.
- Firefox: Mozilla no longer updates 32-bit Linux Firefox, so use the version installed and check it with
  the online preview step in the Khan Academy section.

## 1. Download the PDF library (~2 GB)
Easiest: in the app, **Library -> Get books -> Download missing books** (it lists what a site blocked, with
Open in Firefox). The script does the same from a terminal, without the app:

Open a terminal in your library folder (in the file manager: right-click inside the folder -> "Open in Terminal",
or `cd` to it), then run:

    bash "<kit>/2-download-pdf-books.sh"

- Re-run it any time: finished files are skipped and partial ones resume.
- Some sites block scripts (they return a "bot check" instead of the PDF). Those are caught and listed in
  `2-failed-downloads-open-in-firefox.html` (in the library folder), which opens in Firefox at the end: click each link and save the file into the folder shown.
- Books of your own: add lines to `booklist-local.txt` in the library folder (same format as the app's lists; the
  file explains it and is created the first time the script runs). App updates bring new versions of the scripts
  and of the app's lists, but never change `booklist-local.txt`.
- If it says the certificates are too old (common on 16.04), run once:  `sudo bash "<kit>/1-fix-https-certificates.sh"`
- If curl is missing:  `sudo apt-get install curl`
- Always start scripts with `bash <name>.sh` - that avoids "Permission denied".

## 2. Optional: offline Wikipedia, medical wiki, repair guides (~80 GB)
Easiest: in the app, **Library -> Get books -> Encyclopedias**: tick what you want; a cut-off download continues by itself.
From a terminal:

    bash "<kit>/3-download-offline-wikipedia.sh"
    bash "<kit>/5-start-offline-library-in-firefox.sh"     # without the app: opens everything in Firefox at http://localhost:8080

- Uses `kiwix-serve` (downloaded automatically, a static build that runs on old Ubuntu). Firefox is the reader.
- Other phones/laptops on the same Wi-Fi or network cable can open it too - the start script prints the address.
- Use an ext4 or exFAT drive. FAT32 USB sticks can't hold files over 4 GB (the script warns and skips those).
  exFAT on 16.04 needs:  `sudo apt-get install exfat-fuse exfat-utils`
- Which ones: the "yes" lines of `<kit>/booklists/encyclopedias.txt` (full English Wikipedia, 119 GB, and Khan Academy are "no").
  To pick others, use the app: **Library -> Get books -> Encyclopedias**.
  Khan Academy has its own script - see below.

## 3. Manual downloads in Firefox
The same list is in the app: **Library -> Get books -> Save by hand**, with Open in Firefox and a tick box for each
(it comes from `<kit>/booklists/manual-downloads.txt`).

Tip first: Firefox opens PDFs in its own viewer. To save one, click the **Download** arrow in the viewer's
top-right toolbar, or set Preferences -> General -> Applications -> "Portable Document Format" -> **Save File**.
Firefox saves to ~/Downloads; move each file into the folder shown after the arrow.

OpenStax textbooks (click "Download a PDF" on each page):
- [ ] Anatomy & Physiology 2e - https://openstax.org/details/books/anatomy-and-physiology-2e  -> 01 Medicine
- [ ] Microbiology - https://openstax.org/details/books/microbiology  -> 01 Medicine
- [ ] College Physics 2e - https://openstax.org/details/books/college-physics-2e  -> 11 Math & Science
- [ ] Chemistry 2e - https://openstax.org/details/books/chemistry-2e  -> 11
- [ ] Biology 2e - https://openstax.org/details/books/biology-2e  -> 11
- [ ] Prealgebra 2e - https://openstax.org/details/books/prealgebra-2e  -> 11
- [ ] Elementary Algebra 2e - https://openstax.org/details/books/elementary-algebra-2e  -> 11
- [ ] Calculus Vol. 1 - https://openstax.org/details/books/calculus-volume-1  -> 11
- [ ] Introduction to Computer Science - https://openstax.org/details/books/introduction-computer-science  -> 12
- [ ] Writing Guide with Handbook - https://openstax.org/details/books/writing-guide  -> 13
- [ ] Principles of Accounting Vol. 1 - https://openstax.org/details/books/principles-financial-accounting  -> 14

Other:
- [ ] Where There Is No Vet (Oxfam, 6 PDF parts) - https://oxfamilibrary.openrepository.com/handle/10546/123108  -> 01
- [ ] SKAT Hand Dug Shallow Wells - https://www.rural-water-supply.net/en/resources/256-  -> 02
- [ ] India Mark II Handpump Manual - https://rural-water-supply.net/en/resources/328  -> 02
- [ ] Agrodok booklets (55; chickens, goats, fish ponds...) - https://www.echocommunity.org/sw/publications/by_language/74/en  -> 03
- [ ] CAWST Biosand Filter Construction Manual (pick English) - https://washresources.cawst.org/en/resources/b6be2637/biosand-filter-construction-manual  -> 02
- [ ] WHO/WEDC Technical Notes on WASH in Emergencies - https://repository.lboro.ac.uk/articles/book/Technical_notes_on_drinking-water_sanitation_and_hygiene_in_emergencies/9585326  -> 02
- [ ] ECHO Technical Notes - https://www.echocommunity.org/en/resources/2d15ee1b-8b85-4556-9e6c-c14b2a8b6fce  -> 03
- [ ] Core Knowledge curriculum (K-8) - https://www.coreknowledge.org/download-free-curriculum/  -> 10
- [ ] Eureka Math (pre-K to precalc, 9.4 GB) - https://archive.org/details/engageny-mathematics  -> 10
- [ ] CD3WD appropriate-tech archive (26 GB) - https://archive.org/details/2012_cdw3d_dvd_set
- [ ] Survivor Library (pre-1920s how-to books) - https://www.survivorlibrary.com/index.php/main-category-index/

Construction & metalwork (Practical Action open-access books - click "Download PDF" on each page):
- [ ] Construction Manual for Earthquake-Resistant Houses Built of Earth (Minke) - https://practicalactionpublishing.com/book/2858/construction-manual-for-earthquake-resistant-houses-built-of-earth  -> 06/Masonry & Earth Building
- [ ] How to Build Safer Houses with Confined Masonry - https://practicalactionpublishing.com/book/1036/how-to-build-safer-houses-with-confined-masonry  -> 06/Masonry & Earth Building
- [ ] Constructing Low-rise Confined Masonry Buildings - https://practicalactionpublishing.com/book/388  -> 06/Masonry & Earth Building
- [ ] CSEB (compressed stabilised earth block) Construction Manual - https://practicalactionpublishing.com/book/2717  -> 06/Masonry & Earth Building
- [ ] FAO Basic Blacksmithing (HTML only: File > Print > Save as PDF) - https://www.fao.org/3/ah637e/AH637E00.htm  -> 07 Metalworking
- [ ] Optional: all Practical Action technical briefs offline (lime kilns, bricks, forges...; 1.1 GB zip) -
      https://rachel.worldpossible.org/zipped-modules/en-practical_action.zip

Engines, vehicles & motors (open these pages, then save):
- [ ] FAO Water Lifting (pumps & engines, HTML only: File > Print > Save as PDF) - https://www.fao.org/3/ah810e/AH810E00.htm  -> 17 Engines & Vehicles
- [ ] Practical Action "Diesel Engine Repair and Maintenance" (CC-BY) - https://infohub.practicalaction.org/items/38781bf9-dec9-4bad-9174-40f1409f3cdc  -> 17 Engines & Vehicles/Engines
- [ ] UK MOT Inspection Manual for cars (brakes, steering, suspension, tyres; HTML: print to PDF) - https://www.gov.uk/guidance/mot-inspection-manual-for-private-passenger-and-light-commercial-vehicles  -> 17 Engines & Vehicles/Cars & Trucks
- [ ] Good Practice Guide to Maintain Motor Efficiency (EASA/AEMT) - https://easa.com/resources/resource-library/good-practice-guide-to-maintain-motor-efficiency  -> 18 Electric Motors & E-Vehicles
- [ ] UK e-bike lithium battery safety guidelines (HTML: print to PDF) - https://www.gov.uk/guidance/statutory-guidelines-on-lithium-ion-battery-safety-for-e-bikes  -> 18/E-Bikes, Mopeds & Quads

FAO web-only manuals - open the page, then save it as PDF:
newer Firefox: menu -> Print -> Destination "Save to PDF" -> Save.
older Firefox: menu -> Print -> "Print to File" -> Output format PDF -> Print.
- [ ] Poultry https://www.fao.org/3/y5169e/y5169e00.htm  -> 03
- [ ] Rabbit https://www.fao.org/3/x5082e/X5082E00.htm  -> 03
- [ ] Fruit & Veg Processing https://www.fao.org/3/v5030e/V5030E00.htm  -> 04
- [ ] Grain Storage https://www.fao.org/3/t1838e/t1838e00.htm  -> 04
- [ ] Postharvest Handling https://www.fao.org/4/ae075e/ae075e00.htm  -> 04

## Khan Academy in Firefox (via Kiwix)
1. Preview first (online, 5 min): in Firefox open https://library.kiwix.org , search "Khan Academy", open it,
   play a video and try an exercise. If that works in this Firefox, the offline copy will too.
2. Make sure the library folder is on a disk with 200+ GB free, formatted ext4, exFAT or NTFS (not FAT32) -
   the CF-30's internal disk is fine.
3. Download (168 GB; ~8 h at 50 Mbit/s, ~1.5 days at 10 Mbit/s), inside the library folder. Safe to stop and re-run - it resumes:
       bash "<kit>/4-download-khan-academy.sh"          (Spanish: add  es , French: add  fr )
4. Open it in the Library Search app. Without the app:  bash "<kit>/5-start-offline-library-in-firefox.sh"
   - Firefox opens http://localhost:8080 with Khan Academy next to Wikipedia and the others.
5. If videos don't play:  sudo apt-get install ubuntu-restricted-extras   then restart Firefox.
   If pages look broken, update Firefox:  sudo apt-get update && sudo apt-get install firefox
6. Other devices (kids' laptops/phones) on the same Wi-Fi or cable open the address the start script prints.

Notes: this copy is from March 2023 (Kiwix hasn't published a newer one). Kiwix keeps no logins or progress -
use a paper log per child. Kolibri (with progress tracking) won't install on 16.04; it can run on a newer
machine or a Raspberry Pi and be opened from this computer's Firefox.

## Linux manuals (folder 16 Linux & Ubuntu)
Downloaded automatically: Introduction to Linux, Bash Guide for Beginners, Advanced Bash-Scripting Guide,
System Administrators' Guide, Network Administrators' Guide, Command-Line Tools Summary (all TLDP),
The Linux Command Line (Shotts), Ubuntu Server documentation (written for 24.04; most applies to 16.04 except
networking: 16.04 uses /etc/network/interfaces, not netplan), Debian Administrator's Handbook (EPUB).
The offline-Wikipedia script also gets Unix & Linux, Ask Ubuntu and Super User Q&A. And `man <command>` works offline.

## 6. Search the library (one search box for everything)
Type a question - "boil water", "splint", "fractions", "chmod" - and get results from every book (with the
page number), offline Wikipedia, WikiMed, Khan Academy and the Q&A sites. Tap a result to open it: books open
in the Document Viewer at the right page, articles open inside the app.

1. Install the app (once):

       bash 6-install-or-update-search-app.sh

   - With internet it downloads the newest version from GitHub. On a fresh 16.04 computer (old certificates)
     or without internet, get the `library-search-linux-ia32-vX.Y.Z.tar.gz` file and `6-install-or-update-search-app.sh`
     from the GitHub release page in Firefox, or from a USB stick, put both in one folder and run:
     `bash 6-install-or-update-search-app.sh library-search-linux-ia32-vX.Y.Z.tar.gz`
   - Later versions install themselves: when the computer is online, the app downloads a new version in the
     background and installs it when you close the app (switch it off under **Settings -> Updates**). Without
     internet, update from a USB stick with the same command. Don't use sudo.
   - The installer adds **Library Search** to the app menu and asks whether to put its icon in the sidebar
     (answer Y). Later: `bash 6-install-or-update-search-app.sh --launcher` re-creates it, `--remove-launcher` removes it.
   - The app doesn't have to live in the library folder: `--dir <folder>` installs it anywhere. If it can't find the
     books next to itself, it asks for the library folder on first start (also under **Library -> Library folders**,
     where a USB drive or a second folder can be added).
   - **Settings** (the gear button at the top) has light or dark mode - with a choice of dark colors and how dark -
     updates, the app's version, and a **Guide** (Settings -> Help -> Open the guide) that explains how the app works,
     how the library folder must look, and what to do when something goes wrong. It works without internet.
2. Start it: click **Library Search** in the sidebar (or search for it in the Dash), or run
   `bash "<kit>/6-search-the-library.sh"`.
   It starts the offline Wikipedia reader by itself if step 3 or 4 was done - no need to run step 5 first.
3. The first time, the app offers to **build the book index**: it reads every PDF once (30-90 minutes on the
   CF-30; the computer stays usable). You can stop it any time and it continues later. After adding new books,
   open **Library** in the app and click **Update index** (or run  `bash "<kit>/6-build-search-index.sh"`).

- Needs `pdftotext` (part of Ubuntu; if missing:  `sudo apt-get install poppler-utils`).
- Old scanned books without a text layer can't be searched inside - the app lists them under **Library**;
  you can still find them by title.
- If the app window won't open, use the simple version in Firefox (same search):
  `bash "<kit>/6-search-the-library.sh" --firefox`. Problems are logged in the app folder under `logs/launcher.log`.

## Reading the books
- PDFs: Ubuntu's built-in Document Viewer (Evince) or Firefox.
- .epub files (a few public-domain books from Project Gutenberg): `sudo apt-get install fbreader`.

## Print these on paper
Where There Is No Doctor chapters, Surgical Care at the District Hospital, TC 4-02.1 First Aid, USDA Home Canning Guide,
WHO/WEDC water technical notes, Survival ATP 3-50.21, Seed Saving Guidelines.
