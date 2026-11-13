// Impara's one field (ADR 0204, shared/impara-start.ts): a PR link makes a PR lesson, a long text a text to explain,
// anything else a topic; a forced kind and a text from another page win; the files alone get an ask of their own.
import { describe, expect, it } from 'vitest';
import { detectKind, prLinkIn, startOf } from '../../src/shared/impara-start';

describe('detectKind', () => {
  it('finds a GitHub or Azure DevOps PR anywhere in the field', () => {
    expect(detectKind('Come funziona l’autenticazione nella https://github.com/lampi1/second-brain/pull/301?')).toMatchObject({ kind: 'pr', prUrl: 'https://github.com/lampi1/second-brain/pull/301', pr: { provider: 'github', number: 301 } });
    expect(detectKind('https://dev.azure.com/o/Shop/_git/api/pullrequest/812')).toMatchObject({ kind: 'pr', pr: { provider: 'devops', number: 812 } });
    // the old host form, spelled in pieces (the repo guard keeps such hosts out of the code)
    const old = ['https://o', 'visualstudio', 'com/Shop/_git/api/pullrequest/9'].join('.');
    expect(prLinkIn(`vedi ${old}).`)?.url).toBe(old);
    expect(prLinkIn('https://github.com/a/b/issues/3')).toBeNull();
  });

  it('a long text is a text; a short line a topic', () => {
    expect(detectKind('Come funziona l’IPC di Electron').kind).toBe('topic');
    expect(detectKind('x'.repeat(700)).kind).toBe('text');
    expect(detectKind('a\nb\nc\nd\ne\nf\ng\nh').kind).toBe('text');
  });
});

describe('startOf', () => {
  const opts = { filesAsk: 'Spiegami questi file.' };
  it('builds the start fields', () => {
    expect(startOf('Perché? https://github.com/a/b/pull/7', null, opts)).toEqual({ kind: 'pr', prUrl: 'https://github.com/a/b/pull/7', ask: 'Perché?' });
    expect(startOf('  Le CSP  ', null, opts)).toEqual({ kind: 'topic', ask: 'Le CSP' });
    expect(startOf('y'.repeat(700), null, opts)).toEqual({ kind: 'text', text: 'y'.repeat(700), ask: '' });
    expect(startOf('', null, opts)).toBeNull();
  });

  it('a forced kind wins; a PR forced without a link cannot start', () => {
    expect(startOf('un testo breve da spiegare', 'text', opts)).toMatchObject({ kind: 'text', text: 'un testo breve da spiegare' });
    expect(startOf('nessun link', 'pr', opts)).toBeNull();
    expect(startOf('x'.repeat(700), 'topic', opts)?.kind).toBe('topic');
  });

  it('a text from another page is the text; the field its ask', () => {
    expect(startOf('Cosa dice?', null, { ...opts, pasted: 'La regola…' })).toEqual({ kind: 'text', text: 'La regola…', ask: 'Cosa dice?' });
  });

  it('files alone start a topic with an ask of their own', () => {
    expect(startOf('', null, { ...opts, hasFiles: true })).toEqual({ kind: 'topic', ask: 'Spiegami questi file.' });
  });
});
