// The `routine` command (packages/routine-runtime/src/cli.ts) with a scripted engine and a fake DevOps: run (folder and
// .zip), --from-step, preflight refusal, --engine cursor refused, Ctrl+C on a run then `resume` to the end, `watch`
// starting exactly one run for one matching item (a second poll none, a restarted watch none), Ctrl+C on watch, and
// the terminal renderer showing the same current step as the shared reducer. No CLI, no tokens, no network.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { main, parseArgs, PACKAGE_SOURCE_FILE, type CliDeps } from '../../../packages/routine-runtime/src/cli';
import { parseEvents, progressFrom, type RoutineTrigger } from '../../../packages/routine-runtime/src/index';
import { readProgress, renderProgress } from '../../../packages/routine-runtime/src/terminal';
import { extractPackageZip, readZip } from '../../../packages/routine-runtime/src/zip';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir, type Script } from './fakes';

const sink = () => { let text = ''; return { write: (s: string) => { text += s; return true; }, get text() { return text; } }; };

function harness(script: Script, over: Partial<CliDeps> = {}) {
  const stdout = sink(), stderr = sink();
  const engine = scriptedEngine(script);
  let interrupt: (() => void) | undefined;
  const deps: Partial<CliDeps> = {
    stdout, stderr, env: {}, engine: () => engine, mcp: () => undefined, repaintMs: 10_000,
    onInterrupt: handler => { interrupt = handler; return () => { interrupt = undefined; }; },
    ...over,
  };
  return { stdout, stderr, engine, deps, interrupt: () => interrupt?.() };
}

const plainPackage = () => routinePackage({
  inputs: [{ name: 'topic', default: 'the demo' }], devops: undefined,
  steps: [{ id: 'analyse', title: 'Analyse', prompt: 'Analyse {{topic}}.' }, { id: 'fix', title: 'Fix', prompt: 'Fix it.' }, { id: 'report', title: 'Report', prompt: 'Report.' }],
});
function writePackage(pkg = plainPackage()): string {
  const dir = tempDir('routine-cli-pkg-');
  fs.writeFileSync(path.join(dir, 'routine.json'), JSON.stringify(pkg, null, 2));
  return dir;
}

/** A stored + deflated zip (one top folder), the shape of the app's export. */
function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), packed = zlib.deflateRawSync(data), nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const runDirOf = (out: string) => /Folder: (.+)/.exec(out)?.[1]?.trim() ?? '';

