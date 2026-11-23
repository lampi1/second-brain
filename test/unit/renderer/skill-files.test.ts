// Every file of a skill's package lands in one group, with the kind a person reads at a glance (script, query, reference,
// asset), and only Brain skills are deleted. Pins renderer/lib/skill-files.ts.
import { describe, expect, it } from 'vitest';
import { deleteAction, extOfPath, groupFiles, isImagePath, kindCounts, kindOfFile } from '../../../src/renderer/lib/skill-files';
import type { SkillFile, SkillParts } from '../../../src/shared/skill-library';

const file = (path: string, text = true): SkillFile => ({ path, size: 10, text });
const noParts: SkillParts = { scripts: [], queries: [], references: [], assets: [] };

describe('skill files', () => {
  it('reads the kind from the folder, then from the extension', () => {
    const kinds = Object.fromEntries(['SKILL.md', 'scripts/a.py', 'assets/queries/x.md', 'assets/x.sql', 'query.kql', 'references/doc.md', 'assets/logo.png', 'run.mjs', 'notes.md', 'agents/openai.yaml', 'sub/SKILL.md'].map(p => [p, kindOfFile(p)]));
    expect(kinds).toEqual({
      'SKILL.md': 'instructions', 'scripts/a.py': 'script', 'assets/queries/x.md': 'query', 'assets/x.sql': 'query', 'query.kql': 'query',
      'references/doc.md': 'reference', 'assets/logo.png': 'asset', 'run.mjs': 'script', 'notes.md': 'other', 'agents/openai.yaml': 'other', 'sub/SKILL.md': 'other',
    });
  });

  it('groups every file exactly once, with the header\'s title and a language label', () => {
    const files = [file('scripts/b.py'), file('SKILL.md'), file('assets/queries/q.md'), file('scripts/a.sh'), file('assets/x.bin', false), file('LICENSE')];
    const parts: SkillParts = { ...noParts, scripts: [{ path: 'scripts/b.py', title: 'Deploy', description: 'Pushes it', language: 'Python', tested: 'ok' }], queries: [{ path: 'assets/queries/q.md', title: 'Errors', description: '', language: 'KQL' }] };
    const groups = groupFiles({ files, parts });
    expect(groups.map(g => [g.kind, g.items.map(i => i.path)])).toEqual([
      ['instructions', ['SKILL.md']], ['script', ['scripts/a.sh', 'scripts/b.py']], ['query', ['assets/queries/q.md']], ['asset', ['assets/x.bin']], ['other', ['LICENSE']],
    ]);
    expect(groups.flatMap(g => g.items)).toHaveLength(files.length);
    const [a, b] = groups[1]!.items;
    expect(a).toMatchObject({ title: 'a.sh', language: 'Shell' });
    expect(b).toMatchObject({ title: 'Deploy', description: 'Pushes it', language: 'Python', tested: 'ok' });
    expect(groups[2]!.items[0]!.language).toBe('KQL');
  });

  it('counts the kinds besides SKILL.md', () => {
    expect(kindCounts([file('SKILL.md'), file('scripts/a.py'), file('scripts/b.py'), file('references/x.md')])).toEqual([{ kind: 'script', n: 2 }, { kind: 'reference', n: 1 }]);
    expect(kindCounts([file('SKILL.md')])).toEqual([]);
  });

  it('knows the extension and the images it can show', () => {
    expect([extOfPath('a/b.PY'), extOfPath('LICENSE'), extOfPath('.gitignore'), extOfPath('a.b/c')]).toEqual(['py', '', '', '']);
    expect([isImagePath('assets/x.PNG'), isImagePath('assets/x.svg'), isImagePath('x.pdf')]).toEqual([true, false, false]);
  });

  it('deletes a Brain skill, restores an app skill\'s Brain copy, never deletes an app skill', () => {
    expect(deleteAction({ origin: 'brain', overridesApp: false })).toBe('delete');
    expect(deleteAction({ origin: 'brain', overridesApp: true })).toBe('restore');
    expect(deleteAction({ origin: 'app', overridesApp: false })).toBe('none');
  });
});
