// Impara «News» in the renderer (ADR 0264): main's paper (news:changed keeps it current), its actions (each a news:*
// call, a failure said in a toast) and «Spiegamelo», which starts an Impara lesson on a story (a topic lesson whose
// ask holds the title, the summary and the primary link: its web research reads the source) and remembers it on the
// story. Which section and story are open is the page's own state; the last section is remembered (localStorage, a
// convenience). Used by components/impara/news/.
import type { NewsItem, NewsSchedule, NewsSection, NewsSourceEdit, NewsState } from '@shared/news';
import { createStore } from '../store/createStore';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { errText, imparaPrefs, startLesson } from './impara';

export const news = createStore<{ state: NewsState | null }>({ state: null });

let wired = false;
export function startNews(): void {
  if (wired || typeof window === 'undefined' || !window.sb) return;
  wired = true;
  window.sb.on('news:changed', state => news.set(() => ({ state })));
  void window.sb.invoke('news:state', undefined).then(state => news.set(s => ({ state: s.state ?? state })), () => {});
}

const fail = (e: unknown) => { toast(errText(e), 'err'); return null; };
const put = (p: Promise<NewsState>) => p.then(state => { news.set(() => ({ state })); return state; }, fail);

export async function refreshNews(): Promise<void> {
  try {
    const r = await window.sb.invoke('news:refresh', undefined);
    const tokens = r.tokens === null ? t('news.tokensUnknown') : t('news.tokensN', { n: r.tokens.toLocaleString() });
    toast(t('news.refreshed', { fresh: r.fresh, merged: r.merged, failed: r.failed, tokens }), r.failed || r.aiError ? 'warn' : 'ok');
  } catch (e) { fail(e); }
}
export const markNews = (id: string, m: { read?: boolean; saved?: boolean; lesson?: string }) => put(window.sb.invoke('news:mark', { id, ...m }));
export const editSources = (e: NewsSourceEdit) => put(window.sb.invoke('news:sources', e));
export const setSchedule = (s: Partial<NewsSchedule>) => put(window.sb.invoke('news:schedule', s));

/** «Spiegamelo»: a lesson on the story, started now (the click is the ask), or the one already made. */
export async function explainStory(it: NewsItem): Promise<string | null> {
  if (it.lesson) return it.lesson;
  const p = imparaPrefs.get();
  const ask = [t('news.explainAsk', { title: it.title }), it.summary ?? it.snippet, t('news.explainSource', { url: it.url })].filter(Boolean).join('\n\n');
  const l = await startLesson({ kind: 'topic', ask, depth: p.depth, level: p.level, mode: p.mode, subject: t('news.subject'), ...(p.teacher ? { teacher: p.teacher } : {}) });
  if (!l) return null;
  void markNews(it.id, { lesson: l.id, read: true });
  return l.id;
}

/** The section the paper opened on last («front» = the first page), remembered on this PC only. */
export type NewsView = 'front' | NewsSection | 'prs' | 'saved';
const VIEW_KEY = 'sb.news.view';
export function lastView(): NewsView {
  try { const v = localStorage.getItem(VIEW_KEY); return (['front', 'models', 'harness', 'skills', 'research', 'prs', 'saved'] as string[]).includes(v ?? '') ? v as NewsView : 'front'; } catch { return 'front'; }
}
export function rememberView(v: NewsView): void { try { localStorage.setItem(VIEW_KEY, v); } catch { /* a convenience only */ } }

/** The stories a view lists: the first page is the best of every section (most important first), a section its own,
 *  «Salvate» the saved ones. */
export function storiesOf(state: NewsState | null, view: NewsView): NewsItem[] {
  const all = state?.items ?? [];
  if (view === 'saved') return all.filter(i => i.saved);
  if (view === 'front') return all.slice(0, 40);
  if (view === 'prs') return [];
  return all.filter(i => i.section === view);
}