describe('routine CLI', () => {
  it('parses repeated --input and refuses an unknown option', () => {
    expect(parseArgs(['run', 'pkg', '--input', 'a=1', '--input', 'b=x=y', '--from-step', 'fix', '--headed']))
      .toMatchObject({ command: 'run', target: 'pkg', inputs: { a: '1', b: 'x=y' }, fromStep: 'fix', headed: true });
    expect(() => parseArgs(['run', 'pkg', '--nope'])).toThrow(/unknown option/);
    expect(() => parseArgs(['run', 'pkg', '--input', 'novalue'])).toThrow(/name=value/);
  });

  it('refuses --engine cursor (not supported yet), exit not 0', async () => {
    const h = harness(() => done('x'));
    expect(await main(['run', writePackage(), '--engine', 'cursor'], h.deps)).toBe(2);
    expect(h.stderr.text).toMatch(/cursor" is not supported yet/);
    expect(h.engine.requests).toHaveLength(0);
  });

  it('runs a package folder to the end and prints the report path', async () => {
    const runs = tempDir('routine-cli-runs-');
    const h = harness(r => done(`did ${r.stepId}`));
    expect(await main(['run', writePackage(), '--input', 'topic=login', '--runs-dir', runs], h.deps)).toBe(0);
    const runDir = runDirOf(h.stdout.text);
    expect(runDir.startsWith(path.join(runs, 'demo'))).toBe(true);
    expect(h.stdout.text).toContain(`Report: ${path.join(runDir, 'report.md')}`);
    expect(fs.readdirSync(path.join(runDir, 'steps'))).toEqual(['01-analyse', '02-fix', '03-report']);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, PACKAGE_SOURCE_FILE), 'utf8')).package).toBeTruthy();
    expect(h.stdout.text).toContain('Passo 3 di 3: Report');
  });

  it('runs the app export .zip and starts at --from-step', async () => {
    const runs = tempDir('routine-cli-runs-');
    const zip = path.join(tempDir(), 'demo routine.zip');
    fs.writeFileSync(zip, zipOf({ 'demo/routine.json': JSON.stringify(plainPackage()), 'demo/files/readme.txt': 'hi' }));
    const h = harness(r => done(`did ${r.stepId}`));
    expect(await main(['run', zip, '--from-step', 'fix', '--runs-dir', runs], h.deps)).toBe(0);
    expect(h.engine.requests.map(r => r.stepId)).toEqual(['fix', 'report']);
    const run = JSON.parse(fs.readFileSync(path.join(runDirOf(h.stdout.text), 'run.json'), 'utf8'));
    expect(run.steps[0]).toMatchObject({ id: 'analyse', status: 'done', attempts: 0 });
    expect((await main(['run', zip, '--from-step', 'nope', '--runs-dir', runs], h.deps))).toBe(1);
    expect(h.stderr.text).toMatch(/No step "nope".*analyse, fix, report/);
  });

  it('refuses a package with preflight errors and prints the fix', async () => {
    const dir = writePackage();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'routine.json'), 'utf8'));
    raw.routine.steps[0].role = 'Artisan';
    fs.writeFileSync(path.join(dir, 'routine.json'), JSON.stringify(raw));
    const h = harness(() => done('x'));
    expect(await main(['run', dir, '--runs-dir', tempDir()], h.deps)).toBe(1);
    expect(h.stderr.text).toMatch(/cannot run yet[\s\S]*Fix:/);
    expect(h.engine.requests).toHaveLength(0);
  });

  it('Ctrl+C stops a run (resumable, exit 130); resume finishes it from the step that did not end', async () => {
    const runs = tempDir('routine-cli-runs-'), pkg = writePackage();
    let h = harness(() => done('x'));
    const blocking: Script = async r => {
      if (r.stepId !== 'fix') return done(`did ${r.stepId}`);
      setTimeout(() => h.interrupt(), 20);
      await new Promise(resolve => r.signal.addEventListener('abort', resolve, { once: true }));
      return 'no-result';
    };
    h = harness(blocking);
    expect(await main(['run', pkg, '--runs-dir', runs], h.deps)).toBe(130);
    const runDir = runDirOf(h.stdout.text);
    expect(h.stdout.text).toMatch(/Resume it with: routine resume /);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')).status).toBe('cancelled');

    const again = harness(r => done(`did ${r.stepId}`));
    expect(await main(['resume', runDir], again.deps)).toBe(0);
    expect(again.engine.requests.map(r => r.stepId)).toEqual(['fix', 'report']);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')).status).toBe('done');
    expect(again.stdout.text).toContain(`Report: ${path.join(runDir, 'report.md')}`);
  });

  describe('watch', () => {
    const trigger: RoutineTrigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true, includeTags: ['ai-fixable'] };
    const oneItem = async (): Promise<FlowDetectionResult> => ({ items: [{ title: 'Bug 42', inputs: { 'work-item-id': '42' } }], cursor: { 42: '3' }, summary: '1 item.' } as unknown as FlowDetectionResult);
    const setup = () => {
      const devops = fakeDevOps();
      devops.addItem({ id: 42, fields: { 'System.Title': 'Login fails', 'System.State': 'New' } });
      const pkg = writePackage(routinePackage({ trigger }));
      return { devops, pkg, runs: tempDir('routine-cli-watch-') };
    };

    it('one matching item: exactly one run; a second poll none; a restarted watch none', async () => {
      const { devops, pkg, runs } = setup();
      const over = { devops: { authorization: devops.authorization, request: devops.request, detect: oneItem }, sleep: async () => undefined };
      const h = harness(r => done(`did ${r.stepId}`), { ...over, maxPolls: 2 });
      expect(await main(['watch', pkg, '--runs-dir', runs], h.deps)).toBe(0);
      expect(h.stdout.text.match(/Work item 42: run \S+ started/g)).toHaveLength(1);
      expect(fs.readdirSync(path.join(runs, 'demo')).filter(d => d !== 'trigger.json')).toHaveLength(1);
      const restarted = harness(r => done(`did ${r.stepId}`), { ...over, maxPolls: 1 });
      expect(await main(['watch', pkg, '--runs-dir', runs], restarted.deps)).toBe(0);
      expect(restarted.engine.requests).toHaveLength(0);
      expect(restarted.stdout.text).toContain('Avviate 0 run.');
    });

    it('Ctrl+C exits cleanly (exit 0): the poll stops, the running run is cancelled and stays resumable', async () => {
      const { devops, pkg, runs } = setup();
      let h = harness(() => done('x'));
      const blocking: Script = async r => {
        setTimeout(() => h.interrupt(), 20);
        await new Promise(resolve => r.signal.addEventListener('abort', resolve, { once: true }));
        return 'no-result' as const;
      };
      const waitForStop = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); void ms; });
      h = harness(blocking, { devops: { authorization: devops.authorization, request: devops.request, detect: oneItem }, sleep: waitForStop });
      expect(await main(['watch', pkg, '--runs-dir', runs], h.deps)).toBe(0);
      expect(h.stdout.text).toMatch(/Stopped\. Interrupted runs stay resumable/);
      const runDir = fs.readdirSync(path.join(runs, 'demo')).find(d => d !== 'trigger.json')!;
      expect(JSON.parse(fs.readFileSync(path.join(runs, 'demo', runDir, 'run.json'), 'utf8')).status).toBe('cancelled');
    });

    it('a package without a trigger is refused', async () => {
      const h = harness(() => done('x'));
      expect(await main(['watch', writePackage(), '--runs-dir', tempDir()], h.deps)).toBe(2);
      expect(h.stderr.text).toMatch(/no DevOps trigger/);
    });
  });
});

