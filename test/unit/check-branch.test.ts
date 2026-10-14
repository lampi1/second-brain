// scripts/check-branch.mjs (`npm run check:branch`, ADR 0027): which e2e specs the light check of a branch runs for
// its changed files. A spec of the area or one that names the file; the smoke set for files the whole app goes
// through or that no spec names; nothing for docs and unit tests; never more than MAX_SPECS; never the whole suite.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { changedSpecs, MAX_SPECS, SMOKE } from '../../scripts/check-branch.mjs';

const spec = (name: string, text = '') => ({ name, text });
const SPECS = [
  spec('smoke.spec.ts', 'the app boots'),
  spec('improve.spec.ts', "// End-to-end: \"Migliora l'app\" (components/ImprovePage.tsx, LaunchBanner.tsx; ADR 0020)"),
  spec('mail.spec.ts', '// mail between chats (src/main/chats/mail.ts)'),
  spec('chats.spec.ts', '// the fake CLI (test/fixtures/fake-claude.mjs)'),
  spec('command-asks.spec.ts', '// "Comando da eseguire" (main/run/asks.ts, shared/command-ask.ts) service.ts'),
  spec('codeblocks.spec.ts', '// code blocks'),
  spec('stream.spec.ts', '// alive marks step from lib/beat.ts'),
  spec('devops.spec.ts', '// fake from test/fixtures/devops'),
];
const pick = (...files: string[]) => changedSpecs(files, SPECS).specs;

describe('check:branch spec mapping', () => {
  it('an area maps to its specs, a file to the spec named like it or naming it', () => {
    expect(pick('src/main/improve/stages.ts')).toEqual(['improve.spec.ts']);
    expect(pick('src/renderer/components/ImprovePage.tsx')).toEqual(['improve.spec.ts']);
    expect(pick('src/renderer/store/improve.ts')).toEqual(['improve.spec.ts']);
    expect(pick('src/renderer/lib/beat.ts')).toEqual(['stream.spec.ts']);
    expect(pick('src/main/run/asks.ts').sort()).toEqual(['codeblocks.spec.ts', 'command-asks.spec.ts']);
    // mail.ts: the spec named like it and the one of its area
    expect(pick('src/main/chats/mail.ts').sort()).toEqual(['chats.spec.ts', 'mail.spec.ts']);
  });

  it('a generic name (service.ts) needs its folder in the spec; alone it is not a match', () => {
    expect(pick('src/main/run/service.ts').sort()).toEqual(['codeblocks.spec.ts', 'command-asks.spec.ts']);
    expect(pick('src/main/skills/service.ts')).toEqual(SMOKE);
  });

  it('a changed spec, its snapshots and its fixtures run that spec', () => {
    expect(pick('test/e2e/mail.spec.ts')).toEqual(['mail.spec.ts']);
    expect(pick('test/fixtures/devops/devops-me.mjs')).toEqual(['devops.spec.ts']);
    expect(pick('test/fixtures/fake-claude.mjs')).toEqual(['chats.spec.ts']);
  });

  it('the files of the whole app and files no spec names fall back to the smoke set', () => {
    expect(pick('src/shared/contract.ts')).toEqual(SMOKE);
    expect(pick('src/main/wiring.ts', 'src/main/improve/service.ts').sort()).toEqual(['improve.spec.ts', 'smoke.spec.ts']);
    expect(pick('src/renderer/components/Nowhere.tsx')).toEqual(SMOKE);
    expect(pick('test/e2e/helpers.ts')).toEqual(SMOKE);
  });

  it('docs, unit tests and scripts run no e2e', () => {
    expect(pick('docs/adr/0027-light-branch-check.md', 'AGENTS.md', 'test/unit/improve.test.ts', 'scripts/check-pass.mjs')).toEqual([]);
    expect(pick()).toEqual([]);
  });

  it('a broad change runs at most MAX_SPECS specs, the most touched first, never the whole suite', () => {
    const many = Array.from({ length: 12 }, (_, i) => spec(`area${i}.spec.ts`));
    const out = changedSpecs(['test/e2e/area3.spec.ts', ...many.map(s => `src/main/x/${s.name.replace('.spec.ts', '')}.ts`)], [...many, ...SPECS]);
    expect(out.specs).toHaveLength(MAX_SPECS);
    expect(out.specs[0]).toBe('area3.spec.ts');
    expect(out.why.join('\n')).toMatch(/full check on main/);
  });

  it('Windows paths work; every spec name it can return exists in test/e2e', () => {
    expect(pick('src\\main\\improve\\stages.ts')).toEqual(['improve.spec.ts']);
    const dir = path.join(import.meta.dirname, '..', 'e2e');
    const real = fs.readdirSync(dir).filter(f => f.endsWith('.spec.ts')).map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
    for (const s of SMOKE) expect(real.some(r => r.name === s)).toBe(true);
    // on the real specs a change to the improve area maps to its spec
    expect(changedSpecs(['src/main/improve/stages.ts'], real).specs).toContain('improve.spec.ts');
  });
});
