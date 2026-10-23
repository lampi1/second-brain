// Brain maintenance implementations and review-backed writes (ADR 0077, 0083, 0137). The live dispatcher only
// runs structural migration, explicitly approved corrections and non-loadable repeated-task candidates. Semantic
// skill/memory merge helpers are retained for compatibility but cannot run from a timer or generic maintenance click.
// Every approved mutation is logged with undo; permissions, settings and tools remain outside these helpers.
//   migration      re-runnable, idempotent: every runbook / routines section of the brain becomes a skill in
//                  <brain>/.claude/skills (a role loads it when a task asks for it: skills_suggest). Writes a report.
//   corrections    the lessons queue (agent_learn_propose): each lesson goes to the role's text (default), to a skill,
//                  or to the brain's rules (rules/lessons.md, a topic file listed in brain.json), only after explicit
//                  approval of the evidence-backed proposal. Recurring error text is not applied on its own.
//   repeated-task  three or more ended runs with the same kind of goal and no skill covering it → a new skill with the
//                  requests seen and what the runs reported, stored outside loadable skills pending verification.
//   merge-skills   two brain skills with (nearly) the same text → one, the roles relinked to it.
//   merge-memory   the memory tidy-up (memory-tidy.ts, ADR 0129): near-duplicate facts merged, case-specific ones
//                  rewritten as the reusable rule behind them or dropped; no promotion across scopes.
// Used by brainmodel/service.ts; unit tests: test/unit/brainmodel/jobs.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import { verifiedVerdict } from '../../shared/run-verdict';
import { ORCHESTRATOR_AGENT_ID } from '../../shared/agents';
import type { LearnedRuleProposal } from '../../shared/agent-pack';
import type { BrainSkill, MaintenanceJobId, MigrationItem, MigrationReport } from '../../shared/brain-model';
import { conceptOf } from '../../shared/work-concepts';
import { NAME_RE, parseMd, setBody, yamlValue } from '../../shared/skillmd';
import type { AgentSnapshot, ChangeLog } from './changes';
import { procedureSections, sectionText } from './procedure-sources';
import { readSmall } from './model';
import { checkPermissionText } from '../agents/tool-policy';
import { changeText } from './change-text';
import type { UpgradeAsk } from './upgrade';
import { tidyMemoryJob } from './memory-tidy';

/** The role side of a job: only the role text and the declared skills. */
export interface AgentWriter {
  update(id: string, patch: { instructions?: string; linked?: string[] }, reason: string): AgentSnapshot | null;
}
export interface JobContext {
  root: string;
  /** where new skills go: <brain>/.claude/skills */
  skillDir: string;
  skills(): BrainSkill[];
  profiles(): AgentProfile[];
  runs(): AgentRun[];
  lessons: { pending(): LearnedRuleProposal[]; settle(id: string, status: 'approved' | 'discarded', note: string): void };
  agents: AgentWriter;
  log: ChangeLog;
  now(): number;
  /** a one-shot question to an engine with no tools (the upgrade job's): the memory tidy-up generalizes with it */
  ask?: UpgradeAsk;
}
export interface JobResult { job: MaintenanceJobId; changes: number; note?: string; report?: MigrationReport }

// ── text helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(['della', 'delle', 'dello', 'degli', 'dalla', 'dalle', 'nella', 'nelle', 'sulla', 'sulle', 'questo', 'questa', 'quello', 'quella',
  'come', 'cosa', 'dove', 'quando', 'perche', 'anche', 'sono', 'essere', 'fare', 'fammi', 'puoi', 'please', 'with', 'from', 'that', 'this', 'what',
  'when', 'where', 'into', 'about', 'your', 'their', 'have', 'there', 'oggi', 'adesso', 'subito', 'tutti', 'tutte', 'ogni', 'altro', 'altra',
  'dopo', 'prima', 'poi', 'molto', 'solo', 'just', 'some', 'more', 'than', 'then', 'them', 'they', 'will', 'would', 'could', 'should', 'grazie']);
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Content tokens: words of four letters or more (no stopwords), plus the work concept each one names. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text).match(/[a-z0-9]{4,}/g) ?? []) {
    if (STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
    const c = conceptOf(w);
    if (c) out.add(`~${c}`);
  }
  return out;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}
