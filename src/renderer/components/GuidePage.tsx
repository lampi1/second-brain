// The «Guida» page: the app's core concepts, one card each (content: src/shared/concept-guide.ts). A card shows a plain
// summary; "Come funziona" opens its numbered points, a small diagram, an everyday analogy, the technical details with
// the source files, what is in an open pull request («in arrivo») and what is still a target; «Discutine» opens a chat about it with the card as a draft
// (lib/concept-discuss.ts: an explainer agent's own chat, else the Orchestrator). The prominent card («Ogni compito passa
// da un agente») sits on top, full width, with its diagram always visible. A filter narrows the cards by any text of
// theirs. Mounted by App.tsx PageFrame for the page 'guida' (left rail, Ctrl+K, G E).
import { useId, useMemo, useState } from 'react';
import { CONCEPTS, regiaText, textOf, type ConceptCard, type ConceptDiagram, type GuideLang } from '@shared/concept-guide';
import { lang, t } from '../i18n';
import { planDiscuss } from '../lib/concept-discuss';
import { agents, useAgents } from '../store/agents';
import { app, createChat } from '../store/store';
import { toast, ui } from '../store/ui';
import { brainBridge, focusChat, regiaId } from '../actions';
import { setDraft } from './ChatInput';
import { IconChevronDown, IconChevronRight } from './Icons';
import '../styles/guide.css';

/** «Discutine»: an explainer agent's new chat with the card in its input, else a draft in the Orchestrator. */
async function discuss(card: ConceptCard, l: GuideLang): Promise<void> {
  const cwd = app.get().info?.brainRoot || ui.get().prefs.newChat.cwd || null;
  const plan = planDiscuss(card, l, agents.get().catalog, cwd);
  if (plan.via === 'agent') {
    const r = regiaId();
    const chat = await createChat({ agentId: plan.agentId, harness: plan.harness, cwd: plan.cwd, title: plan.title, prompt: '', ...(r ? { regiaOf: r } : {}) });
    if (chat) {
      setDraft(chat.id, plan.draft);
      focusChat(chat.id);
      toast(t('guide.toAgent', { name: plan.agentName }), 'ok');
      return;
    } // not created (told by createChat): the Orchestrator still can take it
  }
  const draft = plan.via === 'regia' ? plan.draft : regiaText(card, l);
  if (brainBridge.draftToRegia(draft, () => {})) toast(t('guide.toRegia'), 'ok');
  else toast(t('guide.noRegia'), 'warn');
}

function Diagram({ d, title, l }: { d: ConceptDiagram; title: string; l: GuideLang }) {
  return (
    <figure className={`guide-diagram guide-diagram-${d.kind}`} data-testid="guide-diagram">
      <ol aria-label={t('guide.diagram', { title })}>
        {d.steps.map((s, i) => <li key={i}><span className="guide-step-n" aria-hidden="true">{i + 1}</span>{textOf(s, l)}</li>)}
      </ol>
      {d.kind === 'cycle' && <figcaption className="guide-diagram-back" aria-hidden="true"><span>↺</span> {textOf(d.steps[0]!, l)} · {t('guide.back')}</figcaption>}
    </figure>
  );
}

