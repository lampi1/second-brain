// scripts/e2e.mjs (ADR 0042): how many e2e workers the machine takes now (cores/4 up to 4, fewer when the CPU is
// busy or memory is short, never 0), SB_E2E_WORKERS winning over the measure; and playwright.config.ts: the exclusive
// specs exist and the parallel project never picks them; scripts/process-units.mjs: the rule that picks the unit files the full check runs alone.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { autoWorkers, pickWorkers } from '../../scripts/e2e.mjs';
import config, { EXCLUSIVE } from '../../playwright.config';
// @ts-expect-error plain .mjs script without types
import { EXTRA, processUnits } from '../../scripts/process-units.mjs';

describe('autoWorkers', () => {
  it('a quarter of the cores, at most 4', () => {
    expect(autoWorkers({ cores: 14, busy: 0.1, freeGb: 16 })).toBe(3);
    expect(autoWorkers({ cores: 32, busy: 0.1, freeGb: 16 })).toBe(4);
    expect(autoWorkers({ cores: 4, busy: 0.1, freeGb: 16 })).toBe(1);
    expect(autoWorkers({ cores: 2, busy: 0, freeGb: 16 })).toBe(1);
  });
  it('half over 60% busy, one over 90%', () => {
    expect(autoWorkers({ cores: 16, busy: 0.7, freeGb: 16 })).toBe(2);
    expect(autoWorkers({ cores: 16, busy: 0.95, freeGb: 16 })).toBe(1);
  });
  it('no more than the free memory allows, never 0', () => {
    expect(autoWorkers({ cores: 16, busy: 0, freeGb: 1.3 })).toBe(2);
    expect(autoWorkers({ cores: 16, busy: 0, freeGb: 0.2 })).toBe(1);
  });
});

describe('pickWorkers', () => {
  it('SB_E2E_WORKERS wins; a bad value is measured instead', () => {
    expect(pickWorkers({ SB_E2E_WORKERS: '3' })).toEqual({ n: 3, why: 'SB_E2E_WORKERS' });
    expect(pickWorkers({ SB_E2E_WORKERS: 'x' }).why).toMatch(/cores, CPU \d+% busy/);
  }, 10_000);
});

describe('exclusive specs', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'e2e');
  it('each one exists, with its reason', () => {
    for (const [f, why] of Object.entries(EXCLUSIVE)) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
      expect(why).toBeTruthy();
    }
  });
  it('every spec that reads the system clipboard back is one of them', () => {
    const readers = fs.readdirSync(dir).filter(f => f.endsWith('.spec.ts') && /clipboard\.readText|\{ clipboard \}/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(readers.length).toBeGreaterThan(0);
    for (const f of readers) expect(EXCLUSIVE[f], `${f} reads the system clipboard: add it to EXCLUSIVE (playwright.config.ts)`).toBeTruthy();
  });
  it('the parallel project ignores them, the exclusive one runs them alone', () => {
    const [par, exc] = config.projects!;
    expect(par!.name).toBe('parallel');
    expect(par!.testIgnore).toEqual(Object.keys(EXCLUSIVE).map(f => `**/${f}`));
    expect(exc).toMatchObject({ name: 'exclusive', workers: 1, testMatch: par!.testIgnore });
  });
});

describe('unit tests with real processes (scripts/process-units.mjs)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const units = processUnits() as string[];
  it('the rule finds the files whose spawns missed their deadlines beside the e2e (2026-10-14)', () => {
    for (const f of ['chats/manager', 'chats/resume', 'chats/proctree', 'brain/cursor-ledger', 'chats/handoff', 'chats/warm']) {
      expect(units, f).toContain(`test/unit/${f}.test.ts`);
    }
  });
  it('every file that imports node:child_process, uses a fake engine or builds a ChatManager is one; the rest stays', () => {
    const all = (fs.readdirSync(path.join(root, 'test', 'unit'), { recursive: true }) as string[])
      .filter(f => f.endsWith('.test.ts')).map(f => `test/unit/${f.split(path.sep).join('/')}`);
    const direct = all.filter(f => /['"]node:child_process['"]|fake-[\w-]+\.mjs|\bFAKE(_CURSOR)?\b|new ChatManager\(/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    expect(direct.length).toBeGreaterThan(0);
    for (const f of direct) expect(units, f).toContain(f);
    expect(units.length).toBeLessThan(all.length);   // the others still run beside the e2e
  });
  it('follows src imports to any depth, and a type-only import starts nothing', () => {
    expect(units).toContain('test/unit/brain/live.test.ts');   // Live → brain/node → execFile
    expect(units).not.toContain('test/unit/tasks.test.ts');   // imports brain/node's types only, injects its runner
  });
  it('each EXTRA file exists', () => {
    for (const f of EXTRA as string[]) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });
});
