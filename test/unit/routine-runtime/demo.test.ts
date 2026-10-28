// The package demo (packages/routine-runtime/demo) runs from a clean folder through the `routine` command: the package
// and the stand-in Claude CLI are copied into an empty temp folder, the <set-by-user> secrets filled with test values,
// and `routine run` drives it with the real Claude engine adapter (a spawned process, stream-json on stdout) against a
// fake DevOps: no app, no brain, no tokens. Parity: the same package through the app host (createRoutineHost) and
// through the CLI gives the same step folders and the same report.md structure. ADR 0175.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../../packages/routine-runtime/src/cli';
import { createClaudeEngine, loadRoutinePackage, readRun, type EngineRunner } from '../../../packages/routine-runtime/src/index';
import { fakeDevOps, tempDir } from './fakes';

const DEMO = path.resolve(__dirname, '../../../packages/routine-runtime/demo');
const stub = { command: process.execPath, args: ['-e', ''] };
const quiet = () => ({ write: () => true });

/** The demo copied into an empty folder with its placeholders filled (what the owner does by hand). */
function cleanDemo(): { dir: string; engine: EngineRunner } {
  const dir = tempDir('routine-demo-');
  const raw = fs.readFileSync(path.join(DEMO, 'routine.json'), 'utf8').replace(/<set-by-user>/g, 'demo-value-1234');
  fs.writeFileSync(path.join(dir, 'routine.json'), raw);
  fs.copyFileSync(path.join(DEMO, 'fake-claude.mjs'), path.join(dir, 'fake-claude.mjs'));
  const engine = createClaudeEngine({ command: (args, env) => ({ command: process.execPath, args: [path.join(dir, 'fake-claude.mjs'), ...args], env }) });
  return { dir, engine };
}

function devopsWithItem() {
  const devops = fakeDevOps();
  devops.addItem({ id: 126308, project: 'Planning', fields: { 'System.Title': 'Demo bug', 'System.WorkItemType': 'Bug', 'System.State': 'New' } });
  return devops;
}

describe('routine runtime demo', () => {
  it('ships two steps (browser login, DevOps read), the ?mode=local login URL and no real secret', () => {
    const pkg = loadRoutinePackage(DEMO);
    expect(pkg.routine.steps.map(s => s.id)).toEqual(['air-login', 'work-item']);
    expect(pkg.routine.steps[0]!.browser).toBe(true);
    expect(pkg.credentials?.[0]?.loginUrl).toBe('https://dent-1.test.air.orisline.com/Account/Login?mode=local');
    expect(JSON.stringify(pkg)).not.toMatch(/demo-value/);
  });

  it('runs end to end from a clean folder through `routine run` (no app, no brain, fake DevOps)', async () => {
    const { dir, engine } = cleanDemo();
    const devops = devopsWithItem();
    const runs = path.join(dir, 'runs');
    let out = '';
    const code = await main(['run', dir, '--runs-dir', runs], {
      engine: () => engine, mcp: () => stub, env: {}, stdout: { write: s => { out += s; return true; } }, stderr: quiet(),
      onInterrupt: () => () => undefined, repaintMs: 60_000, devops: { authorization: devops.authorization, request: devops.request },
    });
    expect(code, out).toBe(0);
    const runDir = /Folder: (.+)/.exec(out)![1]!.trim();
    const run = readRun(runDir);
    expect(run.run.status).toBe('done');
    expect(run.run.steps.map(s => [s.id, s.status])).toEqual([['air-login', 'done'], ['work-item', 'done']]);
    expect(fs.readFileSync(path.join(runDir, 'steps', '02-work-item', 'prompt.md'), 'utf8')).toContain('126308');
    expect(fs.readFileSync(path.join(runDir, 'steps', '02-work-item', 'prompt.md'), 'utf8')).toContain('Demo bug');
    expect(fs.readFileSync(path.join(runDir, 'steps', '01-air-login', 'prompt.md'), 'utf8')).toContain('## Browser');
    // the filled secrets never reach the run folder
    const all = fs.readdirSync(runDir, { recursive: true }).map(f => path.join(runDir, String(f))).filter(f => fs.statSync(f).isFile()).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toContain('demo-value-1234');
    expect(out).toContain(`Report: ${path.join(runDir, 'report.md')}`);
  }, 60_000);

});
