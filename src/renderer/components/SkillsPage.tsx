// "Skill e agenti" (G S, ADR 0018): every skill and agent of Claude Code and Cursor, user level and project level, in
// one list (search, filters by kind and engine, grouped by where they live), and an editor on the right: a form (name,
// description, instructions; tools and model for an agent) and the whole markdown with its frontmatter, the two always
// showing the same text, checked live (shared/skillmd.ts). Save goes through main, which checks again and runs the
// user's PreToolUse hooks for Write: a refusal is shown with the hook's own message. "Elimina" moves the file to the
// Recycle Bin after a confirmation; "Prova nella Regia" writes "/<name> " in the Regia's input. Why: the user, 12/10,
// "deve anche essere facile dall'app creare e modificare skill una sezione apposta, anche per gli agenti". Rendered by
// App.tsx PageFrame for the 'skill' place (.bx classes of the brain pages, styles/skills.css).
import { Select } from './Select';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Harness, MdIssue, SkillCatalog, SkillEntry, SkillKind, SkillPlace } from '@shared/contract';
import { checkMd, DESC_MAX, field, newMd, parseMd, setBody, setFields, template } from '@shared/skillmd';
import { PageHead } from '../brain/components/States';
import { Pill, Seg } from '../brain/components/ui';
import { brainBridge } from '../actions';
import { askConfirm, toast } from '../store/ui';
import { t } from '../i18n';
import '../styles/skills.css';

const ENGINE: Record<Harness, string> = { claude: 'Claude', cursor: 'Cursor' };
const getKind = (): Record<SkillKind, string> => ({ skill: t('tools.skillsPage.kindSkillLabel'), agent: t('tools.skillsPage.kindAgentLabel') });
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
          <button type="button" className="bx-btn s" data-testid="sk-try" title={t('tools.skillsPage.tryInRegiaTip')}
            onClick={() => { if (!brainBridge.draftToRegia(`/${draft.entry!.name} `, () => {})) toast(t('tools.skillsPage.noRegiaOpen'), 'warn'); }}>{t('tools.skillsPage.tryInRegia')}</button>
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

