// Agent card of the Agenti catalogue (AgentCatalogPage): identity (glyph, name, role), engine and model, a live status
// and four compact run metrics on the front; a click anywhere on the card flips it in 3D (#81, owner 2026-10-19: no
// "Avvia", no "Dettagli") to the back: the agent's prompt, the skills it declares (preloaded when it starts, ADR 0077),
// its memory, the run facts and "Apri profilo". A second click, or Esc, flips it back; the hidden face is inert, so
// keyboard and screen readers only reach the visible one. Under prefers-reduced-motion the faces fade instead of turning.
// Authoritative run metrics keep their sample sizes and unknown values: a missing value is shown as a dash with "Non
// disponibile" for screen readers and in its tooltip, never as zero. Styles: styles/agent-catalog.css (card) and
// styles/brain-model.css (flip).
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { inProbation, type AgentMetrics, type AgentProfile } from '@shared/agents';
import type { MemoryFile } from '@shared/brain-model';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';

type Value = { text: string | null; samples?: string };

function Metric({ label, full, value, unknown }: { label: string; full: string; value: Value; unknown: string }) {
  const tip = [full, value.text ?? unknown, value.samples].filter(Boolean).join(' · ');
  return <div title={tip}>
    <dt>{label}</dt>
    <dd>{value.text ?? <><span aria-hidden="true">—</span><span className="sr-only">{unknown}</span></>}</dd>
  </div>;
}

