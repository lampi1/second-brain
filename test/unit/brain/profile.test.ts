// Unit tests of the owner's profile in me.md (src/main/brain/profile.ts): reading the managed fields from the real
// template, patching only them (the rest byte-identical, CRLF and BOM kept), a name change limited to the template's
// owner lines, the locks (a name in the owner's own lines, a Main work block richer than plain areas), mixed line ends,
// refused patches (multi-line, markdown in the name, unknown keys, locked fields), the revision check
// against a concurrent edit, and the file guards (no brain, missing file, symlink).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProfileService, checkFields, lockedFields, parseProfile, patchProfile } from '../../../src/main/brain/profile';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../../brain-template/me.template.md'), 'utf8');
const VALUES: Record<string, string> = { OWNER: 'Tu', ROLE: 'Da conoscere insieme', LANG: 'italiano', TODAY: '2026-10-17', SHELL: 'PowerShell', BRAIN_NAME: 'memory', OS: 'Windows', REPOS_WIN: 'C:\\r', BRAIN_WIN: 'C:\\b', HARNESSES: 'Claude Code' };
const ME = TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => VALUES[k]!);
const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-profile-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('parseProfile', () => {
  it('reads the managed fields of a freshly rendered me.md', () => {
    const p = parseProfile(ME);
    expect([p.name, p.role, p.language, p.mainWork]).toEqual(['Tu', 'Da conoscere insieme', 'italiano', []]);
    expect(p.rules.map(r => r.title)).toContain('Reply style');
    expect(p.rules.find(r => r.title === 'Long reads go to a sub-agent')!.text).toMatch(/^a long search .* rest of the chat\)\.$/);
  });
  it('reads Main work as inline areas or sub-bullets', () => {
    expect(parseProfile('# A\n\n## Who\n\nA, dev. Language: en in chat.\n\n- **Main work**: billing; search\n').mainWork).toEqual(['billing', 'search']);
    expect(parseProfile('# A\n\n## Who\n\n- **Main work**:\n  - billing\n  - search\n\n## Next\n').mainWork).toEqual(['billing', 'search']);
  });
});

