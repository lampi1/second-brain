// "Skill" (G S, ADR 0018, ADR 0077; a tab of Memoria since ADR 0122): the Brain section's skills. Two concepts only (owner, 2026-10-19): agents and
// skills, so this page lists skills alone (the brain's shared ones, the user's own, Cursor's) as cards in the Agenti
// page's look: what each does, the tools it calls, which agents use it ("Usata da", or "Non usata"), who made it (the
// migration, a maintenance job, the user). "Agenti" on a card links or unlinks the skill to an agent at once, no
// approval, logged and undoable. "Modifica" and "Nuova skill" open the editor: a form (name, description, instructions)
// and the whole markdown with its frontmatter, the two always showing the same text, checked live (shared/skillmd.ts).
// Save goes through main, which checks again and runs the user's PreToolUse hooks for Write: a refusal is shown with
// the hook's own message. "Elimina" moves the file to the Recycle Bin after a confirmation; "Prova nell'Orchestrator" writes
// "/<name> " in the Orchestrator's input. Below: the one-time migration's report (runbooks and routines turned into skills)
// and the maintenance panel (its changes; the hub's «Manutenzione» runs the jobs). Rendered by brain-model/MemoryPage.tsx
// for the «Skill» tab ('skill' links land there; styles/skills.css, brain-model.css).
import { Select } from './Select';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MdIssue, SkillCatalog, SkillEntry, SkillPlace } from '@shared/contract';
import { checkMd, DESC_MAX, field, newMd, parseMd, setBody, setFields, template } from '@shared/skillmd';
import { HelpTip } from './HelpTip';
import { Seg } from '../brain/components/ui';
import { brainBridge } from '../actions';
import { askConfirm, toast, ui } from '../store/ui';
import { t } from '../i18n';
import { useBrainModel, linkSkill, refreshBrainModel } from '../store/brain-model';
import { filterSkills, skillRows, type SkillFilter, type SkillRow } from '../lib/brain-model-view';
import { MaintenancePanel, MigrationReportPanel, when } from './brain-model/MaintenancePanel';
import { HubIntro } from './brain-model/HubIntro';
import { parseHubArg } from '../lib/memory-hub';
import { IconPlus, IconRefresh } from './Icons';
import '../styles/skills.css';
import '../styles/agent-catalog.css';
import '../styles/brain-model.css';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const placeKey = (p: Pick<SkillPlace, 'kind' | 'harness' | 'scope' | 'root'>) => `${p.kind}|${p.harness}|${p.scope}|${p.root ?? ''}`;
const MODELS = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

/** What the editor holds: an existing file (entry) or a new one (place), its text as on disk and as edited. */
interface Draft { entry: SkillEntry | null; place: SkillPlace; saved: string; text: string }
/** The open draft outlives the page (Esc, "← Chat", a shortcut): coming back shows it as it was, unsaved edits included. */
let kept: Draft | null = null;

function Issues({ issues }: { issues: MdIssue[] }) {
  if (!issues.length) return <p className="sk-ok" data-testid="sk-issues-ok">{t('tools.skillsPage.validHeader')}</p>;
  return (
    <ul className="sk-issues" data-testid="sk-issues" aria-live="polite">
      {issues.map((i, k) => <li key={k} className={i.level} data-level={i.level}>{i.level === 'error' ? t('tools.skillsPage.errorLevel') : t('tools.skillsPage.warningLevel')}: {i.text}</li>)}
    </ul>
  );
}

