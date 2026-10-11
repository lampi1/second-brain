// Builds the app icon from build/icon.svg: build/icon.png (512) and build/icon.ico (16…256, PNG entries), rendered
// by Electron itself (no image dependency). Run: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
// Used by: window.ts (window/taskbar icon), shortcuts.ts (Start-menu and desktop shortcuts), scripts/release.mjs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

// drawn on a canvas inside a hidden page (no compositor needed: capturePage of a hidden window can hang)
async function render(win, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((ok, ko) => {
    const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); };
    img.onerror = () => ko(new Error('svg did not load')); img.src = ${JSON.stringify(src)}; })`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: await render(win, size) });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await render(win, 512));
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(pngs));
  console.log(`build/icon.ico (${SIZES.join(', ')}) + build/icon.png (512)`);
  app.quit();
});
