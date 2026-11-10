// The package checks of #373 (shared/skill-lint.ts): name = folder, a description that says when to use the skill,
// SKILL.md under 500 lines, no link to a file the package does not have; and every skill the app ships passes them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintSkill, lintText } from '../../../src/shared/skill-lint';

const md = (name: string, description: string, body = '# x\n') => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
const codes = (name: string, text: string, files: string[] = ['SKILL.md']) => lintSkill(name, text, files.map(p => ({ path: p }))).map(w => w.detail ? `${w.code}:${w.detail}` : w.code);

describe('the package checks', () => {
  it('flags a name that is not the folder, a description with no «when», a long body and a missing file', () => {
    expect(codes('export', md('export', 'Exports and their failures. Use when an export times out or rows are missing.'))).toEqual([]);
    expect(codes('export', md('esporta', 'Use when exporting.'))).toEqual(['name-folder:esporta']);
    expect(codes('export', md('export', 'Helps with exports.'))).toEqual(['no-when']);
    expect(codes('export', md('export', 'Esportazioni. Usala quando un export va in timeout.'))).toEqual([]);
    expect(codes('export', md('export', 'Exporte. Nutze ihn, wenn ein Export hängt.'))).toEqual([]);
    expect(codes('export', md('export', 'Use when exporting.', 'x\n'.repeat(520)))).toEqual(['long:521']);
  });

  it('checks the package paths SKILL.md names; placeholders, URLs and other folders are not files', () => {
    const body = [
      'Run `${CLAUDE_SKILL_DIR}/scripts/run.ps1`, then read [the guide](references/guide.md).',
      'Template: assets/report.md. Old: scripts/gone.sh.',
      'Examples: `${CLAUDE_SKILL_DIR}/scripts/<file>`, scripts/, see https://example.com/x.md and ops/tools/scripts/x.mjs.',
    ].join('\n');
    expect(codes('r', md('r', 'Use when r.', body), ['SKILL.md', 'scripts/run.ps1', 'references/guide.md', 'assets/report.md'])).toEqual(['missing-file:scripts/gone.sh']);
    expect(lintText({ code: 'missing-file', detail: 'scripts/gone.sh' })).toContain('scripts/gone.sh');
  });

  it('every skill the app ships passes them', () => {
    const dir = path.resolve(import.meta.dirname, '../../../brain-template/harness/claude/skills');
    const walk = (d: string, base = ''): { path: string }[] => fs.readdirSync(d, { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [{ path: base + e.name }]));
    const bad = fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'SKILL.md')))
      .flatMap(n => lintSkill(n, fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8'), walk(path.join(dir, n))).map(w => `${n}: ${lintText(w)}`));
    expect(bad).toEqual([]);
  });
});