function Editor({ draft, places, onChange, onSaved, onDeleted, onPlace }: {
  draft: Draft; places: SkillPlace[]; onChange: (text: string) => void; onSaved: (e: SkillEntry, text: string) => void; onDeleted: () => void; onPlace: (p: SkillPlace) => void;
}) {
  const [tab, setTab] = useState<'form' | 'md'>('form');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ error: string; hook?: string } | null>(null);
  const kind = draft.place.kind;
  const p = useMemo(() => parseMd(draft.text), [draft.text]);
  const issues = useMemo(() => checkMd(kind, draft.text), [kind, draft.text]);
  const errors = issues.filter(i => i.level === 'error').length;
  const dirty = draft.text !== draft.saved || !draft.entry;
  const ro = draft.entry?.readOnly ?? null;
  // the form edits keys line by line: a frontmatter it cannot read (unclosed, a line that is not "key: value") is fixed in Markdown
  const formOk = !!p.front && !p.issues.some(i => i.level === 'error' && !i.field);
  const name = field(p, 'name') ?? '';
  const desc = field(p, 'description') ?? '';
  useEffect(() => { setRefused(null); }, [draft.entry?.id, draft.place, draft.text]); // an edit starts over

  const set = (key: string, value: string, dropEmpty = false) => onChange(dropEmpty && !value.trim() ? setFields(draft.text, {}, [key]) : setFields(draft.text, { [key]: value }));
  const save = async () => {
    if (busy || ro || errors || !dirty) return;
    setBusy(true);
    setRefused(null);
    try {
      const pl = draft.place;
      const r = await window.sb.invoke('skills:save', { ...(draft.entry ? { id: draft.entry.id, mtime: draft.entry.mtime } : {}), kind: pl.kind, harness: pl.harness, scope: pl.scope, root: pl.root, text: draft.text });
      if (r.ok) { toast(`${draft.entry ? t('tools.skillsPage.saved') : t('tools.skillsPage.created')}: ${r.entry.name}`, 'ok'); onSaved(r.entry, draft.text); }
      else { setRefused({ error: r.error, ...(r.hook ? { hook: r.hook } : {}) }); toast(r.hook ? t('tools.skillsPage.hookRefused') : `${t('tools.skillsPage.notSaved')} ${r.error}`, 'err'); }
    } catch (e) { setRefused({ error: errText(e) }); } finally { setBusy(false); }
  };
  const del = () => {
    const e = draft.entry;
    if (!e) return;
    askConfirm({
      title: t('tools.skillsPage.deleteConfirmTitle', { kind: t(e.kind === 'agent' ? 'tools.skillsPage.theAgent' : 'tools.skillsPage.theSkill'), name: e.name }), danger: true, confirmLabel: t('tools.skillsPage.deleteConfirmButton'),
      body: e.kind === 'skill' ? t('tools.skillsPage.deleteSkillBody') : t('tools.skillsPage.deleteAgentBody'),
      items: [e.path],
      onConfirm: () => {
        void window.sb.invoke('skills:delete', { id: e.id }).then(r => {
          if (r.ok) { toast(`${t('tools.skillsPage.inTrash')} ${e.name}`, 'ok'); onDeleted(); } else toast(r.error ?? t('tools.skillsPage.notDeleted'), 'err');
        }, err => toast(`${t('tools.skillsPage.notDeleted')}: ${errText(err)}`, 'err'));
      },
    });
  };
  const onKey = (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); ev.stopPropagation(); void save(); }
  };
  const samePlaces = places.filter(x => x.kind === kind);

  return (
    <section className="sk-editor" aria-label={t('tools.skillsPage.editorAria')} data-testid="sk-editor" onKeyDown={onKey}>
      <header className="sk-ed-head">
        <div className="sk-ed-title">
          <h2 data-testid="sk-ed-name">{draft.entry ? draft.entry.name : kind === 'skill' ? t('tools.skillsPage.newSkillTitle') : t('tools.skillsPage.newAgentTitle')}</h2>
          <span className="small muted">{draft.place.label}</span>
        </div>
        <span className="sp" />
        {draft.entry && draft.entry.kind === 'skill' && !dirty && (
          <button type="button" className="bx-btn s" data-testid="sk-try" title={t('tools.skillsPage.tryInOrchestratorTip')}
            onClick={() => { if (!brainBridge.draftToOrchestrator(`/${draft.entry!.name} `, () => {})) toast(t('tools.skillsPage.noOrchestratorOpen'), 'warn'); }}>{t('tools.skillsPage.tryInOrchestrator')}</button>
        )}
        {draft.entry && !ro && <button type="button" className="bx-btn s danger" onClick={del} data-testid="sk-delete">{t('tools.skillsPage.deleteButton')}</button>}
        {dirty && draft.entry && <button type="button" className="bx-btn s" onClick={() => onChange(draft.saved)} data-testid="sk-revert">{t('tools.skillsPage.revertButton')}</button>}
        <button type="button" className="bx-btn s primary" onClick={() => void save()} disabled={busy || !!ro || errors > 0 || !dirty} data-testid="sk-save"
          title={ro ? t('tools.skillsPage.readonly') : errors ? t('tools.skillsPage.fixErrors') : t('tools.skillsPage.saveButtonTip')}>{busy ? t('tools.skillsPage.saving') : draft.entry ? t('tools.skillsPage.saveButton') : t('tools.skillsPage.createButton')}</button>
      </header>
      {draft.entry && <div className="sk-path mono small muted" title={draft.entry.path} data-testid="sk-path">{draft.entry.path}</div>}
      {ro && <p className="sk-ro" data-testid="sk-readonly">{ro}</p>}
      {refused && (
        <div className="sk-refused" role="alert" data-testid="sk-refused">
          <b>{refused.hook ? t('tools.skillsPage.refusedByHook') : t('tools.skillsPage.notSavedHeader')}</b>
          {refused.hook && <div className="mono small">{refused.hook}</div>}
          <pre>{refused.error}</pre>
        </div>
      )}
      <div className="sk-tabs">
        <Seg items={[{ id: 'form', label: t('tools.skillsPage.formLabel') }, { id: 'md', label: t('tools.skillsPage.markdownLabel') }]} value={tab} onChange={setTab} label={t('tools.skillsPage.editorView')} />
      </div>
      {tab === 'form' ? (
        formOk ? (
          <div className="sk-form" data-testid="sk-form">
            {!draft.entry && (
              <label className="sk-field">
                <span>{t('tools.skillsPage.whereLabel')}</span>
                <Select className="st-select" value={placeKey(draft.place)} data-testid="sk-place"
                  onChange={e => { const n = samePlaces.find(x => placeKey(x) === e.target.value); if (n) onPlace(n); }}>
                  {samePlaces.map(x => <option key={placeKey(x)} value={placeKey(x)}>{x.label}</option>)}
                </Select>
              </label>
            )}
            <label className="sk-field">
              <span>{t('tools.skillsPage.nameLabel')} <em>{kind === 'skill' ? t('tools.skillsPage.nameSubSkill') : t('tools.skillsPage.nameSubAgent')}</em></span>
              <input className="sk-input mono" value={name} onChange={e => set('name', e.target.value)} placeholder={kind === 'skill' ? t('tools.skillsPage.namePlaceholderSkill') : t('tools.skillsPage.namePlaceholderAgent')} readOnly={!!ro} data-testid="sk-name" spellCheck={false} />
            </label>
            <label className="sk-field">
              <span>{t('tools.skillsPage.descriptionLabel')} <em>{kind === 'skill' ? t('tools.skillsPage.descriptionSubSkill') : t('tools.skillsPage.descriptionSubAgent')}</em><b className={desc.length > DESC_MAX ? 'over' : ''}>{desc.length}/{DESC_MAX}</b></span>
              <textarea className="sk-input" rows={3} value={desc} onChange={e => set('description', e.target.value.replace(/\r?\n/g, ' '))}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} readOnly={!!ro} data-testid="sk-desc" />
            </label>
            {kind === 'agent' && (
              <div className="sk-row2">
                <label className="sk-field">
                  <span>{t('tools.skillsPage.toolsLabel')} <em>{t('tools.skillsPage.toolsEmpty')}</em></span>
                  <input className="sk-input mono" value={field(p, 'tools') ?? ''} onChange={e => set('tools', e.target.value, true)} placeholder={t('tools.skillsPage.toolsPlaceholder')} readOnly={!!ro} data-testid="sk-tools" spellCheck={false} />
                </label>
                <label className="sk-field">
                  <span>{t('tools.skillsPage.modelLabel')} <em>{t('tools.skillsPage.modelEmpty')}</em></span>
                  <input className="sk-input mono" list="sk-models" value={field(p, 'model') ?? ''} onChange={e => set('model', e.target.value, true)} readOnly={!!ro} data-testid="sk-model" spellCheck={false} />
                  <datalist id="sk-models">{MODELS.map(m => <option key={m} value={m} />)}</datalist>
                </label>
              </div>
            )}
            <label className="sk-field grow">
              <span>{t('tools.skillsPage.instructionsLabel')} <em>{t('tools.skillsPage.instructionsSub')}</em></span>
              <textarea className="sk-input mono sk-body" value={p.body.replace(/^\r?\n/, '')} onChange={e => onChange(setBody(draft.text, e.target.value))} readOnly={!!ro} data-testid="sk-body" spellCheck={false} />
            </label>
          </div>
        ) : <p className="sk-ro" data-testid="sk-form-off">{t('tools.skillsPage.headerBroken')}</p>
      ) : (
        <textarea className="sk-input mono sk-md" value={draft.text} onChange={e => onChange(e.target.value)} readOnly={!!ro} data-testid="sk-md" spellCheck={false} aria-label={t('tools.skillsPage.fullMarkdownAria')} />
      )}
      <Issues issues={issues} />
    </section>
  );
}

