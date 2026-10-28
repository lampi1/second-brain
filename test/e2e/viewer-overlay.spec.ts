// E2E of the file viewer overlay (the owner, 2026-10-22: the viewer as an overlay above the page that expands to full
// screen, with search, a table of contents, a side-by-side comparison and before/after screenshots): a file link opens
// it above the Grindhouse, the browsers' native views park under it and come back when it closes; a long Markdown
// document has its contents rail (a click moves the current section); Ctrl+F counts and moves between matches; code
// wraps, a line number copies the link to its line; Alt+←/→ move between the files opened; the expand button fills the
// window beside the Orchestrator; Compare shows the change side by side with the changed words marked, or unified; an
// agent's message naming a before and an after screenshot offers "Prima / Dopo": side by side, and a slider that the
// arrow keys move. Clipboard writes are recorded, not sent to the system clipboard. Screenshots:
// test-results/shots/viewer-overlay-*-<theme>.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { demoLayout, expandChats, launchDemo, shot, showBrowsers } from './helpers';

type D = { say(id: string, text: string): void; stop(id: string): Promise<void> };
const stop = (app: ElectronApplication, id: string) => app.evaluate((_e, chat) => (globalThis as unknown as { __sbDemo: D }).__sbDemo.stop(chat), id);
const say = (app: ElectronApplication, id: string, text: string) =>
  app.evaluate((_e, [chat, body]) => (globalThis as unknown as { __sbDemo: D }).__sbDemo.say(chat, body), [id, text] as const);
const open = async (page: Page, file: string) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter'); };
const copies = (page: Page) => page.evaluate(() => (window as unknown as { __sbCopies: string[] }).__sbCopies);
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A PNG that looks like a small settings screen: a title bar, a side menu, a card with fields and a button. */
function screen(w: number, h: number, fixed: boolean): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  type Rect = [number, number, number, number, [number, number, number]];
  const rects: Rect[] = [
    [0, 0, w, h, [236, 239, 244]], [0, 0, w, 44, [32, 36, 46]], [0, 44, 170, h, [222, 226, 233]],
    [18, 70, 130, 14, [180, 186, 198]], [18, 98, 110, 14, [196, 201, 211]], [18, 126, 120, 14, [196, 201, 211]],
    [200, 70, w - 230, h - 100, [255, 255, 255]], [224, 94, 220, 18, [40, 44, 56]],
    [224, 136, 300, 30, [244, 245, 248]], [224, 184, 300, 30, [244, 245, 248]], [224, 232, 300, 30, [244, 245, 248]],
    fixed ? [224, 296, 140, 36, [58, 92, 224]] : [262, 318, 140, 36, [196, 70, 70]],
    fixed ? [380, 296, 110, 36, [226, 230, 238]] : [214, 290, 110, 22, [226, 230, 238]],
    ...(fixed ? [[w - 150, 94, 96, 22, [21, 160, 90]] as Rect] : []),
  ];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c: [number, number, number] = [0, 0, 0];
    for (const [rx, ry, rw, rh, col] of rects) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) c = col;
    const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const GUIDE = `# Guida al rilascio

Questa guida descrive come portare una modifica dal ramo di lavoro alla versione stabile, con i controlli che il viewer mostra a ogni passo.

## Prima di iniziare

Controlla di avere l'ultima versione di \`main\` e un albero pulito. Il viewer apre ogni file citato da un agente sopra la pagina corrente.

- Un ramo per ogni modifica
- Commit piccoli, messaggi convenzionali
- Nessun segreto nei file

## Controlli sul ramo

Esegui i controlli leggeri: typecheck, lint dei file cambiati e i test unitari collegati.

\`\`\`bash
npm run check:branch
\`\`\`

> Un ramo è pronto quando i controlli sono verdi sull'ultimo commit.

### Cosa guardare

Apri la modifica nel viewer, confrontala con HEAD e guarda gli screenshot prima e dopo.

## Revisione

Un revisore per ogni dimensione toccata: sicurezza, correttezza, UI. Il viewer mostra il confronto affiancato.

### Domande frequenti

Se un test e2e fallisce solo su main, il ramo da guardare è quello indicato nel passaggio di consegne.

## Rilascio

Il pulsante Aggiorna porta la versione stabile alla punta di main. Il viewer resta disponibile anche lì.

| Passo | Chi | Quando |
|---|---|---|
| Check completo | Orchestrator | dopo il merge |
| Promote | Utente | quando vuole |

## Note finali

Ogni file si apre nel viewer: Esc lo chiude, Alt+← e Alt+→ passano tra i file aperti.
`;