// words that carry no topic in a heading: left out of a generated name (#159: half sentences matched every request)
const NAME_FILLERS = new Set('il lo la i gli le un uno una di a da in con su per tra fra del della dei delle al alla ai e ed o che come non solo quando dove the an of to on at for with by from and or how when only'.split(' '));
/** A skill name from a title: a short one whole, a long one by its key words (fillers left out), in lower case with single hyphens, whole words up to
 *  40 characters (the full heading stays in the skill's text), never empty. */
export function skillName(title: string, taken: Set<string>): string {
  const all = fold(title).split(/[^a-z0-9]+/).filter(Boolean), keys = all.join('-').length <= 40 ? all : all.filter(w => !NAME_FILLERS.has(w));
  let base = '';
  for (const w of keys.length ? keys : all) { const next = base ? `${base}-${w}` : w; if (next.length > 40) break; base = next; }
  base = base || (keys[0] ?? all[0] ?? '').slice(0, 40) || 'skill';
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 44)}-${n}`;
  if (!NAME_RE.test(name)) throw new Error('Invalid generated skill name');
  return name;
}
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const oneLine = (s: string, n = 200) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export function skillText(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${yamlValue(oneLine(description, 1000))}\n---\n\n${body.trim()}\n`;
}
/** Appends `line` under the `## heading` of a markdown text (the section is added at the end when missing). */
export function appendUnder(text: string, heading: string, line: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const at = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (at < 0) return `${lines.join('\n')}\n\n## ${heading}\n\n${line}\n`;
  let end = at + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
  while (end > at + 1 && !lines[end - 1]!.trim()) end--;
  lines.splice(end, 0, line);
  return `${lines.join('\n')}\n`;
}
/** Changes this job already made to a target that the user undid: never made again (their undo is the decision). */
const undone = (log: ChangeLog, job: MaintenanceJobId, target: string): boolean => log.all().some(c => c.job === job && c.target === target && !!c.rolledBackAt);
const brainRel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

// ── migration ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function migrate(ctx: JobContext): JobResult {
  const sections = procedureSections(ctx.root);
  const existing = ctx.skills();
  const taken = new Set(existing.map(s => s.name));
  const items: MigrationItem[] = [];
  let changes = 0;
  for (const s of sections) {
    const source = `${s.file}#${s.line}`;
    const marker = `Spostata qui da \`${s.file}\` (sezione «${s.title}», riga ${s.line})`;
    const already = existing.find(k => (readSmall(k.file) ?? '').includes(marker));
    if (already) { items.push({ source, title: s.title, skill: already.name, status: 'existing' }); continue; }
    const body = sectionText(ctx.root, s);
    if (!body || !body.text.trim()) { items.push({ source, title: s.title, skill: null, status: 'skipped', note: 'sezione vuota o file non leggibile' }); continue; }
    const name = skillName(s.title, taken);
    if (undone(ctx.log, 'migration', name)) { items.push({ source, title: s.title, skill: null, status: 'skipped', note: 'annullata da te: non la rifaccio' }); continue; }
    taken.add(name);
    const description = `${s.purpose || s.title}${s.area && s.area !== s.title ? ` (${s.area})` : ''}`;
    const text = skillText(name, description, [`# ${s.title}`, '', body.text, '',
      `${marker} il ${day(ctx.now())}.${body.masked ? ` ${body.masked} righe con possibili credenziali sono nascoste qui: il testo intero resta nel file originale.` : ''}`].join('\n'));
    const file = path.join(ctx.skillDir, name, 'SKILL.md');
    const c = ctx.log.apply({ job: 'migration', kind: 'skill', action: 'create', target: name, summary: changeText().newSkill({ name, file: s.file, title: s.title }), reason: 'Le procedure diventano skill: il contenuto è lo stesso, ora un ruolo la carica quando il compito la chiede (skills_suggest).', evidence: [source] }, [{ file, text }]);
    if (c) changes++;
    items.push({ source, title: s.title, skill: name, status: 'moved', ...(body.masked ? { note: `${body.masked} righe nascoste (credenziali)` } : {}) });
  }
  return { job: 'migration', changes, report: { at: ctx.now(), items } };
}

