// Live protocol check against the user's real `claude` CLI (spends real tokens, ~0.2 $): runs only with SB_LIVE=1.
//   SB_LIVE=1 npx vitest run test/live
// One tiny sonnet turn in a temp folder, no transcript saved: the model asks one AskUserQuestion, the test answers
// through ClaudeSession like the app does, and the reply must carry the chosen label. Catches protocol drift on CLI
// updates (ADR 0002). Never runs Cursor. Cost, duration, model and CLI version land in test-results/live-claude.json.
// Also: a pasted screenshot (base64 image block) reaches the model (haiku, ~0.01 $; checked on CLI 2.1.283).
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
      await waitFor(() => s.state === 'idle' || undefined, 'the idle state after the result', 10000);
    } finally {
      await s.close();
    }
  }, 420000);

  it('a pasted screenshot (image block) reaches the model', async () => {
    const sink = recSink();
    const s = new ClaudeSession({
      chatId: 'live-img', cwd: tmp('live-img'), model: 'haiku', permissionMode: 'default', sessionId: crypto.randomUUID(), title: 'second-brain live test',
      extraArgs: ['--no-session-persistence'],
    }, sink);
    s.start();
    try {
      s.send('What is the single color filling this image? Answer with one lowercase English word.', [{ mimeType: 'image/png', data: solidPng(96, 64, [220, 20, 20]) }]);
      const r = await waitFor(() => sink.last('result'), 'the result', 180000);
      expect(r.isError).toBe(false);
      expect(sink.last('assistant')?.text.toLowerCase()).toMatch(/red/);
    } finally {
      await s.close();
    }
  }, 300000);

  // "Invia subito" (renderer store.sendQueuedNow) on the real CLI: interrupt mid-turn, wait for idle, send; the new
  // message must run once as its own turn (no replay of the interrupted one, no lost message)
  it('interrupt mid-turn, then a new message: idle in between, one clean turn for it', async () => {
    const sink = recSink();
    const s = new ClaudeSession({
      chatId: 'live-now', cwd: tmp('live-now'), model: 'haiku', permissionMode: 'default', sessionId: crypto.randomUUID(), title: 'second-brain live test',
      extraArgs: ['--no-session-persistence'],
    }, sink);
    s.start();
    try {
      s.send('Count from 1 to 400, one number per line, no other text.');
      await waitFor(() => (sink.last('assistant')?.text.length ?? 0) > 20 || undefined, 'streamed text', 180000);
      await s.interrupt();
      await waitFor(() => s.state === 'idle' || undefined, 'idle after the interrupt', 30000);
      const results = () => [...sink.items.values()].filter(i => i.kind === 'result');
      const before = results().length;
      s.send('Reply with exactly the word: PINEAPPLE');
      await waitFor(() => (results().length > before && s.state === 'idle') || undefined, 'the new turn', 180000);
      const after = results().slice(before);
      fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
      fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-claude-send-now.json'), `${JSON.stringify({ at: new Date().toISOString(), cli: sink.patch.version, before, after, trace: sink.trace }, null, 2)}\n`);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ isError: false });
      expect(sink.last('assistant')?.text).toMatch(/PINEAPPLE/);
    } finally {
      await s.close();
    }
  }, 420000);
});

/** A w×h PNG of one RGB color (no dependency: zlib + CRC32). */
function solidPng(w: number, h: number, rgb: [number, number, number]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
