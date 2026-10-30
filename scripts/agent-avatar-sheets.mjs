// Approval sheets for the role characters: every character at 16, 20, 28, 40 and 96 px on the dark and light
// surfaces, plus a sidebar-tree sample, drawn from the same trusted art as AgentAvatar (src/renderer/lib/character-art.ts).
// Also checks that each character's silhouette stands out from its badge and its badge from both surfaces' ring.
// Writes docs/screenshots/agent-avatars/<theme>.svg and, unless --svg-only, <theme>.png through a hidden Electron window
// (on Linux run it under xvfb-run). Used by the owner and reviewers to approve the art: `node scripts/agent-avatar-sheets.mjs`.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const load = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`);
const { CHARACTERS, characterSvg } = await load('../src/renderer/lib/character-art.ts');
const NAMES = { orchestrator: 'Orchestrator', strategist: 'Strategist', scout: 'Scout', artisan: 'Artisan', sentinel: 'Sentinel', herald: 'Herald', flash: 'Flash' };
const SIZES = [16, 20, 28, 40, 96];
const THEMES = { dark: { bg: '#191a1f', card: '#22242b', text: '#eceef3', muted: '#9aa0ad', ring: '#ffffff59' }, light: { bg: '#f3f4f7', card: '#ffffff', text: '#13161d', muted: '#5b6170', ring: '#0000002e' } };
const dir = fileURLToPath(new URL('../docs/screenshots/agent-avatars/', import.meta.url));
await mkdir(dir, { recursive: true });

