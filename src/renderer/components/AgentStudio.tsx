// A role's own page (Brain → Agenti → a role), one page where every field is edited where it is read (owner,
// 2026-11-24: «la UI della modifica agente è terribile deve essere clean pulita usabilissima. Non mi interessano le
// versioni … anche i permessi degli agenti toglili», ADR 0347). On top who the role is (its character, name, what it
// is for, four numbers: runs, success, mean cost, last use) and «Ripristina predefinito»; then the cards: «Modelli per
// livello» (RoleLevels: several models per level across engines, the Orchestrator only its Base model), the instructions
// (saved as you type, a short pause after the last key), the skills (chips, × and + Skill), the options (Code Mode, Fast,
// maximum context, the roles it may start) and the results per model (ModelStandings). No versions, no permissions, no
// «Modifica» mode: each change saves the card at once (agents:save). The card back's «Apri» (EDIT_ELEMENT) lands here
// with the cursor in the instructions. Rendered by AgentCatalogPage.tsx. Styles: styles/agent-studio.css.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { completedRuns, MAX_CONTEXT_RANGE, type AgentDraft, type AgentMetrics, type AgentProfile } from '@shared/agents';
import { WORK_ROLE_IDS, isDelegatorRole, isRoleId } from '@shared/roles';
import { characterOf } from '@shared/characters';
import { cardPresets } from '@shared/model-presets';
import { levelEngines, levelsOf } from '@shared/model-levels';
import { refreshAgents, resetAgent, saveAgent, useAgents } from '../store/agents';
import { toast, ui } from '../store/ui';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { formatCost } from '../lib/format';
import { characterTone } from '../lib/character-art';
import { agentDraftOf } from '../lib/agent-drafts';
import { kTokens } from '../lib/model-catalog';
import { holdUpdate } from '../lib/update-barrier';
import { go } from '../actions';
import { locale, t } from '../i18n';
import { ModelStandings } from './ModelStandings';
import { AgentAvatar } from './AgentAvatar';
import { AgentImagePicker } from './AgentImagePicker';
import { RoleLevels } from './RoleLevels';
import { RolePresetRows } from './RolePresets';
import { RoleCodeMode } from './RoleCodeMode';
import { HarnessMark } from './Icons';
import { Select } from './Select';
import { useBrainModel } from '../store/brain-model';
import '../styles/agent-studio.css';
import '../styles/brain-model.css';
import { rolePurpose } from '../lib/role-text';
import { errText as reason } from '../lib/ipc-error';

/** The Orchestrator is never delegated to: of the levels only Base, its own model and effort. */
const BASE_ONLY = ['base'] as const;
const SKILL = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
/** The context sizes offered (tokens): the app's range, in round steps. */
const CONTEXTS = [200_000, 400_000, 600_000, 800_000, 1_000_000].filter(n => n >= MAX_CONTEXT_RANGE.min && n <= MAX_CONTEXT_RANGE.max);
/** How long the instructions wait after the last key before they save. */
const TYPE_PAUSE_MS = 900;

/** The place element of the card back's «Apri»: the role page opens with the cursor in the instructions (#126). */
export const EDIT_ELEMENT = 'modifica';
let editHandled = 0;

/** The run numbers of one role, read like the catalogue's (agents:metrics); null when unavailable. */
function useAgentMetrics(agentId: string): AgentMetrics | null | undefined {
  const [value, setValue] = useState<AgentMetrics | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void sb.invoke('agents:metrics', undefined).then(all => { if (alive) setValue(all.find(m => m.agentId === agentId) ?? null); }, () => { if (alive) setValue(null); });
    return () => { alive = false; };
  }, [agentId]);
  return value;
}

/** Saves one change of the card at once; the error goes to a toast (the field shows the card as it is). */
async function saveCard(profile: AgentProfile, change: Partial<AgentDraft>): Promise<boolean> {
  try { await saveAgent({ ...agentDraftOf(profile), ...change }, profile.id); return true; }
  catch (e) { toast(t('studio.saveError', { detail: reason(e) }), 'err'); return false; }
}