export function SkillsPage() {
  const [cat, setCat] = useState<SkillCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | SkillKind>('all');
  const [eng, setEng] = useState<'all' | Harness>('all');
  const [draft, setDraft] = useState<Draft | null>(() => kept);
  useEffect(() => { kept = draft; }, [draft]);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setCat(await window.sb.invoke('skills:list', undefined)); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = !!draft && draft.text !== draft.saved;
  /** leaving unsaved changes asks first */
  const guard = (go: () => void) => {
    if (!dirty) { go(); return; }
    askConfirm({ title: t('tools.skillsPage.unsavedTitle'), body: t('tools.skillsPage.unsavedBody'), confirmLabel: t('tools.skillsPage.leaveChanges'), danger: true, onConfirm: go });
  };
  const open = (e: SkillEntry) => guard(() => {
    void window.sb.invoke('skills:read', { id: e.id }).then(d => {
      const place = cat?.places.find(p => placeKey(p) === placeKey(d.entry)) ?? { kind: d.entry.kind, harness: d.entry.harness, scope: d.entry.scope, root: d.entry.root, dir: '', label: '' };
      setDraft({ entry: d.entry, place, saved: d.text, text: d.text });
    }, err2 => toast(`${t('tools.skillsPage.notRead')} ${errText(err2)}`, 'err'));
  });
  const create = (k: SkillKind) => guard(() => {
    const place = cat?.places.find(p => p.kind === k && p.harness === (eng === 'cursor' ? 'cursor' : 'claude') && p.scope === 'user');
    if (!place) return;
    const t = template(k);
    const text = newMd(k, t);
    setDraft({ entry: null, place, saved: text, text });
  });

  const entries = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (cat?.entries ?? []).filter(e => (kind === 'all' || e.kind === kind) && (eng === 'all' || e.harness === eng)
      && words.every(w => `${e.name} ${e.description}`.toLowerCase().includes(w)));
  }, [cat, q, kind, eng]);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: SkillEntry[] }>();
    for (const e of entries) {
      const pl = cat?.places.find(p => placeKey(p) === placeKey(e));
      const label = pl?.label ?? `${ENGINE[e.harness]}`;
      const g = m.get(label) ?? { label, items: [] };
      g.items.push(e);
      m.set(label, g);
    }
    return [...m.values()];
  }, [entries, cat]);
  const nSkill = cat?.entries.filter(e => e.kind === 'skill').length ?? 0;
  const nAgent = cat?.entries.filter(e => e.kind === 'agent').length ?? 0;

  return (
    <div className="sk-page" data-testid="skills-page">
      <PageHead title={t('tools.skillsPage.pageTitle')} onRefresh={() => void load()}
        lead={cat ? <>{t('tools.skillsPage.lead', { nSkill, nAgent })}<b>{t('tools.skillsPage.slashName')}</b>.</> : t('tools.skillsPage.loadingFolders')}
        actions={<>
          <button type="button" className="bx-btn s primary" onClick={() => create('skill')} data-testid="sk-new-skill">{t('tools.skillsPage.newSkillButton')}</button>
          <button type="button" className="bx-btn s" onClick={() => create('agent')} data-testid="sk-new-agent">{t('tools.skillsPage.newAgentButton')}</button>
        </>} />
      {err && <p className="sk-refused" role="alert">{t('tools.skillsPage.loadError')} {err}</p>}
      <div className="sk-cols">
        <section className="sk-list" aria-label={t('tools.skillsPage.listAria')} data-testid="sk-list">
          <input ref={search} className="sk-input sk-search" type="search" placeholder={t('tools.skillsPage.searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} data-testid="sk-search" aria-label={t('tools.skillsPage.searchLabel')} />
          <div className="sk-filters">
            <Seg items={[{ id: 'all', label: t('tools.skillsPage.kindAll') }, { id: 'skill', label: t('tools.skillsPage.kindSkill') }, { id: 'agent', label: t('tools.skillsPage.kindAgent') }]} value={kind} onChange={setKind} label={t('tools.skillsPage.kindFilterLabel')} />
            <Seg items={[{ id: 'all', label: t('tools.skillsPage.engineAll') }, { id: 'claude', label: t('tools.skillsPage.engineClaude') }, { id: 'cursor', label: t('tools.skillsPage.engineCursor') }]} value={eng} onChange={setEng} label={t('tools.skillsPage.engineFilterLabel')} />
          </div>
          {cat && !entries.length && <p className="small muted" data-testid="sk-empty">{q ? t('tools.skillsPage.emptySearch') : t('tools.skillsPage.emptyNoItems')}</p>}
          {groups.map(g => (
            <div key={g.label} className="sk-group">
              <h3>{g.label}</h3>
              <ul>
                {g.items.map(e => (
                  <li key={e.id}>
                    <button type="button" className={`sk-item ${draft?.entry?.id === e.id ? 'on' : ''}`} onClick={() => open(e)} data-testid={`sk-item-${e.harness}-${e.kind}-${e.name}`} aria-current={draft?.entry?.id === e.id || undefined}>
                      <span className="sk-item-head">
                        <span className="mono sk-item-name">{e.kind === 'skill' ? '/' : ''}{e.name}</span>
                        <Pill tone={e.kind === 'agent' ? 'violet' : 'blue'}>{getKind()[e.kind]}</Pill>
                        {e.readOnly && <Pill tone="outline" title={e.readOnly}>{t('tools.skillsPage.readOnlyPill')}</Pill>}
                        {e.errors > 0 && <Pill tone="bad">{t('tools.skillsPage.errorCount', { n: e.errors })}</Pill>}
                      </span>
                      <span className="sk-item-desc">{e.description || <i>{t('tools.skillsPage.noDescription')}</i>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        {draft ? (
          <Editor draft={draft} places={cat?.places ?? []}
            onChange={text => setDraft(d => (d ? { ...d, text } : d))}
            onPlace={place => setDraft(d => (d ? { ...d, place } : d))}
            onSaved={(entry, text) => { setDraft(d => (d ? { ...d, entry, saved: text } : d)); void load(); }} // what was typed meanwhile stays
            onDeleted={() => { setDraft(null); void load(); }} />
        ) : (
          <section className="sk-editor sk-empty" data-testid="sk-editor-empty">
            <h2>{t('tools.skillsPage.emptyEditorTitle')}</h2>
            <p>{t('tools.skillsPage.emptyEditorBody1')}<b>{t('tools.skillsPage.newSkill')}</b>{t('tools.skillsPage.or')}<b>{t('tools.skillsPage.newAgent')}</b>{t('tools.skillsPage.emptyEditorBody2')}</p>
          </section>
        )}
      </div>
    </div>
  );
}
