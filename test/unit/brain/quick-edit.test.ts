// The Orchestrator's small brain edit (ADR 0370): the path guard (inside the brain, text only, never settings, hooks,
// permissions or git, no link out), the size limits (3 files, 40 changed lines), exact replacements and appends, the
// credential and hook refusals, all-or-nothing writes, the commit of exactly the edited files, the compact diff line,
// and «Annulla» (24 h, refused when a file changed since). Fakes for git, lint and hooks; a fake clock; temp folders.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QUICK_LIMITS, applyChanges, commitMessage, diffLine, quickPath } from '../../../src/main/brain/quick-edit';
import { BrainQuickEdit, type QuickEditDeps, type QuickGit } from '../../../src/main/brain/quick-edit-service';
import { brainEditTool } from '../../../src/main/appctl/brain-edit';
import { BrainChangelog } from '../../../src/main/brain/changelog';
import { log } from '../../../src/main/log';
import { tmp } from '../chats/helpers';

function brain(files: Record<string, string> = {}) {
  const root = tmp('qe-brain');
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); }
  return root;
}
function service(root: string, more: Partial<QuickEditDeps> = {}) {
  vi.spyOn(log, 'info').mockImplementation(() => {}); vi.spyOn(log, 'warn').mockImplementation(() => {});
  let t = 1_000_000;
  const commits: { paths: readonly string[]; message: string }[] = [];
  const git: QuickGit = { commit: async (_r, paths, message) => { commits.push({ paths, message }); return { sha: `sha${commits.length}` }; } };
  const s = new BrainQuickEdit({ root: () => root, journalFile: path.join(tmp('qe-data'), 'brain-quick-edits.json'), git, now: () => t, ...more });
  return { s, commits, at: (ms: number) => { t = ms; }, now: () => t };
}
const text = (root: string, f: string) => fs.readFileSync(path.join(root, f), 'utf8');

describe('quickPath: what may be edited here', () => {
  it('text files inside the brain, one spelling', () => {
    expect(quickPath('rules/qa.md')).toEqual({ rel: 'rules/qa.md' });
    expect(quickPath('.\\me.md')).toEqual({ rel: 'me.md' });
    expect(quickPath('.agents/skills/deploy/SKILL.md')).toEqual({ rel: '.agents/skills/deploy/SKILL.md' });
    expect(quickPath('notes/todo.txt')).toEqual({ rel: 'notes/todo.txt' });
  });
  it('never outside, never settings, hooks, permissions, git, the changelog, nor code or data', () => {
    for (const bad of ['../x.md', 'a/../../x.md', '/etc/x.md', 'C:\\x.md', '~/x.md', '', 'x\0.md']) expect(quickPath(bad), bad).toHaveProperty('problem');
    for (const bad of ['permissions.json', '.claude/settings.json', '.claude/settings.local.json', 'harness/claude/settings.hooks.json', '.claude/hooks/notes.md', '.git/description.md', 'changelog.md', 'domain.json', '.gitignore'])
      expect((quickPath(bad) as { problem: string }).problem, bad).toMatch(/approval|text files/);
    expect((quickPath('ops/tools/mem.mjs') as { problem: string }).problem).toMatch(/only text files/);
  });
});

