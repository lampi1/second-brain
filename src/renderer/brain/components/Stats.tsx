// The pieces that make a number or an error useful (ADR 0037): Reading, the one-line plain-Italian reading of a number
// against its previous period (arrow + words, the tone only as a hint: the words say it); Help, a "?" that opens a
// detailed explanation (the app's HelpTip, wide); ErrorPatterns, the recurring AI errors of ai-errors.md grouped by pattern, each with
// count, last seen, areas, the chats it came from ("Apri" when the chat is in the app), the rule born from it and its
// outcome, the last 7 days against the 7 before, and the discussion bar. Lines whose type cannot be read are one group,
// "Formato non riconosciuto", with the raw lines visible (never a bare dash); patterns seen once and patterns quiet for
// 30 days are one line each: nothing to act on there. Used by pages/Qualita.tsx and pages/Costi.tsx.
import { useContext, type ReactNode } from 'react';
import type { ChatSummary } from '@shared/contract';
import{ModelOrigin}from'../../components/ModelOrigin';
import { chatName } from '@shared/orchestrator';
import { fmt } from '../lib/format';
import { short } from '../lib/text';
import { trend, typeLabel, type ErrorGroup, type ErrorPatterns as Patterns, type Trend } from '../lib/stats';
import type { Quote } from '../lib/discuss';
import { DiscussBar, DiscussContext } from './Discuss';
import { useAppChats } from '../lib/app-chats';
import { Pill, type Navigate, type Tone } from './ui';
import { HelpTip } from '../../components/HelpTip';
import { t as tr, type TextKey } from '../../i18n';

const ARROW = { su: '↑', giu: '↓', uguale: '→' } as const;
/** "↓ in calo: 3 errori questa settimana contro 7" */
export function Reading({ t, testId }: { t: Trend; testId?: string }) {
  const tone = t.good === true ? 'good' : t.good === false ? 'bad' : '';
  return (
    <p className={`bx-reading ${tone}`} data-testid={testId}>
      {t.dir && <span className="ar" aria-hidden="true">{ARROW[t.dir]}</span>}
      <span>{t.text}.</span>
    </p>
  );
}

