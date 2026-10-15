// Exposes a tiny, safe bridge to the UI as window.librarySearch (see NativeBridge in src/shared/api.ts).
import { contextBridge, ipcRenderer } from 'electron';

declare const __APP_VERSION__: string;

contextBridge.exposeInMainWorld('librarySearch', {
  isElectron: true,
  appVersion: __APP_VERSION__,
  electronVersion: process.versions.electron,
  findInPage(text: string, forward: boolean) {
    ipcRenderer.send('ls:find', String(text), forward !== false);
  },
  stopFindInPage() {
    ipcRenderer.send('ls:find-stop');
  },
  openExternal(url: string) {
    ipcRenderer.send('ls:open-external', String(url));
  },
  onFoundInPage(cb: (r: { matches: number; activeMatchOrdinal: number }) => void) {
    const h = (_e: unknown, r: { matches: number; activeMatchOrdinal: number }) => cb(r);
    ipcRenderer.on('ls:found', h);
    return () => {
      ipcRenderer.removeListener('ls:found', h);
    };
  },
});

// Same-origin links that asked for a new window are shown in the reader instead.
ipcRenderer.on('ls:navigate', (_e: unknown, hash: string) => {
  if (typeof hash === 'string' && hash.indexOf('#/') === 0) window.location.hash = hash;
});
