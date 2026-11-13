// Screenshot of a page (file or URL) at a given size, for mockups and evidence.
// Usage: electron scripts/shot.cjs <file-or-url> <out.png> [width] [height]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const [src, out, w = '1600', h = '1000'] = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('shot.cjs') && a !== '.');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(w), height: Number(h), show: false, useContentSize: true, webPreferences: { offscreen: false } });
  const url = /^[a-z]+:/i.test(src) && !/^[a-z]:\\/i.test(src) ? src : `file:///${path.resolve(src.split('?')[0]).replace(/\\/g, '/')}${src.includes('?') ? `?${src.split('?')[1]}` : ''}`;
  await win.loadURL(url);
  await new Promise(r => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log(`${out} ${img.getSize().width}x${img.getSize().height}`);
  app.quit();
});
