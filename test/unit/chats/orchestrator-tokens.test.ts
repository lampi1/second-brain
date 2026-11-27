// The input tokens an ACP Orchestrator reads per turn, before and after ADR 0369, on a fixed transcript fixture
// (test/fixtures/orchestrator-topics/antigravity-day.json): no live call, no engine. Before: the session only grows
// (ACP engines have no compaction), every model call re-reads it. After: the real topic rules, rollover rule and brief
// (orchestrator-topics.ts, orchestrator-rollover.ts, orchestrator-brief.ts) run on the same day; a rollover starts the
// context again from the role text and the brief. Same engine model on both sides: a call reads the context so far,
// a turn's tool outputs and reply grow it. The numbers are printed for the ADR and pinned loosely.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../../src/shared/contract';
import { orchestratorRole } from '../../../src/main/agents/orchestrator-role';
import { OrchestratorTopicService } from '../../../src/main/agents/orchestrator-topic-service';
import { OrchestratorTopicStore } from '../../../src/main/agents/orchestrator-topic-store';
import { topicBrief } from '../../../src/main/agents/orchestrator-brief';
import { ROLLOVER_NOTE, rolloverDue } from '../../../src/main/chats/orchestrator-rollover';
import { sameTopic } from '../../../src/shared/orchestrator-topics';

interface Turn { min: number; text: string; reply: string; toolChars: number; calls: number; from?: string; opens?: { id: string; title: string; cwd: string } }
const fx = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../fixtures/orchestrator-topics/antigravity-day.json'), 'utf8')) as { start: number; baseTokens: number; turns: Turn[] };
const tok = (chars: number): number => Math.round(chars / 4);
/** the hints the app puts under his message (where, open asks, the estimate): about this much */
const HINTS = 400;
const ESSENTIALS = 'me.md:\n' + 'x'.repeat(700) + '\nnow.md:\n' + 'y'.repeat(700);

function day(topics: boolean) {
  let now = fx.start;
  const store = new OrchestratorTopicStore(null, () => now), svc = new OrchestratorTopicService({ store, now: () => now });
  const items: ChatItem[] = [], chats: { id: string; title: string; cwd: string }[] = [], role = orchestratorRole();
  let ctx = fx.baseTokens + tok(role.length), last: string | undefined, rollovers = 0, n = 0;
  // the session a rollover started, as the manager tracks it (manager-topics.ts orchestratorRollover): the user's
  // messages into it and its size after its first turn
  let fresh: { turns: number; base?: number } | null = null;
  const perTurn: number[] = [], labels: string[] = [];
  for (const t of fx.turns) {
    now = fx.start + t.min * 60_000;
    let topic: string | undefined;
    if (t.from) {
      const c = chats.find(x => x.title === t.from);
      topic = c ? svc.topicOfChat(c.id, chats) : undefined;
    } else {
      const a = svc.assign('o', t.text, now, { items, chats, questions: [] }, undefined, `u${n + 1}`);
      topic = a.topic;
      if (fresh && fresh.base === undefined && fresh.turns > 0) fresh.base = ctx;
      const sureSwitch = a.sure && a.by !== 'question' && !!last && !sameTopic(last, topic);
      const reason = topics ? rolloverDue({ kind: 'acp', contextTokens: ctx, topicChanged: sureSwitch, idle: true, ...(fresh ? { turns: fresh.turns, ...(fresh.base ? { baseTokens: fresh.base } : {}) } : {}) }) : null;
      if (reason) {
        rollovers++;
        const brief = topicBrief({ topic, items, topics: store.list(), chats: chats.map(c => ({ id: c.id, title: c.title, state: 'idle' })), essentials: ESSENTIALS });
        ctx = fx.baseTokens + tok(role.length + ROLLOVER_NOTE.length + brief.length);
        fresh = { turns: 1 };
      } else if (fresh) fresh.turns++;
      last = topic;
    }
    labels.push(topic ?? '-');
    ctx += tok(t.text.length + HINTS);
    const growth = tok(t.toolChars + t.reply.length);
    let input = 0;
    for (let j = 0; j < t.calls; j++) input += ctx + Math.round(growth * j / t.calls);
    ctx += growth;
    perTurn.push(input);
    n++;
    items.push({ kind: 'user', id: `u${n}`, at: now, text: t.text, ...(t.from ? { from: t.from } : {}), ...(topic ? { topic } : {}) });
    items.push({ kind: 'assistant', id: `a${n}`, at: now + 1000, text: t.reply, ...(topic ? { topic } : {}) });
    if (t.opens && topic) { chats.push(t.opens); svc.linkChat('o', t.opens.id, topic); }
  }
  const sorted = [...perTurn].sort((a, b) => a - b), q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return { total: perTurn.reduce((a, b) => a + b, 0), p50: q(0.5), p90: q(0.9), max: sorted.at(-1)!, endContext: ctx, rollovers, labels, topics: store.list().map(x => x.label) };
}

describe('input tokens of an ACP Orchestrator day (fixture, no live calls)', () => {
  it('drop by about half with topics and the rollover, and the topics follow the conversation', () => {
    const before = day(false), after = day(true);
    const k = (n: number) => `${Math.round(n / 1000)}k`;
    if (process.env.SB_TOPIC_DEBUG) console.log(after.labels.map((l, i) => `${i} ${l} <- ${fx.turns[i]!.text.slice(0, 50)}`).join('\n'));
    console.log(`[ADR 0369 fixture] turns ${fx.turns.length} · before: total ${k(before.total)}, p50 ${k(before.p50)}, p90 ${k(before.p90)}, max ${k(before.max)}, context at the end ${k(before.endContext)} · after: total ${k(after.total)}, p50 ${k(after.p50)}, p90 ${k(after.p90)}, max ${k(after.max)}, context at the end ${k(after.endContext)}, rollovers ${after.rollovers} · topics ${after.topics.length}: ${after.topics.join(' | ')}`);
    expect(after.total).toBeLessThan(before.total * 0.5);
    expect(after.p50).toBeLessThan(before.p50 * 0.6);
    expect(after.max).toBeLessThan(before.max);
    expect(after.rollovers).toBeGreaterThan(0);
    expect(after.rollovers).toBeLessThan(fx.turns.length / 3); // a fresh session is not every other message
    // the deterministic rules alone (no model) keep the day's subjects apart and bring the follow-ups back
    const at = (needle: string) => after.labels[fx.turns.findIndex(t => t.text.includes(needle))];
    expect(at('fatto il login, riprova')).toBe(at('controlla perché air-mcp-test'));
    expect(at('Token del connettore scaduto')).toBe(at('controlla perché air-mcp-test'));
    expect(at('sì procedi')).toBe(at('prepara il piano per la nuova UI'));
    expect(at('la bozza è pronta?')).toBe(at('scrivi la mail al commercialista'));
    expect(at('Manca la variabile ORIS_DB_PATH')).toBe(at('oris-knowledge non parte mai'));
    expect(at('oris-knowledge ora parte?')).toBe(at('oris-knowledge non parte mai'));
    expect(at('air-mcp-test risponde ancora 401')).toBe(at('controlla perché air-mcp-test'));
    expect(new Set([at('controlla perché air-mcp-test'), at('prepara il piano per la nuova UI'), at('scrivi la mail al commercialista'), at('oris-knowledge non parte mai')]).size).toBe(4);
  });
});
