// Conversation routing uses captured identities and a settled thought, never the latest visible recipient.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceTurns, type VoiceTurnTarget } from '../../src/renderer/lib/voice-turns';
import { parseSpokenAnswer } from '../../src/shared/voice';
const target: VoiceTurnTarget = { chatId: 'orchestrator', mode: 'talk', questionId: 'approval-1', questionVersion: 'version-1', answerable: true };
function make() {
  vi.useFakeTimers();
  const current = vi.fn(() => true), deliver = vi.fn(), draft = vi.fn();
  return { turns: new VoiceTurns({ current, deliver, draft }), current, deliver, draft };
}
afterEach(() => vi.useRealTimers());
describe('complete spoken thoughts', () => {
  it('joins a correction before interpreting yes/no, including a slow second decode', () => {
    const { turns, deliver } = make();
    turns.start(1, target, false); turns.finish(1, 'Sì');
    vi.advanceTimersByTime(600);
    turns.start(2, target, false);
    vi.advanceTimersByTime(2000);
    expect(deliver).not.toHaveBeenCalled();
    turns.finish(2, 'ma aspetta');
    vi.advanceTimersByTime(700);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(target, 'Sì ma aspetta');
    expect(parseSpokenAnswer(deliver.mock.calls[0]![1])).toEqual({ kind: 'text', text: 'Sì ma aspetta' });
  });
  it('does not attach a late answer to a newer question or new chat', () => {
    const { turns, current, deliver, draft } = make();
    turns.start(1, target, false); turns.finish(1, 'Sì');
    current.mockReturnValue(false);
    vi.advanceTimersByTime(700);
    expect(deliver).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledExactlyOnceWith(target, 'Sì');
  });
  it('does not activate a question that has not finished playing', () => {
    const { turns, deliver, draft } = make();
    const waiting = { ...target, answerable: false };
    turns.start(1, waiting, false); turns.finish(1, 'Sì'); vi.advanceTimersByTime(700);
    expect(deliver).not.toHaveBeenCalled(); expect(draft).toHaveBeenCalledWith(waiting, 'Sì');
  });
  it('stop/reset invalidates pending results and timers', () => {
    const { turns, deliver, draft } = make();
    turns.start(1, target, false); turns.finish(1, 'Sì'); turns.start(2, target, false);
    turns.reset(); turns.finish(2, 'Sì'); vi.advanceTimersByTime(1000);
    expect(deliver).not.toHaveBeenCalled(); expect(draft).not.toHaveBeenCalled();
  });
  it('preserves a recognized thought in the original draft on automatic microphone restart', () => {
    const { turns, deliver, draft } = make();
    turns.start(1, target, false); turns.finish(1, 'Keep these words');
    turns.reset(true); vi.advanceTimersByTime(1000);
    expect(deliver).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledExactlyOnceWith(target, 'Keep these words');
  });
  it('drops echoes and unknown/duplicate results without losing real dictation', () => {
    const { turns, deliver, draft } = make();
    turns.start(1, target, true); turns.finish(1, 'Sì'); turns.finish(2, 'unpaired');
    const dictation = { ...target, chatId: 'flash', mode: 'dictate' as const, questionId: null };
    turns.start(3, dictation, false); turns.finish(3, 'real words'); turns.finish(3, 'duplicate');
    vi.advanceTimersByTime(1000);
    expect(deliver).not.toHaveBeenCalled(); expect(draft).toHaveBeenCalledExactlyOnceWith(dictation, 'real words');
  });
  it('keeps two different captured contexts separate, and never dispatches the earlier one', () => {
    const { turns, deliver, draft } = make();
    turns.start(1, target, false); turns.finish(1, 'first');
    const next = { ...target, questionId: 'approval-2' };
    turns.start(2, next, false); turns.finish(2, 'second'); vi.advanceTimersByTime(700);
    expect(draft).toHaveBeenCalledExactlyOnceWith(target, 'first');
    expect(deliver).toHaveBeenCalledExactlyOnceWith(next, 'second');
  });
});
describe('push to talk (manual turns)', () => {
  function manual() {
    vi.useFakeTimers();
    const current = vi.fn(() => true), deliver = vi.fn(), draft = vi.fn();
    return { turns: new VoiceTurns({ current, deliver, draft, manual: () => true }), deliver, draft };
  }
  it('a pause while holding sends nothing; the release sends everything at once', () => {
    const { turns, deliver } = manual();
    turns.start(1, target, false); turns.finish(1, 'prima parte');
    vi.advanceTimersByTime(5000);
    expect(deliver).not.toHaveBeenCalled();
    turns.start(2, target, false); turns.finish(2, 'seconda');
    turns.flush();
    expect(deliver).toHaveBeenCalledExactlyOnceWith(target, 'prima parte seconda');
  });
  it('a transcript still on its way at the release goes as soon as it comes', () => {
    const { turns, deliver } = manual();
    turns.start(1, target, false);
    turns.flush();
    expect(deliver).not.toHaveBeenCalled();
    turns.finish(1, 'arrivo tardi');
    expect(deliver).toHaveBeenCalledExactlyOnceWith(target, 'arrivo tardi');
  });
  it('reset (Esc while holding) sends nothing', () => {
    const { turns, deliver, draft } = manual();
    turns.start(1, target, false); turns.finish(1, 'annulla');
    turns.reset(); turns.flush(); vi.advanceTimersByTime(1000);
    expect(deliver).not.toHaveBeenCalled(); expect(draft).not.toHaveBeenCalled();
  });
});
