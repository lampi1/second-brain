// The brain's data table: search, facet filters with counts, sort by any column, column chooser (remembered per table),
// CSV (Excel in Italian) and JSON export of the filtered rows, full keyboard use (the table is one focus stop:
// ↑/↓/PgUp/PgDn/Home/End move the active row, Enter opens it in the side "peek" panel, Esc closes it) and
// virtualization past 150 rows (fixed-height rows, only the visible ones in the DOM), so 1000+ rows stay instant.
// Every page's tables use it; the pure logic lives in lib/table.ts.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { facetValues, nextSort, queryRows, scrollIntoRow, stamp, toCsv, toJson, windowRange, fileSafe, type ColBase, type TableQuery } from '../lib/table';
import { fmt } from '../lib/format';
import { t as tr } from '../../i18n';
import { Explain, type ExplainProps } from './States';
import { HelpTip } from '../../components/HelpTip';
import { download, IconChevL, IconChevR, IconClose, IconColumns, IconDownload, IconSearch, useEsc } from './ui';

export interface Col<R> extends ColBase<R> {
  render?: (r: R) => ReactNode;
  help?: string;
  width?: string;
  nowrap?: boolean;
  /** long text: at most two lines in the table (one when virtualized), all of it in the peek */
  clip?: boolean;
  /** hidden until chosen in "Colonne" */
  hidden?: boolean;
}
export interface DataTableProps<R> {
  name: string;
  label?: string;
  rows: R[];
  cols: Col<R>[];
  filters?: string[];
  sort?: { key: string; dir: 1 | -1 };
  search?: boolean;
  /** the peek's content; `close` hides the peek (an action that takes the user elsewhere, e.g. the docked Regia) */
  detail?: (r: R, close: () => void) => ReactNode;
  detailTitle?: (r: R) => string;
  empty?: string;
  explain?: ExplainProps;
  /** scroll height of the table body (default: none until it is virtualized, then 560 px) */
  maxHeight?: number;
  testId?: string;
}

export const VIRTUAL_FROM = 150;
const ROW_H = 34;
const loadHidden = (name: string, cols: Col<unknown>[]): Set<string> => {
  try { const s = localStorage.getItem(`bx-cols:${name}`); if (s) return new Set(JSON.parse(s) as string[]); } catch { /* none */ }
  return new Set(cols.filter(c => c.hidden).map(c => c.key));
};

