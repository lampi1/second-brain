// Defaults choose a ready enabled engine and routing preserves explicit choices and launch policy.
import { expect, it } from 'vitest';
import { availableEngine } from '../../../src/shared/engine-readiness';
import type { CliStatus } from '../../../src/shared/contract';
import { resolve } from '../../../src/main/brain/routing';
import { engineOn } from '../../../src/main/engines/policy';
import { recordReadiness } from '../../../src/main/engines/readiness';

const status = (loggedIn: boolean | null, found = true): CliStatus => ({ found, loggedIn, path: null, version: null });
it.each(['codex', 'cursor'])('chooses %s when it is the only logged-in engine', engine => {
  const cli = { claude: status(false), [engine]: status(true) };
  expect(availableEngine(['claude', engine], 'claude', cli)).toBe(engine);
  expect(availableEngine(['claude', engine], 'claude', { ...cli, claude: status(null) })).toBe(engine);
  expect(availableEngine(['claude'], 'claude', cli)).toBeUndefined();
  expect(resolve({}, { harness: 'claude', models: {}, effort: null }, null, h => h === engine)).toMatchObject({ harness: engine, source: 'default' });
  expect(resolve({ harness: engine }, { harness: 'claude', models: {}, effort: null }, null)).toMatchObject({ harness: engine });
});
it('does not route when every engine is unavailable', () => {
  expect(resolve({}, { harness: 'claude', models: {}, effort: null }, null, () => false)).toHaveProperty('error');
});
it('launch gates reject missing/logged-out engines while preserving off switches', () => {
  recordReadiness('codex', status(false));
  expect(engineOn({ engineOn: { codex: true } }, 'codex')).toBe(false);
  recordReadiness('codex', status(true, false));
  expect(engineOn({ engineOn: { codex: true } }, 'codex')).toBe(false);
  recordReadiness('codex', status(true));
  expect(engineOn({ engineOn: { codex: true } }, 'codex')).toBe(true);
  expect(engineOn({ engineOn: { codex: false } }, 'codex')).toBe(false);
});