describe('patchProfile', () => {
  it('changes only the managed lines and keeps everything else byte-identical', () => {
    const out = patchProfile(ME, { role: 'product manager', language: 'English', mainWork: ['Checkout', 'Mobile app'], replyStyle: 'short answers, the decision first' }, TEMPLATE);
    const p = parseProfile(out);
    expect([p.role, p.language, p.mainWork, p.rules.find(r => r.title === 'Reply style')!.text]).toEqual(['product manager', 'English', ['Checkout', 'Mobile app'], 'short answers, the decision first']);
    const changed = out.split('\n').filter(l => !ME.split('\n').includes(l));
    expect(changed).toEqual(['Tu, product manager. Language: English in chat; code, commits and PR texts in English.', '- **Main work**:', '  - Checkout', '  - Mobile app', '- **Reply style**: short answers, the decision first']);
    expect(out).toContain('### Regole delle azioni');
    expect(patchProfile(out, { mainWork: [] }, TEMPLATE)).toBe(patchProfile(ME, { role: 'product manager', language: 'English', replyStyle: 'short answers, the decision first' }, TEMPLATE));
  });
  it('renames the owner only in the template lines that carry the name', () => {
    const custom = ME + '\n- Tutti: niente deploy il venerdì.\n';
    const out = patchProfile(custom, { name: 'Giulia' }, TEMPLATE);
    expect(out).toMatch(/^# Giulia\n/);
    expect(out).toContain('Giulia, Da conoscere insieme. Language: italiano');
    expect(out).toContain('## How to work with Giulia');
    expect(out).toContain('- **Commands for Giulia to run**: one at a time, the last thing in the reply, in a `bash` block (PowerShell syntax).');
    expect(out).toContain('fixed, or Giulia decides.');
    expect(out).toContain('`~/.memory.env`');
    expect(out).toContain('- Tutti: niente deploy il venerdì.');
  });
  it('locks the name when the owner wrote it into their own lines, which a rename would leave stale', () => {
    const custom = ME.replace('Production systems:', 'Production and shared systems:');
    expect(lockedFields(parseProfile(custom), TEMPLATE)).toContain('name');
    expect(() => patchProfile(custom, { name: 'Giulia' }, TEMPLATE)).toThrow('PROFILE_UNRECOGNIZED');
    expect(lockedFields(parseProfile(ME), TEMPLATE)).not.toContain('name');
  });
  it('locks Main work when its block holds more than plain one-line areas', () => {
    const who = '# A\n\n## Who\n\nA, dev. Language: en in chat.\n\n';
    expect(lockedFields(parseProfile(who + '- **Main work**:\n  - billing\n    - invoices\n'))).toContain('mainWork');
    expect(lockedFields(parseProfile(who + '- **Main work**:\n  - billing, a long item\n    that wraps\n'))).toContain('mainWork');
    expect(lockedFields(parseProfile(who + '- **Main work**: ' + Array.from({ length: 13 }, (_, i) => 'a' + i).join('; ') + '\n'))).toContain('mainWork');
    expect(lockedFields(parseProfile(who + '- **Main work**:\n  - billing\n  - **Acme**: search\n'))).not.toContain('mainWork');
  });
  it('keeps CRLF line ends, and each line its own in a mixed file', () => {
    const out = patchProfile(ME.replace(/\n/g, '\r\n'), { role: 'qa' }, TEMPLATE);
    expect(out.split('\r\n')).toHaveLength(ME.split('\n').length);
    expect(out).not.toMatch(/[^\r]\n/);
    const mixed = '# A\r\n\n## Who\n\nA, dev. Language: en in chat.\r\n\n## Next\r\n';
    expect(patchProfile(mixed, { role: 'qa' })).toBe(mixed.replace('dev', 'qa'));
  });
  it('rewrites the Who line tail exactly, with or without " in chat"', () => {
    const who = (line: string) => `# A\n\n## Who\n\n${line}\n`;
    expect(patchProfile(who('A, dev. Language:  en; code in English.'), { role: 'qa' })).toBe(who('A, qa. Language: en; code in English.'));
    expect(patchProfile(who('A, dev. Language: en in chat.'), { language: 'it' })).toBe(who('A, dev. Language: it in chat.'));
  });
  it('adds a missing Reply style rule first in the list and refuses a field the layout does not hold', () => {
    const bare = '# A\n\n## Who\n\nA, dev. Language: en in chat.\n\n## How to work with A\n\n- **Other**: x\n';
    expect(patchProfile(bare, { replyStyle: 'short' })).toBe(bare.replace('- **Other**', '- **Reply style**: short\n- **Other**'));
    expect(() => patchProfile('# A\n\nfree text\n', { role: 'dev' })).toThrow('PROFILE_UNRECOGNIZED');
  });
});

describe('checkFields', () => {
  it('flattens whitespace and refuses what could change the structure', () => {
    expect(checkFields({ role: '  dev \t lead ', mainWork: [' a ', '', 'b'] })).toEqual({ role: 'dev lead', mainWork: ['a', 'b'] });
    expect(checkFields({ replyStyle: 'one\ntwo' })).toEqual({ replyStyle: 'one two' });
    for (const bad of [{ name: '# Boss' }, { name: '' }, { name: 'A*B' }, { other: 1 }, { mainWork: 'x' }, { mainWork: Array(13).fill('a') }, { role: 'x'.repeat(241) }, { language: '' }, { role: '' }, { role: 'a. Language: en' }, { language: 'x. Language: y' }, null])
      expect(() => checkFields(bad), JSON.stringify(bad)).toThrow('PROFILE_FIELDS');
  });
});

describe('ProfileService', () => {
  const brain = (text = ME) => { const root = tmp(); fs.writeFileSync(path.join(root, 'me.md'), text); fs.mkdirSync(path.join(root, 'journal')); for (const d of ['2026-10-15', '2026-10-16']) fs.writeFileSync(path.join(root, 'journal', d + '.md'), '# x\n'); fs.writeFileSync(path.join(root, 'journal', 'index.md'), ''); return root; };
  it('reads the profile with its growth and saves a patch', async () => {
    const root = brain(), service = new ProfileService({ root: () => root, template: TEMPLATE });
    const got = await service.get();
    if (!got.ok) throw new Error(got.reason);
    expect(got.profile).toMatchObject({ name: 'Tu', locked: [], growth: { journalDays: 2, lastJournal: '2026-10-16' } });
    const saved = await service.save({ revision: got.profile.revision, fields: { name: 'Giulia', mainWork: ['Clienti'] } });
    expect(saved).toMatchObject({ name: 'Giulia', mainWork: ['Clienti'] });
    expect(saved.revision).not.toBe(got.profile.revision);
    expect(fs.readdirSync(root).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
  it('refuses a save over a concurrent edit and leaves the file alone', async () => {
    const root = brain(), service = new ProfileService({ root: () => root });
    const got = await service.get();
    if (!got.ok) throw new Error(got.reason);
    fs.appendFileSync(path.join(root, 'me.md'), '- **New rule**: added by brain-editor\n');
    const before = fs.readFileSync(path.join(root, 'me.md'), 'utf8');
    await expect(service.save({ revision: got.profile.revision, fields: { role: 'qa' } })).rejects.toThrow('PROFILE_CHANGED');
    expect(fs.readFileSync(path.join(root, 'me.md'), 'utf8')).toBe(before);
  });
  it('keeps a BOM', async () => {
    const root = brain('\uFEFF' + ME), service = new ProfileService({ root: () => root });
    const got = await service.get();
    if (!got.ok) throw new Error(got.reason);
    expect(got.profile.name).toBe('Tu');
    await service.save({ revision: got.profile.revision, fields: { role: 'qa' } });
    expect(fs.readFileSync(path.join(root, 'me.md'), 'utf8').startsWith('\uFEFF# Tu')).toBe(true);
  });
  it('explains why there is no profile', async () => {
    expect(await new ProfileService({ root: () => null }).get()).toEqual({ ok: false, reason: 'no-brain' });
    expect(await new ProfileService({ root: () => tmp() }).get()).toEqual({ ok: false, reason: 'missing' });
    await expect(new ProfileService({ root: () => null }).save({ revision: 'x', fields: {} })).rejects.toThrow('PROFILE_NO_BRAIN');
  });
  it.skipIf(process.platform === 'win32')('never follows a symlinked me.md', async () => {
    const root = tmp(), outside = path.join(tmp(), 'me.md');
    fs.writeFileSync(outside, ME); fs.symlinkSync(outside, path.join(root, 'me.md'));
    expect(await new ProfileService({ root: () => root }).get()).toEqual({ ok: false, reason: 'unreadable' });
  });
});
