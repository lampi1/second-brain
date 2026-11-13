// «Chiedi alla Guida» (ADR 0196): the question box on top of the Guida page. The question goes to main (IPC guide:ask),
// which asks one light model with no tools, the matching cards and the app map as context; nothing here costs tokens
// until the user presses Chiedi (or Enter). The answer shows under the box: its paragraphs, each [card:<id>] citation as
// a chip that opens that card's panel, each cited source file as a code chip, and the model with its cost when known.
// Loading and error states in place; Esc clears. Hooks stay useState only (test/unit/concept-discuss-click.test.ts
// renders the page without a DOM). Mounted by GuidePage.tsx; pure parts in shared/guide-ask.ts.
import { useState } from 'react';
import { CONCEPTS, textOf, type GuideLang } from '@shared/concept-guide';
import { QUESTION_MAX, answerPieces, type GuideAnswer } from '@shared/guide-ask';
import { t } from '../i18n';
import { formatCost } from '../lib/format';
import { IconSparkle } from './Icons';

type State = { kind: 'idle' } | { kind: 'loading'; question: string } | { kind: 'done'; question: string; answer: GuideAnswer } | { kind: 'error'; question: string; message: string };

const TITLES = new Map(CONCEPTS.map(c => [c.id, c.title]));

function reasonText(a: GuideAnswer): string {
  if (a.noEngine) return t('guide.ask.noEngine');
  if (a.reason === 'invalid') return t('guide.ask.invalid');
  return t('guide.ask.failed', { reason: a.reason ?? '—' });
}

function Answer({ answer, l, onOpen }: { answer: GuideAnswer; l: GuideLang; onOpen: (id: string) => void }) {
  const ids = new Set(answer.cards), files = new Set(answer.files);
  const blocks = answer.text.split(/\n{2,}/).map(b => b.split('\n'));
  const line = (s: string, k: number) => (
    <span key={k}>
      {answerPieces(s, ids, files).map((p, i) => p.kind === 'text' ? <span key={i}>{p.text}</span>
        : p.kind === 'card' ? <button key={i} type="button" className="guide-ask-cite" onClick={() => onOpen(p.id)} data-testid={`guide-ask-cite-${p.id}`}>{textOf(TITLES.get(p.id)!, l)}</button>
        : p.kind === 'file' ? <code key={i} className="guide-ask-file">{p.path}</code>
        : <code key={i}>{p.text}</code>)}
    </span>
  );
  return (
    <div className="guide-ask-text">
      {blocks.map((rows, i) => rows.every(r => /^\s*[-*] /.test(r))
        ? <ul key={i}>{rows.map((r, k) => <li key={k}>{line(r.replace(/^\s*[-*] /, ''), k)}</li>)}</ul>
        : <p key={i}>{rows.map((r, k) => <span key={k}>{k > 0 && <br />}{line(r, k)}</span>)}</p>)}
    </div>
  );
}

export function GuideAsk({ l, onOpen }: { l: GuideLang; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = state.kind === 'loading';
  const ask = () => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setState({ kind: 'loading', question });
    window.sb.invoke('guide:ask', { question, lang: l }).then(
      answer => setState(answer.ok ? { kind: 'done', question, answer } : { kind: 'error', question, message: reasonText(answer) }),
      e => setState({ kind: 'error', question, message: t('guide.ask.failed', { reason: e instanceof Error ? e.message : String(e) }) }));
  };
  const cost = state.kind === 'done' && state.answer.costUsd !== null
    ? `${state.answer.costBasis === 'estimated' ? '≈ ' : ''}${formatCost(state.answer.costUsd)}` : null;
  return (
    <section className="guide-ask" aria-label={t('guide.ask.label')} data-testid="guide-ask">
      <form className="guide-ask-box" onSubmit={e => { e.preventDefault(); ask(); }}>
        <span className="guide-ask-icon" aria-hidden="true"><IconSparkle size={15} /></span>
        <label className="sr-only" htmlFor="guide-ask-input">{t('guide.ask.label')}</label>
        <input id="guide-ask-input" type="text" value={q} maxLength={QUESTION_MAX} placeholder={t('guide.ask.placeholder')} autoComplete="off"
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && (q || state.kind !== 'idle')) { e.stopPropagation(); setQ(''); setState({ kind: 'idle' }); } }}
          data-testid="guide-ask-input" disabled={busy} />
        <button type="submit" className="btn btn-primary btn-s" disabled={busy || q.trim().length < 2} data-testid="guide-ask-send">
          {busy ? t('guide.ask.thinking') : t('guide.ask.send')}
        </button>
      </form>
      {state.kind === 'idle' && <p className="guide-ask-hint">{t('guide.ask.hint')}</p>}
      {state.kind === 'loading' && (
        <div className="guide-ask-answer is-loading" role="status" aria-live="polite" data-testid="guide-ask-loading">
          <span className="guide-ask-q">{state.question}</span>
          <span className="guide-ask-skel" /><span className="guide-ask-skel short" />
          <span className="sr-only">{t('guide.ask.thinking')}</span>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="guide-ask-answer is-error" role="alert" data-testid="guide-ask-error">
          <span className="guide-ask-q">{state.question}</span>
          <p>{state.message}</p>
          <button type="button" className="btn btn-ghost btn-s" onClick={ask}>{t('guide.ask.retry')}</button>
        </div>
      )}
      {state.kind === 'done' && (
        <div className="guide-ask-answer" aria-live="polite" data-testid="guide-ask-answer">
          <span className="guide-ask-q">{state.question}</span>
          <Answer answer={state.answer} l={l} onOpen={onOpen} />
          <footer className="guide-ask-foot">
            {state.answer.cards.length > 0 && <span>{t('guide.ask.cards', { count: state.answer.cards.length })}</span>}
            {state.answer.model && <span>{state.answer.model}</span>}
            <span data-testid="guide-ask-cost">{cost ?? t('guide.ask.costUnknown')}</span>
          </footer>
        </div>
      )}
    </section>
  );
}