// ── corrections ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const LESSONS_RULE = 'rules/lessons.md';
export const LESSONS_WHEN = '---\nwhen: {"prompt":[],"tools":["Edit","Write","MultiEdit","Bash","PowerShell"],"paths":[]}\n---\n# Lezioni dalle correzioni\n\nRegole emerse dalle correzioni dell’utente, per ogni ruolo.\n';
export function corrections(ctx: JobContext): JobResult {
  let changes = 0;
  for (const l of ctx.lessons.pending()) {
    const p = ctx.profiles().find(x => x.id === l.agentId);
    if (!p) { ctx.lessons.settle(l.id, 'discarded', 'ruolo sconosciuto'); continue; }
    if (l.fromChat || l.userApproved !== true || l.assessment?.state !== 'supported') continue; // exact evidence is rechecked by learning.pending()
    try { checkPermissionText(l.rule); } catch { ctx.lessons.settle(l.id, 'discarded', 'una lezione non concede permessi'); continue; }
    const line = `- ${l.rule} (${day(l.createdAt)}; ${l.evidence})`;
    const skill = l.target === 'skill' ? ctx.skills().find(s => s.name === l.skill && s.home === 'brain') : undefined;
    try {
      if (l.target === 'skill' && skill) {
        const text = readSmall(skill.file);
        if (text === null) throw new Error('skill non leggibile');
        const p2 = parseMd(text);
        const next = setBody(text, appendUnder(p2.body, 'Lezioni', line));
        if (ctx.log.apply({ job: 'corrections', kind: 'skill', action: 'update', target: skill.name, summary: changeText().lesson({ skill: skill.name, rule: oneLine(l.rule, 120) }), reason: `Correzione dell’utente (${p.name}).`, evidence: [l.evidence] }, [{ file: skill.file, text: next }])) changes++;
        ctx.lessons.settle(l.id, 'approved', `skill ${skill.name}`);
      } else if (l.target === 'rule') {
        const file = path.join(ctx.root, LESSONS_RULE);
        const current = readSmall(file) ?? LESSONS_WHEN;
        const writes = [{ file, text: appendUnder(current, p.name, line) }];
        const cfg = brainJsonWithTopic(ctx.root, LESSONS_RULE);
        if (cfg) writes.push(cfg);
        if (ctx.log.apply({ job: 'corrections', kind: 'rule', action: 'update', target: LESSONS_RULE, summary: changeText().newRule({ rule: oneLine(l.rule, 120) }), reason: `Correzione dell’utente (${p.name}); vale per ogni ruolo.`, evidence: [l.evidence] }, writes)) changes++;
        ctx.lessons.settle(l.id, 'approved', `regola in ${LESSONS_RULE}`);
      } else {
        const instructions = appendUnder(p.instructions, 'Lezioni dalle correzioni', line);
        if (instructions.length > 8000) { ctx.lessons.settle(l.id, 'discarded', 'il ruolo è al limite di 8000 caratteri: unisci le lezioni'); continue; }
        const snap = ctx.agents.update(p.id, { instructions }, `Manutenzione: lezione dalle correzioni (${oneLine(l.evidence, 100)})`);
        if (snap) { changes++; ctx.log.record({ job: 'corrections', kind: 'agent', action: 'update', target: p.id, summary: `${p.name}: ${oneLine(l.rule, 140)}`, reason: 'Correzione dell’utente: la lezione va nel testo del ruolo.', evidence: [l.evidence] }, [], snap); }
        ctx.lessons.settle(l.id, 'approved', l.target === 'skill' ? 'skill non trovata: nel ruolo' : 'ruolo');
      }
    } catch (e) { if (!/trial|prova/i.test((e as Error).message)) ctx.lessons.settle(l.id, 'discarded', oneLine((e as Error).message, 200)); }
  }
  return { job: 'corrections', changes };
}
/** brain.json with `rel` added to rules.topicFiles (null when it is there already or brain.json is not readable). */
export function brainJsonWithTopic(root: string, rel: string): { file: string; text: string } | null {
  const file = path.join(root, 'brain.json');
  try {
    const raw = readSmall(file);
    const cfg = raw ? JSON.parse(raw) as { rules?: { topicFiles?: string[] } } : {};
    const rules = cfg.rules ?? {}, list = Array.isArray(rules.topicFiles) ? rules.topicFiles : [];
    if (list.includes(rel)) return null;
    return { file, text: `${JSON.stringify({ ...cfg, rules: { ...rules, topicFiles: [...list, rel] } }, null, 2)}\n` };
  } catch { return null; }
}

