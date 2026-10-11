// Unit tests of the keyboard map (src/renderer/lib/keys.ts): global shortcuts from ADR 0005 and the 1-9 / Enter /
// Esc / arrows answering of a focused question or permission card.
import { describe, expect, it } from 'vitest';
import type { PendingRequest } from '@shared/contract';
import { answerText, goSequence, initialDraft, pickOption, requestKey, resolveShortcut, type Draft, type KeyLike } from '../../src/renderer/lib/keys';

const k = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const ctrl = { ctrlKey: true };

const question = (multi = false, n = 3): PendingRequest => ({
  id: 'q', chatId: 'c', type: 'question', tool: 'AskUserQuestion', title: 'Cosa faccio?', detail: '', input: {}, at: 1,
  questions: [{ question: 'Cosa faccio?', multiSelect: multi, options: Array.from({ length: n }, (_, i) => ({ label: i === 1 ? `Opzione ${i + 1} (consigliato)` : `Opzione ${i + 1}` })) }],
});
const twoQuestions: PendingRequest = {
  ...question(), questions: [
    { question: 'Primo?', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'Secondo?', multiSelect: false, options: [{ label: 'C' }, { label: 'D' }] },
  ],
};
const permission: PendingRequest = { id: 'p', chatId: 'c', type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: {}, at: 1 };

