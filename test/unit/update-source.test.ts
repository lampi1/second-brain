// The app's update machinery outside the retired "Migliora l'app" section (ADR 0079; ADR 0074, 0075): how the last
// start went (src/main/update/launch.ts: new version, or back to the previous one and why, told once), the promotion's
// steps and clean environment, and AppSourceService (src/main/update/source.ts) end to end on a real temp git repo with
// fake scripts/pull.mjs and scripts/release.mjs: main's tip as the candidate, "Aggiorna" on a dev build (pull, relaunch)
// and on a stable copy (pull, promote-now, restart), the Orchestrator's pull, the start notice and its marker's rename.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { describe, expect, it } from 'vitest';
import { launchOutcome, nextSeen, promoteStep, reasonText, shaOfRelease } from '../../src/main/update/launch';
import { cleanEnv } from '../../src/main/update/source';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T10:00:00Z');

describe('launch helpers', () => {
  it('release id → sha', () => {
    expect(shaOfRelease('0.1.0-91967ec')).toBe('91967ec');
    expect(shaOfRelease('dev')).toBe(null);
  });

  const state = { current: '0.1.0-new1234', previous: '0.1.0-old1234', bad: [] as string[] };
  it('start outcome: the new version came up (once)', () => {
    const seen = { running: '0.1.0-old1234', at: NOW - DAY };
    const l = launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen, now: NOW });
    expect(l).toMatchObject({ outcome: 'new', running: '0.1.0-new1234' });
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen: nextSeen('0.1.0-new1234', l, seen, NOW), now: NOW + 1000 })).toBe(null);
  });
  it('start outcome: back to the previous one, with the launcher\'s reason; told once', () => {
    const result = { at: new Date(NOW - 5000).toISOString(), wanted: '0.1.0-new1234', started: '0.1.0-old1234', attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'exited with code 1 after 4 s' }, { id: '0.1.0-old1234', outcome: 'started' }] };
    const bad = { ...state, bad: ['0.1.0-new1234'] };
    const l = launchOutcome({ running: '0.1.0-old1234', stable: true, state: bad, result, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW });
    expect(l).toMatchObject({ outcome: 'fallback', wanted: '0.1.0-new1234', running: '0.1.0-old1234' });
    expect(l!.reason).toBe('si è chiusa da sola dopo 4 secondi (codice 1)');
    expect(reasonText({ outcome: 'bad', reason: 'window not ready within 30 s' })).toBe('non ha aperto la finestra entro 30 secondi');
    expect(reasonText({ outcome: 'skipped-bad', reason: 'marked bad by an earlier start' })).toBe('era già stata scartata a un avvio precedente');
    const seen = nextSeen('0.1.0-old1234', l, null, NOW);
    expect(seen.fallbackOf).toBe('0.1.0-new1234');
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state: bad, result: null, seen, now: NOW + DAY })).toBe(null);
  });
  it('start outcome: without the launcher\'s file, a bad current release still says so', () => {
    const l = launchOutcome({ running: '0.1.0-old1234', stable: true, state: { ...state, bad: ['0.1.0-new1234'] }, result: null, seen: null, now: NOW });
    expect(l).toMatchObject({ outcome: 'fallback', reason: reasonText(undefined) });
  });
  it('start outcome: nothing for a dev build, a first start, the same version, a rollback by hand', () => {
    expect(launchOutcome({ running: 'dev', stable: false, state, result: null, seen: null, now: NOW })).toBe(null);
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen: null, now: NOW })).toBe(null);
    const st = { current: '0.1.0-old1234', previous: '0.1.0-new1234', bad: [], history: [{ id: '0.1.0-old1234' }, { id: '0.1.0-new1234' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state: st, result: null, seen: { running: '0.1.0-new1234', at: 0 }, now: NOW })).toBe(null);
  });
  it('start outcome: the launcher record written before the start (started still null)', () => {
    const at = new Date(NOW - 3000).toISOString();
    const fresh = { at, wanted: '0.1.0-new1234', started: null, attempts: [] };
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: fresh, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'new' });
    const fell = { at, wanted: '0.1.0-new1234', started: null, attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'window not ready within 30 s' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state, result: fell, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'fallback', reason: 'non ha aperto la finestra entro 30 secondi' });
  });
  it('promotion steps from release.mjs output', () => {
    expect(promoteStep('')).toBe('Avvio');
    expect(promoteStep('npm run check …\n> tsc')).toMatch(/Test in corso/);
    expect(promoteStep('npm run check …\nnpm run test:stable …')).toMatch(/stabile/);
    expect(promoteStep('promoted 0.1.0-abc (previous: x)')).toBe('Versione pronta');
  });
  it('the environment of pull.mjs, release.mjs and the launcher drops what this run was started with, keeps the user settings', () => {
    const env = cleanEnv({ PATH: 'p', SB_RELEASE: 'x', SB_ENGINE_CLAUDE: 'e', SB_TEST: '1', SB_HIDDEN: '1', SB_UPDATE_REPO: 'r', SB_UPDATE_STABLE: '1', ELECTRON_RUN_AS_NODE: '1', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
    expect(env).toEqual({ PATH: 'p', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
  });
});
