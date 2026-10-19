// Pure view helpers of the Memoria page (MemoryStats from main, brainmodel/memory-stats.ts): the curious facts ("Lo
// sapevi?") picked from the numbers, the date chip split from a memory line, the short week labels of the charts, the
// tone of a skill verdict and the "is there anything at all" check behind the clean-install empty state. No React, no
// IPC, no texts (the page turns each fact id into Italian with i18n): unit-tested in test/unit/brain-ui/memory-view.test.ts.
import type { MemoryStats, SkillVerdict } from '@shared/brain-model';

export type FactId = 'repeat' | 'mostRecalled' | 'longest' | 'oldest' | 'unusedSkills' | 'bestSkill' | 'topWord' | 'weekday' | 'busiestDay' | 'silent' | 'duplicates' | 'errorsTrend';
export interface Fact { id: FactId; params: Record<string, string | number>; file?: string }

/** The facts worth a card, most telling first, at most `max`. Each one only when its numbers say something. */
export function memoryFacts(s: MemoryStats, max = 6): Fact[] {
  const out: Fact[] = [];
  const g = s.errors.groups[0];
  if (g && g.count >= 2) out.push({ id: 'repeat', params: { label: g.label, n: g.count, agents: g.agents.join(', ') }, file: 'ai-errors.md' });
  const r = s.topRecalled[0];
  if (r && r.recalls >= 2) out.push({ id: 'mostRecalled', params: { text: r.text, owner: r.owner, n: r.recalls }, file: r.file });
  const long = s.perAgent.find(a => a.exists);
  if (long && long.entries >= 2) out.push({ id: 'longest', params: { name: long.name, n: long.entries }, file: long.file });
  const unused = s.skills.filter(k => k.verdict === 'unused');
  if (unused.length) out.push({ id: 'unusedSkills', params: { n: unused.length, total: s.skills.length, names: unused.slice(0, 3).map(k => k.name).join(', ') } });
  const best = s.skills.filter(k => k.verdict === 'useful').sort((a, b) => b.uses - a.uses)[0];
  if (best) out.push({ id: 'bestSkill', params: { name: best.name, n: best.uses, pct: Math.round((best.success ?? 0) * 100) }, ...(best.rel ? { file: best.rel } : {}) });
  if (s.oldest?.date) out.push({ id: 'oldest', params: { date: s.oldest.date, owner: s.oldest.owner, text: s.oldest.text }, file: s.oldest.file });
  if (s.errors.total >= 4) {
    const max7 = Math.max(...s.errors.weekday), day = s.errors.weekday.indexOf(max7);
    if (max7 >= 2 && s.errors.weekday.filter(n => n === max7).length === 1) out.push({ id: 'weekday', params: { day, n: max7 } });
  }
  if (s.errors.topWord) out.push({ id: 'topWord', params: { word: s.errors.topWord.word, n: s.errors.topWord.n }, file: 'ai-errors.md' });
  if (s.errors.last30 + s.errors.prev30 >= 2) out.push({ id: 'errorsTrend', params: { now: s.errors.last30, before: s.errors.prev30 } });
  if (s.duplicates) out.push({ id: 'duplicates', params: { n: s.duplicates } });
  const silent = s.perAgent.filter(a => !a.exists);
  if (silent.length && silent.length < s.perAgent.length) out.push({ id: 'silent', params: { n: silent.length, names: silent.slice(0, 3).map(a => a.name).join(', ') } });
  if (s.busiestDay && s.busiestDay.n >= 3) out.push({ id: 'busiestDay', params: { date: s.busiestDay.date, n: s.busiestDay.n } });
  return out.slice(0, max);
}

/** A memory line as written ("2026-10-07 · text"): its date chip and the text after it. */
export function lineParts(line: string): { date: string | null; text: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2})?\s*(?:[·|:–-]\s*)?/.exec(line);
  return m ? { date: m[1]!, text: line.slice(m[0].length).trim() } : { date: null, text: line.trim() };
}

/** "2026-10-05" → "5 ott" (the locale's short day and month). */
export const shortDay = (d: string, locale: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export const verdictTone = (v: SkillVerdict): Tone => (v === 'useful' ? 'good' : v === 'weak' ? 'bad' : v === 'unused' || v === 'mixed' ? 'warn' : 'neutral');

/** Nothing written yet anywhere (a clean install): the page shows what will appear instead of empty charts. */
export const memoryEmpty = (s: MemoryStats | undefined): boolean => !s || (s.totals.entries === 0 && s.errors.total === 0 && s.totals.runs === 0);

/** Sum of a series. */
export const total = (v: number[]): number => v.reduce((a, b) => a + b, 0);

/** A brain-relative path as an absolute one under the brain root (the file viewer reads absolute paths in the real app
 *  and in the demo alike), with the root's own separator. */
export function brainFile(root: string | null, rel: string): string {
  if (!root) return rel;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}
