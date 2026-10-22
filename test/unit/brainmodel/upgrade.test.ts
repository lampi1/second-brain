// The brain upgrade (issue #166, ADR 0116): a brain from an older version gets its inline scripts moved into scripts/
// by itself, one undoable change, never twice; a future place ("queries", the issue's example) works with no code of its
// own; nothing is asked of a model when the local scan finds nothing; a failed answer leaves the step pending; every
// Brain page is either a layout entry's page or listed as holding no content.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAIN_LAYOUT, PAGES_WITHOUT_CONTENT, pendingSections, sectionHash, type LayoutSection } from '../../../src/shared/brain-layout';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { candidates, parseVerdicts, readRecord, upgrade, type UpgradeAsk } from '../../../src/main/brainmodel/upgrade';

let root: string, userData: string, log: ChangeLog;
const NOW = Date.parse('2026-10-22T08:00:00Z');
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const PS = ['$rg = "rg-test"', 'az webapp deploy --resource-group $rg --name app-test --src-path dist.zip', 'Write-Output "done"'].join('\n');
const NOTE = `# Ambienti\n\n## Deploy in test\n\nFunziona, lo uso ogni settimana:\n\n\`\`\`powershell\n${PS}\n\`\`\`\n\nAltro testo.\n\n\`\`\`text\nnot a script\nat all\nreally\n\`\`\`\n`;
/** keeps every candidate whose code mentions "deploy" or "customers" */
const smart: UpgradeAsk = async (_s, prompt) => {
  const { candidates: list } = JSON.parse(prompt) as { candidates: { id: string; code: string }[] };
  return { ok: true, text: JSON.stringify({ items: list.map(c => /deploy|customers/i.test(c.code)
    ? { id: c.id, keep: true, name: /customers/i.test(c.code) ? 'clienti-attivi' : 'deploy-test', title: 'Deploy in test', description: 'Pubblica la web app di test.', usage: 'pwsh scripts/deploy-test.ps1', tags: ['deploy'], worked: true }
    : { id: c.id, keep: false }) }) };
};
const ctx = (ask?: UpgradeAsk, layout?: readonly LayoutSection[]) => ({ root, userData, log, app: '0.2.0', ask, now: () => NOW, ...(layout ? { layout } : {}) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upgrade-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upgrade-ud-'));
  log = new ChangeLog(userData, () => NOW);
  write('brain.json', JSON.stringify({ machinery: 'product-v1', rules: {} }, null, 2));
  write('ambienti/test.md', NOTE);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); });