describe('resolveShortcut', () => {
  it('maps the ADR 0005 keys', () => {
    expect(resolveShortcut(k('k', 'KeyK', ctrl))).toEqual({ type: 'palette' });
    expect(resolveShortcut(k('j', 'KeyJ', ctrl))).toEqual({ type: 'next' });
    expect(resolveShortcut(k('.', 'Period', ctrl))).toEqual({ type: 'stopFocused' });
    expect(resolveShortcut(k(':', 'Period', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'stopAll' }); // Italian layout: Shift+. = ":"
    expect(resolveShortcut(k('V', 'KeyV', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'toggleView' });
    expect(resolveShortcut(k('F', 'KeyF', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'focusMode' });
    expect(resolveShortcut(k('n', 'KeyN', ctrl))).toEqual({ type: 'newChat' });
    expect(resolveShortcut(k('F11', 'F11'))).toEqual({ type: 'maximize' });
    expect(resolveShortcut(k('Escape', 'Escape'))).toEqual({ type: 'escape' });
    expect(resolveShortcut(k('3', 'Digit3', ctrl))).toEqual({ type: 'focusTile', index: 3 });
    expect(resolveShortcut(k('0', 'Digit0', ctrl))).toEqual({ type: 'focusTile', index: 0 });
    expect(resolveShortcut(k('/', 'Slash', ctrl))).toEqual({ type: 'shortcuts' });
  });

  it('navigation keys: back/forward, notifications, Regia, map', () => {
    expect(resolveShortcut(k('ArrowLeft', 'ArrowLeft', { altKey: true }))).toEqual({ type: 'back' });
    expect(resolveShortcut(k('ArrowRight', 'ArrowRight', { altKey: true }))).toEqual({ type: 'forward' });
    expect(resolveShortcut(k('N', 'KeyN', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'center' });
    expect(resolveShortcut(k('r', 'KeyR', ctrl))).toEqual({ type: 'regia' });
    expect(resolveShortcut(k('M', 'KeyM', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'map' });
  });

  it('G then a letter goes to a section; a lone G waits; other keys pass', () => {
    const targets = [{ id: 'home', key: 'G H' }, { id: 'costi', key: 'G C' }];
    const g = goSequence(null, k('g', 'KeyG'), 1000, targets);
    expect(g).toEqual({ pendingAt: 1000, handled: true });
    expect(goSequence(g.pendingAt, k('c', 'KeyC'), 1500, targets)).toEqual({ pendingAt: null, target: 'costi', handled: true });
    expect(goSequence(g.pendingAt, k('c', 'KeyC'), 3000, targets).target).toBeUndefined(); // too late
    expect(goSequence(g.pendingAt, k('x', 'KeyX'), 1500, targets)).toEqual({ pendingAt: null, handled: false });
    expect(goSequence(null, k('h', 'KeyH'), 1000, targets)).toEqual({ pendingAt: null, handled: false });
    expect(goSequence(null, k('g', 'KeyG', ctrl), 1000, targets).handled).toBe(false);
  });

  it('ignores plain typing, Alt combos and unknown Ctrl keys', () => {
    expect(resolveShortcut(k('k', 'KeyK'))).toBeNull();
    expect(resolveShortcut(k('1', 'Digit1'))).toBeNull();
    expect(resolveShortcut(k('k', 'KeyK', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveShortcut(k('c', 'KeyC', ctrl))).toBeNull();
    expect(resolveShortcut(k('v', 'KeyV', ctrl))).toBeNull(); // plain paste stays paste
  });
});

describe('requestKey', () => {
  const key = (r: PendingRequest, d: Draft, key: string) => requestKey(r, d, { key, ctrlKey: false, altKey: false, metaKey: false });

  it('permission: 1/Enter allow, 2 always, 3/Esc deny', () => {
    const d = initialDraft(permission);
    expect(key(permission, d, '1').answer).toEqual({ kind: 'permission', allow: true });
    expect(key(permission, d, 'Enter').answer).toEqual({ kind: 'permission', allow: true });
    expect(key(permission, d, '2').answer).toEqual({ kind: 'permission', allow: true, always: true });
    expect(key(permission, d, 'Escape').answer).toEqual({ kind: 'permission', allow: false });
    expect(key(permission, d, 'x').handled).toBe(false);
  });

  it('question: a digit answers with that option label', () => {
    const r = question();
    expect(key(r, initialDraft(r), '1').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': 'Opzione 1' } });
    expect(key(r, initialDraft(r), '3').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': 'Opzione 3' } });
    const out = key(r, initialDraft(r), '7');
    expect(out.handled).toBe(true);
    expect(out.answer).toBeUndefined();
  });

  it('question: Enter picks the highlighted option, which starts on the recommended one; arrows move it', () => {
    const r = question();
    const d = initialDraft(r);
    expect(d.cursor).toBe(1);
    expect(key(r, d, 'Enter').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': 'Opzione 2 (consigliato)' } });
    const down = key(r, d, 'ArrowDown').draft;
    expect(down.cursor).toBe(2);
    expect(key(r, key(r, down, 'ArrowDown').draft, 'Enter').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': 'Opzione 1' } });
  });

  it('question: Esc leaves the card without answering', () => {
    const r = question();
    const out = key(r, initialDraft(r), 'Escape');
    expect(out).toMatchObject({ handled: true, blur: true });
    expect(out.answer).toBeUndefined();
  });

  it('multi-select: digits toggle, Enter confirms the picks', () => {
    const r = question(true);
    let d = initialDraft(r);
    d = key(r, d, '1').draft;
    d = key(r, d, '3').draft;
    d = key(r, d, '1').draft;
    d = key(r, d, '3').draft;
    d = key(r, d, '2').draft;
    expect(d.picks).toEqual([1]);
    d = key(r, d, '3').draft;
    expect(key(r, d, 'Enter').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': ['Opzione 2 (consigliato)', 'Opzione 3'] } });
  });

  it('several questions are answered one after the other, then sent together', () => {
    const first = key(twoQuestions, initialDraft(twoQuestions), '2');
    expect(first.answer).toBeUndefined();
    expect(first.draft.step).toBe(1);
    expect(key(twoQuestions, first.draft, '1').answer).toEqual({ kind: 'question', answers: { 'Primo?': 'B', 'Secondo?': 'C' } });
  });

  it('a permission without "always" ignores 2', () => {
    const r = { ...permission, noAlways: true };
    const out = key(r, initialDraft(r), '2');
    expect(out.handled).toBe(true);
    expect(out.answer).toBeUndefined();
  });

  it('modifier keys are never handled (they are global shortcuts)', () => {
    expect(requestKey(permission, initialDraft(permission), { key: '1', ctrlKey: true, altKey: false, metaKey: false }).handled).toBe(false);
  });

  it('free text: a question takes it as the answer; a permission is denied with it as the message', () => {
    expect(answerText(question(), initialDraft(question()), ' a modo mio ').answer).toEqual({ kind: 'question', answers: { 'Cosa faccio?': 'a modo mio' } });
    expect(answerText(permission, initialDraft(permission), 'usa npm ci').answer).toEqual({ kind: 'permission', allow: false, message: 'usa npm ci' });
    expect(answerText(permission, initialDraft(permission), '   ').handled).toBe(false);
  });

  it('pickOption by click works like the digit', () => {
    expect(pickOption(permission, initialDraft(permission), 2).answer).toEqual({ kind: 'permission', allow: false });
  });
});
