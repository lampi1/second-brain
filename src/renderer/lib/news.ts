// The «Giornale» in the renderer (ADR 0265, editions ADR 0280): main's paper (news:changed keeps it current), its
// actions (each a news:* call, a failure said in a toast), which stories a view of an edition lists (the front page
// holds a few, the rest wait under «Altre»), the request to the Orchestrator for a new edition (it looks for the
// sources, tries them and builds it) and «Impara», which starts an Impara lesson on a story (a topic lesson whose ask
// holds the title, the summary and the primary link: its web research reads the source) and remembers it on the
// story. Which edition, section and story are open is the page's own state; the last edition and section are
// remembered (localStorage, a convenience). Used by components/impara/news/.
import { frontPage, type NewsEdition, type NewsEditionEdit, type NewsItem, type NewsSchedule, type NewsSourceEdit, type NewsSourceTest, type NewsState } from '@shared/news';
import { now } from './clock';
import { orchestratorId } from '../actions';
import { send } from '../store/store';
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

export async function refreshNews(edition?: string): Promise<void> {
  try {
    const r = await window.sb.invoke('news:refresh', edition ? { edition } : undefined);
    const tokens = r.tokens === null ? t('news.tokensUnknown') : t('news.tokensN', { n: r.tokens.toLocaleString() });
    toast(t('news.refreshed', { fresh: r.fresh, merged: r.merged, failed: r.failed, tokens }), r.failed || r.aiError ? 'warn' : 'ok');
  } catch (e) { fail(e); }
}
export const markNews = (id: string, m: { read?: boolean; saved?: boolean; lesson?: string; less?: boolean }) => put(window.sb.invoke('news:mark', { id, ...m }));
export const editSources = (e: NewsSourceEdit) => put(window.sb.invoke('news:sources', e));
export const editEdition = (e: NewsEditionEdit) => put(window.sb.invoke('news:edition', e));
export const setSchedule = (s: Partial<NewsSchedule>) => put(window.sb.invoke('news:schedule', s));
export const testSource = (url: string): Promise<NewsSourceTest | null> => window.sb.invoke('news:test', { url }).catch(fail);

/** «Meno così»: the story leaves the paper and its source weighs a little less; the toast undoes it. */
export async function lessLikeThis(it: NewsItem): Promise<void> {
  if (await markNews(it.id, { less: true })) toast(t('news.lessDone', { source: it.sourceName }), 'info', { label: t('news.undo'), run: () => void markNews(it.id, { less: false }) });
}

/** A new edition through the Orchestrator: it looks for the best sources, tries each one, builds the edition with its
 *  sections and key words and says which sources it left out. False when there is no Orchestrator to ask. */
export function askEdition(name: string, interest: string): boolean {
  const r = orchestratorId();
  if (!r) return false;
  return send(r, t('news.new.ask', { name: name.trim(), interest: interest.trim() })) !== 'empty';
}

/** «Spiegamelo»: a lesson on the story, started now (the click is the ask), or the one already made. */
export async function explainStory(it: NewsItem, subject: string): Promise<string | null> {
  if (it.lesson) return it.lesson;
  const p = imparaPrefs.get();
  const ask = [t('news.explainAsk', { title: it.title }), it.summary ?? it.snippet, t('news.explainSource', { url: it.url })].filter(Boolean).join('\n\n');
  const l = await startLesson({ kind: 'topic', ask, depth: p.depth, level: p.level, mode: p.mode, subject: subject.slice(0, 40), ...(p.teacher ? { teacher: p.teacher } : {}) });
  if (!l) return null;
  void markNews(it.id, { lesson: l.id, read: true });
  return l.id;
}

/** A view of an edition: its front page, one of its sections (the section's id), or the saved stories. */
export type NewsView = string;
export const FRONT = 'front', SAVED = 'saved';
const VIEW_KEY = 'sb.news.view', EDITION_KEY = 'sb.news.edition';
const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* a convenience only */ } };
export const lastView = (): NewsView => recall(VIEW_KEY) ?? FRONT;
export const rememberView = (v: NewsView): void => remember(VIEW_KEY, v);
export const lastEdition = (): string | null => recall(EDITION_KEY);
export const rememberEdition = (id: string): void => remember(EDITION_KEY, id);

/** The views an edition offers, in order: the front page, its sections, the saved stories. */
export const viewsOf = (ed: NewsEdition | undefined): NewsView[] => [FRONT, ...(ed?.sections.map(s => s.id) ?? []), SAVED];

/** The stories a view lists. The front page: the edition's few best (`front`, the first opens the page) and the rest
 *  of the last days (`more`, shown on request); a section its own stories; «Salvate» the saved ones. A story the user
 *  dismissed («meno così») is in no list. */
export function storiesOf(state: NewsState | null, ed: NewsEdition | undefined, view: NewsView, at = now()): { list: NewsItem[]; more: NewsItem[] } {
  if (!ed) return { list: [], more: [] };
  const all = (state?.items ?? []).filter(i => i.edition === ed.id && !i.less);
  if (view === SAVED) return { list: all.filter(i => i.saved), more: [] };
  if (view === FRONT) { const f = frontPage(all, ed.cap, at); return { list: f.front, more: f.more }; }
  return { list: all.filter(i => i.section === view), more: [] };
}
