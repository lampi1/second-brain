// The role gate's brain-only edits (security review of #89): a role with brain-write and no edit (the Scribe) may
// Edit/Write only a file whose real path is inside the brain folder; "..", a relative path, a link out of the brain
// (file or folder), a hard link, another edit tool, no brain set, and a sibling folder sharing the brain's prefix are
// refused visibly; a role with edit is not limited; a parent without edit still lets a brain edit through when it
// allows brain-write. Pins agents/role-gate.ts insideBrain and the brain part of gateRequest.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateRequest, insideBrain, type GateChat } from '../../../src/main/agents/role-gate';
import type { ToolClass } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gate-'));
  dirs.push(base);
  const brain = path.join(base, 'brain'), outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(brain, 'notes'), { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(base, 'brain-evil'));
  fs.writeFileSync(path.join(brain, 'notes', 'a.md'), 'a');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
  return { base, brain, outside };
}
const policy = (allow: ToolClass[]) => ({ tools: { allow }, ceiling: 'default' as const });
const scribe = (brainRoot: string | null, extra: Partial<GateChat> = {}): GateChat =>
  ({ role: { id: 'scribe', name: 'Scribe' }, skills: [], policy: policy(['read', 'brain-write']), brainRoot, ...extra });
const edit = (tool: string, file_path: string) => ({ type: 'permission', tool, input: { file_path, content: 'x' } });

describe('brain-only edits (brain-write without edit)', () => {
  it('passes Edit and Write of a file inside the brain, existing or new', () => {
    const { brain } = setup();
    expect(gateRequest(edit('Edit', path.join(brain, 'notes', 'a.md')), scribe(brain)).kind).toBe('pass');
    expect(gateRequest(edit('Write', path.join(brain, 'notes', 'new', 'b.md')), scribe(brain)).kind).toBe('pass');
  });

  it('refuses anything outside the brain, "..", relative paths, the brain folder itself and a prefix sibling', () => {
    const { base, brain, outside } = setup();
    for (const p of [path.join(outside, 'secret.txt'), `${brain}${path.sep}..${path.sep}outside${path.sep}x.md`, `${brain}${path.sep}notes${path.sep}..${path.sep}notes${path.sep}a.md`, `${brain}/notes/../notes/a.md`,
      'notes/a.md', brain, path.join(base, 'brain-evil', 'x.md'), '']) {
      const v = gateRequest(edit('Write', p), scribe(brain));
      expect(v, p).toMatchObject({ kind: 'deny', code: 'brainOnly' });
    }
  });

  it('refuses a link that leads out of the brain: a linked file, a linked folder, a hard link', () => {
    const { brain, outside } = setup();
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(brain, 'link.md'));
    fs.symlinkSync(outside, path.join(brain, 'out'), 'dir');
    fs.linkSync(path.join(outside, 'secret.txt'), path.join(brain, 'hard.md'));
    for (const p of [path.join(brain, 'link.md'), path.join(brain, 'out', 'secret.txt'), path.join(brain, 'out', 'new.md'), path.join(brain, 'hard.md')]) {
      expect(insideBrain(brain, p), p).toBe(false);
      expect(gateRequest(edit('Edit', p), scribe(brain)).kind, p).toBe('deny');
    }
    // a link to a file inside the brain stays inside
    fs.symlinkSync(path.join(brain, 'notes', 'a.md'), path.join(brain, 'alias.md'));
    expect(insideBrain(brain, path.join(brain, 'alias.md'))).toBe(true);
  });

  it('a brain reached through a link is resolved too', () => {
    const { base, brain } = setup();
    const via = path.join(base, 'via');
    fs.symlinkSync(brain, via, 'dir');
    expect(insideBrain(via, path.join(brain, 'notes', 'a.md'))).toBe(true);
    expect(insideBrain(brain, path.join(via, 'notes', 'a.md'))).toBe(true);
  });

  it('refuses other edit tools and every edit when no brain is set', () => {
    const { brain } = setup();
    expect(gateRequest(edit('MultiEdit', path.join(brain, 'notes', 'a.md')), scribe(brain)).kind).toBe('deny');
    expect(gateRequest({ type: 'permission', tool: 'NotebookEdit', input: { notebook_path: path.join(brain, 'n.ipynb') } }, scribe(brain)).kind).toBe('deny');
    const v = gateRequest(edit('Write', path.join(brain, 'notes', 'a.md')), scribe(null));
    expect(v).toMatchObject({ kind: 'deny', code: 'brainOnly' });
    if (v.kind === 'deny') expect(v.message).toMatch(/no brain is set/);
  });

  it('does not limit a role with edit, nor reads and commands', () => {
    const { brain, outside } = setup();
    const artisan = scribe(brain, { role: { id: 'artisan', name: 'Artisan' }, policy: policy(['read', 'edit', 'brain-write']) });
    expect(gateRequest(edit('Write', path.join(outside, 'x.md')), artisan).kind).toBe('pass');
    expect(gateRequest({ type: 'permission', tool: 'Read', input: { file_path: path.join(outside, 'secret.txt') } }, scribe(brain)).kind).toBe('pass');
  });

  it('a delegated Scribe: a parent with brain-write lets a brain edit through; one with neither edit nor brain-write refuses it', () => {
    const { brain } = setup();
    const file = path.join(brain, 'notes', 'a.md');
    expect(gateRequest(edit('Edit', file), scribe(brain, { parent: { policy: policy(['read', 'brain-write']), title: 'P' } })).kind).toBe('pass');
    expect(gateRequest(edit('Edit', file), scribe(brain, { parent: { policy: policy(['read', 'edit']), title: 'P' } })).kind).toBe('pass');
    expect(gateRequest(edit('Edit', file), scribe(brain, { parent: { policy: policy(['read', 'web']), title: 'P' } }))).toMatchObject({ kind: 'deny', code: 'aboveParent' });
  });
});
