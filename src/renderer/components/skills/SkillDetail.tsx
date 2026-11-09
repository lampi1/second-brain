// One skill of the library (ADR 0241, #362-#364): its head (name, origin, what it is for, «Prova», delete or restore the
// app's original) and four tabs. Leggi: SKILL.md rendered, without its frontmatter. File: the package's tree (SKILL.md,
// scripts/, references/, assets/) and an editor for every text file, with Ctrl+S, «Nuovo file» and «Togli file»; a
// binary file is listed, never edited. Ruoli: which roles load it at start, each with its own usage; a role's default
// skill is marked and changed from the role. Cronologia: every change with who and when, its diff (brain/pages/FileDiff
// DiffView, before → after) and «Annulla». Every write is skills:write / skills:remove (main/skills/library.ts: the
// user's hooks first, then one change-log entry). Used by SkillsPage.tsx; styles/skill-library.css.
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { LibSkill, SkillFileText, SkillRole, SkillVersion } from '@shared/skill-library';
import { SKILL_PATH } from '@shared/skill-library';
import { parseMd } from '@shared/skillmd';
import { t } from '../../i18n';
import { askConfirm, toast } from '../../store/ui';
import { brainBridge } from '../../actions';
import { errText } from '../../lib/ipc-error';
import { ago } from '../../lib/format';
import { Markdown } from '../../brain/components/Markdown';
import { DiffView } from '../../brain/pages/FileDiff';
import { IconFile, IconFolder, IconHistory, IconPlay, IconPlus, IconTrash } from '../Icons';

