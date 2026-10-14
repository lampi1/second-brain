// The pieces that make a number or an error useful (ADR 0037): Reading, the one-line plain-Italian reading of a number
// against its previous period (arrow + words, the tone only as a hint: the words say it); Help, a "?" that opens a
// detailed explanation (the app's HelpTip, wide); ErrorPatterns, the recurring AI errors of ai-errors.md grouped by pattern, each with
// count, last seen, areas, the chats it came from ("Apri" when the chat is in the app), the rule born from it and its
// outcome, the last 7 days against the 7 before, and the discussion bar. Lines whose type cannot be read are one group,
// "Formato non riconosciuto", with the raw lines visible (never a bare dash); patterns seen once and patterns quiet for
// 30 days are one line each: nothing to act on there. Used by pages/Qualita.tsx and pages/Costi.tsx.
import { useContext, type ReactNode } from 'react';
import type { ChatSummary } from '@shared/contract';
import { chatName } from '@shared/regia';
import { fmt } from '../lib/format';
import { short } from '../lib/text';
import { trend, typeLabel, type ErrorGroup, type ErrorPatterns as Patterns, type Trend } from '../lib/stats';
import type { Quote } from '../lib/discuss';
import { DiscussBar, DiscussContext } from './Discuss';
import { useAppChats } from './Composer';
import { Pill, type Navigate, type Tone } from './ui';
import { HelpTip } from '../../components/HelpTip';

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
/** The app chat a row's "chat/agente" names, by title (the Regia by name or as "Regia"); null when not in the app. */
export function chatFor(name: string, chats: ChatSummary[] | null): ChatSummary | null {
  const n = norm(name);
  if (!n || !chats) return null;
  return chats.find(c => norm(c.title) === n || norm(chatName(c)) === n) ?? (n === 'regia' ? chats.find(c => c.isRegia) ?? null : null);
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  tornato: { label: 'la regola non è bastata', tone: 'bad' }, 'non-tornato': { label: 'la regola tiene', tone: 'good' },
  'troppo-presto': { label: 'regola recente', tone: '' }, 'senza-tipo': { label: 'regola senza tipo', tone: 'warn' },
};
const when = (g: ErrorGroup) => `${fmt.day(g.last)}${g.lastTime ? ` ${g.lastTime}` : ''}`;
const list = (xs: [string, number][]) => xs.slice(0, 4).map(([a, n]) => `${a} (${n})`).join(', ');
const quiet = (g: ErrorGroup) => g.week === 0 && g.prevWeek === 0;
const weekTrend = (g: ErrorGroup): Trend => (quiet(g)
  ? { dir: null, good: null, text: 'nessuno nelle ultime 2 settimane' }
  : trend(g.week, g.prevWeek, { what: g.week === 1 ? 'volta' : 'volte', now: 'negli ultimi 7 giorni', before: 'nei 7 prima' }));

