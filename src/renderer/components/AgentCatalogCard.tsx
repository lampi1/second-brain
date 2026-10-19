// Role card of the Agenti catalogue (AgentCatalogPage): on the front the character large and centred, its name and what
// it is for, engine and model tier, a live status, its level (from ended runs) and performance % (verdicts weighted by
// trust and recency, main/agents/standing.ts), each with a "?" giving the formula, and three compact run metrics; a click anywhere on the card flips it in 3D (#81)
// to the back: the role's instructions, the skills it loads at every launch, its memory, the run facts and "Apri". A second click, or Esc, flips it back; the hidden face is inert, so
// keyboard and screen readers only reach the visible one. Under prefers-reduced-motion the faces fade instead of turning.
// Authoritative run metrics keep their sample sizes and unknown values: a missing value is shown as a dash with "Non
// disponibile" for screen readers and in its tooltip, never as zero. Styles: styles/agent-catalog.css (card) and
// styles/brain-model.css (flip).
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentMetrics, AgentProfile, AgentStanding } from '@shared/agents';
import { characterOf } from '@shared/characters';
import { characterTone } from '../lib/character-art';
import type { MemoryFile } from '@shared/brain-model';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { HelpTip } from './HelpTip';

type Value = { text: string | null; samples?: string };

function Metric({ label, full, value, unknown, help }: { label: string; full: string; value: Value; unknown: string; help?: ReactNode }) {
  const tip = [full, value.text ?? unknown, value.samples].filter(Boolean).join(' · ');
  return <div title={tip}>
    <dt>{label}{help}</dt>
    <dd>{value.text ?? <><span aria-hidden="true">—</span><span className="sr-only">{unknown}</span></>}</dd>
  </div>;
}

/** 0..1 → a band for the gauge's colour (the same cut-offs as agentsGrid.perfBand) */
const band = (v: number) => v >= 0.85 ? 'top' : v >= 0.7 ? 'good' : v >= 0.5 ? 'fair' : 'low';
const pct = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);

/** The level (with the way to the next one) and the performance gauge, each with its "?" formula. An agent with no
 *  ended run is a Lv 1 "Recluta" at 0 of 5; before agents:metrics answers both read as unknown. */