/** A "?" with a long explanation: the app's HelpTip (ADR 0040) in its wide bubble. */
export function Help({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <HelpTip label={label} testid={testId} wide>{children}</HelpTip>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** The app chat a row's "chat/agente" names, by title (the Orchestrator by name or as "Orchestrator"); null when not in the app. */
export function chatFor(name: string, chats: ChatSummary[] | null): ChatSummary | null {
  const n = norm(name);
  if (!n || !chats) return null;
  return chats.find(c => norm(c.title) === n || norm(chatName(c)) === n) ?? (n === 'orchestrator' ? chats.find(c => c.isOrchestrator) ?? null : null);
}

const STATUS: Record<string, { label: TextKey; tone: Tone }> = {
  tornato: { label: 'brainText.stats.status.tornato', tone: 'bad' }, 'non-tornato': { label: 'brainText.stats.status.nonTornato', tone: 'good' },
  'troppo-presto': { label: 'brainText.stats.status.presto', tone: '' }, 'senza-tipo': { label: 'brainText.stats.status.senzaTipo', tone: 'warn' },
};
const statusLabel = (s: string) => { const k = STATUS[s]?.label; return k ? tr(k) : undefined; };
const when = (g: ErrorGroup) => `${fmt.day(g.last)}${g.lastTime ? ` ${g.lastTime}` : ''}`;
const list = (xs: [string, number][]) => xs.slice(0, 4).map(([a, n]) => `${a} (${n})`).join(', ');
const quiet = (g: ErrorGroup) => g.week === 0 && g.prevWeek === 0;
const weekTrend = (g: ErrorGroup): Trend => (quiet(g)
  ? { dir: null, good: null, text: tr('brainText.stats.quiet') }
  : trend(g.week, g.prevWeek, { what: tr('brainText.stats.times', { n: g.week }), now: tr('brainText.common.last7'), before: tr('brainText.common.prev7') }));

/** The quote a pattern's discussion starts from: every number the card shows. */
export function patternQuote(g: ErrorGroup): Quote {
  const r = g.rules[0];
  return {
    id: `err|${g.type}`, what: 'errore', title: typeLabel(g.type), source: 'ai-errors.md',
    facts: [
      `${tr('brainText.stats.fact.count', { n: g.count, first: fmt.day(g.first), last: fmt.day(g.last) })}; ${quiet(g) ? tr('brainText.stats.quiet') : tr('brainText.stats.fact.weeks', { week: g.week, prev: g.prevWeek })}`,
      g.byOwner ? `${tr('brainText.stats.fact.byOwner', { n: g.byOwner, of: g.count })}${g.byOwner < g.count ? tr('brainText.stats.fact.byOthers') : ''}` : '',
      g.areas.length ? tr('brainText.stats.fact.areas', { list: list(g.areas) }) : '',
      g.chats.length ? tr('brainText.stats.fact.chats', { list: list(g.chats) }) : '',
      g.latest.detto || g.latest.vero ? tr('brainText.stats.fact.latestClaim', { when: when(g), said: g.latest.detto, real: g.latest.vero }) : tr('brainText.stats.fact.latestRaw', { when: when(g), line: g.latest.riga ?? '' }),
      r ? tr('brainText.stats.fact.rule', { rule: r.rule, status: r.status ? String(statusLabel(r.status)) : '' }) : tr('brainText.stats.fact.noRule'),
    ],
  };
}

function Pattern({ g, chats }: { g: ErrorGroup; chats: ChatSummary[] | null }) {
  const bridge = useContext(DiscussContext);
  const r = g.rules[0];
  return (
    <li className="bx-card bx-pattern" data-testid="bx-q-pattern" data-type={g.type}>
      <div className="bx-pattern-head">
        <span className="bx-pattern-n" aria-hidden="true">{g.count}×</span>
        <h3><span className="bx-sr">{tr('brainText.stats.nTimes', { n: g.count })}</span>{typeLabel(g.type)}</h3>
        {!g.official && <Pill tone="warn" title={tr('brainText.stats.notOfficialTip')}>{tr('brainText.stats.notOfficial')}</Pill>}
        <span className="sp" />
        <span className="small muted">{tr('brainText.stats.last', { when: when(g) })}</span>
      </div>
      <Reading t={weekTrend(g)} />
      {g.latest.detto || g.latest.vero
        ? <p className="bx-pattern-last"><span className="muted">{tr('brainText.stats.lastLabel')}</span> {tr('brainText.stats.said')} «{short(g.latest.detto, 120)}» <span className="muted">{tr('brainText.stats.real')}</span> {short(g.latest.vero, 140)}</p>
        : <p className="bx-pattern-last"><span className="muted">{tr('brainText.stats.lastLabel')}</span> <span className="bx-raw">{short(g.latest.riga ?? '', 220)}</span></p>}
      <dl className="bx-pattern-facts">
        <dt><ModelOrigin origin={g.latest.responsibleEpisode}/></dt><dd/>
        {g.areas.length > 0 && <><dt>{tr('brainText.stats.areas')}</dt><dd>{g.areas.slice(0, 3).map(([a, n]) => `${short(a, 40)}${n > 1 ? ` (${n})` : ''}`).join(' · ')}{g.areas.length > 3 ? ` · ${tr('brainText.stats.more', { n: g.areas.length - 3 })}` : ''}</dd></>}
        {g.chats.length > 0 && <><dt>{tr('brainText.stats.chat')}</dt>
          <dd className="bx-pattern-chats">
            {g.chats.slice(0, 3).map(([name, n]) => {
              const c = chatFor(name, chats);
              return (
                <span key={name}>
                  {short(name, 36)}{n > 1 ? ` (${n})` : ''}
                  {c && bridge && <button type="button" className="bx-go" onClick={() => bridge.showChat(c.id)} data-testid="bx-q-pattern-open" aria-label={tr('brainText.stats.openChat', { name: chatName(c) })}>{tr('brainText.common.open')}</button>}
                </span>
              );
            })}
            {g.chats.length > 3 && <span className="muted">{tr('brainText.stats.more', { n: g.chats.length - 3 })}</span>}
          </dd></>}
        <dt>{tr('brainText.stats.rule')}</dt>
        <dd>{r ? <>{r.status && <Pill tone={STATUS[r.status]?.tone}>{statusLabel(r.status)}</Pill>} <span title={r.rule}>{short(r.rule, 110)}</span></>
          : <span className="muted">{tr('brainText.stats.noRuleYet')}</span>}</dd>
        {g.byOwner > 0 && <><dt>{tr('brainText.stats.byYou')}</dt><dd>{tr('brainText.common.ofCount', { n: g.byOwner, of: g.count })}</dd></>}
      </dl>
      <DiscussBar topic={{ kind: 'quote', quote: patternQuote(g) }} testId="bx-q-pattern-discuss" />
    </li>
  );
}

/** The detailed explanation of the section ("?" next to its title). */
export function PatternsHelp() {
  return (
    <Help label={tr('brainText.stats.help.label')} testId="bx-q-errori-help">
      <p><b>{tr('brainText.stats.help.originB')}</b>{tr('brainText.stats.help.origin')}<code>mem.mjs error</code>{tr('brainText.stats.help.originRest')}</p>
      <p><b>{tr('brainText.stats.help.typeB')}</b>{tr('brainText.stats.help.type')}</p>
      <p><b>{tr('brainText.stats.help.areaB')}</b>{tr('brainText.stats.help.area')}</p>
      <p><b>{tr('brainText.stats.help.byYouB')}</b>{tr('brainText.stats.help.byYou')}</p>
      <p><b>{tr('brainText.stats.help.compareB')}</b>{tr('brainText.stats.help.compare')}</p>
      <p><b>{tr('brainText.stats.help.ruleB')}</b>{tr('brainText.stats.help.rule')}</p>
      <p><b>{tr('brainText.stats.help.doB')}</b>{tr('brainText.stats.help.do')}</p>
    </Help>
  );
}

/** The recurring patterns, busiest of the week first; the rest in one line each. */
export function ErrorPatterns({ p, nav }: { p: Patterns; nav: Navigate }) {
  const chats = useAppChats();
  return (
    <div className="bx-patterns" data-testid="bx-q-patterns">
      {p.recurring.length ? (
        <ul className="bx-pattern-list">{p.recurring.map(g => <Pattern key={g.type} g={g} chats={chats} />)}</ul>
      ) : <p className="muted">{tr('brainText.stats.none')}</p>}
      {p.unknown.length > 0 && (
        <details className="bx-card tight bx-q-more" data-testid="bx-q-unknown">
          <summary><b>{tr('brainText.stats.unknown')}</b>{tr('brainText.stats.unknownRest', { n: p.unknown.length })}</summary>
          <ul className="bx-list compact">
            {p.unknown.map((r, i) => <li key={i}><span className="meta">{fmt.day(r.data)}</span><span className="t bx-raw">{r.riga || `${r.chi} · ${r.area} · ${r.detto}`}</span></li>)}
          </ul>
        </details>
      )}
      <p className="small muted" data-testid="bx-q-patterns-rest">
        {p.once ? <>{tr('brainText.stats.once', { n: p.once })}</> : null}
        {p.quiet.length ? <>{tr('brainText.stats.quiet30', { n: p.quiet.length, list: p.quiet.map(g => typeLabel(g.type)).join(', ') })}</> : null}
        <button type="button" className="bx-go" onClick={() => nav('esplora/ai-errors.md')}>{tr('brainText.stats.openErrors')}</button>
      </p>
    </div>
  );
}
