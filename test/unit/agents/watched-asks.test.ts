// What the user asked about, told when it is done (agents/watched-asks.ts, ADR 0371 point 4, #492): which chats his
// words name, the general «come procede?», once per ask, the watch's end, and a result the Orchestrator already
// synthesizes. The clock is the test's own; the manager side is in test/unit/agents/delegation.test.ts (#492 point 4).
import { describe, expect, it } from 'vitest';
import { doneNote, WATCH_TTL_MS, WatchedAsks, type WatchedChat } from '../../../src/main/agents/watched-asks';

const chats: WatchedChat[] = [
  { id: 'o', title: 'Orchestrator', state: 'idle', isOrchestrator: true },
  { id: 'a', title: 'Ordini · fix totale', state: 'running' },
  { id: 'b', title: 'Login', state: 'running' },
  { id: 'c', title: 'Report mensile', state: 'idle' },
  { id: 'k', title: 'Ordini · sotto-compito', state: 'running', parentId: 'a' },
  { id: 'x', title: 'Vecchia', state: 'closed', closedAt: 1 },
  { id: 't', title: 'Test', state: 'running' },
  { id: 'p', title: 'Piano · review', state: 'running' },
];
function make() {
  let t = 0;
  const sent: { to: string; text: string }[] = [];
  const w = new WatchedAsks({ list: () => chats, orchestrator: () => 'o', send: (to, text) => { sent.push({ to, text }); }, now: () => t });
  return { w, sent, pass: (ms: number) => { t += ms; } };
}
const result = (chatId: string, quiet = true) => ({ chatId, title: chats.find(c => c.id === chatId)!.title, role: 'Artisan', summary: 'Fatto', quiet });

describe('#492 point 4: watched asks (ADR 0371)', () => {
  it('his words name a root chat by its title or a part of it; in general, every root chat at work', () => {
    const { w } = make();
    expect(w.noteUserText('come va il login?')).toEqual(['b']);
    expect(w.noteUserText('a che punto è «Ordini»?')).toEqual(['a']);
    expect(w.noteUserText('mi fai il punto?')).toEqual(['a', 'b', 't', 'p']);
    expect(w.noteUserText('Novità?')).toEqual(['a', 'b', 't', 'p']);
    expect(w.noteUserText('apri il file ordinamento.ts')).toEqual([]);   // a word that only starts like a title
    expect(w.noteUserText('scrivi una mail a Marco')).toEqual([]);
  });

  it('(review) a short or common title never matches his ordinary words; «aggiornamenti», «situazione», «come va» watch nothing', () => {
    const { w } = make();
    expect(w.noteUserText('lancia i test')).toEqual([]);
    expect(w.noteUserText('fai la review del piano')).toEqual([]);
    expect(w.noteUserText('ci sono aggiornamenti da installare?')).toEqual([]);
    expect(w.noteUserText("com'è la situazione col cliente?")).toEqual([]);
    expect(w.noteUserText('ciao, come va?')).toEqual([]);
    expect(w.noteUserText('novità sui lavori?')).toEqual(['a', 'b', 't', 'p']);
  });

  it('(review) a watch with no result ends after its time too', () => {
    const { w, pass } = make();
    w.noteUserText('come procede il login?');
    expect(w.size).toBe(1);
    pass(WATCH_TTL_MS + 1);
    expect(w.size).toBe(0);
  });

  it('a watched quiet result is one note to the Orchestrator, once; an unwatched one, a synthesized one or a late one none', () => {
    const { w, sent, pass } = make();
    w.noteUserText('come procede ordini?');
    expect(w.resultReleased(result('b'))).toBe(false);
    expect(w.resultReleased(result('a'))).toBe(true);
    expect(w.resultReleased(result('a'))).toBe(false);   // once per ask
    expect(sent).toEqual([{ to: 'o', text: doneNote(result('a')) }]);
    expect(sent[0]!.text).toMatch(/ONE short line in Italian/);
    // the Orchestrator writes about a synthesized result itself: the watch ends, no note
    w.noteUserText('e il login?');
    expect(w.resultReleased(result('b', false))).toBe(false);
    expect(w.resultReleased(result('b'))).toBe(false);
    // after the watch's time, nothing
    w.noteUserText('come va il login?');
    pass(WATCH_TTL_MS + 1);
    expect(w.resultReleased(result('b'))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