const NONE: AgentStanding = { runs: 0, level: 1, levelAt: 0, nextAt: 5, progress: 0, performance: null, evaluated: 0, minRuns: 5, sources: { human: 0, judge: 0, orchestrator: 0, self: 0 } };
function Standing({ id, standing: s }: { id: string; standing: AgentStanding | null }) {
  const left = s && s.nextAt !== null ? s.nextAt - s.runs : 0;
  const perf = s?.performance ?? null;
  const R = 22, C = 2 * Math.PI * R;
  const arc = perf !== null ? perf : s ? Math.min(1, s.evaluated / s.minRuns) : 0;
  return <div className="catalog-standing" data-testid={`catalog-standing-${id}`}>
    <section className="catalog-level" aria-label={t('agentsGrid.level')} data-testid={`catalog-level-${id}`} data-level={s?.level}>
      <h4>{t('agentsGrid.level')}
        <HelpTip title={t('agentsGrid.levelHelpTitle')} wide testid={`catalog-level-help-${id}`}>
          <p>{t('agentsGrid.levelHelp1')}</p><p>{t('agentsGrid.levelHelp2')}</p><p>{t('agentsGrid.levelHelp3')}</p>
          {s && <p className="catalog-help-now">{t('agentsGrid.levelHelpEx', { runs: s.runs, level: s.level, next: s.nextAt === null ? null : s.level + 1, left })}</p>}
        </HelpTip></h4>
      <p className="catalog-level-value">{s ? <><b>{t('agentsGrid.levelShort', { n: s.level })}</b> <span>{t('agentsGrid.levelTitle', { n: s.level })}</span></> : <span aria-hidden="true">—</span>}</p>
      <div className="catalog-level-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s ? Math.round(s.progress * 100) : undefined}
        aria-label={s && s.nextAt !== null ? t('agentsGrid.levelNext', { left, next: s.level + 1 }) : t('agentsGrid.levelTop')}>
        <i style={{ width: `${s ? Math.round(s.progress * 100) : 0}%` }} /></div>
      <small>{!s ? t('catalog.unknown') : s.runs === 0 ? t('agentsGrid.noRuns') : s.nextAt === null ? t('agentsGrid.levelTop') : t('agentsGrid.levelNext', { left, next: s.level + 1 })}</small>
    </section>
    <section className="catalog-perf" aria-label={t('agentsGrid.perf')} data-testid={`catalog-perf-${id}`} data-band={perf !== null ? band(perf) : 'warmup'}>
      <svg className="catalog-gauge" viewBox="0 0 56 56" aria-hidden="true">
        <circle className="track" cx="28" cy="28" r={R} />
        <circle className="fill" cx="28" cy="28" r={R} strokeDasharray={`${(arc * C).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 28 28)" />
      </svg>
      <div className="catalog-perf-text">
        <h4>{t('agentsGrid.perf')}
          <HelpTip title={t('agentsGrid.perfHelpTitle')} wide testid={`catalog-perf-help-${id}`}>
            <p>{t('agentsGrid.perfHelp1')}</p><p>{t('agentsGrid.perfHelp2')}</p><p>{t('agentsGrid.perfHelp3', { min: s?.minRuns ?? 5 })}</p>
            {s && s.evaluated > 0 && <p className="catalog-help-now">{t('agentsGrid.perfSources', s.sources)}</p>}
          </HelpTip></h4>
        <p className="catalog-perf-value">{perf !== null ? <><b>{pct(perf)}</b> <span>{t('agentsGrid.perfBand', { v: perf })}</span></>
          : s ? <span className="warmup">{t('agentsGrid.perfWarmup')}</span> : <span aria-hidden="true">—</span>}</p>
        <small>{!s ? t('catalog.unknown') : perf !== null ? t('agentsGrid.perfJudged', { n: s.evaluated }) : t('agentsGrid.perfWarmupCount', { n: s.evaluated, min: s.minRuns })}</small>
      </div>
    </section>
  </div>;
}

export function AgentCatalogCard({ profile, metrics, loaded, engine, lastStart, onOpen, onSkill, index = 0, memory = null }: {
  profile: AgentProfile; metrics?: AgentMetrics; loaded: boolean; engine: string; lastStart: number | null; onOpen: () => void;
  index?: number;
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
  const stats = metrics?.all, standing = loaded ? metrics?.standing ?? NONE : null;
  const ended = loaded ? stats?.ended ?? 0 : null;
  const open = loaded ? metrics?.open ?? 0 : null;
  const unknown = t('catalog.unknown');
  const rate = stats?.successRate, cost = stats?.costPerRun.median;
  const sample = (n: number) => loaded ? t('catalog.samples', { n, total: ended ?? 0 }) : unknown;
  const values: Record<'runs' | 'open' | 'success' | 'cost', Value> = {
    runs: { text: ended?.toLocaleString(locale()) ?? null },
    open: { text: open?.toLocaleString(locale()) ?? null },
    success: { text: rate?.value != null ? new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(rate.value) : null, samples: sample(rate?.n ?? 0) },
    cost: { text: cost?.value != null ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: cost.value < 0.1 ? 3 : 2 }).format(cost.value) : null, samples: sample(cost?.n ?? 0) },
  };
  const trial = !!profile.trial;
  const working = !trial && (open ?? 0) > 0;
  const state = trial ? 'trial' : working ? 'working' : 'active';
  const origin = t(profile.userLocked ? 'studio.customized' : 'studio.builtIn');
  const tier = t('studio.tierChip', { tier: t(`roles.tier.${profile.tier}`) });
  const skills = profile.skills;
  const last = lastStart === null ? unknown : new Date(lastStart).toLocaleString(locale());
  const prompt = profile.instructions.trim();
  return <article className="catalog-card bm-flip" data-testid={`catalog-card-${profile.id}`} data-state={state} data-flipped={flipped}
    style={{ '--row-index': Math.min(index, 8), '--tone': characterTone(characterOf(profile.id)) } as CSSProperties}>
    <div className="bm-flip-inner">
      <div className="bm-face bm-face-front" inert={flipped} aria-hidden={flipped || undefined} data-testid={`catalog-front-${profile.id}`}>
        <div className="catalog-front-top">
          <span className="catalog-origin">{origin}</span>
          <span className="catalog-badge" data-state={state}>
            <i aria-hidden="true" />{trial ? t('studio.trial') : working ? t('agentsGrid.working') : t('catalog.active')}</span>
        </div>
        <header className="catalog-hero">
          <span className="catalog-hero-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={104} />
            {standing && <span className="catalog-level-medal" aria-hidden="true">{t('agentsGrid.levelShort', { n: standing.level })}</span>}</span>
          <h3><button ref={front} type="button" onClick={() => flip(true)} aria-expanded={flipped} aria-controls={backId} aria-describedby={`${backId}-f`} data-testid={`catalog-flip-${profile.id}`}>{profile.name}</button></h3>
          <span id={`${backId}-f`} className="sr-only">{t('bm.card.flip', { name: profile.name })}</span>
          <p className="catalog-purpose" title={profile.purpose || undefined}>{profile.purpose}</p>
        </header>
        <div className="catalog-chips">
          <span className="catalog-chip" data-kind="engine">{engine}</span>
          <span className="catalog-chip" data-kind="model" title={profile.model ?? tier}>{profile.model ?? tier}</span>
          <span className="catalog-chip" data-kind="skills">{t('bm.map.agentSkills', { n: skills.length })}</span>
        </div>
        <Standing id={profile.id} standing={standing} />
        <dl className="catalog-stats">
          <Metric label={t('agentsGrid.runs')} full={t('catalog.runs')} value={values.runs} unknown={unknown} />
          <Metric label={t('agentsGrid.open')} full={t('catalog.open')} value={values.open} unknown={unknown} />
          <Metric label={t('agentsGrid.cost')} full={t('catalog.cost')} value={values.cost} unknown={unknown}
            help={<HelpTip label={t('catalog.cost')} testid={`catalog-cost-help-${profile.id}`}>{t('agentsGrid.costHelp')}</HelpTip>} />
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
          <div><dt>{t('catalog.engine')}</dt><dd>{engine} · {profile.model ?? tier}</dd></div>
          <div><dt>{t('agentDetail.version')}</dt><dd>{origin} · v{profile.activeVersion}</dd></div>
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
