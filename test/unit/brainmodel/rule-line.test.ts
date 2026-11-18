// One line of an always-loaded file replaced by the maintenance (issue #435, ADR 0320; brainmodel/rule-line.ts): the
// line is found once by its whole text, its indentation and the file's line ends stay, and a line about safety,
// permissions, settings, hooks, production or secrets (or under such a heading) is never changed; the tool's early
// check names the always-loaded files and refuses any other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alwaysLoadedText, editRuleLine, ruleLineChange } from '../../../src/main/brainmodel/rule-line';

const FILE = ['# Agents', '', '## Commits', '', '- Stage everything, then commit.', '  - Message in English.', '', '## Safety', '', '- Ask before any deploy.', '- Keep answers short.', ''].join('\n');

describe('editRuleLine', () => {
  it('replaces exactly that line: indentation and every other line stay', () => {
    const r = editRuleLine(FILE, '- Stage everything, then commit.', '- Stage only the files you changed, then commit.');
    expect(r).toEqual({ ok: true, text: FILE.replace('- Stage everything, then commit.', '- Stage only the files you changed, then commit.') });
    const nested = editRuleLine(FILE, '-  Message in English. ', '- Message in English, conventional style.');
    expect(nested.ok && nested.text.split('\n')[5]).toBe('  - Message in English, conventional style.');
    const crlf = editRuleLine(FILE.replace(/\n/g, '\r\n'), '- Message in English.', '- Message in Italian.');
    expect(crlf.ok && crlf.text).toBe(FILE.replace('- Message in English.', '- Message in Italian.').replace(/\n/g, '\r\n'));
  });

  it('refuses a line that is missing, there twice, unchanged, or not one line', () => {
    expect(editRuleLine(FILE, '- Stage nothing.', '- x')).toEqual({ ok: false, why: 'missing' });
    expect(editRuleLine(`${FILE}- Message in English.\n`, '- Message in English.', '- x')).toEqual({ ok: false, why: 'twice' });
    expect(editRuleLine(FILE, '- Message in English.', '-   Message in English.')).toEqual({ ok: false, why: 'same' });
    expect(editRuleLine(FILE, '- Message in English.', 'a\nb')).toEqual({ ok: false, why: 'shape' });
    expect(editRuleLine(FILE, '', '- x')).toEqual({ ok: false, why: 'shape' });
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
    // a «# …» inside a code block is not a heading
    const code = '# Rules\n\n```sh\n# safety first\n```\n\n- Run the tests.\n';
    expect(editRuleLine(code, '- Run the tests.', '- Run the unit tests.').ok).toBe(true);
  });
});

describe('ruleLineChange (the tool\'s early check)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const brain = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rule-line-')); dirs.push(d); fs.writeFileSync(path.join(d, 'AGENTS.md'), FILE); fs.mkdirSync(path.join(d, 'rules')); fs.writeFileSync(path.join(d, 'rules', 'old.md'), '- Old line.\n'); return d; };
  const rules = [{ file: 'AGENTS.md', loaded: 'always' as const }, { file: 'rules/old.md', loaded: 'none' as const }];

  it('accepts one line of an always-loaded file and returns the change as stored', () => {
    const root = brain();
    expect(ruleLineChange(root, rules, { target: 'rule', file: 'AGENTS.md', before: ' - Message in English. ', text: '- Message in English, conventional style.' }))
      .toEqual({ target: 'rule', file: 'AGENTS.md', before: '- Message in English.', text: '- Message in English, conventional style.' });
  });

  it('refuses another file, a role, another kind, and says why in the tool\'s words', () => {
    const root = brain(), edit = { before: '- Old line.', text: '- New line.' };
    expect(() => ruleLineChange(root, rules, { target: 'rule', file: 'rules/old.md', ...edit })).toThrow(/one of the files loaded in every job \(AGENTS\.md\)/);
    expect(() => ruleLineChange(root, rules, { target: 'rule', file: '../AGENTS.md', ...edit })).toThrow(/loaded in every job/);
    expect(() => ruleLineChange(root, rules, { target: 'rule', role: 'artisan', file: 'AGENTS.md', ...edit })).toThrow(/no role/);
    expect(() => ruleLineChange(root, rules, { target: 'skill', file: 'AGENTS.md', ...edit })).toThrow(/only with kind rule/);
    expect(() => ruleLineChange(root, rules, { target: 'rule', file: 'AGENTS.md', before: '- Ask before any deploy.', text: '- Deploy.' })).toThrow(/changed only by the user/);
    expect(() => ruleLineChange(root, rules, { target: 'rule', file: 'AGENTS.md', ...edit })).toThrow(/not a line of that file/);
    expect(() => ruleLineChange(null, rules, { target: 'rule', file: 'AGENTS.md', ...edit })).toThrow(/No brain folder/);
    expect(alwaysLoadedText(root, rules, 'rules/old.md')).toBeNull();
    expect(alwaysLoadedText(root, rules, 'AGENTS.md')).toBe(FILE);
  });
});