describe('brain upgrade', () => {
  it('moves an inline script into scripts/ with its header and a pointer, in one undoable change, and never twice', async () => {
    const ask = vi.fn(smart);
    const r = await upgrade(ctx(ask));
    expect(r).toMatchObject({ job: 'upgrade', changes: 1 });
    expect(ask).toHaveBeenCalledTimes(1);
    const script = read('scripts/deploy-test.ps1');
    expect(script).toContain('# @title Deploy in test');
    expect(script).toContain('# @tested 2026-10-22 ok: noted as working in ambienti/test.md (Deploy in test)');
    expect(script).toContain(PS); // the code itself, byte for byte
    const note = read('ambienti/test.md');
    expect(note).toContain('→ `scripts/deploy-test.ps1`');
    expect(note).not.toContain('az webapp deploy');
    expect(note).toContain('not a script'); // a text block is not a candidate
    // recorded in brain.json, other keys kept
    const json = JSON.parse(read('brain.json'));
    expect(json.machinery).toBe('product-v1');
    expect(json.layout.app).toBe('0.2.0');
    expect(pendingSections(readRecord(root, userData))).toEqual([]);
    // a second pass asks nothing and changes nothing
    expect(await upgrade(ctx(ask))).toMatchObject({ changes: 0 });
    expect(ask).toHaveBeenCalledTimes(1);
    // Annulla puts everything back; the step is not redone afterwards
    const change = log.all().find(c => c.job === 'upgrade')!;
    log.rollback(change.id, { activeVersion: () => null, restore: () => {} });
    expect(read('ambienti/test.md')).toBe(NOTE);
    expect(fs.existsSync(path.join(root, 'scripts', 'deploy-test.ps1'))).toBe(false);
    expect(await upgrade(ctx(ask))).toMatchObject({ changes: 0 });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('a future place ("queries") needs only its layout entry: kusto blocks become notes in queries/', async () => {
    write('clienti/acme.md', '# Acme\n\n```kusto\nCustomers\n| where active == 1\n| project id, name\n```\n');
    const queries: LayoutSection = { id: 'queries', place: 'queries/', since: '0.3.0', page: 'query', holds: 'Saved SQL queries someone reruns.',
      receives: { kind: 'code-block', languages: ['kusto'], minLines: 3, write: 'note-file' } };
    await upgrade(ctx(smart)); // in line with today's layout first
    const ask = vi.fn(smart);
    const r = await upgrade(ctx(ask, [...BRAIN_LAYOUT, queries]));
    expect(ask).toHaveBeenCalledTimes(1); // only the new entry is looked at
    expect(r.changes).toBe(1);
    expect(read('queries/clienti-attivi.md')).toContain('```kusto\nCustomers\n| where active == 1\n| project id, name\n```');
    expect(read('clienti/acme.md')).toContain('→ `queries/clienti-attivi.md`');
    expect(readRecord(root, userData)!.sections.queries).toBe(sectionHash(queries));
  });

  it('asks nothing when the scan finds nothing (a fresh brain) and records the layout', async () => {
    fs.rmSync(path.join(root, 'ambienti'), { recursive: true });
    const ask = vi.fn(smart);
    expect(await upgrade(ctx(ask))).toMatchObject({ changes: 0 });
    expect(ask).not.toHaveBeenCalled();
    expect(pendingSections(readRecord(root, userData))).toEqual([]);
  });

  it('leaves the step pending when the agent cannot answer, and never reads a block that may hold a credential', async () => {
    const fake = ['gh', 'p_', 'a'.repeat(36)].join(''); // built at run time: no secret-shaped literal in the repo
    write('ambienti/secret.md', `\`\`\`bash\nexport TOKEN=${fake}\ncurl -H "Authorization: Bearer $TOKEN" https://x\necho ok\n\`\`\`\n`);
    expect(candidates(root, BRAIN_LAYOUT.find(s => s.id === 'scripts')!).map(c => c.file)).toEqual(['ambienti/test.md']);
    const r = await upgrade(ctx(async () => ({ ok: false, text: '', reason: 'Nessun motore isolato disponibile' })));
    expect(r.changes).toBe(0);
    expect(r.note).toContain('Nessun motore');
    expect(pendingSections(readRecord(root, userData)).map(s => s.id)).toEqual(['scripts']);
    expect(read('ambienti/test.md')).toBe(NOTE);
  });

  it('keeps a brain without brain.json in line through userData', async () => {
    fs.rmSync(path.join(root, 'brain.json'));
    await upgrade(ctx(smart));
    expect(fs.existsSync(path.join(root, 'brain.json'))).toBe(false);
    expect(pendingSections(readRecord(root, userData))).toEqual([]);
  });

  it('an empty block never swallows the next one, and a script not known to work gets no @tested line', async () => {
    write('ambienti/test.md', `# Vuoto\n\n\`\`\`bash\n\`\`\`\n\nTesto.\n\n\`\`\`bash\necho deploy\necho two\necho three\n\`\`\`\n`);
    const found = candidates(root, BRAIN_LAYOUT.find(s => s.id === 'scripts')!);
    expect(found.map(c => c.code)).toEqual(['echo deploy\necho two\necho three']);
    const untried: UpgradeAsk = async (_s, prompt) => {
      const { candidates: list } = JSON.parse(prompt) as { candidates: { id: string }[] };
      return { ok: true, text: JSON.stringify({ items: list.map(c => ({ id: c.id, keep: true, name: 'deploy-test', title: 'T', description: 'D', worked: false })) }) };
    };
    await upgrade(ctx(untried));
    const script = read('scripts/deploy-test.sh');
    expect(script).not.toContain('@tested');
    expect(read('ambienti/test.md')).toContain('Testo.');
  });

  it('a note edited while the agent was reading keeps its block for the next pass', async () => {
    const edits: UpgradeAsk = async (s, prompt) => { write('ambienti/test.md', `Nuova riga in cima.\n${NOTE}`); return smart(s, prompt); };
    const r = await upgrade(ctx(edits));
    expect(r.changes).toBe(0);
    expect(read('ambienti/test.md')).toContain('az webapp deploy');
    expect(fs.existsSync(path.join(root, 'scripts', 'deploy-test.ps1'))).toBe(false);
  });

  it('never writes through a symlinked scripts/ folder', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upgrade-out-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'scripts'), 'dir');
      await upgrade(ctx(smart));
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(read('ambienti/test.md')).toBe(NOTE);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('an unreadable brain.json is left as it is and the record goes to userData', async () => {
    write('brain.json', '{ broken');
    await upgrade(ctx(smart));
    expect(read('brain.json')).toBe('{ broken');
    expect(pendingSections(readRecord(root, userData))).toEqual([]);
  });

  it('parses only well-formed verdicts for the asked ids', () => {
    expect(parseVerdicts('nope', ['c1'])).toBeNull();
    expect(parseVerdicts('```json\n{"items":[{"id":"c1","keep":true,"name":"Deploy Test!","title":"T","description":"D"},{"id":"c9","keep":true}]}\n```', ['c1']))
      .toEqual([{ id: 'c1', keep: true, name: 'deploy-test', title: 'T', description: 'D', usage: undefined, tags: [], worked: false }]);
    expect(parseVerdicts('{"items":[{"id":"c1","keep":true}]}', ['c1'])).toEqual([{ id: 'c1', keep: false }]); // no name: not kept
  });

  it('every Brain page is a layout entry\'s page or holds no content of its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../src/renderer/brain/index.tsx'), 'utf8');
    const ids = [...src.match(/export type BrainPageId = ([^;]+);/)![1]!.matchAll(/'([a-z]+)'/g)].map(m => m[1]!);
    const covered = new Set([...BRAIN_LAYOUT.map(s => s.page), ...PAGES_WITHOUT_CONTENT]);
    expect(ids.filter(id => !covered.has(id))).toEqual([]);
    expect(new Set(BRAIN_LAYOUT.map(s => s.id)).size).toBe(BRAIN_LAYOUT.length);
  });
});