export function AgentStudio({ profile }: { profile: AgentProfile }) {
  const { catalog, error } = useAgents();
  const shown = catalog?.profiles.find(p => p.id === profile.id) ?? profile;
  const metrics = useAgentMetrics(shown.id);
  const [resetting, setResetting] = useState(false), [busy, setBusy] = useState(false);
  const lastStart = useApp(s => Object.values(s.chats).reduce((at, c) => c.run?.agentId === shown.id ? Math.max(at, c.run.startedAt) : at, 0));
  const stats = metrics?.all;
  const rate = stats?.successRate.value ?? null, cost = stats?.costPerRun.median.value ?? null;
  const pct = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
  const nums: [string, string][] = [
    [metrics ? completedRuns(metrics).toLocaleString(locale()) : '—', t('rolePage.runs')],
    [rate !== null ? pct(rate) : '—', t('rolePage.success')],
    [cost !== null ? formatCost(cost) : '—', t('rolePage.cost')],
    [lastStart ? new Date(lastStart).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : '—', t('rolePage.last')],
  ];
  const reset = async () => {
    setBusy(true);
    try { await resetAgent(shown.id); setResetting(false); toast(t('studio.resetDone'), 'ok'); }
    catch (e) { toast(`${t('studio.resetError')} ${reason(e)}`, 'err'); }
    finally { setBusy(false); }
  };
  const work = shown.id !== 'orchestrator';
  return <section className="agent-detail" aria-label={shown.name} data-testid="agent-studio" style={{ '--tone': characterTone(characterOf(shown.id)) } as CSSProperties}>
    <button type="button" className="ad-back" onClick={() => go({ page: 'agenti' })}><span aria-hidden="true">←</span> {t('rolePage.back')}</button>
    <article className="ad-body" data-testid={`agent-detail-${shown.id}`}>
      <header className="ad-hero">
        <div className="ad-avatar-col"><span className="ad-avatar"><AgentAvatar avatar={shown.avatar} name={shown.name} size={72} /></span>{isRoleId(shown.id) && <AgentImagePicker id={shown.id} />}</div>
        <div className="ad-id">
          <h2>{shown.name}</h2>
          <p className="ad-purpose">{rolePurpose(shown.id, shown.purpose)}</p>
          <p className="ad-nums" data-testid="agent-numbers">{nums.map(([v, k]) => <span key={k}><b>{v}</b> {k}</span>)}</p>
        </div>
        <div className="ad-actions">
          {resetting
            ? <span className="ad-confirm" role="group" aria-label={t('studio.reset')} data-testid="agent-reset-confirm"><span>{t('studio.resetConfirm')}</span>
              <button type="button" className="btn btn-primary btn-s" disabled={busy} onClick={() => void reset()} autoFocus>{t('studio.resetDo')}</button>
              <button type="button" className="btn btn-ghost btn-s" onClick={() => setResetting(false)}>{t('studio.cancel')}</button></span>
            : <button type="button" className="btn btn-ghost btn-m" disabled={busy || !shown.userLocked || !!shown.trial} onClick={() => setResetting(true)} data-testid="agent-reset">{t('studio.reset')}</button>}
        </div>
      </header>
      {(error || catalog?.problem) && <p role="alert" className="studio-alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
      {shown.trial && <p role="alert" className="studio-alert">{t('studio.trialOpen')}</p>}
      <div className="ad-grid">
        <div className="ad-main">
          {work ? <RoleLevels profile={shown} /> : <section className="ad-card" data-testid="role-levels">
            <header className="ad-card-head"><h3>{t('rolePage.levels')}</h3></header>
            <p className="ad-hint">{t('rolePage.levels.orchestrator')}</p>
            <RolePresetRows profile={shown} ids={BASE_ONLY} undoable />
          </section>}
          <Instructions profile={shown} />
        </div>
        <div className="ad-side">
          <Skills profile={shown} />
          <Options profile={shown} />
          <section className="ad-card" aria-labelledby={`ad-results-${shown.id}`}>
            <header className="ad-card-head"><h3 id={`ad-results-${shown.id}`}>{t('rolePage.results')}</h3></header>
            <p className="ad-hint">{t('rolePage.results.hint')}</p>
            <ModelStandings id={shown.id} standing={metrics?.standing} inUse={shown.model} />
          </section>
        </div>
      </div>
    </article>
  </section>;
}

/** The instructions, saved by themselves after a short pause (and when the field loses focus). */
function Instructions({ profile }: { profile: AgentProfile }) {
  const [text, setText] = useState(profile.instructions);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(profile);
  latest.current = profile;
  // the card changed elsewhere (a restore, the Orchestrator): the field follows it while the user is not typing
  useEffect(() => { if (!timer.current && document.activeElement !== field.current) setText(profile.instructions); }, [profile.instructions]);
  useEffect(() => { if (state === 'saving') return holdUpdate(t('studio.hold')); }, [state]);
  const flush = async (value: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (value === latest.current.instructions) return;
    setState('saving');
    setState(await saveCard(latest.current, { instructions: value }) ? 'saved' : 'idle');
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // «Apri» on the card back: the cursor goes to the instructions
  const hl = ui.use(s => s.highlight);
  useEffect(() => { if (hl?.id !== EDIT_ELEMENT || hl.n === editHandled) return; editHandled = hl.n; field.current?.focus({ preventScroll: true }); }, [hl?.n]);
  return <section className="ad-card ad-prompt" aria-labelledby={`ad-prompt-${profile.id}`}>
    <header className="ad-card-head"><h3 id={`ad-prompt-${profile.id}`}>{t('rolePage.instructions')}</h3>
      {state !== 'idle' && <span className="ad-saved" role="status" data-state={state} data-testid="agent-instructions-state">{state === 'saving' ? t('rolePage.saving') : `✓ ${t('rolePage.saved')}`}</span>}</header>
    <p className="ad-hint">{t('rolePage.instructions.hint')}</p>
    <textarea ref={field} className="ad-prompt-edit" value={text} maxLength={8000} disabled={!!profile.trial} aria-label={t('rolePage.instructions')} data-testid="agent-instructions"
      onChange={e => { const v = e.target.value; setText(v); setState('idle'); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; void flush(v); }, TYPE_PAUSE_MS); }}
      onBlur={() => void flush(text)} />
  </section>;
}

