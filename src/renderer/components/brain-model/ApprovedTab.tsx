// The Memoria hub's «Approvate» tab (ADR 0122; the owner, 2026-10-22: "tutto quello approvato/applicato, elimina con un
// click"): everything that is in the brain now, in one list grouped by kind (the brain's own skills, its rules, the
// memory facts confirmed, the scripts), with a search over all of them. Each row has a trash button: one click, the row
// leaves, and a toast offers «Annulla» for a few seconds. Skills, rules and scripts go through the change log
// ('brainmodel:remove', so «Annulla» is its rollback and the change shows in Apprendimento too); a confirmed fact is
// deleted ('memory:delete', which cannot be undone) only when its toast has expired, so «Annulla» simply keeps it. The
// always-loaded files (CLAUDE.md and the like) are edited, never deleted from here. Rendered by MemoryPage.tsx.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { MemoryReviewRecord } from '@shared/learning-review';
import { sb } from '../../sb';
import { locale, t } from '../../i18n';
import { brainModel, removeBrainItem, rollbackChange, useBrainModel } from '../../store/brain-model';
import { createStore } from '../../store/createStore';
import { toast } from '../../store/ui';
import { goTarget } from '../../actions';
import { useBrain } from '../../brain/api';
import { normScripts } from '../../brain/types';
import { IconCheck, IconSearch, IconShield, IconSparkle, IconTerminal, IconTrash } from '../Icons';

type Kind = 'skill' | 'rule' | 'fact' | 'script';
interface Row { kind: Kind; id: string; name: string; sub: string; at: number | null; locked?: string; open?: () => void }

// ── the confirmed memory facts (memory:reviewList), read once per hub and again on every brain change ──
const facts = createStore<{ rows: MemoryReviewRecord[]; loaded: boolean }>({ rows: [], loaded: false });
let factsOn = false;
async function readFacts(): Promise<void> {
  try { const rows = await sb.invoke('memory:reviewList', undefined); facts.set(() => ({ rows, loaded: true })); } catch { facts.set(() => ({ rows: [], loaded: true })); }
}
function useFacts(): MemoryReviewRecord[] {
  useEffect(() => {
    if (factsOn) return;
    factsOn = true;
    void readFacts();
    try { sb.on('brainmodel:changed', () => { void readFacts(); }); } catch { /* no bridge (tests) */ }
  }, []);
  return facts.use(s => s.rows).filter(r => r.status === 'confirmed');
}

/** Facts whose delete waits for its toast to expire (id → timer): hidden meanwhile, «Annulla» clears the timer. */
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
const hidden = createStore<{ ids: string[] }>({ ids: [] });
const hide = (key: string, on: boolean) => hidden.set(s => ({ ids: on ? [...new Set([...s.ids, key])] : s.ids.filter(x => x !== key) }));
const UNDO_MS = 6000;

const ruleLocked = (file: string, loaded: string): boolean => !/^rules\/[^/]+\.md$/i.test(file) || loaded === 'always';
const isoMs = (s: string | null | undefined): number | null => { const v = s ? Date.parse(s) : NaN; return Number.isFinite(v) ? v : null; };

function useRows(): { rows: Row[]; ready: boolean } {
  const { state } = useBrainModel();
  const scripts = useBrain('/api/scripts', normScripts);
  const confirmed = useFacts();
  const rows = useMemo<Row[]>(() => [
    ...(state?.skills ?? []).filter(s => s.home === 'brain').map(s => ({ kind: 'skill' as const, id: s.name, name: s.name, sub: s.description || s.rel || s.file, at: s.changedAt, open: s.rel ? () => goTarget(`file/${s.rel}`) : undefined })),
    ...(state?.rules ?? []).map(r => ({ kind: 'rule' as const, id: r.file, name: r.title, sub: r.file, at: r.changedAt, locked: ruleLocked(r.file, r.loaded) ? t('mh.ap.locked') : undefined, open: () => goTarget(`file/${r.file}`) })),
    ...confirmed.map(f => ({ kind: 'fact' as const, id: f.memoryId, name: `${f.subject} · ${f.predicate}`, sub: f.value, at: isoMs(f.transitions?.at(-1)?.at ?? f.observedAt) })),
    ...(scripts.data?.scripts ?? []).filter(s => s.tested.state === 'ok').map(s => ({ kind: 'script' as const, id: s.id, name: s.title, sub: s.file, at: isoMs(s.changedAt), open: () => goTarget(`memoria/script/${encodeURIComponent(s.id)}`) })),
  ], [state, confirmed, scripts.data]);
  return { rows, ready: !!state };
}

/** How many things the brain holds now (the tab's count): the rows the tab lists. */
export function useApprovedCount(): number | undefined {
  const { rows, ready } = useRows();
  const gone = hidden.use(s => s.ids);
  return ready ? rows.filter(r => !gone.includes(`${r.kind}:${r.id}`)).length : undefined;
}

