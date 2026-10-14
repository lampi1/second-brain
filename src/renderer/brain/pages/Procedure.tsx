// Procedure: the procedures already written in the brain (runbooks, routines, rules with real steps), found by main by
// the files' structure (brain/procedures.ts), never from a fixed list (the user, 2026-10-13: "una sezione visibile delle
// procedure ... tutte quelle che hai già nel cervello"; it took the place of Comunicazione). Left: search and filters
// over the list, grouped by area (title, one-line purpose, tags, last change). Right: the procedure open, rendered
// (headings, numbered steps, tables) with "Copia" on every code block and a click-to-copy on inline commands, "Apri il
// file", and the Discutine / "Apri una chat" bar for a chat that follows it. Read-only and zero tokens: nothing here
// runs a command (no Esegui, by design: procedures hold production commands and queries); lines that may hold a
// credential arrive already masked from main. Live: main says when a procedure file changed ('procedures:changed',
// api.ts reloads what is on screen).
// Data: /api/procedures, /api/procedure?id=… (answered by main).
import { useMemo, useState } from 'react';
import type { ProcedureSummary } from '@shared/contract';
import { normProcedure, normProcedures } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { Async, Empty, PageHead } from '../components/States';
import { Markdown } from '../components/Markdown';
import { DiscussBar } from '../components/Discuss';
import { copyText, IconCopy, IconExternal, IconSearch, Pill, toast, type Navigate } from '../components/ui';

const TAGS: { id: string; label: string; help: string }[] = [
  { id: 'passi', label: 'Passi', help: 'ha passi numerati' },
  { id: 'comandi', label: 'Comandi', help: 'ha comandi o script da lanciare' },
  { id: 'query', label: 'Query', help: 'ha query SQL' },
  { id: 'produzione', label: 'Produzione', help: 'parla di produzione' },
];

/** Lower case, no accents: "Qualità" matches "qualita". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dayOf = (iso: string | null) => (iso ? fmt.day(iso.slice(0, 10)) : '');

/** The procedures that match the words (all of them, anywhere in title, purpose, area, file, tags) and every chosen tag. */
export function filterProcedures(list: ProcedureSummary[], q: string, tags: ReadonlySet<string>): ProcedureSummary[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list.filter(p => {
    if ([...tags].some(t => !p.tags.includes(t))) return false;
    const hay = fold([p.title, p.purpose, p.area, p.group ?? '', p.file, p.source, ...p.tags].join(' '));
    return words.every(w => hay.includes(w));
  });
}

function Row({ p, open, nav }: { p: ProcedureSummary; open: boolean; nav: Navigate }) {
  return (
    <button type="button" className="bx-proc-row" aria-current={open} onClick={() => nav(`procedure/${encodeURIComponent(p.id)}`)} data-testid="bx-proc-row" data-id={p.id}>
      <b className="t">{p.title}</b>
      {p.purpose && <span className="p">{p.purpose}</span>}
      <span className="m">
        {p.tags.map(t => <Pill key={t} tone={t === 'produzione' ? 'warn' : 'outline'}>{t}</Pill>)}
        <span className="d" title={`${p.file}, riga ${p.line}`}>{p.source}{p.changedAt ? ` · modificato ${dayOf(p.changedAt)}` : ''}</span>
      </span>
    </button>
  );
}

function Detail({ id }: { id: string }) {
  const r = useBrain(`/api/procedure?id=${encodeURIComponent(id)}`, normProcedure);
  const d = r.data;
  const openFile = async () => {
    if (!d) return;
    const res = await window.sb.invoke('app:openPath', { path: d.path }).catch(() => null);
    if (!res) toast('Non riesco ad aprire il file');
    else if (res.how === 'folder') toast('Il file è selezionato in Esplora risorse');
    else if (res.how === 'missing' || res.how === 'refused') toast(res.reason);
  };
  return (
    <article className="bx-viewer bx-proc-view" data-testid="bx-proc-view" aria-label={d?.title ?? 'Procedura'}>
      <Async loading={r.loading && !d} error={d ? null : r.error} onRetry={() => r.reload()} lines={8}>
        {() => d && (
          <>
            <header className="bx-proc-head">
              <h2 data-testid="bx-proc-title">{d.title}</h2>
              <p className="small muted">{d.area}{d.group ? ` · ${d.group}` : ''} · <span className="mono">{d.file}</span>, riga {d.line}{d.changedAt ? ` · modificato ${dayOf(d.changedAt)}` : ''}</p>
              <div className="bx-row">
                <button type="button" className="bx-btn s" onClick={() => void openFile()} data-testid="bx-proc-open-file"><IconExternal /> Apri il file</button>
                <button type="button" className="bx-btn s" onClick={() => void copyText(d.path).then(ok => toast(ok ? 'Percorso copiato' : 'Copia non riuscita'))}><IconCopy /> Copia il percorso</button>
              </div>
            </header>
            <p className="bx-proc-safe small" data-testid="bx-proc-safe">
              Solo lettura: qui i comandi e le query si copiano, non parte niente.
              {d.masked > 0 && <> <b data-testid="bx-proc-masked">{d.masked === 1 ? '1 riga nascosta' : `${d.masked} righe nascoste`}</b> perché {d.masked === 1 ? 'può' : 'possono'} contenere una credenziale.</>}
            </p>
            <div className="bx-card"><Markdown text={d.markdown} copy name={d.title} testId="bx-proc-md" /></div>
            <DiscussBar key={d.id} topic={{ kind: 'procedure', procedure: d }} testId="bx-proc-discuss" />
          </>
        )}
      </Async>
    </article>
  );
}

