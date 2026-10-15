// Renders assets/icons/library-search.svg to PNGs (transparent background) with Electron's Chromium.
//   npx electron scripts/make-icons.cjs
// Output: assets/icons/<size>.png for the sizes Ubuntu's launcher and menus use.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const dir = path.join(__dirname, '..', 'assets', 'icons');
const svg = fs.readFileSync(path.join(dir, 'library-search.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas id="c"></canvas>');
  for (const size of SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.getElementById('c');
        c.width = c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, ${size}, ${size});
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('svg failed to load'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    })`);
    fs.writeFileSync(path.join(dir, `${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`${size}.png`);
  }
  app.quit();
});