export function AgentCatalogCard({ profile, metrics, loaded, engine, lastStart, onOpen, onSkill, updateAvailable, index = 0, skills = [], memory = null }: {
  profile: AgentProfile; metrics?: AgentMetrics; loaded: boolean; engine: string; lastStart: number | null; onOpen: () => void; updateAvailable?: boolean;
  index?: number;
  /** the skills the agent declares (brain model), shown on the back */ skills?: string[];
  /** its own memory file, when it has one */ memory?: MemoryFile | null;
  /** a skill chip on the back: go to that skill */ onSkill?: (name: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const backId = useId();
  const front = useRef<HTMLButtonElement>(null), back = useRef<HTMLButtonElement>(null), moved = useRef(false);
  const flip = (on: boolean) => { moved.current = true; setFlipped(on); };
  // the focus follows the turn: the face that just became visible gets it (only after the user's own flip)
  useEffect(() => { if (moved.current) { moved.current = false; (flipped ? back : front).current?.focus({ preventScroll: true }); } }, [flipped]);
  useEffect(() => {
    if (!flipped) return;
    // capture, and stopped: Esc flips the card back instead of leaving the page (the app's global Esc)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); flip(false); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [flipped]);
  const stats = metrics?.all;
  const ended = loaded ? stats?.ended ?? 0 : null;
  const open = loaded ? metrics?.open ?? 0 : null;
  const unknown = t('catalog.unknown');
  const rate = stats?.successRate, cost = stats?.costPerRun.median;
  const sample = (n: number) => loaded ? t('catalog.samples', { n, total: ended ?? 0 }) : unknown;
  const values: Record<'runs' | 'open' | 'success' | 'cost', Value> = {
    runs: { text: ended?.toLocaleString(locale()) ?? null },
    open: { text: open?.toLocaleString(locale()) ?? null },
    success: { text: rate?.value != null ? new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(rate.value) : null, samples: sample(rate?.n ?? 0) },
    cost: { text: cost?.value != null ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(cost.value) : null, samples: sample(cost?.n ?? 0) },
  };
  const probation = inProbation(profile);
  const working = !probation && (open ?? 0) > 0;
  const state = probation ? 'probation' : working ? 'working' : 'active';
  const tone = profile.avatar?.kind === 'symbol' ? profile.avatar.tone ?? 'blue' : 'blue';
  const origin = profile.origin.kind === 'preset' ? t('catalog.preset') : t('catalog.custom');
  const role = profile.role || origin;
  const last = lastStart === null ? unknown : new Date(lastStart).toLocaleString(locale());
  const prompt = profile.instructions.trim();
  return <article className="catalog-card bm-flip" data-testid={`catalog-card-${profile.id}`} data-state={state} data-tone={tone} data-flipped={flipped}
    style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <div className="bm-flip-inner">
      <div className="bm-face bm-face-front" inert={flipped} aria-hidden={flipped || undefined} data-testid={`catalog-front-${profile.id}`}>
        <header className="catalog-card-head">
          <span className="catalog-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={40} /></span>
          <div className="catalog-card-id">
            <h3><button ref={front} type="button" onClick={() => flip(true)} aria-expanded={flipped} aria-controls={backId} aria-describedby={`${backId}-f`} data-testid={`catalog-flip-${profile.id}`}>{profile.name}</button></h3>
            <span id={`${backId}-f`} className="sr-only">{t('bm.card.flip', { name: profile.name })}</span>
            <p className="catalog-role" title={role}>{role}</p>
          </div>
          <span className="catalog-badge" data-probation={probation} data-state={state}>
            <i aria-hidden="true" />{probation ? t('catalog.probation') : working ? t('agentsGrid.working') : t('catalog.active')}</span>
        </header>
        <p className="catalog-purpose" title={profile.purpose || undefined}>{profile.purpose}</p>
        <div className="catalog-chips">
          <span className="catalog-chip" data-kind="engine">{engine}</span>
          <span className="catalog-chip" data-kind="model" title={profile.model ?? t('studio.defaultEngine')}>{profile.model ?? t('studio.defaultEngine')}</span>
          <span className="catalog-chip" data-kind="skills">{t('bm.map.agentSkills', { n: skills.length })}</span>
          {updateAvailable && <button type="button" className="catalog-chip catalog-update" onClick={onOpen}>{t('catalog.presetUpdate')}</button>}
        </div>
        <dl className="catalog-stats">
          <Metric label={t('agentsGrid.runs')} full={t('catalog.runs')} value={values.runs} unknown={unknown} />
          <Metric label={t('agentsGrid.open')} full={t('catalog.open')} value={values.open} unknown={unknown} />
          <Metric label={t('agentsGrid.success')} full={t('catalog.success')} value={values.success} unknown={unknown} />
          <Metric label={t('agentsGrid.cost')} full={t('catalog.cost')} value={values.cost} unknown={unknown} />
        </dl>
      </div>
      <div className="bm-face bm-face-back" id={backId} inert={!flipped} aria-hidden={!flipped || undefined} data-testid={`catalog-back-${profile.id}`}>
        <header className="bm-back-head">
          <span className="catalog-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={34} /></span>
          <h3><button ref={back} type="button" onClick={() => flip(false)} aria-describedby={`${backId}-b`} data-testid={`catalog-unflip-${profile.id}`}>{profile.name}</button></h3>
          <span id={`${backId}-b`} className="sr-only">{t('bm.card.flipBack', { name: profile.name })}</span>
        </header>
        <section className="catalog-prompt" aria-label={t('agentDetail.prompt')}>
          <h4>{t('agentDetail.prompt')}{prompt && <small>{t('agentDetail.promptSize', { n: prompt.length })}</small>}</h4>
          {prompt ? <pre tabIndex={0} data-testid={`catalog-prompt-${profile.id}`}>{prompt}</pre> : <p>{t('agentDetail.promptEmpty')}</p>}
        </section>
        <section className="bm-back-skills" aria-label={t('bm.card.skills')} data-testid={`catalog-skills-${profile.id}`}>
          <h4>{t('bm.card.skills')}</h4>
          {skills.length ? <div className="bm-chips">{skills.map(s => onSkill
            ? <button key={s} type="button" className="bm-chip" onClick={() => onSkill(s)}>{s}</button>
            : <span key={s} className="bm-chip">{s}</span>)}</div>
            : <p>{t('bm.card.noSkills')}</p>}
        </section>
        <dl>
          <div><dt>{t('bm.card.memory')}</dt><dd>{memory?.entries ? t('bm.mem.entries', { n: memory.entries }) : t('bm.card.memoryNone')}</dd></div>
          <div><dt>{t('catalog.engine')}</dt><dd>{engine} · {profile.model ?? t('studio.defaultEngine')}</dd></div>
          <div><dt>{t('agentsGrid.origin')}</dt><dd>{origin} · v{profile.activeVersion}</dd></div>
          <div><dt>{t('catalog.success')}</dt><dd>{values.success.text ?? unknown} <small>{values.success.samples}</small></dd></div>
          <div><dt>{t('catalog.cost')}</dt><dd>{values.cost.text ?? unknown} <small>{values.cost.samples}</small></dd></div>
          <div><dt>{t('catalog.last')}</dt><dd>{last}</dd></div>
        </dl>
        <footer className="bm-back-foot">
          <span className="bm-flip-hint" aria-hidden="true">{t('bm.card.back')}</span>
          <button type="button" className="btn btn-ghost btn-s" onClick={onOpen} data-testid={`catalog-open-${profile.id}`}>{t('agentsGrid.openProfile')}</button>
        </footer>
      </div>
    </div>
  </article>;
}
