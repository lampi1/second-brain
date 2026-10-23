// app_digest: the whole status the Orchestrator needs in ONE tool call, built from what the app already holds (zero tokens, no
// network): every open chat with its state, what it waits for (question text, permission, command's first line), its
// last line, git branch, long context; the chats closed and the commands the user ran; the user's PRs and unread Task
// news from the Task page's last read. `since` keeps only what changed (the waiting and failed chats always stay).
// Why: the owner, 2026-10-13, "tante piccole ottimizzazioni che non fanno perdere qualità ma non usano LLM quando
// possibile". Measured on the transcripts of 07-13/10: the Orchestrator read chats one by one 157 times a week (app_chat_items,
// ~470k tokens of context re-read per call) and a "stato" took ~11 tool calls (~1 $); this answers it in one call.
// Used by appctl/tools.ts (tool app_digest); pinned by test/unit/appctl-digest.test.ts.
import type { ChatSummary, TasksState, PendingRequest, RunInfo } from '../../shared/contract';
import { chatName } from '../../shared/orchestrator';
import { redact } from '../log';
import { engineLabel } from '../engines/registry';
import { uiLocale } from '../locale';
import { workRecap } from '../../shared/work-recap';

export interface DigestInput {
  chats: ChatSummary[];
  /** open questions/permissions plus the commands left for the user (app_pending's list) */
  pending: PendingRequest[];
  runs: RunInfo[];
  tasks: TasksState | null;
  now: number;
  /** only what changed since this time (ms); null = everything */
  since: number | null;
  /** the caller (an Orchestrator): left out of the list */
  selfId?: string;
  warnTokens: number;
  branch?: (cwd: string) => string | null;
}

const one = (s: string | undefined, n: number): string => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = (t: number): string => new Intl.DateTimeFormat(uiLocale(), { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
/** "3 min", "2 h", "ieri" */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} g`;
}
const engine = (c: ChatSummary) => engineLabel(c.harness);
const k = (n: number) => `${Math.round(n / 1000)}k`;

/** What an open request asks, in one line. */
export function askLine(r: PendingRequest): string {
  if (r.type === 'question') return `domanda «${one(r.questions?.map(q => q.question).join(' / ') || r.title, 220)}»`;
  if (r.type === 'command') return `comando da eseguire \`${one((r.command?.code ?? r.detail).split('\n')[0], 140)}\``;
  return `permesso «${one(r.title, 160)}»`;
}

const VOTES: Record<string, string> = { '10': 'approvata', '5': 'approvata con suggerimenti', '-5': 'chiede modifiche', '-10': 'rifiutata' };

/** One line per PR: name (the bug it fixes), build, votes that matter, QA failures; QA-blocked first. */
export function prLines(d: TasksState): string[] {
  const rows = workRecap(d).prs.map(({ pr: p, failed, blocked, missing, openBugs }) => {
    const bug = p.workItems.find(w => /bug/i.test(w.type)) ?? p.workItems[0];
    const name = one(bug?.title || p.title, 90);
    const qa = failed || blocked || missing || openBugs ? `QA: ${[failed && `${failed} test falliti`, blocked && `${blocked} bloccati`, missing && `${missing} da eseguire`, openBugs && `${openBugs} bug aperti`].filter(Boolean).join(', ')}` : '';
    const build = p.build ? `build ${p.build.result ?? p.build.status}` : '';
    const votes = p.reviewers.filter(r => r.vote !== 0).map(r => `${r.name.split(/\s+/)[0]} ${VOTES[String(r.vote)] ?? r.label}`).join(', ');
    const waiting = p.reviewers.filter(r => r.required && r.vote === 0).map(r => r.name.split(/\s+/)[0]);
    const parts = [qa, build, votes, waiting.length ? `aspetta ${waiting.join(', ')}` : '', p.draft ? 'bozza' : '', p.autoComplete ? 'auto-complete' : '', p.activeThreads ? `${p.activeThreads} discussioni aperte` : ''].filter(Boolean);
    return { qa: !!qa, text: `- ${name} (${p.repo} → ${p.target}): ${parts.join(' · ') || 'nessuna novità'} ${p.url}` };
  });
  return rows.sort((a, b) => Number(b.qa) - Number(a.qa)).map(r => r.text);
}

