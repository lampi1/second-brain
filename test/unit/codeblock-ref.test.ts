// A repeated shell block is drawn as a reference to the original command, never as a second Esegui (ADR 0299,
// renderer/components/CodeBlock.tsx RefLine): its state and «Apri» in place of the button, the original's output under
// it. Static render with the run store mocked; invented commands.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { CommandRef } from '../../src/shared/command-dupes';

const state: { ref: CommandRef | null } = { ref: null };
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/lib/runs', () => ({ useBlockRun: () => null, useCommandRef: () => state.ref, useRunById: () => null }));
vi.mock('../../src/renderer/lib/marks', () => ({ useMark: () => null }));
vi.mock('../../src/renderer/lib/clock', async orig => ({ ...(await orig<object>()), useNow: () => 10 }));
const { CodeBlock } = await import('../../src/renderer/components/CodeBlock');

const code = 'az deployment group create -g rg-demo -f main.bicep';
const html = () => renderToStaticMarkup(createElement(CodeBlock, { chatId: 'orch', itemId: 'o1', lang: 'powershell', code }));
const original = { kind: 'ask' as const, id: 'cmd-w1-0', chatId: 'worker', itemId: 'w1' };

it('a block repeating a waiting command shows «in attesa» and «Apri», no Esegui', () => {
  state.ref = { original, ask: { id: 'cmd-w1-0', chatId: 'worker', type: 'command', tool: 'Esegui', title: '', detail: code, input: null, at: 1, command: { itemId: 'w1', code, lang: 'powershell' } }, run: null };
  const h = html();
  expect(h).toContain('data-testid="cb-ref"');
  expect(h).toContain('in attesa');
  expect(h).toContain('cb-ref-open');
  expect(h).not.toContain('cb-exec');
});

it('once the original ran, the reference says «in corso», then «finito, exit N», with its output', () => {
  const run = { id: 'run-1', chatId: 'worker', itemId: 'w1', code, cwd: 'C:/repo/demo', state: 'running' as const, exitCode: null, output: 'Deploying demo…', startedAt: 1 };
  state.ref = { original, ask: null, run };
  expect(html()).toContain('in corso');
  expect(html()).toContain('Deploying demo…');
  state.ref = { original, ask: null, run: { ...run, state: 'error', exitCode: 3, endedAt: 2 } };
  expect(html()).toContain('finito, exit 3');
  expect(html()).not.toContain('cb-exec');
  state.ref = null;
  expect(html()).toContain('cb-exec');
});
