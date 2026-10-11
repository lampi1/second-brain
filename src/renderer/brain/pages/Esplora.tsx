// Esplora: every file the brain shows (tracked files only: secrets never appear), read-only. Left the tree by folder
// with a name filter; on top a word search across all files (results with file and line); right the file: markdown
// rendered (links to other brain files open here), JSON lines as a table, the rest as code with line numbers; download
// and "Copia il percorso". Data: /api/files, /api/file?p=…, /api/search?q=…, /api/version (the brain root).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { normFile, normFiles, normHits, normVersion, type SearchHit } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { baseName } from '../lib/text';
import { Async, Empty, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { copyText, IconCopy, IconDownload, IconSearch, toast, type Navigate } from '../components/ui';
import { saveBrainFile } from './Confronto';

const ROOT_GROUP = '(cartella principale)';
const groupOf = (f: string) => (f.includes('/') ? f.split('/')[0]! : ROOT_GROUP);

function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function Code({ text, line }: { text: string; line?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  const lines = text.split(/\r?\n/);
  const w = String(lines.length).length;
  useEffect(() => { if (line) ref.current?.querySelector(`[data-l="${line}"]`)?.scrollIntoView({ block: 'center' }); }, [line, text]);
  // a very long file stays one text block (one element per line would slow the page down)
  if (lines.length > 4000) return <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">{text}</pre>;
  return (
    <pre ref={ref} className="bx-code bx-scroll" style={{ maxHeight: '70vh' }} data-testid="bx-code">
      {lines.map((l, i) => <div key={i} data-l={i + 1} style={i + 1 === line ? { background: 'var(--bx-amber-bg)' } : undefined}><span style={{ color: 'var(--bx-text-4)', userSelect: 'none', display: 'inline-block', width: `${w + 2}ch` }}>{i + 1}</span>{l || ' '}</div>)}
    </pre>
  );
}

function Jsonl({ text, name }: { text: string; name: string }) {
  const rows = useMemo(() => text.split(/\r?\n/).filter(Boolean).map(l => {
    try { const o = JSON.parse(l) as Record<string, unknown>; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : v])); } catch { return { riga: l }; }
  }), [text]);
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cols: Col<Record<string, unknown>>[] = keys.map((k, i) => ({ key: k, label: k, clip: true, hidden: i >= 8 }));
  return <DataTable name={name} label={name} rows={rows} cols={cols} />;
}

function Viewer({ path, files, root, line, nav }: { path: string; files: Set<string>; root: string; line?: number; nav: Navigate }) {
  const f = useBrain(`/api/file?p=${encodeURIComponent(path)}`, normFile);
  const full = root ? `${root.replace(/[\\/]+$/, '')}/${path}` : path;
  return (
    <div className="bx-viewer" data-testid="bx-viewer">
      <div className="bx-viewer-head">
        <h2>{path}</h2>
        <span className="sp" style={{ flex: 1 }} />
        <button type="button" className="bx-btn s" onClick={() => void saveBrainFile(path)}><IconDownload /> Scarica</button>
        <button type="button" className="bx-btn s" onClick={() => void copyText(full).then(ok => toast(ok ? 'Percorso copiato' : 'Copia non riuscita'))}><IconCopy /> Copia il percorso</button>
      </div>
      <Async loading={f.loading && !f.data} error={f.data ? null : f.error} onRetry={() => f.reload()} lines={10}>
        {() => f.data && (
          <>
            <p className="small muted">{fmt.int(f.data.size)} byte · ultima modifica {fmt.when(f.data.modified)} ({fmt.ago(f.data.modified)})</p>
            {/\.md$/i.test(path) ? <div className="bx-card"><Markdown text={f.data.text} files={files} root={root} onOpenFile={p => nav(`esplora/${p}`)} name={baseName(path)} testId="bx-file-md" /></div>
              : /\.jsonl$/i.test(path) ? <Jsonl text={f.data.text} name={baseName(path)} />
                : /\.json$/i.test(path) ? <Code text={(() => { try { return JSON.stringify(JSON.parse(f.data.text), null, 2); } catch { return f.data.text; } })()} line={line} />
                  : <Code text={f.data.text} line={line} />}
          </>
        )}
      </Async>
    </div>
  );
}

