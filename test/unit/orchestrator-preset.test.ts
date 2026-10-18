// Portable Orchestrator seed, additive migrations and user-owned version regressions.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { ORCHESTRATOR_AGENT_ID as ID, ORCHESTRATOR_INSTRUCTIONS } from '../../src/main/agents/orchestrator-preset';
import { orchestratorRole } from '../../src/main/chats/orchestrator';
import type { AgentModelChoice } from '../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-preset-')); dirs.push(dir); return dir; };
const models = (): AgentModelChoice[] => ['claude', 'codex', 'cursor'].map(engine => ({ engine, label: engine, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }));
const service = (userData: string) => new AgentCatalogService({ userData, models });

describe('Orchestrator preset', () => {
  it('refuses worker launches of the coordinator preset', () => {
    const dir = temp(), c = service(dir);
    expect(() => c.resolve({ harness: 'claude', cwd: dir, agentId: ID })).toThrow(/coordinatore/);
  });
  it('seeds exactly once with history and preserves user versions on restart', () => {
    const dir = temp(), c = service(dir), seed = c.list().profiles.find(p => p.id === ID)!;
    expect(seed).toMatchObject({ name: 'Orchestrator', userLocked: false, origin: { kind: 'preset' } });
    const edited = c.save({ ...seed, instructions: 'My coordinator workflow' }, ID);
    expect(edited).toMatchObject({ userLocked: true, version: 2, lastEditedBy: 'user' });
    expect(c.history(ID).find(v => v.version === 1)?.behaviour.instructions).toBe(ORCHESTRATOR_INSTRUCTIONS);
    const before = fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8'), again = service(dir);
    expect(again.list().profiles.filter(p => p.id === ID)).toEqual([edited]);
    expect(fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8')).toBe(before);
    expect(again.resolve({ harness: 'codex', cwd: dir, regia: true }).instructions).toBe(edited.instructions);
    expect(orchestratorRole(edited.instructions)).toContain(edited.instructions);
    expect(orchestratorRole(edited.instructions)).not.toContain(ORCHESTRATOR_INSTRUCTIONS);
  });
  it.each(['claude', 'codex', 'cursor'] as const)('defaults to the preset on %s without replacing engine choices', harness => {
    const dir = temp(), c = service(dir), req = { harness, cwd: dir, regia: true, model: 'selected', effort: 'medium' as const };
    const result = c.resolve(req);
    expect(result.request).toEqual(req);
    expect(result.owner).toMatchObject({ id: ID, engine: harness, model: 'selected', source: 'catalog' });
    expect(result.instructions).toBe(ORCHESTRATOR_INSTRUCTIONS);
    expect(c.resolve({ ...req, regia: false, appRegia: true }).owner.id).toBe(ID);
  });
  it.each([1, 2])('adds the preset to v%s catalogs without losing existing agents', version => {
    const dir = temp(), c = service(dir), profiles = c.list().profiles.filter(p => p.id !== ID);
    const mine = c.save({ ...profiles[0]!, name: 'My specialist', instructions: 'Preserve me' });
    const file = path.join(dir, version === 1 ? 'agents.json' : 'agents.v2.json');
    fs.writeFileSync(file, JSON.stringify({ version, profiles: [...profiles, mine] }));
    if (version === 1) fs.rmSync(path.join(dir, 'agents.v2.json'));
    const again = service(dir);
    expect(again.list().problem).toBeNull();
    expect(again.list().profiles.find(p => p.id === mine.id)).toMatchObject({ name: mine.name, instructions: mine.instructions });
    expect(again.list().profiles.filter(p => p.id === ID)).toHaveLength(1);
    expect(service(dir).history(ID)).toHaveLength(1);
  });
});
