// Compatibility merge helpers must retain all text and stable identities without reviving migrated sources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeSkills, migrate, skillText, type JobContext } from '../../../src/main/brainmodel/jobs';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { readSkills } from '../../../src/main/brainmodel/model';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function world(): JobContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-jobs-')); roots.push(root);
  const skillDir = path.join(root, '.claude/skills');
  let at = 0;
  return { root, skillDir, skills: () => readSkills([{ dir: skillDir, home: 'brain' }], root, []),
    profiles: () => [], runs: () => [], lessons: { pending: () => [], settle: () => {} }, agents: { update: () => null },
    log: new ChangeLog(path.join(root, 'data'), () => ++at), now: () => 42 };
}
const body = '1. Prepare artifact pipeline workspace fixture.\n2. Inspect configuration dependency result output.\n3. Verify integration checks before release approval.\n';
describe('compatibility skill merges', () => {
  it('protects migrated source identities from the legacy semantic merge helper', () => {
    const w = world(); fs.mkdirSync(path.join(w.root, 'runbooks'));
    fs.writeFileSync(path.join(w.root, 'runbooks/deploy.md'), `# Procedures\n\n## Alpha deployment\n${body}\n## Beta deployment\n${body}`);
    expect(migrate(w).changes).toBe(2);
    expect(mergeSkills(w).changes).toBe(0);
    expect(migrate(w).changes).toBe(0);
    expect(w.skills()).toHaveLength(2);
  });
  it('keeps all three merged texts and never reverses an explicitly undone merge', () => {
    const w = world();
    for (const name of ['alpha', 'beta', 'gamma']) {
      const dir = path.join(w.skillDir, name); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText(name, 'Fixture', `${body}4. ${name} extra evidence.`));
    }
    expect(mergeSkills(w).changes).toBe(2);
    const text = fs.readFileSync(w.skills()[0]!.file, 'utf8');
    expect(text).toContain('alpha extra'); expect(text).toContain('beta extra'); expect(text).toContain('gamma extra');
    const last = w.log.all().at(-1)!;
    w.log.rollback(last.id, { activeVersion: () => null, restore: () => {} });
    expect(mergeSkills(w).changes).toBe(0);
  });
});