const norm = (p: string | null | undefined) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const HOME_TONE = { brain: 'green', user: 'blue', cursor: 'violet' } as const;

/** "Agenti" on a card: one checkbox per active agent; a change links or unlinks at once (logged, undoable). */
function AgentToggles({ row, agents, busy }: { row: SkillRow; agents: { id: string; name: string }[]; busy: boolean }) {
  const toggle = async (agent: { id: string; name: string }, on: boolean) => {
    const err = await linkSkill(row.name, agent.id, on);
    toast(err ?? t(on ? 'bm.skills.linked' : 'bm.skills.unlinked', { skill: row.name, agent: agent.name }), err ? 'err' : 'ok');
  };
  return <details className="bm-toggles" data-testid={`bm-toggles-${row.name}`}>
    <summary className="btn btn-ghost btn-s">{t('bm.skills.agents')}</summary>
    <fieldset disabled={busy}>
      <legend>{t('bm.skills.agentsLabel', { name: row.name })}</legend>
      {agents.map(a => <label key={a.id}><input type="checkbox" checked={row.usedBy.includes(a.id)} onChange={e => void toggle(a, e.target.checked)} data-testid={`bm-link-${row.name}-${a.id}`} />{a.name}</label>)}
    </fieldset>
  </details>;
}

function SkillCard({ row, agents, busy, onEdit, index }: { row: SkillRow; agents: { id: string; name: string }[]; busy: boolean; onEdit: (e: SkillEntry) => void; index: number }) {
  const names = row.usedBy.map(id => agents.find(a => a.id === id)?.name ?? id);
  const unused = row.linkable && !row.usedBy.length;
  return <article className="catalog-card" data-kind="skill" data-unused={unused} data-testid={`bm-skill-${row.name}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3><code>/{row.name}</code></h3><p className="bm-card-sub" title={row.file}>{row.rel ?? row.file}</p></div>
      <span className="bm-badges">
        <span className="bm-badge" data-tone={HOME_TONE[row.home]}>{t(`bm.skills.home.${row.home}`)}</span>
        {unused && <span className="bm-badge" data-tone="amber" data-testid="bm-unused">{t('bm.skills.unused')}</span>}
      </span>
    </header>
    <p className="bm-desc">{row.description || <i>{t('tools.skillsPage.noDescription')}</i>}</p>
    {row.home === 'cursor' ? <p className="bm-note">{t('bm.skills.cursorOnly')}</p> : !row.linkable ? null : <dl className="bm-row"><dt>{t('bm.skills.usedBy')}</dt><dd className="bm-chips">{names.length ? names.map(n => <span key={n} className="bm-chip">{n}</span>) : <span className="bm-card-sub">—</span>}</dd></dl>}
    {row.tools.length > 0 && <dl className="bm-row"><dt>{t('bm.skills.tools')}</dt><dd className="bm-chips">{row.tools.slice(0, 8).map(x => <span key={x} className="bm-chip" data-kind="tool">{x}</span>)}{row.tools.length > 8 && <span className="bm-chip" data-kind="tool">+{row.tools.length - 8}</span>}</dd></dl>}
    <footer className="bm-card-foot">
      <span>{row.madeBy ? t('bm.madeBy', { job: t(`bm.job.${row.madeBy}`) }) : row.changedAt ? t('bm.changed', { at: when(row.changedAt) }) : ''}</span>
      <span className="sp" />
      {row.linkable && agents.length > 0 && <AgentToggles row={row} agents={agents} busy={busy} />}
      {row.entry && <button type="button" className="btn btn-ghost btn-s" onClick={() => onEdit(row.entry!)} data-testid={`bm-edit-${row.name}`}>{t('bm.skills.edit')}</button>}
    </footer>
  </article>;
}

export function SkillsPage() {
  // the page lives in Memoria's Skill tab: its own arg follows the tab ("skill/<search>", ADR 0122)
  const arg = parseHubArg(ui.use(s => s.pageArg)).rest;
  const { state, busy } = useBrainModel();
  const [cat, setCat] = useState<SkillCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(() => arg ?? '');
  const [filter, setFilter] = useState<SkillFilter>('all');
  const [draft, setDraft] = useState<Draft | null>(() => kept);
  useEffect(() => { kept = draft; }, [draft]);
  useEffect(() => { if (arg) setQ(arg); }, [arg]);
  const editor = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setCat(await window.sb.invoke('skills:list', undefined)); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // a skill saved, linked or merged elsewhere: the editor's list follows the brain model
  useEffect(() => { if (state) void load(); }, [state?.skills.length, load]);

  const dirty = !!draft && draft.text !== draft.saved;
  /** leaving unsaved changes asks first */
  const guard = (go: () => void) => {
    if (!dirty) { go(); return; }
    askConfirm({ title: t('tools.skillsPage.unsavedTitle'), body: t('tools.skillsPage.unsavedBody'), confirmLabel: t('tools.skillsPage.leaveChanges'), danger: true, onConfirm: go });
  };
  const reveal = () => requestAnimationFrame(() => editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const open = (e: SkillEntry) => guard(() => {
    void window.sb.invoke('skills:read', { id: e.id }).then(d => {
      const place = cat?.places.find(p => placeKey(p) === placeKey(d.entry)) ?? { kind: d.entry.kind, harness: d.entry.harness, scope: d.entry.scope, root: d.entry.root, dir: '', label: '' };
      setDraft({ entry: d.entry, place, saved: d.text, text: d.text }); reveal();
    }, err2 => toast(`${t('tools.skillsPage.notRead')} ${errText(err2)}`, 'err'));
  });
  /** a new skill goes to the brain's shared skills (the brain as a Claude project) when the brain is a known project */
  const create = () => guard(() => {
    const skills = cat?.places.filter(p => p.kind === 'skill' && p.harness === 'claude') ?? [];
    const place = skills.find(p => p.scope === 'project' && state?.root && norm(p.root) === norm(state.root)) ?? skills.find(p => p.scope === 'user');
    if (!place) return;
    const text = newMd('skill', template('skill'));
    setDraft({ entry: null, place, saved: text, text }); reveal();
  });
  const close = () => guard(() => setDraft(null));

  const rows = useMemo(() => skillRows(state, cat), [state, cat]);
  const shown = useMemo(() => filterSkills(rows, q, filter), [rows, q, filter]);
  const used = rows.filter(r => r.usedBy.length).length;

  return (
    <div className="sk-page bm-page agent-overview" data-testid="skills-page">
      <HubIntro lead={cat || state ? t('bm.skills.lead', { n: rows.length, used }) : t('tools.skillsPage.loadingFolders')}
        actions={<><button type="button" className="btn btn-ghost btn-s" onClick={() => void load()} data-testid="bx-refresh"><IconRefresh size={13} /> {t('costs.refresh')}</button><button type="button" className="btn btn-primary btn-s" onClick={create} data-testid="sk-new-skill"><IconPlus size={13} /> {t('bm.skills.new')}</button></>} />
      {err && <p className="sk-refused" role="alert">{t('tools.skillsPage.loadError')} {err}</p>}
      {draft && <div className="bm-editor" ref={editor}>
        <div className="bm-editor-bar"><button type="button" className="btn btn-ghost btn-s" onClick={close} data-testid="sk-close">{t('bm.skills.close')}</button></div>
        <Editor draft={draft} places={cat?.places ?? []}
          onChange={text => setDraft(d => (d ? { ...d, text } : d))}
          onPlace={place => setDraft(d => (d ? { ...d, place } : d))}
          onSaved={(entry, text) => { setDraft(d => (d ? { ...d, entry, saved: text } : d)); void load(); void refreshBrainModel(); }} // what was typed meanwhile stays
          onDeleted={() => { setDraft(null); void load(); void refreshBrainModel(); }} />
      </div>}
      <div className="bm-toolbar" data-testid="sk-list">
        <input className="sk-input sk-search" type="search" placeholder={t('bm.skills.search')} value={q} onChange={e => setQ(e.target.value)} data-testid="sk-search" aria-label={t('bm.skills.searchLabel')} />
        <Seg items={[{ id: 'all', label: t('bm.skills.filter.all') }, { id: 'used', label: t('bm.skills.filter.used') }, { id: 'unused', label: t('bm.skills.filter.unused') }]} value={filter} onChange={setFilter} label={t('bm.skills.filterLabel')} />
        <HelpTip title={t('explain.skills.title')} wide guide="skills" testid="sk-help"><p>{t('explain.skills.p1')}</p><p>{t('explain.skills.p2')}</p></HelpTip>
      </div>
      {!rows.length && (cat || state) ? <p className="bm-empty" data-testid="sk-empty">{t('bm.skills.empty')}</p>
        : !shown.length && rows.length ? <p className="bm-empty" data-testid="sk-empty">{t('bm.skills.emptySearch')}</p>
          : <div className="catalog-grid" data-testid="bm-skill-grid">{shown.map((r, i) => <SkillCard key={`${r.home}|${r.file}`} row={r} agents={state?.root ? state.agents : []} busy={busy} onEdit={open} index={i} />)}</div>}
      {state?.migration && <MigrationReportPanel report={state.migration} />}
      <MaintenancePanel kinds={['skill', 'agent']} />
    </div>
  );
}
