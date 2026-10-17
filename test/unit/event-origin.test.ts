// Memory producer integration: provider snapshots survive file parsing without retrospective attribution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { normalizeEventOrigin } from '../../src/shared/event-origin';

const template = path.resolve(import.meta.dirname, '../../brain-template/ops/tools');
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const makeDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-test-')); dirs.push(dir); return dir; };
const observed = { agentId: 'agent-a', sessionId: 'session-a', turnId: 'turn-a', engine: 'codex', modelObserved: 'observed-model', source: 'chat-provider-event', at: 1234 };

function parseRows(kind: string, file: string) {
  const program = `import fs from 'node:fs'; import {${kind}} from './brain-template/ops/tools/brain-site/parse.mjs'; console.log(JSON.stringify(${kind}(fs.readFileSync(process.argv[1],'utf8'))));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program, file], { cwd: path.resolve(template, '../../..'), encoding: 'utf8', windowsHide: true }));
}

it('accepts only explicit event snapshots and keeps human separate', () => {
  expect(normalizeEventOrigin(JSON.stringify(observed))).toEqual({ kind: 'model', ...observed });
  expect(normalizeEventOrigin({ kind: 'human' })).toEqual({ kind: 'human' });
  for (const value of [undefined, '', '{}', { model: 'selected-profile' }, { ...observed, source: null }, { ...observed, at: Infinity }, { ...observed, modelObserved: null }]) expect(normalizeEventOrigin(value)).toBeUndefined();
});

it('reads a fresh context for each error, never attributes the reporter model to the responsible episode', () => {
  const root = makeDir();
  const context = path.join(root, 'context.json');
  const mem = path.join(template, 'mem.mjs');
  const write = (text: string) => execFileSync(process.execPath, [mem, 'error', '--root', root, '--text', text], { env: { ...process.env, SB_EVENT_CONTEXT: context }, windowsHide: true });
  fs.writeFileSync(context, JSON.stringify({ version: 1, origin: observed }));
  write('2026-10-17 10:00 · chat · area · altro · detto: first · vero: fact · visto da: user');
  fs.writeFileSync(context, JSON.stringify({ version: 1, origin: { ...observed, modelObserved: 'next-model' } }));
  write('2026-10-17 10:01 · chat · area · altro · detto: second · vero: fact · visto da: user');
  fs.unlinkSync(context);
  write('2026-10-17 10:02 · chat · area · altro · detto: third · vero: fact · visto da: user');
  const rows = parseRows('aiErrors', path.join(root, 'ai-errors.md'));
  expect(normalizeEventOrigin(rows[0].reporterOrigin)?.modelObserved).toBe('observed-model');
  expect(normalizeEventOrigin(rows[1].reporterOrigin)?.modelObserved).toBe('next-model');
  expect(rows[2].reporterOrigin).toBe('');
  expect(rows.every((row: { responsibleEpisode: string }) => row.responsibleEpisode === '')).toBe(true);
});

it('preserves an idea event snapshot and leaves legacy ideas unavailable', () => {
  const root = makeDir();
  const context = path.join(root, 'context.json'), body = path.join(root, 'idea.md');
  fs.writeFileSync(context, JSON.stringify({ version: 1, origin: observed }));
  fs.writeFileSync(body, '- **Idea:** useful observation\n- **Fonte:** IA · chat · evidence\n- **Notato:** observed data\n');
  execFileSync(process.execPath, [path.join(template, 'mem.mjs'), 'idea', '--root', root, '--area', 'lavoro', '--title', 'Observed insight', '--per', 'ia', '--file', body], { env: { ...process.env, SB_EVENT_CONTEXT: context }, windowsHide: true });
  fs.appendFileSync(path.join(root, 'ideas.md'), '\n## 2026-01-01 · [lavoro] · Historical insight · `aperta`\n- **Idea:** old\n- **Fonte:** IA · chat · old\n');
  const rows = parseRows('ideas', path.join(root, 'ideas.md'));
  expect(normalizeEventOrigin(rows[0].origin)?.modelObserved).toBe('observed-model');
  expect(normalizeEventOrigin(rows[1].origin)).toBeUndefined();
});

it('records explicit positive feedback as human even with a model context', () => {
  const root = makeDir(), file = path.join(root, 'ai-wins.md');
  const context = path.join(root, 'context.json');
  fs.writeFileSync(context, JSON.stringify({ version: 1, origin: observed }));
  const program = `import {logPositive} from './brain-template/ops/tools/feedback-log.mjs'; logPositive({harness:'codex',chat:'chat',text:'bravo, perfetto',lastAssistant:'Delivered',file:process.argv[1]});`;
  execFileSync(process.execPath, ['--input-type=module', '-e', program, file], { cwd: path.resolve(template, '../../..'), env: { ...process.env, SB_EVENT_CONTEXT: context }, windowsHide: true });
  const rows = parseRows('aiWins', file);
  expect(rows).toHaveLength(1);
  expect(normalizeEventOrigin(rows[0].origin)).toEqual({ kind: 'human' });
});
