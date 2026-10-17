import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService, checkedAvatar, compatibleOwner, readOwner } from '../../src/main/agents/catalog';
import { SetupService } from '../../src/main/agents/setup';
import type { AgentDraft, AgentModelChoice } from '../../src/shared/agents';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agents-')); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const choices = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const draft = (): AgentDraft => ({ name: 'Ricerca', purpose: 'Controllare fonti', instructions: 'Cita le fonti.', engine: 'claude', model: 'known-model', avatar: { kind: 'symbol', value: 'search' }, effort: 'medium' });

describe('Agent catalog and local setup', () => {
  it('adds concrete duties only to fresh seeds and preserves customized default identities on reload', () => {
    const dir = tmp(), service = new AgentCatalogService({ userData: dir, models: choices });
    const profiles = service.list().profiles;
    for (const [id, word] of [['research', 'CI'], ['writing', 'criteri'], ['analysis', 'copertura'], ['planning', 'backlog'], ['development', 'ADR']]) {
      expect(profiles.find(p => p.id === `default-${id}`)?.instructions).toContain(word);
    }
    expect(profiles.find(p => p.id === 'default-general')?.instructions).toBe('Chiarisci il risultato atteso. Distingui fatti, ipotesi e proposte. Rispetta permessi e dati personali.');
    service.save({ ...draft(), instructions: 'My customized workflow' }, 'default-development');
    const file = path.join(dir, 'agents.json'), before = fs.readFileSync(file, 'utf8');
    expect(new AgentCatalogService({ userData: dir, models: choices }).list().profiles.find(p => p.id === 'default-development')?.instructions).toBe('My customized workflow');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
  it('offers professional defaults without inventing installed models or login', () => {
    const c = new AgentCatalogService({ userData: tmp(), models: choices }).list();
    expect(c.profiles).toHaveLength(6);
    expect(c.profiles.every(p => p.model === null && p.engine === 'claude')).toBe(true);
    expect(c.models[0]).toMatchObject({ installed: null, authenticated: null });
    expect(c.imageGeneration.available).toBe(false);
    expect(c.builder.available).toBe(false);
  });
  it('persists validated profiles and duplicates with a new identity', () => {
    const dir = tmp(), c = new AgentCatalogService({ userData: dir, models: choices });
    const saved = c.save({ ...draft(), permissionMode: 'bypassPermissions', cwd: 'private' });
    const copy = c.duplicate(saved.id);
    expect(copy.id).not.toBe(saved.id);
    const restored = new AgentCatalogService({ userData: dir, models: choices }).list().profiles.find(p => p.id === saved.id)!;
    expect(restored).toEqual(saved);
    expect(restored).not.toHaveProperty('permissionMode');
    expect(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')).not.toContain('private');
  });
  it('freezes owner choices and instructions; profile edits never change an old snapshot', () => {
    const c = new AgentCatalogService({ userData: tmp(), models: choices });
    const p = c.save(draft());
    const resolved = c.resolve({ harness: 'claude', cwd: '/unused', agentId: p.id });
    c.save({ ...draft(), name: 'Nuovo nome', model: null }, p.id);
    expect(resolved.owner).toMatchObject({ name: 'Ricerca', model: 'known-model', source: 'catalog' });
    expect(resolved.request.model).toBe('known-model');
    expect(resolved.instructions).toBe('Cita le fonti.');
    expect(() => c.resolve({ harness: 'codex', cwd: '/unused', agentId: p.id })).toThrow(/non corrisponde/);
  });
  it('keeps unavailable saved profiles but refuses to silently substitute another model', () => {
    const dir = tmp(), c = new AgentCatalogService({ userData: dir, models: choices });
    const p = c.save(draft());
    const reloaded = new AgentCatalogService({ userData: dir, models: () => [{ ...choices()[0]!, models: [], source: 'unknown' }] });
    expect(reloaded.list().profiles.find(x => x.id === p.id)?.model).toBe('known-model');
    expect(() => reloaded.resolve({ harness: 'claude', cwd: '/unused', agentId: p.id })).toThrow(/modello non è tra/);
    expect(() => c.save({ ...draft(), model: '--execute' })).toThrow(/Modello non valido/);
  });
  it('keeps corrupt catalogs intact and fails closed on save', () => {
    const dir = tmp(), file = path.join(dir, 'agents.json');
    fs.writeFileSync(file, '{broken');
    const c = new AgentCatalogService({ userData: dir, models: choices });
    expect(c.list().problem).toBeTruthy();
    expect(() => c.save(draft())).toThrow(/conservato/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });
  it('refuses an aggregate avatar budget that would make the next restart unreadable', () => {
    const dir = tmp(), bytes = Buffer.alloc(250_000);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
    const c = new AgentCatalogService({ userData: dir, models: choices, imageSize: () => ({ width: 64, height: 64 }) });
    const p = c.save({ ...draft(), avatar: { kind: 'image', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } });
    let rejected = false;
    for (let i = 0; i < 30; i++) { try { c.duplicate(p.id); } catch { rejected = true; break; } }
    expect(rejected).toBe(true);
    expect(fs.statSync(path.join(dir, 'agents.json')).size).toBeLessThanOrEqual(8_000_000);
    expect(new AgentCatalogService({ userData: dir, models: choices, imageSize: () => ({ width: 64, height: 64 }) }).list().problem).toBeNull();
  });
  it('rejects active/remote/mislabeled images and excessive decoded dimensions', () => {
    for (const dataUrl of ['https://remote.invalid/a.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,PHN2Zy8+']) expect(() => checkedAvatar({ kind: 'image', dataUrl }, () => ({ width: 64, height: 64 }))).toThrow();
    const bytes = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
    const png = bytes.toString('base64');
    const avatar = { kind: 'image', dataUrl: `data:image/png;base64,${png}` };
    expect(() => checkedAvatar(avatar, () => ({ width: 2048, height: 64 }))).toThrow(/1024/);
    expect(() => checkedAvatar(avatar)).toThrow(/leggibile/);
    expect(checkedAvatar(avatar, () => ({ width: 64, height: 64 }))).toEqual(avatar);
    bytes.writeUInt32BE(100_000, 16);
    const decode = vi.fn(() => ({ width: 100_000, height: 64 }));
    expect(() => checkedAvatar({ kind: 'image', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }, decode)).toThrow(/1024/);
    expect(decode).not.toHaveBeenCalled();
    const extended = Buffer.alloc(30); extended.write('RIFF', 0); extended.write('WEBP', 8); extended.write('VP8X', 12); extended.writeUIntLE(63, 24, 3); extended.writeUIntLE(63, 27, 3);
    const extendedAvatar = { kind: 'image', dataUrl: `data:image/webp;base64,${extended.toString('base64')}` };
    expect(() => checkedAvatar(extendedAvatar, decode)).toThrow(/1024/);
    expect(readOwner({ ...compatibleOwner('claude', null), avatar: extendedAvatar })).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
  it('uses a real tool-free builder only on explicit request, validates output and never saves a draft', async () => {
    const complete = vi.fn(async () => ({ ok: true as const, text: JSON.stringify({ ...draft(), permissionMode: 'bypassPermissions' }) }));
    const dir = tmp(), c = new AgentCatalogService({ userData: dir, models: choices, builder: () => ({ available: true, engine: 'api', models: ['known-api'], reason: null }), complete });
    expect(complete).not.toHaveBeenCalled();
    const before = fs.readFileSync(path.join(dir, 'agents.json'), 'utf8');
    const result = await c.draft({ text: 'Prepara ricerca', engine: 'api', model: 'known-api' });
    expect(result).toEqual({ ok: true, draft: draft() });
    expect(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')).toBe(before);
    expect(await c.draft({ text: 'Hi', engine: 'other', model: 'known-api' })).toMatchObject({ ok: false });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('preserves legacy effective choices in a recognizable owner', () => {
    const owner = compatibleOwner('codex', null, true);
    expect(readOwner(owner)).toEqual(owner);
    expect(owner).toMatchObject({ engine: 'codex', model: null, source: 'legacy' });
    expect(readOwner({ ...owner, avatar: { kind: 'image', dataUrl: 'https://x.invalid/x.svg' } })).toBeNull();
  });
  it('bounds restored owner image bytes and headers before exposing them to the renderer', () => {
    const owner = compatibleOwner('codex', null, true), bytes = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
    bytes.writeUInt32BE(20_000, 16); bytes.writeUInt32BE(20_000, 20);
    expect(readOwner({ ...owner, avatar: { kind: 'image', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } })).toBeNull();
    bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
    const valid = { ...owner, avatar: { kind: 'image', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } };
    expect(readOwner(valid)).toEqual(valid);
    expect(readOwner({ ...owner, avatar: { kind: 'image', dataUrl: 'data:image/png;base64,PHN2Zy8+' } })).toBeNull();
  });
  it('lets the explicit AI guide start from empty fields or repair an unavailable saved model', async () => {
    const complete = vi.fn(async (_req: { prompt: string }) => ({ ok: true as const, text: JSON.stringify(draft()) }));
    const dir = tmp(), c = new AgentCatalogService({ userData: dir, models: choices, builder: () => ({ available: true, engine: 'api', models: ['known-api'], reason: null }), complete });
    const empty = { ...draft(), name: '', purpose: '', instructions: '', model: null };
    expect(await c.draft({ text: 'Mi aiuta con le fonti', engine: 'api', model: 'known-api', base: empty })).toEqual({ ok: true, draft: draft() });
    expect(await c.draft({ text: 'Aggiorna il modello', engine: 'api', model: 'known-api', base: { ...draft(), engine: 'removed', model: 'old-model' } })).toEqual({ ok: true, draft: draft() });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.parse(complete.mock.calls[1]![0]!.prompt).base).toMatchObject({ engine: 'removed', model: 'old-model' });
    await expect(c.draft({ text: 'Bad', engine: 'api', model: 'known-api', base: { ...empty, instructions: 'x'.repeat(8001) } })).rejects.toThrow(/Istruzioni/);
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('resumes a local interview draft and never applies arbitrary protected fields', () => {
    const dir = tmp(), setup = new SetupService(dir, false);
    expect(setup.get().status).toBe('new');
    setup.save({ ...setup.get().preferences, step: 2, work: 'employee', goals: 'Documenti chiari', permissionMode: 'bypassPermissions' }, 'draft');
    const resumed = new SetupService(dir, false);
    expect(resumed.get()).toMatchObject({ status: 'draft', preferences: { step: 2, work: 'employee', goals: 'Documenti chiari' } });
    expect(fs.readFileSync(path.join(dir, 'setup.json'), 'utf8')).not.toContain('permissionMode');
    resumed.save(resumed.get().preferences, 'skipped');
    expect(new SetupService(dir, false).get().status).toBe('skipped');
    expect(new SetupService(tmp(), true).get().status).toBe('existing');
  });
  it('rejects malformed setup without losing the last draft and deduplicates completion', () => {
    const done = vi.fn(), setup = new SetupService(tmp(), false, () => 100, done);
    expect(() => setup.save({ ...setup.get().preferences, step: 200 }, 'completed')).toThrow();
    expect(setup.get().status).toBe('new');
    setup.save(setup.get().preferences, 'completed'); setup.save(setup.get().preferences, 'completed');
    expect(done).toHaveBeenCalledTimes(1);
  });
});
