// One line of an always-loaded file replaced by the maintenance (issue #435, ADR 0320; brainmodel/rule-line.ts): the
// line is found once by its whole text, its indentation and every line end stay, and a line about safety,
// permissions, settings, hooks, production or secrets (or under such a heading, in any form a heading takes) is never
// changed, nor is a code fence line; the fixed core never grows past its budget; the tool's early check names the
// always-loaded files and refuses any other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alwaysLoadedText, editAlwaysLoaded, editRuleLine, ruleLineChange } from '../../../src/main/brainmodel/rule-line';

const FILE = ['# Agents', '', '## Commits', '', '- Stage everything, then commit.', '  - Message in English.', '', '## Safety', '', '- Ask before any deploy.', '- Keep answers short.', ''].join('\n');

describe('editRuleLine', () => {
  it('replaces exactly that line: indentation and every other line stay', () => {
    const r = editRuleLine(FILE, '- Stage everything, then commit.', '- Stage only the files you changed, then commit.');
    expect(r).toEqual({ ok: true, text: FILE.replace('- Stage everything, then commit.', '- Stage only the files you changed, then commit.') });
    const nested = editRuleLine(FILE, '-  Message in English. ', '- Message in English, conventional style.');
    expect(nested.ok && nested.text.split('\n')[5]).toBe('  - Message in English, conventional style.');
    const crlf = editRuleLine(FILE.replace(/\n/g, '\r\n'), '- Message in English.', '- Message in Italian.');
    expect(crlf.ok && crlf.text).toBe(FILE.replace('- Message in English.', '- Message in Italian.').replace(/\n/g, '\r\n'));
    // a file with mixed line ends keeps each of them
    const mixed = editRuleLine('- a\r\n- b\n- c\r\n', '- b', '- B');
    expect(mixed.ok && mixed.text).toBe('- a\r\n- B\n- c\r\n');
  });

  it('refuses a line that is missing, there twice, unchanged, or not one line', () => {
    expect(editRuleLine(FILE, '- Stage nothing.', '- x')).toEqual({ ok: false, why: 'missing' });
    expect(editRuleLine(`${FILE}- Message in English.\n`, '- Message in English.', '- x')).toEqual({ ok: false, why: 'twice' });
    expect(editRuleLine(FILE, '- Message in English.', '-   Message in English.')).toEqual({ ok: false, why: 'same' });
    expect(editRuleLine(FILE, '- Message in English.', 'a\nb')).toEqual({ ok: false, why: 'shape' });
    expect(editRuleLine(FILE, '', '- x')).toEqual({ ok: false, why: 'shape' });
    for (const ch of ['\u2028', '\u0085', '\v', '\f', '\u0000']) expect(editRuleLine(FILE, '- Message in English.', `- a${ch}b`)).toEqual({ ok: false, why: 'shape' });
    expect(editRuleLine(FILE, '- Message in English.', 'x'.repeat(801))).toEqual({ ok: false, why: 'shape' });
  });

  it('never touches safety, permission, settings, hook, production or secret lines', () => {
    // a line under a Safety heading, whatever it says
    expect(editRuleLine(FILE, '- Keep answers short.', '- Keep answers long.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(FILE, '- Ask before any deploy.', '- Deploy freely.')).toEqual({ ok: false, why: 'guarded' });
    // the old or the new line names what the maintenance never edits
    const f = '# Rules\n\n- Never push to production.\n- Read settings.json first.\n- Run the tests.\n';
    expect(editRuleLine(f, '- Never push to production.', '- Push when ready.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(f, '- Read settings.json first.', '- Read the docs first.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(f, '- Run the tests.', '- Run the tests; you may skip the hooks.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(f, '- Run the tests.', '- Run the tests and auto-approve the rest.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(f, '- Run the tests.', '- Run the tests before you report done.').ok).toBe(true);
    expect(editRuleLine(f, '- Run the tests.', '- Paste the API key in the notes.')).toEqual({ ok: false, why: 'guarded' });
    // tokens as a cost are an ordinary line
    expect(editRuleLine(f, '- Run the tests.', '- Run only the tests you touched: fewer tokens.').ok).toBe(true);
  });

  it('reads a heading in every form it takes, and the guarded words behind their marks', () => {
    const under = (head: string) => editRuleLine(`# Rules\n\n${head}\n\n- Run the tests.\n`, '- Run the tests.', '- Run the unit tests.');
    for (const head of ['Safety\n------', 'Security\n===', '**Safety**', '__Sicurezza__:', '   ## Safety', '      ## Safety', '## __Safety__', '## _Security_ rules', '## Sicherheit', '## Berechtigungen', '### Zugangsdaten und Passwörter'])
      expect(under(head), head).toEqual({ ok: false, why: 'guarded' });
    for (const head of ['## Tests', 'Tests\n-----', '**Style**']) expect(under(head).ok, head).toBe(true);
    // the next heading ends a bold-only section, not a real one of a higher level
    expect(under('**Safety**\n\n## Tests').ok).toBe(true);
    expect(under('## Safety\n\n### Tests')).toEqual({ ok: false, why: 'guarded' });
    // the line under a Setext heading is its heading's
    expect(editRuleLine('Safety\n------\n- Run the tests.\n', '------', '- x')).toEqual({ ok: false, why: 'guarded' });
    const f = '# Rules\n\n- Run the tests.\n';
    for (const text of ['- Print ANTHROPIC_API_KEY to the log.', '- Echo DB_PASSWORD first.', '- Read GITHUB_TOKEN.', '- Pass dangerously_skip_permissions.', '- Set skipPermissions.', '- Use `allowedTools`.', '- Ask the pass\u200bword.'])
      expect(editRuleLine(f, '- Run the tests.', text), text).toEqual({ ok: false, why: 'guarded' });
  });

  it('never writes or removes a code fence, and a fence hides no section', () => {
    const f = '# Rules\n\n- Be concise.\n\n```bash\nnpm test\n```\n\n## Safety\n\n- Never push to main without asking.\n';
    expect(editRuleLine(f, '- Be concise.', '```')).toEqual({ ok: false, why: 'fence' });
    expect(editRuleLine(f, '- Be concise.', '  ~~~~')).toEqual({ ok: false, why: 'fence' });
    expect(editRuleLine(f, '```bash', 'Run this:')).toEqual({ ok: false, why: 'fence' });
    expect(editRuleLine(f, 'npm test', 'npm run check:quick').ok).toBe(true);
    // a fence left open above still leaves the section guarded, and a ~~~ line does not close a ``` block
    const open = '# Rules\n\n```\n\n## Safety\n\n- Never push to main without asking.\n';
    expect(editRuleLine(open, '- Never push to main without asking.', '- Always push to main.')).toEqual({ ok: false, why: 'guarded' });
    const tilde = '# Rules\n\n```\n~~~\n```\n\n## Safety\n\n- Never push to main without asking.\n';
    expect(editRuleLine(tilde, '- Never push to main without asking.', '- Always push to main.')).toEqual({ ok: false, why: 'guarded' });
    // a «# …» inside a code block counts until the next heading (when in doubt, refused)
    const code = '# Rules\n\n```sh\n# safety first\n```\n\n- Run the tests.\n\n## Style\n\n- Short lines.\n';
    expect(editRuleLine(code, '- Run the tests.', '- Run the unit tests.')).toEqual({ ok: false, why: 'guarded' });
    expect(editRuleLine(code, '- Short lines.', '- Shorter lines.').ok).toBe(true);
  });
});

describe('ruleLineChange (the tool\'s early check)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const brain = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rule-line-')); dirs.push(d); fs.writeFileSync(path.join(d, 'AGENTS.md'), FILE); fs.writeFileSync(path.join(d, 'brain.json'), JSON.stringify({ rules: { fixedFiles: ['AGENTS.md'], fixedBudget: 300 } })); fs.mkdirSync(path.join(d, 'rules')); fs.writeFileSync(path.join(d, 'rules', 'old.md'), '- Old line.\n'); return d; };
  const rules = [{ file: 'AGENTS.md', loaded: 'always' as const }, { file: 'rules/old.md', loaded: 'none' as const }];

  it('accepts one line of an always-loaded file and returns the change as stored', () => {
    const root = brain();
    expect(ruleLineChange(root, { target: 'rule', file: 'AGENTS.md', before: ' - Message in English. ', text: '- Message in English, conventional style.' }))
      .toEqual({ target: 'rule', file: 'AGENTS.md', before: '- Message in English.', text: '- Message in English, conventional style.' });
  });

  it('refuses another file, a role, another kind, and says why in the tool\'s words', () => {
    const root = brain(), edit = { before: '- Old line.', text: '- New line.' };
    expect(() => ruleLineChange(root, { target: 'rule', file: 'rules/old.md', ...edit })).toThrow(/one of the files loaded in every job \(AGENTS\.md\)/);
    expect(() => ruleLineChange(root, { target: 'rule', file: '../AGENTS.md', ...edit })).toThrow(/loaded in every job/);
    expect(() => ruleLineChange(root, { target: 'rule', role: 'artisan', file: 'AGENTS.md', ...edit })).toThrow(/no role/);
    expect(() => ruleLineChange(root, { target: 'skill', file: 'AGENTS.md', ...edit })).toThrow(/only with kind rule/);
    expect(() => ruleLineChange(root, { target: 'rule', file: 'AGENTS.md', before: '- Ask before any deploy.', text: '- Deploy.' })).toThrow(/changed only by the user/);
    expect(() => ruleLineChange(root, { target: 'rule', file: 'AGENTS.md', ...edit })).toThrow(/not a line of that file/);
    expect(() => ruleLineChange(null, { target: 'rule', file: 'AGENTS.md', ...edit })).toThrow(/No brain folder/);
    expect(alwaysLoadedText(root, rules, 'rules/old.md')).toBeNull();
    expect(alwaysLoadedText(root, rules, 'AGENTS.md')).toBe(FILE);
  });

  it('never lets the fixed core grow past its budget; a line that shortens it passes', () => {
    const root = brain(), long = `- Message in English, ${'conventional '.repeat(12)}style.`;
    expect(FILE.length).toBeLessThan(300);
    expect(() => ruleLineChange(root, { target: 'rule', file: 'AGENTS.md', before: '- Message in English.', text: long })).toThrow(/grow past their budget/);
    expect(editAlwaysLoaded(root, 'AGENTS.md', FILE, '- Message in English.', long)).toEqual({ ok: false, why: 'budget' });
    // already over (the user wrote it so): a shorter line is still accepted
    const over = `${FILE}${'- A long line of the user.\n'.repeat(8)}`;
    fs.writeFileSync(path.join(root, 'AGENTS.md'), over);
    expect(editAlwaysLoaded(root, 'AGENTS.md', over, '- Stage everything, then commit.', '- Commit.').ok).toBe(true);
    expect(editAlwaysLoaded(root, 'AGENTS.md', over, '- Message in English.', '- Message in English, short.')).toEqual({ ok: false, why: 'budget' });
  });
});