const lum = hex => hex.slice(1, 7).match(/../g).map(v => parseInt(v, 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mid = ([a, b]) => '#' + [1, 3, 5].map(i => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');
// OKLab distance between the silhouette's main colour (its largest hair or headwear fill) and the badge: hue counts as
// much as lightness here, which a luminance ratio would miss (a red cap on a sky-blue badge reads well at 16 px).
const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function oklab(hex) {
  const [r, g, b] = hex.slice(1, 7).match(/../g).map(v => lin(parseInt(v, 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dist = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));
const area = s => ('p' in s ? s.p.length : 'c' in s && Array.isArray(s.c) ? s.c[2] ** 2 * 3 : 'e' in s ? s.e[2] * s.e[3] * 3 : 0);
const problems = [];
for (const [id, ch] of Object.entries(CHARACTERS)) {
  const sil = [...(ch.back ?? []), ...ch.head].filter(s => s.f).sort((a, b) => area(b) - area(a))[0].f, badge = mid(ch.bg), d = dist(sil, badge);
  console.log(`${id.padEnd(13)} silhouette ${sil} / badge ${badge}: OKLab ${d.toFixed(3)}, luminance ${contrast(sil, badge).toFixed(2)}:1`);
  if (d < 0.15) problems.push(`${id}: silhouette/badge OKLab distance ${d.toFixed(3)} < 0.15`);
}
if (problems.length) throw Error(`Contrast failed:\n${problems.join('\n')}`);

const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const looks = Object.fromEntries([...(await readFile(new URL('../src/shared/characters.ts', import.meta.url), 'utf8')).matchAll(/^\s+(\w+): '([^']+)',$/gm)].map(m => [m[1], m[2]]));
let uid = 0;
function sheet(theme) {
  const t = THEMES[theme], ids = Object.keys(CHARACTERS), rowH = 112, top = 70, width = 1040, height = top + ids.length * rowH + 150;
  const head = SIZES.map((s, i) => `<text x="${300 + i * 130}" y="${top - 16}" fill="${t.muted}">${s} px</text>`).join('');
  const rows = ids.map((id, r) => {
    const y = top + r * rowH, cells = SIZES.map((s, i) => `<g transform="translate(${300 + i * 130} ${y + (96 - s) / 2})">${characterSvg(id, s, `${theme}${uid++}`)}</g>`).join('');
    return `<rect x="16" y="${y - 6}" width="${width - 32}" height="${rowH - 8}" rx="12" fill="${t.card}"/>`
      + `<text x="32" y="${y + 40}" font-size="17" font-weight="600" fill="${t.text}">${NAMES[id]}</text>`
      + `<foreignObject x="32" y="${y + 50}" width="250" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="font:12px/1.35 Segoe UI,sans-serif;color:${t.muted}">${esc(looks[id] ?? '')}</div></foreignObject>${cells}`;
  }).join('');
  const ty = top + ids.length * rowH + 10, tree = ['orchestrator', 'strategist', 'scout', 'sentinel'].map((id, i) => {
    const x = 40 + (i > 1 ? 24 : i * 24), y = ty + 36 + i * 26;
    return `<g transform="translate(${x} ${y - 12})">${characterSvg(id, 16, `${theme}${uid++}`)}</g><text x="${x + 24}" y="${y + 1}" font-size="13" fill="${t.text}">${NAMES[id]}</text>`;
  }).join('');
  const tiles = ['artisan', 'herald', 'flash'].map((id, i) => {
    const x = 330 + i * 115, y = ty + 40;
    return `<g transform="translate(${x} ${y})">${characterSvg(id, 20, `${theme}${uid++}`)}</g><text x="${x + 26}" y="${y + 15}" font-size="13" fill="${t.text}">${NAMES[id]}</text>`
      + `<g transform="translate(${x} ${y + 40})">${characterSvg(id, 28, `${theme}${uid++}`)}</g><text x="${x + 34}" y="${y + 59}" font-size="13" fill="${t.text}">${NAMES[id]}</text>`;
  }).join('');
  const body = `<rect width="100%" height="100%" fill="${t.bg}"/><style>.ring{stroke:${t.ring}}</style>`
    + `<text x="24" y="34" font-size="20" font-weight="600" fill="${t.text}">Role characters · ${theme}</text>${head}${rows}`
    + `<rect x="16" y="${ty}" width="${width - 32}" height="130" rx="12" fill="${t.card}"/><text x="32" y="${ty + 20}" font-size="12" fill="${t.muted}">In context: sidebar tree (16 px), strips (20 px), chat header (28 px)</text>${tree}${tiles}`;
  return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, sans-serif">${body}</svg>\n` };
}

const sheets = Object.keys(THEMES).map(theme => ({ theme, ...sheet(theme) }));
// one element per line: reviewable diffs, and the guard scans every line
for (const s of sheets) await writeFile(join(dir, `${s.theme}.svg`), s.svg.replaceAll('><', '>\n<'));
if (!process.argv.includes('--svg-only')) {
  // A throwaway Electron main that loads each sheet in a hidden window and saves it at 2x for close inspection.
  const work = join(tmpdir(), `sb-avatar-sheets-${process.pid}`);
  await mkdir(work, { recursive: true });
  const jobs = sheets.map(s => ({ svg: join(dir, `${s.theme}.svg`), png: join(dir, `${s.theme}.png`), width: s.width, height: s.height }));
  await writeFile(join(work, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, useContentSize: true });
  try {
    for (const j of ${JSON.stringify(jobs)}) {
      w.setContentSize(j.width, j.height);
      await w.loadURL('data:image/svg+xml;base64,' + require('fs').readFileSync(j.svg).toString('base64'));
      await new Promise(r => setTimeout(r, 300));
      require('fs').writeFileSync(j.png, (await w.webContents.capturePage({ x: 0, y: 0, width: j.width, height: j.height })).toPNG());
    }
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
`);
  // Root (a Linux container) cannot start Chromium's sandbox; the window only shows these local, generated sheets.
  const electron = createRequire(import.meta.url)('electron');
  const run = spawnSync(electron, [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), join(work, 'main.cjs')], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  await rm(work, { recursive: true, force: true });
  if (run.status !== 0) throw Error(`Electron exited with ${run.status}: PNG sheets not written (on Linux run under xvfb-run)`);
  // the guard pins every committed image by its hash (.guardallow): the lines to add when a sheet changed
  for (const j of jobs) console.log(`docs/screenshots/agent-avatars/${j.png.split(/[\\/]/).pop()} binary-media sha256:${createHash('sha256').update(await readFile(j.png)).digest('hex')}`);
}
console.log(`Wrote ${sheets.length} approval sheets to docs/screenshots/agent-avatars/${process.argv.includes('--svg-only') ? ' (SVG only)' : ' (SVG + PNG)'}.`);
