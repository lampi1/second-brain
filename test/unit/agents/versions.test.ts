// Role versions (src/main/agents/versions.ts, ADR 0186): only the role's text, skills, model or tier make a new version;
// an amend rewrites a version's behaviour in place with a bounded note; an older history (no `changed`, no `amended`,
// or one of them out of shape) still loads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentHistory, versionedChanges } from '../../../src/main/agents/versions';
import { AMENDS_KEPT, type AgentBehaviour, type AgentVersion } from '../../../src/shared/agents';

const base: AgentBehaviour = { instructions: 'x', engine: 'claude', model: null, tools: { allow: ['read'] }, permissionCeiling: null, tier: 'mid', tierMax: 'top', launches: [], skills: ['a', 'b'] };
const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-versions-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const entry = (p: Partial<AgentVersion> = {}): AgentVersion => ({ agentId: 'scout', version: 1, parentVersion: null, behaviour: base, author: 'default', reason: 'r', at: 1, state: 'active', ...p });

describe('versionedChanges', () => {
  it('names text, skills, model and tier, and nothing for tools, launches or limits', () => {
    expect(versionedChanges(base, { ...base, tools: { allow: ['read', 'edit'] }, launches: ['scout'], maxContext: 100_000, permissionCeiling: 'plan' })).toEqual([]);
    expect(versionedChanges(base, { ...base, skills: ['b', 'a'] })).toEqual([]); // same skills, other order
    expect(versionedChanges(base, { ...base, instructions: 'y', skills: ['a'] })).toEqual(['text', 'skills']);
    expect(versionedChanges(base, { ...base, engine: 'cursor' })).toEqual(['model']);
    expect(versionedChanges(base, { ...base, effort: 'high' })).toEqual(['model']);
    expect(versionedChanges(base, { ...base, tierMax: 'mid' })).toEqual(['tier']);
  });
});

describe('AgentHistory amends', () => {
  it('rewrites a version in place with at most AMENDS_KEPT notes, and reads an old or malformed record', () => {
    const dir = tmp(), h = new AgentHistory(dir, 'h.json');
    h.commit([entry()]);
    for (let i = 0; i < AMENDS_KEPT + 2; i++) h.commit([], [], [{ agentId: 'scout', version: 1, behaviour: { ...base, launches: [`l${i}`] }, at: 10 + i, by: 'user', reason: `n${i}` }]);
    const v = h.get('scout', 1)!;
    expect(v.behaviour.launches).toEqual([`l${AMENDS_KEPT + 1}`]);
    expect(v.amended).toHaveLength(AMENDS_KEPT);
    expect(v.amended!.at(-1)).toMatchObject({ by: 'user', reason: `n${AMENDS_KEPT + 1}` });
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ version: 1, entries: [entry(), entry({ version: 2, changed: ['nope'] as never, amended: 'x' as never })] }));
    const old = new AgentHistory(dir, 'old.json');
    expect(old.problem).toBeNull();
    expect(old.get('scout', 2)).not.toHaveProperty('changed');
    expect(old.get('scout', 2)).not.toHaveProperty('amended');
  });
});
