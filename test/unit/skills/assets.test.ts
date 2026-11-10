// Scripts and queries belong to skills (ADR 0263): the automatic, idempotent move of the brain's old scripts/ and
// queries/ into the one skill that names each file (with a backup and Annulla), the list of the files it cannot place,
// the user's pick for one of them, and the package's groups the Skill page shows. Real files in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignAsset, migrateAssets, skillParts, unassignedAssets } from '../../../src/main/skills/assets';
import { packageFiles } from '../../../src/main/skills/library';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { queryNote } from '../../../src/main/brain/queries';
import { withHeader, type SkillPlace } from '../../../src/main/brain/scripts';

let root: string, ud: string, log: ChangeLog;
const NO_AGENT = { activeVersion: () => null, restore: () => { throw new Error('no'); } };
const write = (rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (rel: string) => fs.existsSync(path.join(root, rel));
const skill = (name: string, body: string): SkillPlace => {
  write(`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: d\n---\n${body}\n`);
  return { name, origin: 'brain', folder: path.join(root, '.agents', 'skills', name) };
};
const meta = { title: 'Deploy in test', description: 'Pubblica la web app di test', tested: { ok: true, note: 'ok', at: '2026-11-10' } };
const deps = (skills: SkillPlace[]) => ({ root, skills, log, backupDir: path.join(ud, 'backups'), now: () => new Date(Date.UTC(2026, 10, 10, 12)) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-assets-'));
  ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-assets-ud-'));
  log = new ChangeLog(ud);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(ud, { recursive: true, force: true }); });

describe('the move of the old scripts/ and queries/ into their skills', () => {
  it('moves what one skill names, rewrites its paths, keeps a copy, lists the rest; a second pass changes nothing', () => {
    const deploy = skill('deploy', '1. Lancia `scripts/deploy.ps1`.');
    const report = skill('report', 'Usa la query clienti.md del lunedì.');
    const other = skill('vendite', 'Anche qui: queries/comune.md.');
    write('scripts/deploy.ps1', withHeader('deploy.ps1', 'Write-Output ok', meta));
    write('scripts/orfano.sh', 'echo hi\n');
    write('scripts/.deleted/20261101-x.sh', 'old\n');
    write('queries/clienti.md', queryNote('kusto', 'Clienti | take 10', { title: 'Clienti', description: 'Elenco' }));
    write('queries/comune.md', queryNote('sql', 'SELECT 1', { title: 'Comune', description: 'In due skill' }));
    write('.agents/skills/report/references/guida.md', 'Vedi anche queries/comune.md.\n');
    const skills = [deploy, report, other];
    const r = migrateAssets(deps(skills));
    expect(r.moved.sort()).toEqual(['queries/clienti.md → report', 'scripts/deploy.ps1 → deploy']);
    expect(has('scripts/deploy.ps1')).toBe(false);
    expect(read('.agents/skills/deploy/scripts/deploy.ps1')).toContain('Write-Output ok');
    expect(read('.agents/skills/deploy/SKILL.md')).toContain('`${CLAUDE_SKILL_DIR}/scripts/deploy.ps1`');
    expect(read('.agents/skills/report/assets/queries/clienti.md')).toContain('Clienti | take 10');
    // the copy, before anything moved
    expect(fs.readFileSync(path.join(ud, 'backups', '20261110-120000', 'scripts', 'deploy.ps1'), 'utf8')).toContain('Write-Output ok');
    expect(fs.existsSync(path.join(ud, 'backups', '20261110-120000', 'queries', 'clienti.md'))).toBe(true);
    // no skill names it, two skills name it: they stay, listed; the old trash stays as it is
    expect(r.unassigned.map(u => [u.kind, u.name, u.reason, u.candidates])).toEqual([
      ['script', 'orfano.sh', 'none', []], ['query', 'comune.md', 'many', ['report', 'vendite']],
    ]);
    expect(r.unassigned[1]!.title).toBe('Comune');
    expect(has('scripts/.deleted/20261101-x.sh')).toBe(true);
    // idempotent
    const again = migrateAssets(deps(skills));
    expect(again.moved).toEqual([]);
    expect(again.unassigned).toEqual(r.unassigned);
    expect(unassignedAssets(root, skills).map(u => u.name)).toEqual(['orfano.sh', 'comune.md']);
    // each move is one change with Annulla: it puts the file and the skill's text back
    const c = log.all().find(x => x.summary.includes('deploy.ps1'))!;
    expect(c).toMatchObject({ job: 'migration', target: 'deploy' });
    log.rollback(c.id, NO_AGENT);
    expect(has('scripts/deploy.ps1')).toBe(true);
    expect(has('.agents/skills/deploy/scripts/deploy.ps1')).toBe(false);
    expect(read('.agents/skills/deploy/SKILL.md')).toContain('`scripts/deploy.ps1`');
  });

  it('a copy already in the skill only leaves the old folder; another file with that name in the skill is a conflict', () => {
    const deploy = skill('deploy', 'Lancia scripts/uguale.sh e scripts/diverso.sh.');
    write('scripts/uguale.sh', 'echo 1\n');
    write('.agents/skills/deploy/scripts/uguale.sh', 'echo 1\n');
    write('scripts/diverso.sh', 'echo 2\n');
    write('.agents/skills/deploy/scripts/diverso.sh', 'echo altro\n');
    const r = migrateAssets(deps([deploy]));
    expect(r.moved).toEqual(['scripts/uguale.sh → deploy']);
    expect(has('scripts/uguale.sh')).toBe(false);
    expect(r.unassigned.map(u => [u.name, u.reason])).toEqual([['diverso.sh', 'conflict']]);
    expect(read('.agents/skills/deploy/scripts/diverso.sh')).toBe('echo altro\n');
  });

  it('the user places a file no skill names; an app or user skill is never a target', () => {
    const deploy = skill('deploy', 'Niente.');
    write('scripts/orfano.sh', 'echo hi\n');
    const app: SkillPlace = { name: 'app-skill', origin: 'app', folder: path.join(root, 'app-skill') };
    expect(assignAsset(deps([deploy, app]), { kind: 'script', name: 'orfano.sh', skill: 'app-skill' })).toMatchObject({ ok: false });
    expect(assignAsset(deps([deploy, app]), { kind: 'script', name: 'orfano.sh', skill: 'deploy' })).toMatchObject({ ok: true, file: 'deploy/scripts/orfano.sh' });
    expect(read('.agents/skills/deploy/scripts/orfano.sh')).toBe('echo hi\n');
    expect(log.all().at(-1)).toMatchObject({ job: 'user', target: 'deploy' });
    expect(assignAsset(deps([deploy]), { kind: 'script', name: 'orfano.sh', skill: 'deploy' })).toMatchObject({ ok: false });
  });
});

describe('what the move never does', () => {
  it('an undone move is not done again; a file that is not UTF-8 stays; a script keeps its mode', () => {
    const deploy = skill('deploy', 'Lancia scripts/a.sh e scripts/win.ps1.');
    write('scripts/a.sh', 'echo a\n');
    fs.chmodSync(path.join(root, 'scripts/a.sh'), 0o755);
    fs.writeFileSync(path.join(root, 'scripts/win.ps1'), Buffer.from('\ufeffWrite-Output è', 'utf16le'));
    const r = migrateAssets(deps([deploy]));
    expect(r.moved).toEqual(['scripts/a.sh → deploy']);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(root, '.agents/skills/deploy/scripts/a.sh')).mode & 0o777).toBe(0o755);
    expect(r.unassigned.map(u => [u.name, u.reason])).toEqual([['win.ps1', 'not-utf8']]);
    expect(has('scripts/win.ps1')).toBe(true);
    // Annulla sticks: the next launch lists it instead of moving it again
    log.rollback(log.all().find(c => c.job === 'migration')!.id, NO_AGENT);
    expect(has('scripts/a.sh')).toBe(true);
    const again = migrateAssets(deps([deploy]));
    expect(again.moved).toEqual([]);
    expect(again.unassigned.map(u => [u.name, u.reason])).toEqual([['a.sh', 'undone'], ['win.ps1', 'not-utf8']]);
    expect(unassignedAssets(root, [deploy], log).map(u => u.reason)).toEqual(['undone', 'not-utf8']);
    // the undo outlives the change log (a marker in the brain's ops/state/migration-kept/)
    const fresh = new ChangeLog(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-assets-ud2-')));
    expect(migrateAssets({ ...deps([deploy]), log: fresh }).unassigned.map(u => u.reason)).toEqual(['undone', 'not-utf8']);
    // the user can still place it
    expect(assignAsset(deps([deploy]), { kind: 'script', name: 'a.sh', skill: 'deploy' })).toMatchObject({ ok: true });
    expect(assignAsset(deps([deploy]), { kind: 'script', name: 'win.ps1', skill: 'deploy' })).toMatchObject({ ok: false });
  });

  it('a copy in a skill that does not name it, while another skill does, is no reason to drop the old file', () => {
    const a = skill('a', 'Niente.');
    const b = skill('b', 'Lancia scripts/x.sh.');
    write('scripts/x.sh', 'echo x\n');
    write('.agents/skills/a/scripts/x.sh', 'echo x\n');
    const r = migrateAssets(deps([a, b]));
    expect(r.moved).toEqual(['scripts/x.sh → b']);
    expect(read('.agents/skills/b/SKILL.md')).toContain('${CLAUDE_SKILL_DIR}/scripts/x.sh');
  });
});