export function Esplora({ arg, nav }: { arg?: string; nav: Navigate }) {
  const files = useBrain('/api/files', normFiles);
  const ver = useBrain('/api/version', normVersion, { maxAgeMs: 10 * 60e3 });
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [line, setLine] = useState<number | undefined>(undefined);
  const hits = useBrain(query.length >= 2 ? `/api/search?q=${encodeURIComponent(query)}` : null, normHits, { maxAgeMs: 60e3 });
  const all = files.data ?? [];
  const set = useMemo(() => new Set(all), [all]);
  const cur = arg && set.has(arg) ? arg : null;
  const [openGroups, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { if (cur) setOpen(s => new Set([...s, groupOf(cur)])); }, [cur]);
  useEffect(() => { if (cur) document.querySelector('[aria-current="true"][data-file]')?.scrollIntoView({ block: 'nearest' }); }, [cur, files.data]);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of all) m.set(groupOf(f), [...(m.get(groupOf(f)) ?? []), f]);
    return [...m].sort(([a], [b]) => (a === ROOT_GROUP ? -1 : b === ROOT_GROUP ? 1 : a.localeCompare(b)));
  }, [all]);
  const fq = filter.trim().toLowerCase();
  const search = (e: FormEvent) => { e.preventDefault(); setQuery(q.trim()); };
  const open = (h: SearchHit) => { setLine(h.line || undefined); nav(`esplora/${h.file}`); };
  const main = all.filter(f => !f.includes('/') && /\.md$/.test(f)).slice(0, 8);

  return (
    <>
      <PageHead title="Esplora" at={files.at} onRefresh={() => files.reload()}
        lead={files.data ? <><b>{all.length} file</b> del cervello: regole, memoria, diario, runbook, report, tool. Solo lettura.</> : undefined}
        what="Solo i file tracciati del cervello: i segreti non compaiono mai. Cerca una parola in tutti i file o sfoglia le cartelle." />
      <form className="bx-row" onSubmit={search} role="search" data-testid="bx-search">
        <label className="bx-search" style={{ flex: 1, minWidth: 240 }}><IconSearch /><input className="bx-input" type="search" placeholder="Cerca una parola in tutti i file…" aria-label="Cerca nei file" value={q} onChange={e => setQ(e.target.value)} /></label>
        <button type="submit" className="bx-btn primary" disabled={q.trim().length < 2}>Cerca</button>
        {query && <button type="button" className="bx-btn ghost" onClick={() => { setQuery(''); setQ(''); }}>Chiudi i risultati</button>}
      </form>
      {query && (
        <section className="bx-card tight" aria-label="Risultati della ricerca" data-testid="bx-hits">
          <Async loading={hits.loading && !hits.data} error={hits.data ? null : hits.error} onRetry={() => hits.reload()} lines={3} label="Cerco…">
            {() => hits.data && (
              <>
                <p className="small muted" style={{ padding: '2px 10px 6px' }}>{hits.data.length}{hits.data.length >= 300 ? '+' : ''} risultati per «{query}»</p>
                <div className="bx-hits">{hits.data.map((h, i) => <button key={i} type="button" onClick={() => open(h)}><span className="f">{h.file}{h.line ? `:${h.line}` : ''}</span><span className="l"><Mark text={h.text} q={query} /></span></button>)}</div>
              </>
            )}
          </Async>
        </section>
      )}
      <Async loading={files.loading && !files.data} error={files.data ? null : files.error} onRetry={() => files.reload()} lines={8} block>
        {() => (
          <div className="bx-explore">
            <nav className="bx-card bx-tree bx-scroll" aria-label="File del cervello" data-testid="bx-tree">
              <input className="bx-input" type="search" placeholder="Filtra i nomi dei file…" aria-label="Filtra i file" value={filter} onChange={e => setFilter(e.target.value)} />
              {groups.map(([g, list]) => {
                const shown = list.filter(f => !fq || f.toLowerCase().includes(fq));
                if (!shown.length) return null;
                const isOpen = !!fq || openGroups.has(g);
                return (
                  <div key={g} className={`grp ${isOpen ? 'open' : ''}`}>
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}><span className="chev" />{g}<span className="n">{shown.length}</span></button>
                    {isOpen && <div className="files">{shown.map(f => <button key={f} type="button" data-file={f} aria-current={f === cur} title={f} onClick={() => { setLine(undefined); nav(`esplora/${f}`); }}>{g === ROOT_GROUP ? f : f.slice(g.length + 1)}</button>)}</div>}
                  </div>
                );
              })}
            </nav>
            {cur ? <Viewer path={cur} files={set} root={ver.data?.root ?? ''} line={line} nav={nav} /> : (
              <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                {arg && !cur ? <Empty title="File non trovato">«{arg}» non è tra i file che il cervello mostra.</Empty> : <Empty title="Scegli un file a sinistra">Oppure cerca una parola in tutti i file. I principali:</Empty>}
                <div className="bx-row">{main.map(f => <button key={f} type="button" className="bx-chip" onClick={() => nav(`esplora/${f}`)}>{f}</button>)}</div>
              </div>
            )}
          </div>
        )}
      </Async>
    </>
  );
}
