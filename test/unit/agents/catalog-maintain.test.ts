// The catalog's maintenance path (ADR 0083): a job changes only a role's text and its skills, as a new active version
// authored "maintenance" with no approval and no trial; tools, permissions, engine and model are refused; an open trial
// makes it wait; the undo makes the previous version active again only while nothing newer happened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { AgentModelChoice } from '../../../src/shared/agents';
import { ROLE_DEFAULTS } from '../../../src/shared/roles';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const catalog = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-maintain-')); dirs.push(d); return new AgentCatalogService({ userData: d, models }); };
const scout = (c: AgentCatalogService) => c.list().profiles.find(p => p.id === 'scout')!;

describe('catalog.maintain', () => {
  it('makes a new active version authored by the maintenance, and undoes it', () => {
    const c = catalog(), a = scout(c);
    const lesson = `${a.instructions}\n\n## Lezioni dalle correzioni\n\n- Sempre il file.`;
    const r = c.maintain(a.id, { instructions: lesson }, 'Manutenzione: lezione')!;
    expect(r.before).toBe(a.activeVersion);
    expect(r.profile).toMatchObject({ activeVersion: a.activeVersion + 1, lastEditedBy: 'maintenance', userLocked: false });
    expect(r.profile.trial).toBeUndefined();
    expect(c.history(a.id).find(v => v.version === r.profile.activeVersion)).toMatchObject({ author: 'maintenance', reason: 'Manutenzione: lezione' });
    expect(c.maintain(a.id, { instructions: r.profile.instructions }, 'same')).toBeNull(); // nothing changed
    expect(() => c.maintainRestore(a.id, r.before, a.activeVersion)).toThrow(/changed/);
    const back = c.maintainRestore(a.id, r.before, r.profile.activeVersion);
    expect(back).toMatchObject({ activeVersion: a.activeVersion, instructions: ROLE_DEFAULTS.scout.instructions });
  });
  it('never touches tools, permissions, engine or model', () => {
    const c = catalog(), a = scout(c);
    expect(() => c.maintain(a.id, { tools: { allow: ['shell'] } } as never, 'x')).toThrow(/only the role text and the skills/);
    expect(() => c.maintain(a.id, { model: 'other' } as never, 'x')).toThrow(/only the role text and the skills/);
    expect(() => c.maintain('missing', { instructions: 'x' }, 'x')).toThrow();
  });
});