export type DetailTab = 'read' | 'files' | 'roles' | 'history';
const TABS: DetailTab[] = ['read', 'files', 'roles', 'history'];
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 102.4) / 10} KB` : `${Math.round(n / 1024 / 102.4) / 10} MB`);
const whoOf = (job: string) => (job === 'user' ? t('sl.who.user') : job === 'migration' ? t('sl.who.migration') : job === 'research' ? t('sl.who.research') : t('sl.who.job'));

function ReadTab({ skill }: { skill: LibSkill }) {
  const [doc, setDoc] = useState<SkillFileText | null>(null);
  useEffect(() => { let live = true; void window.sb.invoke('skills:file', { skill: skill.name, path: 'SKILL.md' }).then(d => { if (live) setDoc(d); }, () => {}); return () => { live = false; }; }, [skill.name, skill.changedAt]);
  const body = useMemo(() => (doc?.text ? parseMd(doc.text).body.replace(/^\s+/, '') : ''), [doc]);
  return <div className="sl-read" data-testid="sl-read">
    {skill.origin === 'app' && <p className="sl-note">{t('sl.appNote')}</p>}
    {doc ? <div className="sl-prose"><Markdown text={body || '—'} copyBlocks testId="sl-md" /></div> : <p className="sl-muted">…</p>}
  </div>;
}

/** The package as folders and files: SKILL.md, then each folder with its files. */
function Tree({ skill, path, onPick, adding, onAdd }: { skill: LibSkill; path: string; onPick: (p: string) => void; adding: boolean; onAdd: () => void }) {
  const groups = useMemo(() => {
    const out = new Map<string, LibSkill['files']>();
    for (const f of skill.files) { const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''; out.set(dir, [...(out.get(dir) ?? []), f]); }
    return [...out].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [skill.files]);
  return <nav className="sl-tree" aria-label={t('sl.files.tree')} data-testid="sl-tree">
    {groups.map(([dir, files]) => <div key={dir || '.'} className="sl-tree-group">
      {dir && <div className="sl-tree-dir"><IconFolder size={13} />{dir}/</div>}
      {files.map(f => <button key={f.path} type="button" className="sl-tree-file" aria-current={f.path === path ? 'true' : undefined} onClick={() => onPick(f.path)} data-testid={`sl-file-${f.path}`} data-binary={!f.text} style={{ paddingInlineStart: dir ? 26 : 10 }}>
        <IconFile size={13} /><span>{f.path.slice(dir ? dir.length + 1 : 0)}</span><span className="sl-tree-size">{size(f.size)}</span></button>)}
    </div>)}
    <button type="button" className="sl-tree-add" onClick={onAdd} aria-expanded={adding} data-testid="sl-file-new"><IconPlus size={13} />{t('sl.files.new')}</button>
  </nav>;
}

function FilesTab({ skill, onDirty, onChanged }: { skill: LibSkill; onDirty: (d: boolean) => void; onChanged: () => void }) {
  const [path, setPath] = useState('SKILL.md');
  const [doc, setDoc] = useState<SkillFileText | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const fresh = doc === null && !skill.files.some(f => f.path === path);
  const dirty = doc ? doc.text !== null && text !== doc.text : fresh && text.length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const open = useCallback((p: string) => {
    setPath(p); setError(null);
    if (!skill.files.some(f => f.path === p)) { setDoc(null); setText(''); return; }
    void window.sb.invoke('skills:file', { skill: skill.name, path: p }).then(d => { setDoc(d); setText(d.text ?? ''); }, e => setError(errText(e)));
  }, [skill.name, skill.files]);
  useEffect(() => { open('SKILL.md'); }, [skill.name]); // only when another skill opens
  const pick = (p: string) => {
    if (!dirty) { open(p); return; }
    askConfirm({ title: t('sl.files.unsavedTitle'), body: t('sl.files.unsavedBody'), confirmLabel: t('sl.files.leave'), danger: true, onConfirm: () => open(p) });
  };
  const save = async () => {
    if (busy || !dirty) { if (!dirty) toast(t('sl.files.same'), 'info'); return; }
    setBusy(true); setError(null);
    try {
      const r = await window.sb.invoke('skills:write', { skill: skill.name, path, text, ...(doc ? { mtime: doc.mtime } : {}) });
      if (!r.ok) { setError(r.error); return; }
      toast(t('sl.files.saved', { path }), 'ok');
      const d = await window.sb.invoke('skills:file', { skill: skill.name, path });
      setDoc(d); setText(d.text ?? text);
      onChanged();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const remove = () => askConfirm({ title: t('sl.files.removeTitle', { path }), body: t('sl.files.removeBody'), confirmLabel: t('sl.files.remove'), danger: true, onConfirm: () => {
    void window.sb.invoke('skills:write', { skill: skill.name, path, text: null }).then(r => { if (r.ok) { onChanged(); open('SKILL.md'); } else setError(r.error); }, e => setError(errText(e)));
  } });
  const add = () => {
    const p = newPath.trim().replace(/^\/+/, '');
    if (!SKILL_PATH.test(p) || p.split('/').includes('..')) return;
    setAdding(false); setNewPath(''); setDoc(null); setText(''); setPath(p); setError(null);
  };
  const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void save(); } };
  const binary = doc && doc.text === null;
  return <div className="sl-files" data-testid="sl-files">
    <Tree skill={skill} path={path} onPick={pick} adding={adding} onAdd={() => setAdding(a => !a)} />
    <div className="sl-editor" onKeyDown={onKey}>
      {adding && <form className="sl-newfile" onSubmit={e => { e.preventDefault(); add(); }}>
        <input className="sl-input mono" autoFocus value={newPath} onChange={e => setNewPath(e.target.value)} placeholder={t('sl.files.newPlaceholder')} spellCheck={false} data-testid="sl-newfile-path" aria-invalid={!!newPath && !SKILL_PATH.test(newPath.trim())} />
        <button type="submit" className="btn btn-ghost btn-s" disabled={!SKILL_PATH.test(newPath.trim())}>{t('sl.files.add')}</button>
        <p className="sl-hint">{t('sl.files.newHint')}</p>
      </form>}
      <header className="sl-editor-head">
        <span className="sl-editor-path mono">{path}{dirty && <span className="sl-dirty" aria-label="*">●</span>}</span>
        <span className="sp" />
        {path !== 'SKILL.md' && !fresh && <button type="button" className="btn btn-subtle btn-s" onClick={remove} data-testid="sl-file-remove"><IconTrash size={13} />{t('sl.files.remove')}</button>}
        {dirty && doc && <button type="button" className="btn btn-subtle btn-s" onClick={() => setText(doc.text ?? '')} data-testid="sk-revert">{t('sl.files.revert')}</button>}
        {!binary && <button type="button" className="btn btn-primary btn-s" onClick={() => void save()} disabled={busy || !dirty} title={t('sl.files.saveTip')} data-testid="sk-save">{busy ? t('sl.files.saving') : t('sl.files.save')}</button>}
      </header>
      {error && <p className="sl-error" role="alert" data-testid="sk-refused">{error}</p>}
      {binary ? <p className="sl-note">{t('sl.files.binary', { size: size(doc.size) })}</p>
        : <textarea className="sl-code mono" value={text} onChange={e => setText(e.target.value)} spellCheck={false} aria-label={t('sl.files.editorLabel', { path })} data-testid="sk-md" />}
      <p className="sl-hint">{skill.origin === 'app' ? t('sl.appNote') : t('sl.files.skillDir')}</p>
    </div>
  </div>;
}

function RolesTab({ skill, roles, hasBrain, onChanged }: { skill: LibSkill; roles: SkillRole[]; hasBrain: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState<Set<string>>(new Set());
  // a role whose default skill this is: shown, changed from the role (the library refuses it here)
  useEffect(() => { void window.sb.invoke('agents:list', undefined).then(c => setDefaults(new Set(c.profiles.filter(p => p.skills.includes(skill.name)).map(p => p.id))), () => {}); }, [skill.name]);
  const toggle = async (role: SkillRole, on: boolean) => {
    setBusy(true);
    try {
      const next = on ? [...new Set([...skill.roles, role.id])] : skill.roles.filter(r => r !== role.id);
      await window.sb.invoke('skills:roles', { skill: skill.name, roles: next });
      toast(t(on ? 'sl.roles.on' : 'sl.roles.off', { skill: skill.name, role: role.name }), 'ok');
      onChanged();
    } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  const top = Math.max(1, ...skill.uses.map(u => u.uses));
  const now = Date.now();
  return <div className="sl-roles" data-testid="sl-roles">
    <p className="sl-lead">{hasBrain ? t('sl.roles.lead') : t('sl.roles.noBrain')}</p>
    <ul>
      {roles.filter(r => r.id !== 'orchestrator').map(r => {
        const on = skill.roles.includes(r.id), def = defaults.has(r.id), use = skill.uses.find(u => u.role === r.id);
        return <li key={r.id} className="sl-role" data-on={on}>
          <label>
            <input type="checkbox" role="switch" checked={on} disabled={busy || def || !hasBrain} onChange={e => void toggle(r, e.target.checked)} data-testid={`bm-link-${skill.name}-${r.id}`} />
            <span className="sl-role-name">{r.name}</span>
            {def && <span className="sl-flag" title={t('sl.roles.defaultTip')}>{t('sl.roles.default')}</span>}
          </label>
          <span className="sl-role-use">
            <span className="sl-bar" aria-hidden><span style={{ inlineSize: `${use ? Math.max(4, (100 * use.uses) / top) : 0}%` }} /></span>
            <span className="small">{use ? t('sl.roles.uses', { n: use.uses, at: ago(use.lastAt, now) }) : t('sl.roles.never')}</span>
          </span>
        </li>;
      })}
    </ul>
  </div>;
}

function Version({ v, skill, onUndone }: { v: SkillVersion; skill: string; onUndone: (h: SkillVersion[]) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    setBusy(true);
    try { onUndone(await window.sb.invoke('skills:undo', { skill, changeId: v.id })); toast(t('sl.history.undoneToast'), 'ok'); }
    catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  const now = Date.now();
  return <li className="sl-version" data-undone={!!v.undoneAt} data-testid={`sl-version-${v.id}`}>
    <span className="sl-version-dot" aria-hidden />
    <div className="sl-version-body">
      <div className="sl-version-head">
        <span className="sl-version-when" title={new Date(v.at).toLocaleString()}>{ago(v.at, now)}</span>
        <span className="sl-version-who">{whoOf(v.job)}</span>
        <span className="sp" />
        {v.undoneAt ? <span className="sl-flag">{t('sl.history.undone', { at: ago(v.undoneAt, now) })}</span>
          : <button type="button" className="btn btn-ghost btn-s" onClick={() => void undo()} disabled={busy || !v.canUndo} title={v.canUndo ? undefined : t('sl.history.cannot')} data-testid="sl-undo">{t('sl.history.undo')}</button>}
      </div>
      <p className="sl-version-summary">{v.summary}</p>
      <div className="sl-version-files">{v.files.map(f => <span key={f.path} className="sl-chip mono">{f.path}{f.before === null ? ` · ${t('sl.history.created')}` : f.after === null ? ` · ${t('sl.history.removed')}` : ''}</span>)}
        {v.files.length > 0 && <button type="button" className="sl-link" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? t('sl.history.hide') : t('sl.history.show')}</button>}</div>
      {open && v.files.map(f => <DiffView key={f.path} diff={{ kind: 'diff', path: f.path, left: { label: `${f.path} · ${t('sl.history.before')}`, text: f.before ?? '' }, right: { label: t('sl.history.after'), text: f.after ?? '' } }} />)}
    </div>
  </li>;
}

function HistoryTab({ skill, onChanged }: { skill: LibSkill; onChanged: () => void }) {
  const [h, setH] = useState<SkillVersion[] | null>(null);
  useEffect(() => { let live = true; void window.sb.invoke('skills:history', { skill: skill.name }).then(x => { if (live) setH(x); }, () => { if (live) setH([]); }); return () => { live = false; }; }, [skill.name, skill.changedAt]);
  return <div className="sl-history" data-testid="sl-history">
    <p className="sl-lead">{t('sl.history.lead')}</p>
    {!h ? <p className="sl-muted">…</p> : !h.length ? <p className="sl-empty">{t('sl.history.empty')}</p>
      : <ol className="sl-timeline">{h.map(v => <Version key={v.id} v={v} skill={skill.name} onUndone={x => { setH(x); onChanged(); }} />)}</ol>}
  </div>;
}

export function SkillDetail({ skill, roles, hasBrain, tab, onTab, onDirty, onChanged, onGone }: {
  skill: LibSkill; roles: SkillRole[]; hasBrain: boolean; tab: DetailTab; onTab: (t: DetailTab) => void;
  onDirty: (d: boolean) => void; onChanged: () => void; onGone: () => void;
}) {
  const removable = skill.origin !== 'app';
  const remove = () => askConfirm({
    title: skill.overridesApp ? t('sl.restoreTitle', { name: skill.name }) : t('sl.deleteTitle', { name: skill.name }),
    body: skill.overridesApp ? t('sl.restoreBody') : t('sl.deleteBody'), danger: !skill.overridesApp,
    confirmLabel: skill.overridesApp ? t('sl.restore') : t('sl.delete'),
    onConfirm: () => { void window.sb.invoke('skills:remove', { skill: skill.name }).then(r => {
      if (!r.ok) { toast(r.error ?? '', 'err'); return; }
      toast(skill.overridesApp ? t('sl.restored', { name: skill.name }) : t('sl.deleted', { name: skill.name }), 'ok');
      if (skill.overridesApp) onChanged(); else onGone();
    }, e => toast(errText(e), 'err')); },
  });
  const now = Date.now();
  const tryIt = () => { if (!brainBridge.draftToOrchestrator(`/${skill.name} `, () => {})) toast(t('sl.noOrchestrator'), 'warn'); };
  return <article className="sl-detail" data-testid="sk-editor" data-origin={skill.origin}>
    <header className="sl-head">
      <div className="sl-head-title">
        <h2 data-testid="sk-ed-name" title={skill.name}><span className="sl-slash" aria-hidden>/</span>{skill.name}</h2>
        <span className="sl-origin" data-origin={skill.origin} title={t(`sl.originTip.${skill.origin}`)}>{t(`sl.origin.${skill.origin}`)}</span>
        {skill.overridesApp && <span className="sl-flag">{t('sl.overrides')}</span>}
      </div>
      <p className="sl-desc" data-testid="sk-desc">{skill.description || <i>{t('sl.noDescription')}</i>}</p>
      <p className="sl-facts small">
        <span>{t('sl.facts.files', { n: skill.files.length })}</span>
        <span>{skill.totalUses ? t('sl.uses', { n: skill.totalUses }) : t('sl.noUses')}</span>
        {skill.changedAt && <span>{t('sl.facts.changed', { at: ago(skill.changedAt, now) })}{skill.madeBy ? ` ${t('sl.facts.by', { who: whoOf(skill.madeBy) })}` : ''}</span>}
        <span className="mono sl-folder" title={skill.folder}><span>{skill.folder}</span></span>
      </p>
    </header>
    <div className="sl-tabs" role="tablist" aria-label={t('sl.tabs')}>
      {TABS.map(id => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} data-testid={`sl-tab-${id}`}>
        {id === 'history' && <IconHistory size={13} />}{t(`sl.tab.${id}`)}{id === 'files' && <span className="sl-n">{skill.files.length}</span>}{id === 'roles' && <span className="sl-n">{skill.roles.length}</span>}</button>)}
      <span className="sp" />
      <span className="sl-head-actions">
        <button type="button" className="btn btn-ghost btn-s" onClick={tryIt} title={t('sl.tryTip')} data-testid="sk-try"><IconPlay size={12} />{t('sl.try')}</button>
        {removable && <button type="button" className={skill.overridesApp ? 'btn btn-ghost btn-s' : 'btn btn-danger btn-s'} onClick={remove} data-testid="sk-delete">{skill.overridesApp ? t('sl.restore') : <><IconTrash size={12} />{t('sl.delete')}</>}</button>}
      </span>
    </div>
    <div className="sl-panel" role="tabpanel">
      {tab === 'read' && <ReadTab skill={skill} />}
      {tab === 'files' && <FilesTab skill={skill} onDirty={onDirty} onChanged={onChanged} />}
      {tab === 'roles' && <RolesTab skill={skill} roles={roles} hasBrain={hasBrain} onChanged={onChanged} />}
      {tab === 'history' && <HistoryTab skill={skill} onChanged={onChanged} />}
    </div>
  </article>;
}
