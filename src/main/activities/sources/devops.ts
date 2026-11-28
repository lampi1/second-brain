// «Attività pianificate» (ADR 0373): the DevOps reader. It reuses the Task page's zero-token read: the brain's (or the
// app's) devops-me.mjs run as a Node child (src/main/tasks/service.ts), asked only for the days since the activity's
// cursor, and turns its news (mentions, comments, reviews, changes on followed items) into ActivityItems. Never a model,
// never a write to DevOps. The script runner is injected (the integrator passes the same one the Task service uses), so
// the engine's tests use a fake. A failed run returns `error` in the user's words (az login expired, offline, ...), no retry.
// Used by service.ts through the integrator's wiring; tests: test/unit/activities-sources.test.ts.
import type { RunResult } from '../../brain/node';
import { errorOf, parseNewsRun, windowDays, type StoredNews } from '../../tasks/model';
import type { ActivityCursor, ActivityItem, ActivityReadResult, ActivitySourceReader } from '../../../shared/activities';

/** Runs `devops-me.mjs --json --days <n>` and gives its output; null = the script is not there (no brain, no app copy). */
export type DevopsRun = (days: number) => Promise<RunResult | null>;

/** One DevOps news as the filter and the triage see it: the person who did it is `from`, a mention is `mentionsMe`. */
export function itemOfNews(n: StoredNews): ActivityItem {
  const text = [n.detail, n.body].filter(Boolean).join(' · ');
  return { key: n.key, at: Date.parse(n.at), from: n.who ?? '', title: n.title, text, unread: true, mentionsMe: n.kind === 'mention', url: n.url };
}

export function devopsReader(run: DevopsRun): ActivitySourceReader {
  return {
    source: 'devops',
    async read(_activity, cursor: ActivityCursor, now: number): Promise<ActivityReadResult> {
      const r = await run(windowDays(cursor.at > 0 ? cursor.at : null, now));
      if (!r) return { items: [], error: 'manca lo script di lettura di DevOps (devops-me.mjs)' };
      if (r.code !== 0) { const e = errorOf(r, 'Lettura di DevOps'); return { items: [], error: e.command ? `${e.message} Comando: ${e.command}` : e.message }; }
      try { return { items: parseNewsRun(r.stdout).news.map(itemOfNews) }; }
      catch (e) { return { items: [], error: `risposta di DevOps non riconosciuta: ${e instanceof Error ? e.message : String(e)}` }; }
    },
  };
}
