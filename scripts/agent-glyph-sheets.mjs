// Reproducible approval sheets from the same trusted artwork/palette as AgentAvatar; never starts Electron.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const load = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`);
const { GLYPH_ART, GLYPH_METRICS, GLYPH_SIZES } = await load('../src/renderer/lib/agent-glyph-art.ts');
const { GLYPH_TONES, GLYPH_INK } = await load('../src/renderer/lib/agent-glyph-tones.ts');
const dir = new URL('../docs/screenshots/agent-icons/', import.meta.url);
await mkdir(dir, { recursive: true });
const themes = { dark: '#191a1f', light: '#ffffff' };
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
let minimumInk=Infinity, minimumBadge=Infinity;
for(const theme of Object.keys(themes)) for(const tone of Object.values(GLYPH_TONES)) for(let step=0;step<=10;step++) {
  const [a,b]=tone[theme], color='#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-step/10)+parseInt(b.slice(i,i+2),16)*step/10).toString(16).padStart(2,'0')).join('');
  minimumInk=Math.min(minimumInk,contrast(color,GLYPH_INK[theme]));
  for(const background of theme==='dark'?['#101114','#191a1f','#30333c']:['#ffffff','#f3f4f7','#e2e5eb']) minimumBadge=Math.min(minimumBadge,contrast(color,background));
}
if(minimumInk<4.5 || minimumBadge<3) throw Error(`Contrast failed: ink ${minimumInk}, badge ${minimumBadge}`);
console.log(`Measured contrast minima: ink ${minimumInk.toFixed(2)}:1; badge ${minimumBadge.toFixed(2)}:1.`);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function badge(id, tone, size, theme, index) {
  const art = GLYPH_ART[id], metrics = GLYPH_METRICS[size], [a,b] = GLYPH_TONES[tone][theme];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><defs><linearGradient id="g${index}" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#g${index})"/><g color="${GLYPH_INK[theme]}"><path d="${art.accent}" fill="currentColor" opacity=".3"/><g fill="none" stroke="currentColor" stroke-width="${metrics.stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${size===16 && art.small ? art.small : art.outline}"/>${metrics.detail && art.detail ? `<path d="${art.detail}"/>` : ''}</g></g></svg>`;
}
const sheets = [];
for (const theme of Object.keys(themes)) {
  for (const size of GLYPH_SIZES) {
    const rows = Object.entries(GLYPH_ART).map(([id, art], row) => `<g transform="translate(24 ${70 + row*52})"><text y="26">${escape(art.label)}</text>${['blue','amber','teal'].map((tone,col) => `<g transform="translate(${240+col*100} 0)">${badge(id,tone,size,theme,`${row}-${col}`)}</g>`).join('')}</g>`).join('');
    sheets.push({ name: `${theme}-${size}`, width: 590, height: 1340, body: `<text x="24" y="30">Role glyphs · ${theme} · ${size}px · blue / amber / teal</text>${rows}` });
  }
  const rows = Object.entries(GLYPH_ART).slice(0,10).map(([id,art],row) => `<g transform="translate(24 ${70+row*68})">${badge(id,Object.keys(GLYPH_TONES)[row],40,theme,row)}<text x="64" y="26">${escape(art.label)}</text></g>`).join('');
  sheets.push({ name: `${theme}-presets-2x`, width: 590, height: 780, scale: 2, body: `<text x="24" y="30">Preset proposals · awaiting Brother approval</text>${rows}` });
}
for (const sheet of sheets) {
  const theme = sheet.name.startsWith('dark') ? 'dark' : 'light';
  sheet.svg = `<!-- Approval artwork only; presets retain legacy symbols until approved. -->\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width*(sheet.scale??1)}" height="${sheet.height*(sheet.scale??1)}" viewBox="0 0 ${sheet.width} ${sheet.height}"><rect width="100%" height="100%" fill="${themes[theme]}"/><g font-family="Segoe UI, sans-serif" font-size="15" fill="${theme==='dark'?'#eceef3':'#13161d'}">${sheet.body}</g></svg>\n`;
  sheet.svg = sheet.svg.replaceAll('><', '>\n<');
  await writeFile(new URL(`${sheet.name}.svg`,dir),sheet.svg);
}
if (!process.argv.includes('--svg-only')) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const sheet of sheets) {
      const page = await browser.newPage({ viewport: { width: sheet.width, height: sheet.height }, deviceScaleFactor: sheet.scale ?? 1 });
      await page.setContent(`<style>body{margin:0}body>svg{display:block;width:100%;height:100%}</style>${sheet.svg}`);
      await page.screenshot({ path: new URL(`${sheet.name}.png`,dir).pathname.replace(/^\/(.:)/,'$1') });
      await page.close();
    }
  } finally { await browser.close(); }
}
console.log(`Wrote ${sheets.length} approval sheets${process.argv.includes('--svg-only') ? ' (SVG only)' : ' (SVG + PNG)'}.`);
