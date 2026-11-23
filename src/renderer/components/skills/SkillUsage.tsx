// How much each skill is used (owner 2026-11-23: «vedere chiaramente quelle più usate e meno usate»): the overview above
// the Skill page (most used, least used: a bar each, a click opens the skill, the head sorts the list), the meter on each
// row, and the usage line of the open skill. The counts are LibSkill.totalUses, from the runs' `tags.skills`
// (main/skills/library.ts info): only engines in USAGE_TRACKED_ENGINES record them, so a skill without uses says so.
// Used by SkillsPage.tsx and SkillDetail.tsx; styles/skill-library.css.
import { useMemo } from 'react';
import { USAGE_TRACKED_ENGINES, USAGE_UNTRACKED_ENGINES, type LibSkill } from '@shared/skill-library';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { sortSkills, type SortBy } from '../../lib/skill-sort';

const TOP = 5;
export const trackedNote = (): string => t('sl.usageNote', { on: USAGE_TRACKED_ENGINES.join(', '), off: USAGE_UNTRACKED_ENGINES.join(', ') });
export const usesText = (s: Pick<LibSkill, 'totalUses'>): string => (s.totalUses ? t('sl.uses', { n: s.totalUses }) : t('sl.noUses'));
const share = (n: number, max: number): string => `${n ? Math.max(5, Math.round((100 * n) / Math.max(1, max))) : 0}%`;

export function UsageMeter({ skill, max }: { skill: LibSkill; max: number }) {
  return <span className="sl-meter" title={trackedNote()}>
    <span className="sl-bar" aria-hidden><span style={{ inlineSize: share(skill.totalUses, max) }} /></span>
    <span className={skill.totalUses ? 'sl-uses' : 'sl-uses none'}>{usesText(skill)}</span>
  </span>;
}

function Board({ kind, list, max, sort, pick, roleName, onSort, onPick }: { kind: 'uses' | 'least'; list: LibSkill[]; max: number; sort: SortBy; pick: string | null; roleName: (id: string) => string; onSort: (s: SortBy) => void; onPick: (name: string) => void }) {
  const now = Date.now();
  return <section className="sl-board" data-kind={kind} aria-label={t(`sl.sort.${kind}`)} data-testid={`sl-board-${kind}`}>
    <button type="button" className="sl-board-head" aria-pressed={sort === kind} onClick={() => onSort(kind)} title={t('sl.board.sortTip')} data-testid={`sl-board-sort-${kind}`}>
      <span>{t(`sl.sort.${kind}`)}</span><span className="sl-board-go">{sort === kind ? t('sl.board.sorted') : t('sl.board.sort')}</span>
    </button>
    <ol>{list.map(s => <li key={s.name}>
      <button type="button" className="sl-board-row" aria-current={s.name === pick ? 'true' : undefined} data-origin={s.origin} onClick={() => onPick(s.name)} data-testid={`sl-${kind === 'uses' ? 'top' : 'least'}-${s.name}`}
        title={s.uses[0] ? t('sl.topTip', { name: s.name, n: s.totalUses, who: roleName(s.uses[0].role) }) : trackedNote()}>
        <span className="sl-board-dot" aria-hidden />
        <span className="sl-board-name">{s.name}</span>
        <span className="sl-bar" aria-hidden><span style={{ inlineSize: share(s.totalUses, max) }} /></span>
        <span className="sl-board-n">{s.totalUses}</span>
        <span className="sl-board-when">{s.lastUse ? ago(s.lastUse, now) : t('sl.noUses')}</span>
      </button></li>)}</ol>
  </section>;
}

export function UsageOverview({ skills, sort, pick, roleName, onSort, onPick }: { skills: LibSkill[]; sort: SortBy; pick: string | null; roleName: (id: string) => string; onSort: (s: SortBy) => void; onPick: (name: string) => void }) {
  const top = useMemo(() => sortSkills(skills.filter(s => s.totalUses > 0), 'uses').slice(0, TOP), [skills]);
  const least = useMemo(() => { const best = new Set(top.map(s => s.name)); return sortSkills(skills.filter(s => !best.has(s.name)), 'least').slice(0, TOP); }, [skills, top]);
  const max = Math.max(1, ...skills.map(s => s.totalUses));
  const board = { max, sort, pick, roleName, onSort, onPick };
  if (!top.length && !least.length) return null;
  return <div className="sl-overview" data-testid="sl-overview">
    {top.length > 0 && <Board kind="uses" list={top} {...board} />}
    {least.length > 0 && <Board kind="least" list={least} {...board} />}
    <p className="sl-usage-note" data-testid="sl-usage-note">{trackedNote()}</p>
  </div>;
}

/** The open skill's usage: how often, when last, by whom, and what is not counted. */
export function SkillUsageLine({ skill, max, roleName }: { skill: LibSkill; max: number; roleName: (id: string) => string }) {
  const now = Date.now();
  return <div className="sl-usage" data-testid="sl-usage-line">
    <span className="sl-usage-n">{skill.totalUses}</span>
    <span className="sl-usage-main">
      <span className="sl-bar" aria-hidden><span style={{ inlineSize: share(skill.totalUses, max) }} /></span>
      <span className="small">{skill.totalUses ? `${t('sl.uses', { n: skill.totalUses })}${skill.lastUse ? ` · ${t('sl.lastUse', { at: ago(skill.lastUse, now) })}` : ''}${skill.uses[0] ? ` · ${t('sl.mostBy', { who: roleName(skill.uses[0].role) })}` : ''}` : t('sl.noUses')}</span>
      <span className="small sl-muted">{trackedNote()}</span>
    </span>
  </div>;
}
