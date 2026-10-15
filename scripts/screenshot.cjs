// Dev-only: capture a page at the CF-30's screen size.
//   npx electron scripts/screenshot.cjs <url> <out.png> [width=1024] [height=768] [waitMs=2500] [js-to-run-after-load]
// Prints a JSON line with overflow info (horizontal scroll = layout bug).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const args = process.argv.slice(2).filter((a) => a !== '.' && !/screenshot\.cjs$/.test(a));
const [url, out, w = '1024', h = '768', wait = '2500', js] = args;
if (!url || !out) {
  console.error('usage: electron scripts/screenshot.cjs <url> <out.png> [width] [height] [waitMs] [js]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(w),
    height: Number(h),
    useContentSize: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    await win.loadURL(url);
    if (js) {
      await sleep(600);
      await win.webContents.executeJavaScript(js, true);
    }
    await sleep(Number(wait));
    const info = await win.webContents.executeJavaScript(
      `(() => { const m = document.getElementById('main');
        return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
                 mainScrollW: m ? m.scrollWidth : 0, mainClientW: m ? m.clientWidth : 0,
                 mainScrollH: m ? m.scrollHeight : 0, mainClientH: m ? m.clientHeight : 0, title: document.title }; })()`,
      true,
    );
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log(JSON.stringify({ out, ...info, hscroll: info.scrollW > info.innerW || info.mainScrollW > info.mainClientW }));
  } catch (e) {
    console.error('screenshot failed:', e && e.message);
    process.exitCode = 1;
  }
  app.quit();
});
