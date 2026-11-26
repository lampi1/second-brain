// The skills a chat used, as small chips on its Grindhouse card (owner, 2026-11-23: «le skill usate le voglio vedere a
// colpo d'occhio»). Claude reports them as a tool (run.tags.skills); every other engine only shows the ones it opened by
// reading a SKILL.md (main/agents/runs.ts skillOfRead); an engine with none recorded says «uso non tracciato» rather
// than hiding the gap. Used by ChatTile.tsx; the rule of what shows is the pure skillChipsOf.
import type { ChatSummary } from '@shared/contract';
import { t } from '../i18n';

/** Chips shown before «+N». */
export const CHIPS_MAX = 3;

/** What the card says about a chat's skills: the names (at most CHIPS_MAX, `more` = the rest) or `untracked` for a
 *  non-Claude run with none recorded; nothing for a chat that is no run, or a Claude run with no skill. */
export function skillChipsOf(chat: Pick<ChatSummary, 'harness' | 'run' | 'loadedSkills'>): { names: string[]; more: number; untracked: boolean } | null {
  if (!chat.run) return null;
  const all = chat.run.tags?.skills ?? [];
  if (all.length) return { names: all.slice(0, CHIPS_MAX), more: Math.max(0, all.length - CHIPS_MAX), untracked: false };
  if (chat.harness === 'claude') return null;
  // the engine tells nothing about the skills it used: the ones its role loaded, marked as not tracked (room for two beside the mark)
  const loaded = chat.loadedSkills ?? [];
  return { names: loaded.slice(0, 2), more: Math.max(0, loaded.length - 2), untracked: true };
}

export function SkillChips({ chat }: { chat: ChatSummary }) {
  const c = skillChipsOf(chat);
  if (!c) return null;
  const all = c.untracked ? (chat.loadedSkills ?? []) : (chat.run?.tags?.skills ?? []);
  const count = all.length;
  const tip = c.untracked
    ? `${t('skills.untrackedTip')}${count ? `: ${all.join(', ')}` : ''}`
    : all.join(', ');
  return (
    <span className={`bench-skills-badge${c.untracked ? ' untracked' : ''}`} data-testid={`skill-chips-${chat.id}`} data-tip={tip} aria-label={tip}>
      ⚡ {count > 0 ? count : '·'}
    </span>
  );
}
