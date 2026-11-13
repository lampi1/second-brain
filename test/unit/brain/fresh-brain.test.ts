// A clean install starts from an EMPTY brain (the owner, 2026-10-18; ADR 0072): a brain created the way setup does
// (the automatic memory) holds only the owner's profile and brain.json, the
// brain pages find no rules, skills or memory in it, and the app still delivers its machinery (boot rules, topic
// rules, agents, skills, hooks, the model table) from its own copy outside the folder. Temp folders only: the release
// template is the repo's brain-template; no real brain, global settings, app or model is used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useAssets } from '../../../src/main/rules/delivery';
import { writeFreshBrain } from '../../../src/main/rules/new-brain';
import { useTemplateRoot, useToolsHome } from '../../../src/main/rules/tools';

const TEMPLATE = path.resolve(import.meta.dirname, '../../../brain-template');
let base = '';
const roots: string[] = [];
/** every file under `dir` (forward slashes), the brain's own .git left out */
function tree(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === '.git') return [];
    return e.isDirectory() ? tree(dir, r) : [r];
  }).sort();
}
beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fresh-'))); roots.push(base);
  useToolsHome(path.join(base, 'userData')); useTemplateRoot(TEMPLATE);
  const assets = path.join(base, 'assets');
  fs.mkdirSync(path.join(assets, 'hooks'), { recursive: true });
  for (const f of ['runtime.mjs', 'cli.mjs', 'hooks/runner.mjs', 'hooks/cli.mjs']) fs.writeFileSync(path.join(assets, f), '// fixture\n');
  useAssets(assets);
});
afterEach(() => { useToolsHome(null); useTemplateRoot(null); useAssets(null); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

describe('a fresh brain is empty of app content', () => {
  it('never writes into a folder that already has files (a legacy brain keeps all of them)', () => {
    const legacy = path.join(base, 'legacy'); fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'AGENTS.md'), '# My brain\n');
    fs.writeFileSync(path.join(legacy, 'routines.md'), '# Routines\n');
    expect(() => writeFreshBrain(legacy)).toThrow();
    expect(tree(legacy)).toEqual(['AGENTS.md', 'routines.md']);
  });
});
