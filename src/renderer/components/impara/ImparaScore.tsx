// The overall score at the top of Impara's start (ADR 0204; owner, 2026-10-30, report «Impara v3» I6): a ring with the
// score 0-100 (shared/mastery.ts: memory today × solid share, so it falls without reviews) and its change this week,
// then four tiles: memory today, solid cards, days in a row, lessons finished. Nothing is shown before the first card.
// `ScoreRing` is also the end of a review session (ImparaReview.tsx); `MasteryBadge` is a subject's level on its tile
// (ImparaReviewHome.tsx), with the rule of each level in its tip. Styles impara-quiz.css (.sc-*).
import type { ImparaScore, MasteryLevel, SubjectMastery } from '@shared/mastery';
import { LEVEL_RULES, MASTERY_LEVELS, SOLID_DAYS } from '@shared/mastery';
import { t } from '../../i18n';
import '../../styles/impara-quiz.css';

export function ScoreRing({ value, size = 84, label, tone = 'accent', testid = 'impara-score-ring' }: { value: number; size?: number; label: string; tone?: 'accent' | 'good' | 'mid' | 'low'; testid?: string }) {
  const r = 42, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <svg className={`sc-ring ${tone}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label} data-testid={testid}>
      <circle cx="50" cy="50" r={r} className="sc-ring-bg" />
      <circle cx="50" cy="50" r={r} className="sc-ring-fg" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" className="sc-ring-v" dominantBaseline="central" textAnchor="middle">{label}</text>
    </svg>
  );
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function ImparaScoreBand({ score }: { score: ImparaScore }) {
  if (score.score === null) return null;
  const d = score.delta;
  return (
    <section className="sc-band" data-testid="impara-overall" aria-label={t('impara.score.title')}>
      <div className="sc-main">
        <ScoreRing value={score.score} label={String(score.score)} testid="impara-score-value" tone={score.score >= 80 ? 'good' : 'accent'} />
        <div className="sc-main-in">
          <div className="ip-kicker">{t('impara.score.title')}</div>
          <div className="sc-line">
            <b className="sc-title" data-testid="impara-score-band">{t(`impara.score.band.${score.score >= 90 ? 3 : score.score >= 70 ? 2 : score.score >= 40 ? 1 : 0}`)}</b>
            {d !== null && <span className={`sc-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`} data-testid="impara-score-delta">{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'} {t('impara.score.week')}</span>}
          </div>
          <p className="ip-muted sc-why" data-tip={t('impara.score.how', { days: SOLID_DAYS })}>{t('impara.score.lead')}</p>
        </div>
      </div>
      <div className="sc-tiles">
        <div className="sc-tile" data-tip={t('impara.rv.recallTip')}><b data-testid="impara-score-memory">{pct(score.memory)}</b><span>{t('impara.score.memory')}</span></div>
        <div className="sc-tile" data-tip={t('impara.score.solidTip', { days: SOLID_DAYS })}><b data-testid="impara-score-solid">{score.solid}<small>/{score.cards}</small></b><span>{t('impara.score.solid')}</span></div>
        <div className="sc-tile"><b>{score.streak}</b><span>{t('impara.score.streak')}</span></div>
        <div className="sc-tile"><b>{score.lessonsDone}</b><span>{t('impara.score.lessons')}</span></div>
      </div>
    </section>
  );
}

/** The rule of a level, in words, for its tip. */
export function levelRule(level: MasteryLevel): string {
  if (level === 'started') return t('impara.mastery.rule.started');
  const r = LEVEL_RULES[level];
  return t('impara.mastery.rule', { studied: Math.round(r.studied * 100), solid: Math.round(r.solid * 100), memory: Math.round(r.memory * 100) });
}

/** A subject's level: its name and four steps lit up to it (Khan Academy's mastery levels). */
export function MasteryBadge({ m }: { m: SubjectMastery }) {
  const k = MASTERY_LEVELS.indexOf(m.level);
  const tip = `${t(`impara.mastery.${m.level}`)}: ${levelRule(m.level)}|${t('impara.mastery.now', { studied: m.studied, cards: m.cards, solid: m.solid, memory: m.memory === null ? '—' : `${Math.round(m.memory * 100)}%` })}`;
  return (
    <span className={`sc-level l${k}`} data-tip={tip} data-testid="impara-subject-level" data-level={m.level}>
      <span className="sc-steps" aria-hidden="true">{MASTERY_LEVELS.map((_, i) => <i key={i} className={i <= k ? 'on' : ''} />)}</span>
      {t(`impara.mastery.${m.level}`)}
    </span>
  );
}