/** The quote a pattern's discussion starts from: every number the card shows. */
export function patternQuote(g: ErrorGroup): Quote {
  const r = g.rules[0];
  return {
    id: `err|${g.type}`, what: 'errore', title: typeLabel(g.type), source: 'ai-errors.md', inBrain: true,
    facts: [
      `${g.count} volte dal ${fmt.day(g.first)} al ${fmt.day(g.last)}; ${quiet(g) ? 'nessuno nelle ultime 2 settimane' : `ultimi 7 giorni ${g.week}, i 7 prima ${g.prevWeek}`}`,
      g.byOwner ? `trovati da me: ${g.byOwner} su ${g.count}${g.byOwner < g.count ? '; gli altri da reviewer, QA, hook o dall\'agente stesso' : ''}` : '',
      g.areas.length ? `aree: ${list(g.areas)}` : '',
      g.chats.length ? `chat: ${list(g.chats)}` : '',
      g.latest.detto || g.latest.vero ? `l'ultimo (${when(g)}): detto «${g.latest.detto}», vero «${g.latest.vero}»` : `l'ultimo (${when(g)}): ${g.latest.riga ?? ''}`,
      r ? `regola nata: ${r.rule}${r.status ? ` (${STATUS[r.status]?.label})` : ''}` : 'nessuna regola nata da questi errori',
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
        <h3><span className="bx-sr">{g.count} volte: </span>{typeLabel(g.type)}</h3>
        {!g.official && <Pill tone="warn" title="Non è uno degli 11 tipi dell'intestazione di ai-errors.md">tipo non ufficiale</Pill>}
        <span className="sp" />
        <span className="small muted">ultimo {when(g)}</span>
      </div>
      <Reading t={weekTrend(g)} />
      {g.latest.detto || g.latest.vero
        ? <p className="bx-pattern-last"><span className="muted">Ultimo:</span> detto «{short(g.latest.detto, 120)}» <span className="muted">→ vero:</span> {short(g.latest.vero, 140)}</p>
        : <p className="bx-pattern-last"><span className="muted">Ultimo:</span> <span className="bx-raw">{short(g.latest.riga ?? '', 220)}</span></p>}
      <dl className="bx-pattern-facts">
        {g.areas.length > 0 && <><dt>Aree</dt><dd>{g.areas.slice(0, 3).map(([a, n]) => `${short(a, 40)}${n > 1 ? ` (${n})` : ''}`).join(' · ')}{g.areas.length > 3 ? ` · altre ${g.areas.length - 3}` : ''}</dd></>}
        {g.chats.length > 0 && <><dt>Chat</dt>
          <dd className="bx-pattern-chats">
            {g.chats.slice(0, 3).map(([name, n]) => {
              const c = chatFor(name, chats);
              return (
                <span key={name}>
                  {short(name, 36)}{n > 1 ? ` (${n})` : ''}
                  {c && bridge && <button type="button" className="bx-go" onClick={() => bridge.showChat(c.id)} data-testid="bx-q-pattern-open" aria-label={`Apri la chat «${chatName(c)}»`}>Apri</button>}
                </span>
              );
            })}
            {g.chats.length > 3 && <span className="muted">altre {g.chats.length - 3}</span>}
          </dd></>}
        <dt>Regola</dt>
        <dd>{r ? <>{r.status && <Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Pill>} <span title={r.rule}>{short(r.rule, 110)}</span></>
          : <span className="muted">nessuna: se torna ancora, chiedi una regola o un controllo</span>}</dd>
        {g.byOwner > 0 && <><dt>Trovati da te</dt><dd>{g.byOwner} su {g.count}</dd></>}
      </dl>
      <DiscussBar topic={{ kind: 'quote', quote: patternQuote(g) }} testId="bx-q-pattern-discuss" />
    </li>
  );
}

/** The detailed explanation of the section ("?" next to its title). */
export function PatternsHelp() {
  return (
    <Help label="errori che si ripetono" testId="bx-q-errori-help">
      <p><b>Da dove vengono.</b> Ogni riga di ai-errors.md è un errore di un agente o di una chat: la scrive subito la chat
        che lo riceve (con <code>mem.mjs error</code>) quando correggi un agente, quando un reviewer o la QA smentisce
        una sua affermazione o quando l'agente scopre da solo di aver sbagliato. Il file non si sfoltisce mai.</p>
      <p><b>Tipo.</b> Lo schema dell'errore, uno degli 11 dell'intestazione di ai-errors.md (es. «fatto non verificato» =
        detto senza controllare). Qui gli errori sono raggruppati per tipo; un'etichetta fuori lista resta un gruppo a sé,
        segnato «tipo non ufficiale».</p>
      <p><b>Area e chat.</b> L'area è il prodotto o la parte toccata; la chat è chi ha sbagliato. «Apri» porta alla chat se
        è ancora nell'app.</p>
      <p><b>Trovati da te.</b> Quante volte te ne sei accorto tu (campo «visto da»), invece di un reviewer, della QA, di un
        hook o dell'agente stesso: sono quelli che ti costano tempo.</p>
      <p><b>Confronto.</b> Gli ultimi 7 giorni (oggi compreso) contro i 7 prima: «in calo» è buono.</p>
      <p><b>Regola.</b> La regola nata dall'errore (campo «regola:» o il conteggio del cervello): «la regola non è bastata»
        = lo stesso tipo è tornato entro 14 giorni.</p>
      <p><b>Cosa farne.</b> Un tipo che si ripete chiede una cosa sola: una regola più chiara o un controllo automatico.
        «Discutine» manda alla Regia una bozza con questi numeri; «Apri una chat» ne apre una dedicata.</p>
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
      ) : <p className="muted">Nessun errore che si ripete negli ultimi 30 giorni.</p>}
      {p.unknown.length > 0 && (
        <details className="bx-card tight bx-q-more" data-testid="bx-q-unknown">
          <summary><b>Formato non riconosciuto</b> · {p.unknown.length} {p.unknown.length === 1 ? 'riga' : 'righe'} senza un tipo leggibile: correggile in ai-errors.md</summary>
          <ul className="bx-list compact">
            {p.unknown.map((r, i) => <li key={i}><span className="meta">{fmt.day(r.data)}</span><span className="t bx-raw">{r.riga || `${r.chi} · ${r.area} · ${r.detto}`}</span></li>)}
          </ul>
        </details>
      )}
      <p className="small muted" data-testid="bx-q-patterns-rest">
        {p.once ? <>{p.once} {p.once === 1 ? 'tipo comparso una volta sola' : 'tipi comparsi una volta sola'}: ancora nessuno schema da correggere. </> : null}
        {p.quiet.length ? <>{p.quiet.length} {p.quiet.length === 1 ? 'schema fermo' : 'schemi fermi'} da più di 30 giorni ({p.quiet.map(g => typeLabel(g.type)).join(', ')}). </> : null}
        <button type="button" className="bx-go" onClick={() => nav('esplora/ai-errors.md')}>Apri ai-errors.md</button>
      </p>
    </div>
  );
}