// ── repeated task → new skill ───────────────────────────────────────────────────────────────────────────────────────
const REPEAT_MIN = 3, REPEAT_SIM = 0.4, REPEAT_DAYS = 60;
export function repeatedTask(ctx: JobContext): JobResult {
  const since = ctx.now() - REPEAT_DAYS * 86400e3;
  const scopePath = (value: string): string => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const brainRoot = scopePath(ctx.root);
  const runs = ctx.runs().filter(r => r.scope && scopePath(r.scope.brainRoot) === brainRoot && r.endedAt && r.startedAt >= since && r.goal.trim().length >= 12 && r.agentId !== ORCHESTRATOR_AGENT_ID);
  const groups: { toks: Set<string>; runs: AgentRun[]; scope: string }[] = [];
  for (const r of runs) {
    const t = tokens(r.goal);
    if (t.size < 2) continue;
    const scope = JSON.stringify([brainRoot, scopePath(r.scope!.projectRoot), r.tags?.app ?? null]);
    const g = groups.find(x => x.scope === scope && jaccard(x.toks, t) >= REPEAT_SIM);
    if (g) { g.runs.push(r); for (const x of t) g.toks.add(x); } else groups.push({ toks: t, runs: [r], scope });
  }
  const skills = ctx.skills(), taken = new Set(skills.map(s => s.name));
  let changes = 0;
  for (const g of groups) {
    const distinctTasks = new Map<string, AgentRun>();
    for (const r of g.runs) { const key = r.taskId ?? `chat:${r.chatId}`, prior = distinctTasks.get(key); if (!prior || r.startedAt > prior.startedAt) distinctTasks.set(key, r); }
    if (distinctTasks.size < REPEAT_MIN) continue;
    // Follow-ups and rework share their task identity; they never inflate repetition or word frequencies.
    g.runs = [...distinctTasks.values()];
    const chats = new Set(g.runs.map(r => r.chatId));
    // the words most runs share: the job's name and its "when to use"
    const counts = new Map<string, number>();
    for (const r of g.runs) for (const t of tokens(r.goal)) if (!t.startsWith('~')) counts.set(t, (counts.get(t) ?? 0) + 1);
    const common = [...counts].filter(([, n]) => n >= Math.ceil(g.runs.length / 2)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
    if (common.length < 1) continue;
    const key = tokens(common.join(' '));
    if (skills.some(s => jaccard(tokens(`${s.name.replace(/-/g, ' ')} ${s.description}`), key) >= 0.5)) continue;
    const name = skillName(common.slice(0, 3).join(' '), taken);
    if (undone(ctx.log, 'repeated-task', name) || ctx.log.all().some(c => c.job === 'repeated-task' && c.target === name)) continue;
    taken.add(name);
    const first = g.runs.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b)), last = g.runs.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
    const good = g.runs.filter(r => r.report?.canonical && verifiedVerdict(r, [], ctx.now())?.verdict === 'success');
    const body = [`# ${oneLine(last.goal, 90)}`, '',
      `Quando usarla: richieste come queste, viste ${g.runs.length} volte dal ${day(first.startedAt)} al ${day(last.startedAt)}.`, '',
      ...g.runs.slice(-6).map(r => `- ${oneLine(r.goal, 160)}`), '',
      '## Esempi verificati indipendentemente', '',
      ...(good.length ? good.slice(-5).map(r => `- ${day(r.startedAt)}: ${oneLine(r.report ? r.report.summary : '', 220)}`) : ['- Nessun esempio verificato indipendentemente: il solo resoconto non prova la riuscita.']), '',
      '## Passi', '', 'Documentare qui i passi concreti: le richieste ripetute non descrivono una procedura.', '',
      '## Candidata non verificata', '', 'Non eseguire automaticamente. Prima di promuoverla: documentare passi concreti, un esempio verificato indipendentemente e un replay riuscito con evidenze.', ''].join('\n');
    const file = path.join(ctx.root, 'memory', 'skill-candidates', `${name}.md`);
    const c = ctx.log.apply({ job: 'repeated-task', kind: 'skill', action: 'create', target: name, summary: changeText().candidate({ name, n: g.runs.length }), reason: `${distinctTasks.size} incarichi distinti in ${chats.size} chat nello stesso progetto: candidata in attesa di verifica indipendente e replay, non caricabile come skill.`, evidence: g.runs.slice(-6).map(r => r.runId) },
      [{ file, text: skillText(name, `Come fare: ${oneLine(last.goal, 160)}`, body) }]);
    if (!c) continue;
    changes++;
  }
  return { job: 'repeated-task', changes };
}
function linkTo(ctx: JobContext, p: AgentProfile, name: string, job: MaintenanceJobId, reason: string, drop?: string): boolean {
  const linked = [...new Set([...(p.knowhow?.linked ?? []).filter(n => n !== drop), name])];
  try {
    const snap = ctx.agents.update(p.id, { linked }, `Manutenzione: usa la skill ${name}`);
    if (!snap) return false;
    ctx.log.record({ job, kind: 'agent', action: 'link', target: p.id, summary: changeText().link({ agent: p.name, name, ...(drop ? { drop } : {}) }), reason, evidence: [name] }, [], snap);
    return true;
  } catch { return false; }
}