describe('applyChanges', () => {
  it('replaces text found once, counting only the lines that change', () => {
    const r = applyChanges('# R\n- a\n- b\n- c\n', [{ old: '- b', new: '- B\n- b2' }]);
    expect(r).toMatchObject({ after: '# R\n- a\n- B\n- b2\n- c\n', added: 2, removed: 1, preview: '- B' });
  });
  it('appends on a line of its own, creates a missing file, keeps CRLF', () => {
    expect(applyChanges('x', [{ new: '- nuova' }])).toMatchObject({ after: 'x\n- nuova\n', added: 1, removed: 0 });
    expect(applyChanges(null, [{ new: '# T\n- uno' }])).toMatchObject({ after: '# T\n- uno\n', added: 2 });
    expect(applyChanges('a\r\nb\r\n', [{ old: 'a\nb', new: 'a\nc' }])).toMatchObject({ after: 'a\r\nc\r\n', added: 1, removed: 1 });
  });
  it('refuses text that is missing, found twice, or a replacement in a file that does not exist', () => {
    expect(applyChanges('a\n', [{ old: 'z', new: 'y' }])).toMatchObject({ problem: expect.stringMatching(/not found/) });
    expect(applyChanges('a a\n', [{ old: 'a', new: 'y' }])).toMatchObject({ problem: expect.stringMatching(/more than once/) });
    expect(applyChanges(null, [{ old: 'a', new: 'y' }])).toMatchObject({ problem: expect.stringMatching(/does not exist/) });
  });
  it('the diff line and the commit message', () => {
    expect(diffLine([{ path: 'rules/qa.md', added: 2, removed: 1, created: false }, { path: 'x.md', added: 1, removed: 0, created: true }], '- **Test**: sempre'))
      .toBe('✎ rules/qa.md +2 −1 · x.md (nuovo) +1 — «- **Test**: sempre»');
    expect(commitMessage('d\'ora in poi i test prima', ['rules/qa.md'])).toMatch(/^brain: d'ora in poi i test prima\n\n.*rules\/qa\.md/);
  });
});

describe('BrainQuickEdit', () => {
  it('applies, commits exactly the edited files with a clear message, and logs the change', async () => {
    const root = brain({ 'rules/qa.md': '# QA\n- vecchia\n', 'me.md': '# Me\n' });
    const changelog = new BrainChangelog(() => root);
    const { s, commits } = service(root, { changelog });
    const r = await s.apply([{ path: 'rules/qa.md', old: '- vecchia', new: '- nuova (2026-11-27, "d\'ora in poi")' }, { path: 'me.md', new: '- risposte brevi' }], { summary: 'test prima del merge', by: 'Orchestrator' });
    expect(text(root, 'rules/qa.md')).toBe('# QA\n- nuova (2026-11-27, "d\'ora in poi")\n');
    expect(text(root, 'me.md')).toBe('# Me\n- risposte brevi\n');
    expect(r.diff).toBe('✎ rules/qa.md +1 −1 · me.md +1 — «- nuova (2026-11-27, "d\'ora in poi")»');
    expect(r.commit).toBe('sha1');
    expect(commits).toEqual([{ paths: ['rules/qa.md', 'me.md', 'changelog.md'], message: expect.stringMatching(/^brain: test prima del merge/) }]);
    expect(changelog.list().entries[0]).toMatchObject({ action: 'edited', target: 'rules/qa.md, me.md', by: 'Orchestrator' });
    expect(r.undoUntil - 1_000_000).toBe(QUICK_LIMITS.undoMs);
  });

  it('size limits: more than 3 files or 40 changed lines is refused and nothing is written', async () => {
    const root = brain({ 'a.md': 'a\n', 'b.md': 'b\n', 'c.md': 'c\n', 'd.md': 'd\n' });
    const { s, commits } = service(root);
    await expect(s.apply(['a', 'b', 'c', 'd'].map(f => ({ path: `${f}.md`, new: 'x' })), { summary: '', by: 'O' })).rejects.toThrow(/4 files > 3.*Artisan/);
    const big = Array.from({ length: 41 }, (_, i) => `- riga ${i}`).join('\n');
    await expect(s.apply([{ path: 'a.md', new: big }], { summary: '', by: 'O' })).rejects.toThrow(/41 changed lines > 40.*Artisan/);
    await expect(s.apply([{ path: 'a.md', new: Array.from({ length: 40 }, (_, i) => `- ${i}`).join('\n') }], { summary: '', by: 'O' })).resolves.toMatchObject({ files: [{ added: 40 }] });
    expect(commits).toHaveLength(1);
    expect(text(root, 'b.md')).toBe('b\n');
  });

  it('path guard at the service: settings and permissions refused, a linked folder pointing out refused', async () => {
    const root = brain({ 'permissions.json': '{}', 'me.md': 'x\n' });
    const { s } = service(root);
    await expect(s.apply([{ path: 'permissions.json', new: '{"rules":[]}' }], { summary: '', by: 'O' })).rejects.toThrow(/ADR 0294/);
    await expect(s.apply([{ path: '../outside.md', new: 'x' }], { summary: '', by: 'O' })).rejects.toThrow(/outside the brain/);
    if (process.platform !== 'win32') {
      const out = tmp('qe-out');
      fs.symlinkSync(out, path.join(root, 'linked'));
      await expect(s.apply([{ path: 'linked/x.md', new: 'x' }], { summary: '', by: 'O' })).rejects.toThrow(/outside the brain folder/);
      expect(fs.existsSync(path.join(out, 'x.md'))).toBe(false);
    }
  });

  it('a credential, or the user\'s own hook, refuses the whole edit before anything is written', async () => {
    const root = brain({ 'a.md': 'a\n', 'b.md': 'b\n' });
    const hooks = vi.fn(async (_r: string, file: string) => (file.endsWith('b.md') ? 'contesto fisso sopra il budget' : null));
    const { s, commits } = service(root, { hooks });
    await expect(s.apply([{ path: 'a.md', new: `password=${'Zx9'.repeat(4)}` }], { summary: '', by: 'O' })).rejects.toThrow(/credential/);
    await expect(s.apply([{ path: 'a.md', new: '- ok' }, { path: 'b.md', new: '- troppo' }], { summary: '', by: 'O' })).rejects.toThrow(/b\.md: refused by the brain's own hook: contesto fisso/);
    expect([text(root, 'a.md'), text(root, 'b.md')]).toEqual(['a\n', 'b\n']);
    expect(commits).toEqual([]);
  });

  it('the lint\'s findings and a SKILL.md\'s lint come back as warnings; a failed commit leaves the files written', async () => {
    const root = brain({ '.agents/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Use when deploying.\n---\n# Deploy\n' });
    const lint = vi.fn(async () => ({ summary: 'brain-lint: fixed context 9000 chars', findings: ['near-duplicate rule x ≈ y'] }));
    const { s } = service(root, { lint, git: { commit: async () => ({ skipped: 'the brain folder is not a git repo' }) } });
    const r = await s.apply([{ path: '.agents/skills/deploy/SKILL.md', old: 'name: deploy', new: 'name: deploy-app' }], { summary: 'rename', by: 'O' });
    expect(r.warnings[0]).toMatch(/SKILL\.md: frontmatter name «deploy-app» differs from the folder name/);
    expect(r.warnings).toContain('near-duplicate rule x ≈ y');
    expect(r).toMatchObject({ lint: 'brain-lint: fixed context 9000 chars', commit: null, commitSkipped: 'the brain folder is not a git repo' });
    expect(lint).toHaveBeenCalledWith(root, ['.agents/skills/deploy/SKILL.md']);
    expect(text(root, '.agents/skills/deploy/SKILL.md')).toContain('name: deploy-app');
  });

  it('«Annulla»: the files back as they were, a created one removed, committed as a revert, once', async () => {
    const root = brain({ 'rules/qa.md': '# QA\n- a\n' });
    const { s, commits } = service(root);
    const r = await s.apply([{ path: 'rules/qa.md', old: '- a', new: '- b' }, { path: 'rules/new.md', new: '- nuova' }], { summary: 'regola', by: 'O' });
    const u = await s.undo(r.id, 'O');
    expect(u).toMatchObject({ id: r.id, commit: 'sha2' });
    expect(text(root, 'rules/qa.md')).toBe('# QA\n- a\n');
    expect(fs.existsSync(path.join(root, 'rules/new.md'))).toBe(false);
    expect(commits[1]).toEqual({ paths: ['rules/qa.md', 'rules/new.md'], message: expect.stringMatching(/^Revert "brain: regola"\n\nThis reverts commit sha1\./) });
    await expect(s.undo(r.id, 'O')).rejects.toThrow(/already undone/);
    expect(s.recent()[0]).toMatchObject({ id: r.id, undone: true, canUndo: false });
  });

  it('«Annulla» is refused after 24 h, or when a file changed since; "last" names the newest', async () => {
    const root = brain({ 'a.md': 'a\n', 'b.md': 'b\n' });
    const { s, at, now } = service(root);
    const first = await s.apply([{ path: 'a.md', old: 'a', new: 'A' }], { summary: '1', by: 'O' });
    const second = await s.apply([{ path: 'b.md', old: 'b', new: 'B' }], { summary: '2', by: 'O' });
    fs.writeFileSync(path.join(root, 'b.md'), 'B\nuser edit\n');
    await expect(s.undo('last', 'O')).rejects.toThrow(/b\.md changed after this edit/);
    expect(second.id).not.toBe(first.id);
    at(now() + QUICK_LIMITS.undoMs + 1);
    await expect(s.undo(first.id, 'O')).rejects.toThrow(/more than 24 h old/);
    expect(text(root, 'a.md')).toBe('A\n');
  });

  it('the tool: apply returns the diff line to show; undo and recent', async () => {
    const root = brain({ 'now.md': '# Ora\n' });
    const { s } = service(root);
    const tool = brainEditTool(s, () => 'Orchestrator');
    const out = await tool.run({ changes: [{ path: 'now.md', new: '- app · review · next: merge' }], summary: 'filo' }) as { id: string; diff: string; note: string };
    expect(out.diff).toBe('✎ now.md +1 — «- app · review · next: merge»');
    expect(out.note).toMatch(/Annulla/);
    expect(await tool.run({ action: 'recent' })).toMatchObject({ edits: [{ id: out.id, files: ['now.md'], canUndo: true }] });
    expect(await tool.run({ action: 'undo', id: 'last' })).toMatchObject({ ok: true, undone: out.id });
    await expect(tool.run({ changes: [] })).rejects.toThrow(/at least one/);
  });
});
