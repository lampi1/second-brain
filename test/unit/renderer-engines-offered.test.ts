// The renderer's engine list (src/renderer/lib/engines.ts, ADR 0221): an ACP catalog proposal the user has not turned on
// is offered nowhere (new chat, chat menu, «Cambia motore»), only Settings lists it; once trusted it is an engine like
// the others; the built-in engines are always offered.
import { describe, expect, it, vi } from 'vitest';
import type { EngineInfo } from '@shared/contract';

vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: () => Promise.resolve(null), on: () => () => {} } }));
const { offered } = await import('../../src/renderer/lib/engines');

const info = (p: Partial<EngineInfo>): EngineInfo => ({ id: 'x', label: 'X', name: 'X', kind: 'acp', caps: {} as EngineInfo['caps'], source: 'app', key: false, runs: 'x acp', trusted: true, ...p } as EngineInfo);
const catalog = { installUrl: 'https://example.com', signIn: null, skillDirs: [] };

describe('offered', () => {
  it('hides an untrusted catalog proposal and shows it once the user turned it on', () => {
    expect(offered(info({ id: 'kilo', source: 'catalog', trusted: false, catalog }))).toBe(false);
    expect(offered(info({ id: 'kilo', source: 'catalog', trusted: true, catalog }))).toBe(true);
    expect(offered(info({ id: 'claude', source: 'app', trusted: true }))).toBe(true);
  });
});