export function digest(inp: DigestInput): string {
  const { now, since } = inp;
  const open = inp.chats.filter(c => !c.closedAt && c.state !== 'closed' && c.id !== inp.selfId);
  const asks = new Map<string, PendingRequest[]>();
  for (const r of inp.pending) asks.set(r.chatId, [...(asks.get(r.chatId) ?? []), r]);
  const changed = (c: ChatSummary) => since === null || c.updatedAt >= since;
  const name = (c: ChatSummary) => `«${chatName(c)}» (${engine(c)}, ${c.id})`;
  const extra = (c: ChatSummary) => {
    const b = inp.branch?.(c.cwd);
    return [
      b ? `ramo ${b}` : '',
      c.contextTokens && c.contextTokens >= inp.warnTokens ? `contesto lungo ${k(c.contextTokens)}` : '',
      c.background ? `${c.background} attività in background` : '',
      c.continuedBy ? `continua in «${c.continuedBy.title}»` : '',
    ].filter(Boolean).join(' · ');
  };
  const line = (c: ChatSummary, head: string, last = true) => {
    const e = extra(c);
    const tail = last && c.lastText ? ` · ultima riga «${one(c.lastText, 240)}»` : '';
    return `- ${name(c)}: ${head}${e ? ` · ${e}` : ''}${tail}`;
  };

  const wait: string[] = [], err: string[] = [], run: string[] = [], done: string[] = [], same: string[] = [], orchestrators: string[] = [];
  // with since: a request or an error already told in an earlier digest is named only (the caller has its text; the
  // owner, 2026-10-20: the same text again in every wake was tokens for nothing); a call without since has it all
  const told: string[] = [];
  let toldWait = 0, toldErr = 0;
  for (const c of open) {
    const rs = asks.get(c.id) ?? [];
    if (c.isOrchestrator) { orchestrators.push(`${name(c)}: ${c.state}${rs.length ? `, ${rs.length} richieste aperte` : ''}`); continue; }
    if (rs.length) {
      for (const r of rs) if (since !== null && r.at < since) { told.push(`«${c.title}» (aspetta l'utente)`); toldWait++; } else wait.push(line(c, `aspetta l'utente da ${ago(now - r.at)}: ${askLine(r)}`, false));
      continue;
    }
    if (c.state === 'error') { if (since !== null && !changed(c)) { told.push(`«${c.title}» (errore)`); toldErr++; } else err.push(line(c, `ferma su un errore: ${one(c.lastError ?? c.lastText, 240)}`, false)); continue; }
    if (!changed(c)) { same.push(`«${c.title}»`); continue; }
    // waiting in the CPU queue (ADR 0036): no turn ran yet, so never "turno finito"
    if (c.queued) run.push(line(c, `in coda per il carico della macchina (posizione ${c.queued.position}, da ${ago(now - c.queued.since)})`, false));
    else if (c.state === 'running' || c.state === 'starting' || c.state === 'waiting') run.push(line(c, `al lavoro (aggiornata ${ago(now - c.updatedAt)} fa)`));
    else {
      const r = c.lastResult;
      const how = !r ? 'nessun turno ancora' : r.interrupted ? 'fermata dall\'utente' : r.isError ? 'turno finito con errore' : 'turno finito';
      done.push(line(c, `${how}${r ? ` ${ago(now - r.at)} fa` : ''}`));
    }
  }

  const from = since ?? now - 24 * 3600_000;
  const closed = inp.chats.filter(c => c.closedAt && c.closedAt >= from && c.id !== inp.selfId)
    .map(c => `- «${c.title}» chiusa ${ago(now - c.closedAt!)} fa (${c.closedBy === 'user' ? 'a mano' : 'da sola, finita'})${c.lastText ? ` · ultima riga «${one(c.lastText, 160)}»` : ''}`);
  const titleOf = (id: string) => inp.chats.find(c => c.id === id)?.title ?? id;
  const runs = inp.runs.filter(r => (r.endedAt ?? r.startedAt) >= (since ?? now - 2 * 3600_000))
    .map(r => `- «${titleOf(r.chatId)}»: \`${one(redact(r.code.split('\n')[0] ?? ''), 120)}\` ${r.state === 'running' ? 'in corso' : `${r.state}, uscita ${r.exitCode ?? '-'}`}`);

  const counts = [`${open.filter(c => !c.isOrchestrator).length} chat aperte`, wait.length + toldWait && `${wait.length + toldWait} richieste per l'utente`, err.length + toldErr && `${err.length + toldErr} in errore`, run.length && `${run.length} al lavoro`].filter(Boolean).join(', ');
  const out = [`Stato alle ${hhmm(now)}${since !== null ? ` (novità dalle ${hhmm(since)})` : ''}: ${counts}.`];
  const section = (title: string, rows: string[]) => { if (rows.length) out.push('', `${title}:`, ...rows); };
  section('Aspettano l\'utente (l\'app glielo mostra già: nello stato basta dire quale chat e su cosa)', wait);
  section('In errore', err);
  section('Al lavoro', run);
  section(since !== null ? 'Hanno finito il turno da allora' : 'Ferme a fine turno', done);
  if (told.length) out.push('', `Ancora come prima (dettagli in app_digest senza since): ${[...new Set(told)].join(', ')}.`);
  if (same.length) out.push('', `Invariate: ${same.join(', ')}.`);
  section(since !== null ? 'Chiuse da allora' : 'Chiuse nelle ultime 24 h', closed);
  section('Comandi eseguiti dall\'utente con Esegui', runs);
  if (orchestrators.length) section('Orchestrator', orchestrators);

  const d = inp.tasks;
  if (!d || !d.at) { if (since === null || d?.error) out.push('', `Task (Azure DevOps): non letti dall'app${d?.error ? ` (${one(d.error.message, 120)})` : ''}: usa devops-me.mjs.`); }
  else if (since !== null && d.at < since) out.push('', `PR dell'utente: invariate dall'ultima lettura (${d.prs.length}, Task letti alle ${hhmm(d.at)}).`);
  else {
    out.push('', `PR dell'utente (Task letti alle ${hhmm(d.at)}${now - d.at > 3600_000 ? `, ${ago(now - d.at)} fa` : ''}):`, ...(d.prs.length ? prLines(d) : ['- nessuna PR attiva']));
    const news = d.news.filter(n => n.unread && (since === null || Date.parse(n.at) >= since));
    if (news.length) out.push('', `Novità Task non lette (${news.length}):`, ...news.slice(0, 8).map(n => `- ${n.kind}${n.who ? ` · ${n.who.split(/\s+/)[0]}` : ''}: ${one(n.title, 90)}${n.detail ? ` — ${one(n.detail, 110)}` : ''} ${n.url}`));
    if (d.reviews.length) out.push(`Review che aspettano il suo voto: ${d.reviews.length}.`);
  }
  if (d?.error) out.push(`PR non aggiornate: ${one(d.error.message, 160)}. I dati mostrati restano l’ultima lettura riuscita.`);
  if (d?.at) {
    const recap = workRecap(d, now);
    out.push(`QA: ${recap.qaAt ? `ultima lettura riuscita ${new Date(recap.qaAt).toISOString()}` : 'data di lettura non disponibile'}${d.qaError ? `; lettura fallita: ${one(d.qaError, 160)}` : recap.qaFreshness === 'stale' ? '; dati oltre un’ora' : ''}.`);
    const unknown = recap.prs.filter(p => !p.qaKnown).length;
    if (unknown) out.push(`QA non disponibili per ${unknown} PR: assenza di errori non significa verifiche superate.`);
  }
  return out.join('\n');
}