describe('Windows paths and links', () => {
  it('a reference written with a backslash moves and is rewritten', () => {
    const deploy = skill('deploy', 'powershell -File scripts\\backup.ps1');
    write('scripts/backup.ps1', 'Write-Output ok\n');
    expect(migrateAssets(deps([deploy])).moved).toEqual(['scripts/backup.ps1 → deploy']);
    expect(read('.agents/skills/deploy/SKILL.md')).toContain('powershell -File ${CLAUDE_SKILL_DIR}/scripts/backup.ps1');
  });

  it('a path elsewhere that ends with the name is not a reference', () => {
    const deploy = skill('deploy', 'Vedi C:\\tools\\backup.ps1');
    write('scripts/backup.ps1', 'Write-Output ok\n');
    expect(migrateAssets(deps([deploy])).unassigned.map(u => u.reason)).toEqual(['none']);
  });

  it.skipIf(process.platform === 'win32')('never moves through a skill folder that links outside the skill', () => {
    const deploy = skill('deploy', 'Lancia scripts/x.sh.');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-assets-out-'));
    fs.symlinkSync(out, path.join(deploy.folder, 'scripts'));
    write('scripts/x.sh', 'echo x\n');
    const r = migrateAssets(deps([deploy]));
    expect(r.moved).toEqual([]);
    expect(fs.readdirSync(out)).toEqual([]);
    expect(has('scripts/x.sh')).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe('the package by its groups', () => {
  it('shows scripts with their header, queries with their language, references and assets', () => {
    const s = skill('deploy', 'x');
    write('.agents/skills/deploy/scripts/deploy.ps1', withHeader('deploy.ps1', 'Write-Output ok', meta));
    write('.agents/skills/deploy/assets/queries/clienti.md', queryNote('kusto', 'Clienti', { title: 'Clienti attivi', description: 'Per il lunedì' }));
    write('.agents/skills/deploy/references/api.md', '# Le API del servizio\n\ntesto\n');
    write('.agents/skills/deploy/assets/modello.txt', 'x');
    const p = skillParts(s.folder, packageFiles(s.folder));
    expect(p.scripts).toEqual([{ path: 'scripts/deploy.ps1', title: 'Deploy in test', description: 'Pubblica la web app di test', language: 'PowerShell', tested: 'ok' }]);
    expect(p.queries).toEqual([{ path: 'assets/queries/clienti.md', title: 'Clienti attivi', description: 'Per il lunedì', language: 'KQL' }]);
    expect(p.references.map(r => r.title)).toEqual(['Le API del servizio']);
    expect(p.assets.map(a => a.path)).toEqual(['assets/modello.txt']);
  });
});