function Card({ card, l, open, onToggle }: { card: ConceptCard; l: GuideLang; open: boolean; onToggle: () => void }) {
  const body = useId();
  const L = (x: Parameters<typeof textOf>[0]) => textOf(x, l);
  const title = L(card.title);
  return (
    <article className={`guide-card${card.prominent ? ' guide-prominent' : ''}${open ? ' open' : ''}`} data-testid={`guide-card-${card.id}`} aria-label={title}>
      <header className="guide-card-head">
        <h3>{title}</h3>
        {card.coming?.map(x => <span key={x.pr} className="guide-badge guide-badge-coming" data-testid="guide-coming-badge">{t('guide.comingBadge', { pr: x.pr })}</span>)}
        {card.target?.length ? <span className="guide-badge" data-testid="guide-target-badge">{t('guide.targetBadge')}</span> : null}
      </header>
      <p className="guide-summary">{L(card.summary)}</p>
      {card.prominent && card.diagram && <Diagram d={card.diagram} title={title} l={l} />}
      <div className="guide-actions">
        <button type="button" className="btn btn-ghost btn-s guide-toggle" aria-expanded={open} aria-controls={body} onClick={onToggle} data-testid={`guide-toggle-${card.id}`}>
          {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />} {open ? t('guide.hide') : t('guide.howItWorks')}
        </button>
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s guide-discuss" onClick={() => void discuss(card, l)} data-testid={`guide-discuss-${card.id}`}
          data-tip={t('guide.discussTip')} aria-label={`${t('guide.discuss')}: ${title}`}>
          <span aria-hidden="true">↗</span> {t('guide.discuss')}
        </button>
      </div>
      {open && (
        <div className="guide-body" id={body} data-testid={`guide-body-${card.id}`}>
          <ol className="guide-points">{card.points.map((p, i) => <li key={i}>{L(p)}</li>)}</ol>
          <div className="guide-analogy"><strong>{t('guide.analogy')}</strong><p>{L(card.analogy)}</p></div>
          {!card.prominent && card.diagram && <Diagram d={card.diagram} title={title} l={l} />}
          <section className="guide-tech" aria-label={t('guide.technical')}>
            <h4>{t('guide.technical')}</h4>
            <dl>{card.tech.map((x, i) => <div key={i}><dt>{L(x.label)}</dt><dd>{L(x.text)}</dd></div>)}</dl>
            <h5>{t('guide.sources')}</h5>
            <ul className="guide-sources">{card.sources.map(s => <li key={s}><code>{s}</code></li>)}</ul>
          </section>
          {card.coming?.length ? (
            <section className="guide-coming" data-testid="guide-coming">
              <h4><span aria-hidden="true">◷</span> {t('guide.coming')}</h4>
              <ul>{card.coming.map(x => <li key={x.pr}><strong>PR #{x.pr}</strong> · {L(x.text)}</li>)}</ul>
            </section>
          ) : null}
          {card.target?.length ? (
            <section className="guide-target" data-testid="guide-target">
              <h4><span aria-hidden="true">⚑</span> {t('guide.target')}</h4>
              <ul>{card.target.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </article>
  );
}

/** The card's every text in one language, lower case, for the filter. */
const haystack = (c: ConceptCard, l: GuideLang): string =>
  [c.title, c.summary, c.analogy, ...c.points, ...(c.target ?? []), ...c.tech.flatMap(x => [x.label, x.text])].map(x => textOf(x, l)).join(' ').toLowerCase();

export function GuidePage() {
  useAgents(); // the catalog, for «Discutine» to find an explainer agent
  const l: GuideLang = lang();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? CONCEPTS.filter(c => { const h = haystack(c, l); return words.every(w => h.includes(w)); }) : CONCEPTS;
  }, [q, l]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="guide" role="region" aria-label={t('guide.title')} data-testid="guide-page">
      <header className="guide-header">
        <div>
          <span className="guide-eyebrow">{t('guide.eyebrow')}</span>
          <h1>{t('guide.title')}</h1>
          <p>{t('guide.lead')}</p>
        </div>
        <label className="guide-filter">
          <span className="sr-only">{t('guide.filter')}</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('guide.filterPlaceholder')} data-testid="guide-filter" />
          <small>{t('guide.count', { count: shown.length })}</small>
        </label>
      </header>
      {shown.length === 0
        ? <p className="guide-none" role="status">{t('guide.none')}</p>
        : <div className="guide-grid">{shown.map(c => <Card key={c.id} card={c} l={l} open={open.has(c.id)} onToggle={() => toggle(c.id)} />)}</div>}
    </div>
  );
}