/** The skills it loads at every start: chips with ×, and a field to add one (the brain's skills suggested). */
function Skills({ profile }: { profile: AgentProfile }) {
  const { state: brain } = useBrainModel();
  const [name, setName] = useState(''), [adding, setAdding] = useState(false);
  const list = `skills-${profile.id}`;
  const add = async () => {
    const n = name.trim();
    if (!SKILL.test(n) || profile.skills.includes(n) || profile.skills.length >= 40) return;
    if (await saveCard(profile, { skills: [...profile.skills, n] })) { setName(''); setAdding(false); }
  };
  return <section className="ad-card" aria-labelledby={`ad-skills-${profile.id}`} data-testid="agent-skills">
    <header className="ad-card-head"><h3 id={`ad-skills-${profile.id}`}>{t('rolePage.skills')}</h3></header>
    <p className="ad-hint">{t('rolePage.skills.hint')}</p>
    <div className="ad-skills">
      {profile.skills.map(s => <span key={s} className="ad-skill"><button type="button" className="ad-skill-name" onClick={() => go({ page: 'skill', arg: s })}>{s}</button>
        <button type="button" className="ad-skill-x" aria-label={t('studio.skillRemove', { name: s })} onClick={() => void saveCard(profile, { skills: profile.skills.filter(x => x !== s) })}>×</button></span>)}
      {adding
        ? <span className="ad-skill-add"><input list={list} value={name} maxLength={80} autoFocus aria-label={t('studio.skillName')} data-testid="agent-skill-name"
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} onBlur={() => { if (!name.trim()) setAdding(false); }} />
          <datalist id={list}>{(brain?.skills ?? []).map(s => <option key={s.name} value={s.name}>{s.description}</option>)}</datalist></span>
        : <button type="button" className="rl-add" onClick={() => setAdding(true)} data-testid="agent-skill-add">{t('rolePage.skills.add')}</button>}
    </div>
  </section>;
}

/** Code Mode and Fast (RoleCodeMode), the maximum context, and for the Orchestrator and the Strategist the roles they
 *  may start. */
function Options({ profile }: { profile: AgentProfile }) {
  const { catalog } = useAgents();
  const engines = levelEngines(levelsOf(profile, cardPresets(profile, null)));
  const contextual = engines.some(h => catalog?.models.find(m => m.engine === h)?.maxContext);
  const toggle = (id: string) => saveCard(profile, { launches: profile.launches.includes(id) ? profile.launches.filter(x => x !== id) : WORK_ROLE_IDS.filter(x => x === id || profile.launches.includes(x)) });
  return <section className="ad-card ad-options" aria-labelledby={`ad-options-${profile.id}`} data-testid="agent-options">
    <header className="ad-card-head"><h3 id={`ad-options-${profile.id}`}>{t('rolePage.options')}</h3>
      <span className="ad-engines" aria-label={t('rolePage.engines')}>{engines.map(h => <HarnessMark key={h} harness={h} size={16} />)}</span></header>
    <RoleCodeMode profile={profile} engines={engines} />
    {contextual && <div className="st-row"><div className="st-text"><span className="st-title">{t('rolePage.context')}</span><p className="st-desc">{t('rolePage.context.hint')}</p></div>
      <div className="st-ctl"><Select value={profile.maxContext ? String(profile.maxContext) : ''} aria-label={t('rolePage.context')} data-testid="agent-max-context"
        onChange={e => void saveCard(profile, { maxContext: e.target.value ? Number(e.target.value) : null })}>
        <option value="">{t('rolePage.context.default')}</option>
        {CONTEXTS.map(n => <option key={n} value={String(n)}>{kTokens(n)}</option>)}
        {profile.maxContext && !CONTEXTS.includes(profile.maxContext) && <option value={String(profile.maxContext)}>{kTokens(profile.maxContext)}</option>}
      </Select></div></div>}
    {isDelegatorRole(profile.id) && <div className="st-row ad-launches" data-testid="agent-launches"><div className="st-text"><span className="st-title">{t('rolePage.launches')}</span><p className="st-desc">{t('rolePage.launches.hint')}</p>
      <div className="ad-launch-list">{WORK_ROLE_IDS.filter(id => id !== profile.id).map(id => {
        const r = catalog?.profiles.find(p => p.id === id);
        return <label key={id} className="ad-launch"><input type="checkbox" checked={profile.launches.includes(id)} onChange={() => void toggle(id)} />
          {r && <AgentAvatar avatar={r.avatar} name={r.name} size={18} />}<span>{r?.name ?? id}</span></label>;
      })}</div></div></div>}
  </section>;
}