function cellText<R>(c: Col<R>, r: R): string {
  const v = c.value ? c.value(r) : (r as Record<string, unknown>)[c.key];
  if (c.type === 'usd') return fmt.usd(typeof v === 'number' ? v : Number(v));
  if (c.type === 'num') return v === '' || v == null ? '' : fmt.int(Number(v));
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function DataTable<R>({ name, label, rows, cols, filters = [], sort, search = true, detail, detailTitle, empty = tr('costs.tableEmpty'), explain, maxHeight, testId }: DataTableProps<R>) {
  const uid = useId();
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<TableQuery['sort']>(sort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden(name, cols as Col<unknown>[]));
  const [active, setActive] = useState(-1);
  const [peek, setPeek] = useState(false);
  const [menu, setMenu] = useState(false);
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => queryRows(rows, cols, { q, filters: facet, sort: order }), [rows, cols, q, facet, order]);
  const shown = cols.filter(c => !hidden.has(c.key));
  const virt = visible.length > VIRTUAL_FROM;
  const height = maxHeight ?? (virt ? 560 : undefined);
  const facets = useMemo(() => filters.map(k => {
    const c = cols.find(x => x.key === k) ?? { key: k, label: k };
    return { col: c, values: facetValues(rows, c) };
  }).filter(f => f.values.length > 1), [filters, cols, rows]);
  const filtered = !!q || Object.values(facet).some(Boolean);

  useEffect(() => { setActive(a => (a >= visible.length ? visible.length - 1 : a)); }, [visible.length]);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  useEsc(peek, () => { setPeek(false); box.current?.focus(); });

  const saveHidden = (h: Set<string>) => { setHidden(h); try { localStorage.setItem(`bx-cols:${name}`, JSON.stringify([...h])); } catch { /* private */ } };
  const go = (i: number) => {
    const n = Math.max(0, Math.min(visible.length - 1, i));
    setActive(n);
    const el = box.current;
    if (!el) return;
    if (virt) { const t = scrollIntoRow(n, el.scrollTop, el.clientHeight, ROW_H, 32); if (t !== el.scrollTop) el.scrollTop = t; }
    else requestAnimationFrame(() => document.getElementById(`${uid}-r${n}`)?.scrollIntoView({ block: 'nearest' }));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!visible.length) return;
    // a control inside the table (a column's sort button or "?") keeps its own keys
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, a, input, select')) return;
    const k = e.key;
    if (k === 'ArrowDown') go(active + 1);
    else if (k === 'ArrowUp') go(active < 0 ? 0 : active - 1);
    else if (k === 'PageDown') go(active + 10);
    else if (k === 'PageUp') go(active - 10);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(visible.length - 1);
    else if (k === 'Enter' || k === ' ') { if (active < 0) go(0); else setPeek(p => !p); }
    else return;
    e.preventDefault();
  };

  const range = virt ? windowRange(top, height ?? 560, ROW_H, visible.length) : { start: 0, end: visible.length, padTop: 0, padBottom: 0 };
  const cur = active >= 0 ? visible[active] : undefined;
  const exportName = `${fileSafe(name)}-${stamp()}`;

  return (
    <div className="bx-table" data-testid={testId ?? `bx-table-${fileSafe(name)}`}>
      {explain && <Explain {...explain} />}
      <div className="bx-tbar">
        {search && (
          <label className="bx-search">
            <IconSearch />
            <input className="bx-input" type="search" placeholder={tr('costs.tableSearch')} aria-label={tr('costs.tableSearchLabel',{name:label??name})} value={q} onChange={e => setQ(e.target.value)} />
          </label>
        )}
        {facets.map(({ col, values }) => (
          <select key={col.key} className={`bx-select ${facet[col.key] ? 'on' : ''}`} aria-label={tr('costs.tableFilter',{name:col.label})} value={facet[col.key] ?? ''} onChange={e => setFacet(f => ({ ...f, [col.key]: e.target.value }))}>
            <option value="">{col.label}: {tr('costs.tableAll')}</option>
            {values.map(v => <option key={v.value} value={v.value}>{v.value} ({v.count})</option>)}
          </select>
        ))}
        <span className="count" aria-live="polite">{visible.length === rows.length ? tr('costs.tableRows',{count:fmt.int(rows.length)}) : tr('costs.tableFilteredRows',{count:fmt.int(visible.length),total:fmt.int(rows.length)})}</span>
        {filtered && <button type="button" className="bx-btn ghost s" onClick={() => { setQ(''); setFacet({}); }}>{tr('costs.tableReset')}</button>}
        <span className="sp" />
        <div className="bx-rel" ref={menuRef}>
          <button type="button" className="bx-btn s" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(m => !m)} title={tr('costs.tableChooseColumns')}><IconColumns /> {tr('costs.tableColumns')}</button>
          {menu && (
            <div className="bx-colmenu" role="group" aria-label={tr('costs.tableShownColumns')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); } }}>
              {cols.map(c => (
                <label key={c.key}>
                  <input type="checkbox" checked={!hidden.has(c.key)} disabled={!hidden.has(c.key) && shown.length === 1}
                    onChange={() => { const h = new Set(hidden); if (h.has(c.key)) h.delete(c.key); else h.add(c.key); saveHidden(h); }} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="bx-btn s" onClick={() => download(`${exportName}.csv`, toCsv(shown, visible), 'text/csv')} title={tr('costs.tableCsv')}><IconDownload /> CSV</button>
        <button type="button" className="bx-btn s" onClick={() => download(`${exportName}.json`, toJson(shown, visible), 'application/json')} title={tr('costs.tableJson')}><IconDownload /> JSON</button>
      </div>
      <div ref={box} className={`bx-tbox bx-scroll ${virt ? 'virt' : ''}`} style={height ? { maxHeight: height } : undefined} tabIndex={0} role="grid" aria-label={label ?? name}
        aria-rowcount={visible.length + 1} aria-activedescendant={active >= 0 ? `${uid}-r${active}` : undefined} onKeyDown={onKey}
        onScroll={virt ? e => { const t = e.currentTarget.scrollTop; requestAnimationFrame(() => setTop(t)); } : undefined}>
        <table>
          <colgroup>{shown.map(c => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
          <thead>
            <tr role="row">
              {shown.map(c => {
                const s = order?.key === c.key ? order.dir : 0;
                return (
                  <th key={c.key} role="columnheader" scope="col" aria-label={c.label} aria-sort={s ? (s > 0 ? 'ascending' : 'descending') : 'none'} className={`${c.type === 'num' || c.type === 'usd' ? 'num' : ''} ${c.help ? 'has-help' : ''}`}>
                    <div className="bx-th">
                      <button type="button" className="bx-sort" data-tip={tr('costs.tableSort')} onClick={() => setOrder(nextSort(order, c))}>
                        <span className="l">{c.label}</span>{s !== 0 && <span className="arrow" aria-hidden="true">{s > 0 ? '▲' : '▼'}</span>}
                      </button>
                      {c.help && <HelpTip label={c.label}>{c.help}</HelpTip>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!visible.length && <tr className="empty"><td colSpan={shown.length}>{filtered ? tr('costs.tableNoMatches') : empty}</td></tr>}
            {range.padTop > 0 && <tr className="spacer" aria-hidden="true"><td colSpan={shown.length} style={{ height: range.padTop }} /></tr>}
            {visible.slice(range.start, range.end).map((r, j) => {
              const i = range.start + j;
              return (
                <tr key={i} id={`${uid}-r${i}`} role="row" aria-rowindex={i + 2} aria-selected={i === active}
                  className={`r ${i === active ? 'active' : ''} ${peek && i === active ? 'open' : ''}`} style={virt ? { height: ROW_H } : undefined}
                  onClick={e => { if ((e.target as HTMLElement).closest('a,button')) return; setActive(i); setPeek(true); box.current?.focus({ preventScroll: true }); }}>
                  {shown.map(c => {
                    const content = c.render ? c.render(r) : cellText(c, r);
                    const t = typeof content === 'string' ? content : undefined;
                    return (
                      <td key={c.key} role="gridcell" className={`${c.type === 'num' || c.type === 'usd' ? 'num' : ''} ${c.nowrap ? 'nowrap' : ''}`} title={t && t.length > 30 ? t : undefined}>
                        {c.clip && t ? <div className="bx-clip2">{t}</div> : content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {range.padBottom > 0 && <tr className="spacer" aria-hidden="true"><td colSpan={shown.length} style={{ height: range.padBottom }} /></tr>}
          </tbody>
        </table>
      </div>
      {peek && cur !== undefined && (
        <aside className="bx-peek bx" role="dialog" aria-label={tr('costs.tableRowDetail')} data-testid="bx-peek">
          <header>
            <h3>{detailTitle ? detailTitle(cur) : cellText(shown[0] ?? cols[0]!, cur) || tr('costs.tableDetail')}</h3>
            <span className="pos">{tr('costs.tablePosition',{index:active+1,total:visible.length})}</span>
            <button type="button" className="bx-btn ghost s" aria-label={tr('costs.tablePrevious')} disabled={active <= 0} onClick={() => go(active - 1)}><IconChevL /></button>
            <button type="button" className="bx-btn ghost s" aria-label={tr('costs.tableNextRow')} disabled={active >= visible.length - 1} onClick={() => go(active + 1)}><IconChevR /></button>
            <button type="button" className="bx-btn ghost s" aria-label={tr('costs.tableClose')} title={tr('costs.tableClose')} onClick={() => { setPeek(false); box.current?.focus(); }}><IconClose /></button>
          </header>
          <div className="body">{detail ? detail(cur, () => setPeek(false)) : <RowFields row={cur} cols={cols} />}</div>
        </aside>
      )}
    </div>
  );
}

/** Every field of a row as label: value (column labels where known). */
export function RowFields<R>({ row, cols }: { row: R; cols: Col<R>[] }) {
  const labels = new Map(cols.map(c => [c.key, c.label]));
  const entries = Object.entries(row as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && v !== '' && v != null && !(Array.isArray(v) && !v.length));
  return (
    <dl className="bx-kv">
      {entries.map(([k, v]) => [<dt key={`${k}-t`}>{labels.get(k) ?? k}</dt>, <dd key={`${k}-d`}>{typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)}</dd>])}
    </dl>
  );
}