export function Procedure({ arg, nav }: { arg?: string; nav: Navigate }) {
  const list = useBrain('/api/procedures', normProcedures);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const all = list.data?.procedures ?? [];
  const shown = useMemo(() => filterProcedures(all, q, tags), [all, q, tags]);
  const groups = useMemo(() => {
    const m = new Map<string, ProcedureSummary[]>();
    for (const p of shown) m.set(p.area, [...(m.get(p.area) ?? []), p]);
    return [...m];
  }, [shown]);
  const files = new Set(all.map(p => p.file)).size;
  const cur = arg ? decodeArg(arg) : null;
  const known = !cur || all.some(p => p.id === cur);
  const toggle = (t: string) => setTags(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <>
      <PageHead title="Procedure" at={list.at} live onRefresh={() => list.reload()}
        lead={list.data ? <><b>{all.length} {all.length === 1 ? 'procedura' : 'procedure'}</b> in {files} file del cervello: runbook, routine e regole con passi.</> : undefined}
        what="Le procedure già scritte nel cervello, trovate dalla struttura dei file. Solo lettura: copi un comando o una query e lo esegui tu; le righe con credenziali non compaiono." />
      <div className="bx-row bx-proc-bar" role="search" data-testid="bx-proc-search">
        <label className="bx-search" style={{ flex: 1, minWidth: 240 }}>
          <IconSearch />
          <input className="bx-input" type="search" placeholder="Cerca: deploy, lookup, licenza, query…" aria-label="Cerca nelle procedure" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="bx-row" role="group" aria-label="Filtra per contenuto">
          {TAGS.map(t => <button key={t.id} type="button" className="bx-chip" aria-pressed={tags.has(t.id)} title={t.help} onClick={() => toggle(t.id)} data-testid={`bx-proc-tag-${t.id}`}>{t.label}</button>)}
        </div>
      </div>
      <Async loading={list.loading && !list.data} error={list.data ? null : list.error} onRetry={() => list.reload()} lines={8} block>
        {() => !all.length
          ? <Empty title="Nessuna procedura trovata">Scrivile in una cartella runbook, procedure o rules, oppure in un file routines.md: ogni sezione ## o ### diventa una procedura.</Empty>
          : (
            <div className="bx-proc">
              <nav className="bx-card bx-proc-list bx-scroll" aria-label="Elenco delle procedure" data-testid="bx-proc-list">
                {!shown.length && <p className="small muted bx-proc-none" data-testid="bx-proc-none">Nessuna procedura con questi filtri.</p>}
                {groups.map(([area, ps]) => (
                  <section key={area} className="bx-proc-grp" aria-label={area}>
                    <h3>{area}<span className="n">{ps.length}</span></h3>
                    {ps.map(p => <Row key={p.id} p={p} open={p.id === cur} nav={nav} />)}
                  </section>
                ))}
              </nav>
              {cur && known ? <Detail key={cur} id={cur} />
                : cur ? <Empty title="Procedura non trovata">Forse il file è cambiato: scegline una dall'elenco.</Empty>
                  : <Empty title="Scegli una procedura dall'elenco">Si apre qui, con «Copia» su ogni comando e la possibilità di aprire una chat che la segue.</Empty>}
            </div>
          )}
      </Async>
    </>
  );
}

function decodeArg(arg: string): string {
  try { return decodeURIComponent(arg); } catch { return arg; }
}
