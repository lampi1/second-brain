// Live protocol check against the user's real `claude` CLI (spends real tokens, ~0.2 $): runs only with SB_LIVE=1.
//   SB_LIVE=1 npx vitest run test/live
// One tiny sonnet turn in a temp folder, no transcript saved: the model asks one AskUserQuestion, the test answers
// through ClaudeSession like the app does, and the reply must carry the chosen label. Catches protocol drift on CLI
// updates (ADR 0002). Never runs Cursor. Cost, duration, model and CLI version land in test-results/live-claude.json.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeSession } from '../../src/main/chats/claude';
import { recSink, tmp, waitFor } from '../unit/chats/helpers';

describe.skipIf(process.env.SB_LIVE !== '1')('live: real claude CLI', () => {
  it('streams, asks a question through can_use_tool, takes the answer and reports cost', async () => {
    const sink = recSink();
    const s = new ClaudeSession({
      chatId: 'live', cwd: tmp('live'), model: 'sonnet', permissionMode: 'default', sessionId: crypto.randomUUID(), title: 'second-brain live test',
      extraArgs: ['--no-session-persistence'],
    }, sink);
    s.start();
    try {
      s.send('Protocol test of a host app. Use the AskUserQuestion tool exactly once: question "Pick one", header "Pick", options "Alfa" and "Beta", single choice. After the answer, reply with only the chosen label and nothing else.');
      const q = await waitFor(() => sink.pendings[0], 'the question', 180000);
      expect(q.type).toBe('question');
      const question = q.questions?.[0];
      expect(question?.options.length).toBeGreaterThanOrEqual(2);
      const label = question?.options.find(o => /beta/i.test(o.label))?.label ?? question?.options[1]?.label ?? 'Beta';
      expect(s.answer(q.id, { kind: 'question', answers: { [question?.question ?? 'Pick one']: label } })).toBe(true);
      const r = await waitFor(() => sink.last('result'), 'the result', 240000);
      // vitest hides console output of passing tests: the facts go to a file (test-results/ is gitignored)
      const facts = { at: new Date().toISOString(), costUsd: r.costUsd, durationMs: r.durationMs, model: sink.patch.model, cli: sink.patch.version, isError: r.isError };
      fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
      fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-claude.json'), `${JSON.stringify(facts, null, 2)}\n`);
      expect(r.isError).toBe(false);
      expect(r.costUsd).toBeGreaterThan(0);
      expect(sink.last('tool')).toMatchObject({ name: 'AskUserQuestion', status: 'ok' });
      expect(sink.last('assistant')?.text).toMatch(/beta/i);
      expect(sink.events.some(e => e.replace)).toBe(true); // streamed
      expect(s.state).toBe('idle');
    } finally {
      await s.close();
    }
  }, 420000);
});