describe('routine terminal renderer', () => {
  it('shows the same current step as the shared reducer, the last action and the DevOps comment to answer', () => {
    const dir = tempDir();
    const events = [
      { type: 'run-start', at: 0, runId: 'r', routine: 'demo', total: 7 },
      { type: 'step-start', at: 1000, n: 1, total: 7, id: 'a', title: 'Analisi', attempt: 1 },
      { type: 'step-end', at: 2000, n: 1, id: 'a', status: 'done' },
      { type: 'step-start', at: 60_000, n: 3, total: 7, id: 'c', title: 'Riproduci il bug', attempt: 1 },
      { type: 'action', at: 61_000, n: 3, text: 'Bash: npm test' },
      { type: 'waiting-human', at: 62_000, n: 3, url: 'https://example.test/item/42#comment', question: 'Quale ambiente?' },
    ];
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map(e => JSON.stringify(e)).join('\n')}\n{"partial`);
    const reduced = progressFrom(parseEvents(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')));
    const lines = renderProgress(readProgress(dir), 62_000 + 4 * 60_000);
    expect(reduced.step).toMatchObject({ n: 3, total: 7, title: 'Riproduci il bug' });
    expect(lines[0]).toBe(`Passo ${reduced.step!.n} di ${reduced.step!.total}: ${reduced.step!.title} · in attesa di una persona 4 min`);
    expect(lines).toContain('  ultima azione: Bash: npm test');
    expect(lines).toContain('  rispondi nel commento DevOps: https://example.test/item/42#comment');
  });
});

describe('routine zip reader', () => {
  it('reads a package zip and refuses paths outside its folder', () => {
    const entries = readZip(zipOf({ 'routine.json': '{}', 'files/a.txt': 'x' }));
    expect(entries.map(e => [e.name, e.data.toString()])).toEqual([['routine.json', '{}'], ['files/a.txt', 'x']]);
    const bad = path.join(tempDir(), 'bad.zip');
    fs.writeFileSync(bad, zipOf({ '../evil.txt': 'x', 'routine.json': '{}' }));
    expect(() => extractPackageZip(bad, tempDir())).toThrow(/unsafe path/);
  });
});