const CODE = `// Settings form: saves the user's display preferences.
import { useState } from 'react';
import { savePrefs, type Prefs } from './store';

export interface FieldProps { label: string; value: string; onChange: (value: string) => void }

export function Field({ label, value, onChange }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="field-input" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

export function SettingsForm({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState(false);
  const update = (key: keyof Prefs) => (value: string) => setPrefs(p => ({ ...p, [key]: value }));
  const submit = async () => {
    setSaving(true);
    try { await savePrefs(prefs); } finally { setSaving(false); }
  };
  return (
    <form className="settings" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <Field label="Nome" value={prefs.name} onChange={update('name')} />
      <Field label="Email" value={prefs.email} onChange={update('email')} />
      <Field label="Fuso orario" value={prefs.timezone} onChange={update('timezone')} />
      <div className="actions"><button type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button><button type="button" className="ghost" onClick={() => setPrefs(initial)}>Annulla</button></div>
    </form>
  );
}
`;

function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-vw-'));
  const ev = path.join(userData, 'evidence', 'settings-fix');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'settings-before.png'), screen(880, 520, false));
  fs.writeFileSync(path.join(ev, 'settings-after.png'), screen(880, 520, true));
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-vw-brain-'));
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Brain\n');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-vw-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'guida-rilascio.md'), GUIDE);
  fs.writeFileSync(path.join(repo, 'SettingsForm.tsx'), CODE); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'first');
  fs.writeFileSync(path.join(repo, 'SettingsForm.tsx'), CODE
    .replace("const [saving, setSaving] = useState(false);", "const [saving, setSaving] = useState(false);\n  const [error, setError] = useState<string | null>(null);")
    .replace("try { await savePrefs(prefs); } finally { setSaving(false); }", "try { await savePrefs(prefs); setError(null); } catch (e) { setError(String(e)); } finally { setSaving(false); }")
    .replace('<Field label="Fuso orario"', '{error && <p className="error" role="alert">{error}</p>}\n      <Field label="Fuso orario"'));
  return { userData, ev, brain, repo };
}