// ── merge duplicate skills ──────────────────────────────────────────────────────────────────────────────────────────
const MERGE_SIM = 0.8;
export function mergeSkills(ctx: JobContext): JobResult {
  const skills = ctx.skills().filter(s => s.home === 'brain');
  const text = new Map(skills.map(s => [s.name, readSmall(s.file) ?? '']));
  const gone = new Set<string>();
  let changes = 0;
  for (const a of skills) for (const b of skills) {
    if (a.name >= b.name || gone.has(a.name) || gone.has(b.name)) continue;
    const ta = text.get(a.name)!, tb = text.get(b.name)!;
    if (!ta || !tb || jaccard(tokens(parseMd(ta).body), tokens(parseMd(tb).body)) < MERGE_SIM) continue;
    // keep the one more agents use (then the older one); merge only a lone SKILL.md (other files: left to the user)
    const [keep, drop] = b.usedBy.length > a.usedBy.length || (b.usedBy.length === a.usedBy.length && (b.changedAt ?? 0) < (a.changedAt ?? 0)) ? [b, a] : [a, b];
    try { if (fs.readdirSync(path.dirname(drop.file)).length > 1) continue; } catch { continue; }
    if (undone(ctx.log, 'merge-skills', `${drop.name}>${keep.name}`)) continue;
    const kt = text.get(keep.name)!, kp = parseMd(kt), have = new Set(kp.body.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    const extra = parseMd(text.get(drop.name)!).body.split(/\r?\n/).filter(l => l.trim() && !have.has(l.trim()) && !/^#\s/.test(l));
    const merged = extra.length ? setBody(kt, `${kp.body.replace(/\s+$/, '')}\n\n## Da «${drop.name}»\n\n${extra.join('\n')}\n`) : kt;
    const c = ctx.log.apply({ job: 'merge-skills', kind: 'skill', action: 'merge', target: `${drop.name}>${keep.name}`, summary: changeText().merge({ drop: drop.name, keep: keep.name }), reason: `Le due skill dicevano quasi le stesse cose (somiglianza ≥ ${Math.round(MERGE_SIM * 100)}%).`, evidence: [brainRel(ctx.root, drop.file), brainRel(ctx.root, keep.file)] },
      [{ file: keep.file, text: merged }, { file: drop.file, text: null }]);
    if (!c) continue;
    changes++; gone.add(drop.name);
    for (const p of ctx.profiles().filter(x => x.knowhow?.linked.includes(drop.name))) linkTo(ctx, p, keep.name, 'merge-skills', `«${drop.name}» non c’è più: è dentro «${keep.name}».`, drop.name);
  }
  return { job: 'merge-skills', changes };
}

// ── the memory tidy-up ──────────────────────────────────────────────────────────────────────────────────────────────
/** Merges, generalizes or drops facts within their own scope (memory-tidy.ts); text repetition across roles is not
 *  evidence of global validity, so nothing is promoted to a shared fact and the legacy memory files stay as they are. */
export function mergeMemory(ctx: JobContext): Promise<JobResult> { return tidyMemoryJob(ctx); }
