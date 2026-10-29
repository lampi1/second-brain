// eslint.config.js's local rules (ADR 0198, docs/agents/rules.md): sb/file-header fails a file with no header comment
// and sb/max-lines warns on a new file over 800 lines, each message saying the fix; the files over it today are exempt.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { ESLint } from 'eslint';

const cwd = path.join(import.meta.dirname, '..', '..');
const eslint = new ESLint({ cwd });
const lint = async (text: string, file: string) => (await eslint.lintText(text, { filePath: path.join(cwd, file) }))[0]!.messages;

describe('repo lint rules', () => {
  it('a file without a header comment is an error that says the fix', async () => {
    const m = await lint('export const a = 1;\n', 'src/shared/new-file.ts');
    expect(m.map(x => [x.ruleId, x.severity])).toEqual([['sb/file-header', 2]]);
    expect(m[0]!.message).toContain('Fix: start it with a // comment');
    expect(await lint('// what, why, who uses it\nexport const a = 1;\n', 'src/shared/new-file.ts')).toEqual([]);
    expect(await lint('#!/usr/bin/env node\n/* header */\nconsole.log(1);\n', 'scripts/new-tool.mjs')).toEqual([]);
  });

  it('a new file over 800 lines warns, never fails; the known long files are exempt', async () => {
    const long = '// header\n' + Array.from({ length: 805 }, (_, i) => `export const a${i} = ${i};`).join('\n') + '\n';
    const m = await lint(long, 'src/shared/new-long.ts');
    expect(m.map(x => [x.ruleId, x.severity])).toEqual([['sb/max-lines', 1]]);
    expect(m[0]!.message).toContain('Fix: split it by responsibility');
    expect(await lint(long, 'src/main/chats/claude.ts')).toEqual([]);
  });
});
