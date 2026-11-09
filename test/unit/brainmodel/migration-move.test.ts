// Migration v2 (#367, ADR 0244): a section that becomes a skill leaves its file for a pointer, the scripts and queries
// only it names move into the skill's scripts/ with their paths rewritten, records never become skills, a forgotten
// skill never comes back (#311), and one Undo puts everything back. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, type JobContext } from '../../../src/main/brainmodel/jobs';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { readSkills } from '../../../src/main/brainmodel/model';
import { withoutSection } from '../../../src/main/brainmodel/migration-move';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const get = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
function world(): JobContext {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-move-'))); roots.push(root);
  const skillDir = path.join(root, '.agents/skills');
  let at = 0;
  return { root, skillDir, skills: () => readSkills([{ dir: skillDir, home: 'brain' }], root, []),
    profiles: () => [], runs: () => [], lessons: { pending: () => [], settle: () => {} }, agents: { update: () => null },
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
    expect(skill).toContain('`node scripts/pulisci.mjs`');
    expect(skill).toContain('`scripts/conta.sql`');
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
    w.log.rollback(change.id, { activeVersion: () => null, restore: () => {} });
    expect(get(w.root, 'runbook/db.md')).toContain('1. Esegui `node runbook/sql/pulisci.mjs`.');
    expect(get(w.root, 'runbook/sql/pulisci.mjs')).toBe('console.log("pulisci")\n');
    expect(fs.existsSync(path.join(w.root, '.agents/skills/pulire-le-sessioni/SKILL.md'))).toBe(false);
    // the Undo is the decision: the next pass does not move it again
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
  });
  it('withoutSection keeps CRLF and returns null for a section that is gone', () => {
    const text = '# A\r\n\r\n## Passi\r\n\r\n1. Uno.\r\n2. Due.\r\n';
    expect(withoutSection('runbook/a.md', text, 'runbook/a.md#passi', 'X')).toBe('# A\r\n\r\n## Passi\r\n\r\nX\r\n');
    expect(withoutSection('runbook/a.md', text, 'runbook/a.md#altro', 'X')).toBeNull();
  });
});