const GROUPS: { kind: Kind; icon: ReactNode }[] = [
  { kind: 'skill', icon: <IconSparkle /> }, { kind: 'rule', icon: <IconShield /> }, { kind: 'fact', icon: <IconCheck /> }, { kind: 'script', icon: <IconTerminal /> },
];

async function remove(row: Row): Promise<void> {
  const key = `${row.kind}:${row.id}`;
  hide(key, true);
  if (row.kind === 'fact') {
    const root = brainModel.get().state?.root;
    if (!root) { hide(key, false); return; }
    const timer = setTimeout(() => {
      waiting.delete(key);
      void sb.invoke('memory:delete', { expectedRoot: root, id: row.id }).then(() => readFacts(), e => { hide(key, false); toast(`${t('mh.ap.notDeleted')}: ${String(e)}`, 'err'); });
    }, UNDO_MS + 200);
    waiting.set(key, timer);
    toast(t('mh.ap.deleted', { name: row.name }), 'ok', { label: t('mh.ap.undo'), run: () => { clearTimeout(waiting.get(key)); waiting.delete(key); hide(key, false); } }, UNDO_MS);
    return;
  }
  const r = await removeBrainItem(row.kind, row.id);
  if ('error' in r) { hide(key, false); toast(`${t('mh.ap.notDeleted')}: ${r.error}`, 'err'); return; }
  toast(t('mh.ap.deleted', { name: row.name }), 'ok', {
    label: t('mh.ap.undo'),
    run: () => { void rollbackChange(r.changeId).then(err => { hide(key, false); toast(err ?? t('mh.ap.restored', { name: row.name }), err ? 'err' : 'ok'); }); },
  }, UNDO_MS);
}

function ApprovedRow({ row, index }: { row: Row; index: number }) {
  const label = t('mh.ap.delete', { name: row.name });
  return <li className="mh-row" data-kind={row.kind} data-locked={row.locked ? 'true' : undefined} data-testid={`mh-ap-${row.kind}-${row.id}`} style={{ '--i': Math.min(index, 10) } as CSSProperties}>
    <span className="mh-row-dot" aria-hidden="true" />
    <div className="mh-row-main">
      {row.open ? <button type="button" className="mh-row-name" onClick={row.open}>{row.kind === 'skill' ? <code>/{row.name}</code> : row.name}</button> : <b className="mh-row-name">{row.name}</b>}
      <small title={row.sub}>{row.sub}</small>
    </div>
    {row.at && <time className="mh-row-when" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</time>}
    <button type="button" className="mh-trash" aria-label={label} data-tip={row.locked ?? label} disabled={!!row.locked} onClick={() => void remove(row)} data-testid={`mh-del-${row.kind}-${row.id}`}><IconTrash size={15} /></button>
  </li>;
}

export function ApprovedTab() {
  const { rows, ready } = useRows();
  const gone = hidden.use(s => s.ids);
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(r => !gone.includes(`${r.kind}:${r.id}`) && words.every(w => `${r.name} ${r.sub}`.toLowerCase().includes(w)));
  const total = rows.filter(r => !gone.includes(`${r.kind}:${r.id}`)).length;
  return <div className="mh-approved" data-testid="mh-approved">
    <div className="mh-intro">
      <p>{ready ? t('mh.ap.lead', { n: total }) : t('bm.loading')}</p>
      <label className="mh-search"><IconSearch size={14} /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('mh.ap.search')} aria-label={t('mh.ap.search')} data-testid="mh-ap-search" /></label>
    </div>
    <div className="mh-groups">
      {GROUPS.map(g => {
        const list = shown.filter(r => r.kind === g.kind).sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name));
        const all = rows.filter(r => r.kind === g.kind && !gone.includes(`${r.kind}:${r.id}`)).length;
        return <section key={g.kind} className="mh-group" data-kind={g.kind} aria-labelledby={`mh-g-${g.kind}`} data-testid={`mh-ap-group-${g.kind}`}>
          <header><span className="mh-group-icon" aria-hidden="true">{g.icon}</span><h3 id={`mh-g-${g.kind}`}>{t(`mh.ap.g.${g.kind}`)}</h3><span className="mh-group-n">{all}</span></header>
          {list.length ? <ul>{list.map((r, i) => <ApprovedRow key={r.id} row={r} index={i} />)}</ul>
            : <p className="mh-group-empty">{words.length && all ? t('mh.ap.noMatch') : t(`mh.ap.empty.${g.kind}`)}</p>}
        </section>;
      })}
    </div>
    <p className="bm-note">{t('mh.ap.note')}</p>
  </div>;
}
