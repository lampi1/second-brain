// Migration v2 (#367, ADR 0244): a section that becomes a skill leaves its file for a pointer, the scripts and queries
// only it names move into the skill's scripts/ with their paths rewritten, records never become skills, a forgotten
// skill never comes back (#311), one Undo puts a whole file back and is remembered beyond the change log, and nothing
// moves when an Undo could not give the bytes back. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, type JobContext } from '../../../src/main/brainmodel/jobs';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { readSkills } from '../../../src/main/brainmodel/model';
import { withoutSection } from '../../../src/main/brainmodel/migration-move';
import type { AgentProfile } from '../../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const get = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
function world(roles: string[] = []): JobContext {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-move-'))); roots.push(root);
  const skillDir = path.join(root, '.agents/skills');
  let at = 0;
  return { root, skillDir, skills: () => readSkills([{ dir: skillDir, home: 'brain' }], root, []),
    profiles: () => roles.map(instructions => ({ instructions }) as AgentProfile), runs: () => [], lessons: { pending: () => [], settle: () => {} }, agents: { update: () => null },
    log: new ChangeLog(path.join(root, '..', `${path.basename(root)}-data`), () => ++at), now: () => Date.parse('2026-11-09T10:00:00Z') };
}

describe('migration v2: move, not copy', () => {
  it('moves the section and the scripts only it names; a script named elsewhere, the managed scripts/ and ops/ stay', () => {
    const w = world();
    put(w.root, 'runbook/db.md', '# Database\n\n## Pulire le sessioni\n\n1. Esegui `node runbook/sql/pulisci.mjs`.\n2. Controlla con `runbook/sql/conta.sql`.\n3. Poi `node ops/tools/brain-lint.mjs` e `scripts/backup.ps1`.\n4. Infine `runbook/sql/comune.sql`.\n\n## 2026-10-01 · nota\n\nIl database era lento quel giorno.\n');
    put(w.root, 'runbook/sql/pulisci.mjs', 'console.log("pulisci")\n');
    put(w.root, 'runbook/sql/conta.sql', 'SELECT COUNT(*) FROM sessioni;\n');
    put(w.root, 'runbook/sql/comune.sql', 'SELECT 1;\n');
    put(w.root, 'ops/tools/brain-lint.mjs', '// app\n');
    put(w.root, 'scripts/backup.ps1', '# backup\n');
    put(w.root, 'notes/altro.md', 'Uso anche comune.sql qui.\n');
    const r = migrate(w);
    const item = r.report!.items.find(i => i.title === 'Pulire le sessioni')!;
    expect(item).toMatchObject({ status: 'moved', skill: 'pulire-le-sessioni', note: '2 script spostati con lei' });
    const skill = get(w.root, '.agents/skills/pulire-le-sessioni/SKILL.md');
    expect(skill).toContain('`node ${CLAUDE_SKILL_DIR}/scripts/pulisci.mjs`');
    expect(skill).toContain('`${CLAUDE_SKILL_DIR}/scripts/conta.sql`');
    expect(skill).toContain('`node ops/tools/brain-lint.mjs`'); // app machinery: never moved
    expect(skill).toContain('`scripts/backup.ps1`'); // the brain's managed scripts: they stay on their page
    expect(skill).toContain('`runbook/sql/comune.sql`'); // named in another note: it stays
    expect(get(w.root, '.agents/skills/pulire-le-sessioni/scripts/pulisci.mjs')).toBe('console.log("pulisci")\n');
    expect(fs.existsSync(path.join(w.root, 'runbook/sql/pulisci.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(w.root, 'runbook/sql/conta.sql'))).toBe(false);
    expect(fs.existsSync(path.join(w.root, 'runbook/sql/comune.sql'))).toBe(true);
    expect(get(w.root, 'runbook/db.md')).toBe('# Database\n\n## Pulire le sessioni\n\n→ Spostata nella skill `pulire-le-sessioni` il 2026-11-09.\n\n## 2026-10-01 · nota\n\nIl database era lento quel giorno.\n');
    // a second pass finds nothing: no copy, no duplicate
    expect(migrate(w).changes).toBe(0);
    // one Undo puts the section and the scripts back, and removes the skill
    const change = w.log.all().find(c => c.target === 'pulire-le-sessioni')!;
    const agents = { activeVersion: () => null, restore: () => {} };
    expect(w.log.canRollback(change, agents)).toBe(true);
    w.log.rollback(change.id, agents);
    expect(get(w.root, 'runbook/db.md')).toContain('1. Esegui `node runbook/sql/pulisci.mjs`.');
    expect(get(w.root, 'runbook/sql/pulisci.mjs')).toBe('console.log("pulisci")\n');
    expect(fs.existsSync(path.join(w.root, '.agents/skills/pulire-le-sessioni/SKILL.md'))).toBe(false);
    // the Undo is the decision: the next pass does not move it again
    migrate(w);
    expect(fs.existsSync(path.join(w.root, '.agents/skills/pulire-le-sessioni/SKILL.md'))).toBe(false);
    expect(get(w.root, 'runbook/db.md')).toContain('1. Esegui');
    // remembered in the brain: a change log that forgot the Undo does not bring the move back
    w.log = new ChangeLog(path.join(w.root, '..', `${path.basename(w.root)}-data2`), () => 1);
    migrate(w);
    expect(fs.existsSync(path.join(w.root, '.agents/skills/pulire-le-sessioni/SKILL.md'))).toBe(false);
    expect(get(w.root, 'runbook/db.md')).toContain('1. Esegui');
  });
  it('never moves a section whose credentials are hidden in the skill: the file keeps the only full text', () => {
    const w = world();
    put(w.root, 'runbook/prod.md', `# Prod\n\n## Query sul cliente\n\n1. Collegati con Server=tcp:x;User ID=a;${'Pass'}${'word'}=segreto-finto-1;\n2. Esegui la query.\n`);
    const item = migrate(w).report!.items[0]!;
    expect(item.status).toBe('moved');
    expect(item.note).toMatch(/credenziali.*resta anche nel file/);
    expect(get(w.root, 'runbook/prod.md')).toContain('segreto-finto-1');
    expect(get(w.root, `.agents/skills/${item.skill}/SKILL.md`)).not.toContain('segreto-finto-1');
  });
  it('a forgotten skill never comes back: its section left the file at the first pass (#311)', () => {
    const w = world();
    put(w.root, 'routines.md', '# Routine\n\n## Brief del mattino\n\n1. Leggi now.md.\n2. Scrivi tre righe.\n');
    const name = migrate(w).report!.items[0]!.skill!;
    const file = path.join(w.skillDir, name, 'SKILL.md');
    w.log.apply({ job: 'research', kind: 'skill', action: 'remove', target: name, summary: 'Dimenticata', reason: 'Mai usata', evidence: [] }, [{ file, text: null, removed: [{ item: '*', reason: 'Mai usata' }] }]);
    for (let i = 0; i < 2; i++) { migrate(w); expect(fs.existsSync(file)).toBe(false); }
  });
  it('several sections of one file move in one pass, each found where it is after the previous move', () => {
    const w = world();
    put(w.root, 'runbook/rilasci.md', '# Rilasci\n\n## In test\n\n1. Crea il tag.\n2. Avvia la pipeline.\n\n## In produzione\n\n1. Chiedi il via.\n2. Promuovi la build.\n');
    const r = migrate(w);
    expect(r.report!.items.map(i => i.status)).toEqual(['moved', 'moved']);
    expect(get(w.root, '.agents/skills/in-produzione/SKILL.md')).toContain('Promuovi la build');
    expect(get(w.root, 'runbook/rilasci.md')).toBe('# Rilasci\n\n## In test\n\n→ Spostata nella skill `in-test` il 2026-11-09.\n\n## In produzione\n\n→ Spostata nella skill `in-produzione` il 2026-11-09.\n');
    // one change for the file: one Undo puts it back whole and removes both skills
    expect(r.changes).toBe(1);
    w.log.rollback(w.log.all()[0]!.id, { activeVersion: () => null, restore: () => {} });
    expect(get(w.root, 'runbook/rilasci.md')).toContain('2. Promuovi la build.');
    expect(fs.existsSync(path.join(w.skillDir, 'in-test'))).toBe(false);
  });
  it('a file that is not plain UTF-8 is copied, never moved: an Undo could not give its bytes back', () => {
    const w = world();
    const bytes = Buffer.concat([Buffer.from('# Caff'), Buffer.from([0xe8]), Buffer.from('\n\n## Preparare\n\n1. Macina.\n2. Versa.\n')]);
    put(w.root, 'runbook/bar.md', ''); fs.writeFileSync(path.join(w.root, 'runbook/bar.md'), bytes);
    const item = migrate(w).report!.items[0]!;
    expect(item.note).toMatch(/UTF-8/);
    expect(fs.readFileSync(path.join(w.root, 'runbook/bar.md')).equals(bytes)).toBe(true);
  });
  it('a copy the user edited after the first migration keeps its section in the file', () => {
    const w = world();
    put(w.root, 'routines.md', '# Routine\n\n## Chiusura\n\n1. Salva il lavoro.\n2. Scrivi il diario.\n');
    const name = migrate({ ...w, auto: true }).report!.items[0]!.skill!;
    expect(get(w.root, 'routines.md')).toContain('1. Salva il lavoro.'); // the app's own pass only copies
    const file = path.join(w.skillDir, name, 'SKILL.md');
    fs.writeFileSync(file, get(w.root, `.agents/skills/${name}/SKILL.md`).replace('1. Salva il lavoro.', '1. Salva tutto, anche le bozze.'));
    const item = migrate(w).report!.items[0]!;
    expect(item).toMatchObject({ status: 'existing', note: expect.stringMatching(/skill è cambiata/) });
    expect(get(w.root, 'routines.md')).toContain('1. Salva il lavoro.');
  });
  it('scripts that find files next to themselves, or that a role names, stay; a numbered file with no title keeps its frontmatter', () => {
    const w = world(['Usa sempre `runbook/ruolo.sh` prima di partire.']);
    put(w.root, 'runbook/svc.md', '# Servizio\n\n## Riavvio\n\n1. Esegui `runbook/vicino.ps1`.\n2. Poi `runbook/ruolo.sh`.\n');
    put(w.root, 'runbook/vicino.ps1', '. "$PSScriptRoot\\common.ps1"\n');
    put(w.root, 'runbook/ruolo.sh', 'echo ok\n');
    put(w.root, 'runbook/passi.md', '---\ntitle: Passi\n---\n\n## 1. Primo\n\nApri il pannello e controlla.\n\n## 2. Secondo\n\nChiudi il pannello e annota.\n');
    const r = migrate(w);
    expect(r.report!.items.find(i => i.title === 'Riavvio')).toMatchObject({ status: 'moved' });
    expect(fs.existsSync(path.join(w.root, 'runbook/vicino.ps1'))).toBe(true);
    expect(fs.existsSync(path.join(w.root, 'runbook/ruolo.sh'))).toBe(true);
    expect(get(w.root, '.agents/skills/riavvio/SKILL.md')).toContain('`runbook/vicino.ps1`');
    const passi = r.report!.items.find(i => i.source.startsWith('runbook/passi.md'));
    expect(passi).toMatchObject({ status: 'moved', note: expect.stringMatching(/titolo/) });
    expect(get(w.root, 'runbook/passi.md')).toMatch(/^---\ntitle: Passi\n---\n/);
  });
  it('a script moves only when nothing could break: no exec bit, no sibling import, no caller in any file, no stale path', () => {
    const w = world();
    put(w.root, 'runbook/ops.md', '# Ops\n\n## Giro\n\n1. Lancia `runbook/x/run.sh`.\n2. Poi `runbook/x/calc.py`.\n3. Poi `runbook/x/chiamata.ps1`.\n4. Poi `runbook/x/win.ps1` (o C:\\brain\\runbook\\x\\win.ps1).\n5. Infine `runbook/x/ok.sql`.\n');
    put(w.root, 'runbook/x/run.sh', 'echo hi\n'); fs.chmodSync(path.join(w.root, 'runbook/x/run.sh'), 0o755);
    put(w.root, 'runbook/x/calc.py', 'import helpers\nprint(helpers.go())\n');
    put(w.root, 'runbook/x/helpers.py', 'def go(): return 1\n');
    put(w.root, 'runbook/x/chiamata.ps1', 'Write-Host ok\n');
    fs.writeFileSync(path.join(w.root, 'Makefile'), 'all:\n\tpwsh runbook/x/chiamata.ps1\n');
    put(w.root, 'runbook/x/win.ps1', 'Write-Host win\n');
    put(w.root, 'runbook/x/ok.sql', 'SELECT 1;\n');
    const item = migrate(w).report!.items[0]!;
    // Windows has no exec bit, so run.sh moves too (the line below already says so).
    expect(item.note).toBe(`${process.platform === 'win32' ? 2 : 1} script spostati con lei`);
    for (const f of ['run.sh', 'calc.py', 'chiamata.ps1', 'win.ps1']) expect(fs.existsSync(path.join(w.root, 'runbook/x', f))).toBe(process.platform === 'win32' && f === 'run.sh' ? false : true);
    expect(fs.existsSync(path.join(w.root, 'runbook/x/ok.sql'))).toBe(false);
  });
  it('a script a UTF-16 file names stays', () => {
    const w = world();
    put(w.root, 'runbook/a.md', '# A\n\n## Passo\n\n1. Esegui `runbook/s/uno.ps1`.\n2. Controlla.\n');
    put(w.root, 'runbook/s/uno.ps1', 'Write-Host 1\n');
    fs.writeFileSync(path.join(w.root, 'avvio.ps1'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('& .\\runbook\\s\\uno.ps1\r\n', 'utf16le')]));
    migrate(w);
    expect(fs.existsSync(path.join(w.root, 'runbook/s/uno.ps1'))).toBe(true);
  });
  it('a moved skill is never regenerated from a new section with the same title', () => {
    const w = world();
    put(w.root, 'runbook/d.md', '# D\n\n## Deploy\n\n1. Vecchio passo uno.\n2. Vecchio passo due.\n');
    migrate(w);
    const skill = get(w.root, '.agents/skills/deploy/SKILL.md');
    put(w.root, 'runbook/d.md', '# D\n\n## Deploy\n\n1. Nuovo passo uno.\n2. Nuovo passo due.\n');
    const item = migrate(w).report!.items[0]!;
    expect(item).toMatchObject({ status: 'existing', note: expect.stringMatching(/rivedilo/) });
    expect(get(w.root, '.agents/skills/deploy/SKILL.md')).toBe(skill);
    expect(get(w.root, 'runbook/d.md')).toContain('Nuovo passo uno');
  });
  it('withoutSection keeps CRLF and returns null for a section that is gone', () => {
    const text = '# A\r\n\r\n## Passi\r\n\r\n1. Uno.\r\n2. Due.\r\n';
    expect(withoutSection('runbook/a.md', text, 'runbook/a.md#passi', 'X')).toBe('# A\r\n\r\n## Passi\r\n\r\nX\r\n');
    expect(withoutSection('runbook/a.md', text, 'runbook/a.md#altro', 'X')).toBeNull();
    // only the section's lines change: elsewhere blank runs and mixed line endings keep their bytes
    const mixed = '# A\n\n\n\nIntro.\r\n\n## Passi\n\n1. Uno.\n2. Due.\n\n\n\n## Dopo\r\nFine.';
    expect(withoutSection('runbook/a.md', mixed, 'runbook/a.md#passi', 'X')).toBe('# A\n\n\n\nIntro.\r\n\n## Passi\n\nX\n\n## Dopo\r\nFine.');
  });
});