for (const scheme of ['dark', 'light'] as const) {
  test(`file viewer overlay: over the page, contents, search, code, history, full screen, side-by-side compare, before/after · ${scheme}`, async () => {
    const { userData, ev, brain, repo } = fixture();
    const { app, page } = await launchDemo({ scheme, userData, width: 1920, height: 1080, config: { theme: scheme }, env: { SB_BRAIN: brain } });
    try {
      await page.evaluate(() => {
        const w = window as unknown as { __sbCopies: string[] }; w.__sbCopies = [];
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t: string) => { w.__sbCopies.push(t); } });
      });
      // the demo's waiting requests leave, so the questions window stays out of the way
      for (const id of ['orchestrator', 'qa', 'feedback']) await stop(app, id);
      await expect(page.getByTestId('qwin')).toHaveCount(0);
      const overlay = page.getByTestId('viewer-overlay'), viewer = page.getByTestId('cited-file-viewer');
      if (scheme === 'dark') {
        // a browser beside its chat: its native view is placed on screen before the viewer opens
        await showBrowsers(page, 'qa');
        await page.getByTestId('tile-browser-tab-qa').scrollIntoViewIfNeeded();
        await expect.poll(async () => (await demoLayout(app)).some(view => view.rect !== null)).toBe(true);
      }

      // a long Markdown document: above the page, with its contents rail
      await open(page, path.join(repo, 'guida-rilascio.md'));
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId('workspace')).toBeVisible(); // the page is still there, under it
      if (scheme === 'dark') await expect.poll(async () => (await demoLayout(app)).every(view => view.rect === null)).toBe(true);
      await expect(viewer.getByTestId('viewer-name')).toHaveText('guida-rilascio.md');
      const toc = viewer.getByTestId('viewer-toc'), items = toc.getByTestId('viewer-toc-item');
      await expect(items).toHaveCount(8);
      await expect(items.first()).toHaveAttribute('aria-current', 'location');
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-markdown-${scheme}`);
      // Ctrl+F: counted, moved with Enter, closed with Esc (the viewer stays)
      await page.keyboard.press('Control+F');
      const input = viewer.getByTestId('viewer-find-input'), count = viewer.getByTestId('viewer-find-count');
      await expect(input).toBeFocused();
      await input.fill('viewer');
      await expect(count).toHaveAttribute('data-count', '6');
      await expect(count).toHaveText('1 di 6');
      await input.press('Enter'); await input.press('Enter');
      await expect(count).toHaveText('3 di 6');
      await input.press('Shift+Enter');
      await expect(count).toHaveText('2 di 6');
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-find-${scheme}`);
      await input.fill('nessuna-corrispondenza');
      await expect(count).toHaveText('Nessun risultato');
      await input.press('Escape');
      await expect(viewer.getByTestId('viewer-find')).toHaveCount(0);
      await expect(overlay).toBeVisible();

      // the contents rail moves the current section
      await items.filter({ hasText: 'Controlli sul ramo' }).click();
      await expect(items.filter({ hasText: 'Controlli sul ramo' })).toHaveAttribute('aria-current', 'location');
      await items.filter({ hasText: /^Note finali$/ }).click();
      await expect(items.filter({ hasText: /^Note finali$/ })).toHaveAttribute('aria-current', 'location');

      // code: wrap, and a line number copies the link to its line
      await open(page, path.join(repo, 'SettingsForm.tsx'));
      await expect(viewer.getByTestId('viewer-name')).toHaveText('SettingsForm.tsx');
      const code = viewer.getByTestId('bx-code');
      await expect(code).toHaveAttribute('data-highlighted', 'true');
      const wrap = viewer.getByTestId('viewer-wrap');
      if ((await wrap.getAttribute('aria-pressed')) === 'true') await wrap.click();
      await wrap.click();
      await expect(code).toHaveAttribute('data-wrap', 'true');
      await code.locator('[data-l="18"] .bx-ln').click();
      await expect.poll(() => copies(page)).toHaveLength(1);
      const link = (await copies(page))[0]!;
      expect(link.startsWith('sb://file/')).toBe(true);
      expect(JSON.parse(decodeURIComponent(link.slice('sb://file/@file:'.length)))).toMatchObject({ path: path.join(repo, 'SettingsForm.tsx').replace(/\\/g, '/'), line: 18 });
      await expect(code.locator('[data-l="18"]')).toHaveClass(/is-picked/);
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-code-${scheme}`);

      // back and forward between the files opened in the viewer
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(viewer.getByTestId('viewer-name')).toHaveText('guida-rilascio.md');
      await viewer.getByTestId('viewer-forward').click();
      await expect(viewer.getByTestId('viewer-name')).toHaveText('SettingsForm.tsx');

      // full screen beside the Orchestrator column, and back
      await viewer.getByTestId('viewer-expand').click();
      await expect(overlay).toHaveAttribute('data-full', 'true');
      await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();

      // Compare against HEAD: side by side with the changed words, or unified
      await viewer.getByTestId('viewer-compare').click();
      const diff = viewer.getByTestId('viewer-diff');
      await expect(diff).toHaveAttribute('data-added', '3');
      if ((await diff.getAttribute('data-layout')) !== 'split') await diff.getByRole('button', { name: 'Affiancato' }).click();
      const split = diff.getByTestId('viewer-diff-split');
      await expect(split.locator('[data-kind="add"]').first()).toBeVisible();
      await expect(split.locator('mark.bx-word').first()).toBeVisible();
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-diff-split-${scheme}`);
      await diff.getByRole('button', { name: 'Unificato' }).click();
      await expect(diff.getByTestId('viewer-diff-rows')).toBeVisible();
      await diff.getByRole('button', { name: 'Affiancato' }).click();
      await viewer.getByTestId('viewer-expand').click();
      await expect(overlay).not.toHaveAttribute('data-full', 'true');

      // Esc closes it; the page under it is as it was, and the native views come back
      await page.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0);
      if (scheme === 'dark') await expect.poll(async () => (await demoLayout(app)).some(view => view.rect !== null)).toBe(true);

      // an agent's message names a before and an after screenshot: "Prima / Dopo" opens the pair in the viewer
      const chat = await page.evaluate(cwd => window.sb.invoke('chat:create', { harness: 'claude', cwd, title: 'Fix impostazioni' }), ev);
      await say(app, chat.id, `Fatto: il pulsante Salva è allineato e c'è la conferma.\n\n![Prima](${path.join(ev, 'settings-before.png')}) ![Dopo](${path.join(ev, 'settings-after.png')})`);
      await expandChats(page, chat.id);
      const tile = page.getByTestId('tile-chat-' + chat.id);
      const compare = tile.locator('[data-testid$="-img-compare"]');
      await compare.scrollIntoViewIfNeeded();
      await expect(compare).toBeVisible();
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-shots-thumbs-${scheme}`);
      await compare.click();
      const shots = page.getByTestId('viewer-shots');
      await expect(shots).toBeVisible();
      if ((await shots.getAttribute('data-layout')) !== 'side') await shots.getByRole('button', { name: 'Affiancati' }).click();
      await expect.poll(() => shots.locator('.vw-shot img').evaluateAll(list => list.map(i => (i as HTMLImageElement).naturalWidth))).toEqual([880, 880]);
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-shots-side-${scheme}`);
      await shots.getByRole('button', { name: 'Cursore' }).click();
      const handle = shots.getByTestId('viewer-slider-handle'), slider = shots.getByTestId('viewer-slider');
      await expect(slider).toHaveAttribute('data-pos', '50');
      await handle.focus();
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      await expect(slider).toHaveAttribute('data-pos', '46');
      const box = (await slider.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.62, box.y + box.height / 2);
      await expect.poll(async () => Number(await slider.getAttribute('data-pos'))).toBeGreaterThan(58);
      await page.mouse.move(2, 2);
      await shot(page, `viewer-overlay-shots-slider-${scheme}`);
      // the shots and the files share one back/forward list
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(viewer.getByTestId('viewer-name')).toHaveText('SettingsForm.tsx');
      await page.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0);
    } finally { await app.close(); }
  });
}
