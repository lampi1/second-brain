// Impara (ADR 0181): the lessons the user asks for to master a PR of theirs, a technical topic or a pasted text. A lesson
// is a base flowchart that grows piece by piece (each piece lights its nodes: the app adds the classes, the model only
// names the node ids), a short narration per piece (read aloud by the app's voice or just written), checks after some
// pieces, extra pieces the user asks for («Spiegamelo meglio», «Fammi un esempio», «Mostrami il codice», a question of
// their own) and a final «Spiegalo tu». Methods: Dunlosky et al. 2013 (practice testing), Mayer's multimedia principles
// (segmenting, signaling, modality, redundancy, pre-training), LearnLM's principles (active learning, adapt to the
// learner), Chi & Wylie's ICAP (explain in your own words). Everything the model writes is untrusted: this file checks
// and caps it (parse*), the renderer draws diagrams only through lib/viz/mermaid.ts (strict, an image, never DOM).
// Shared by main/learn/ (generation, store) and the renderer (components/impara/); pinned by test/unit/lesson.test.ts.

export type LessonDepth = 'quick' | 'lesson' | 'deep';
export const LESSON_DEPTHS: readonly LessonDepth[] = ['quick', 'lesson', 'deep'];
/** «Quanto ne sai già?»: asked on the start form, so the lesson adapts with no round trip before the first piece */
export type LessonLevel = 'new' | 'basics' | 'expert';
export const LESSON_LEVELS: readonly LessonLevel[] = ['new', 'basics', 'expert'];
export type LessonKind = 'pr' | 'topic' | 'text';
export type LessonExtraKind = 'better' | 'example' | 'code' | 'question';
export const LESSON_EXTRAS: readonly LessonExtraKind[] = ['better', 'example', 'code', 'question'];
export type LessonGrade = 'ok' | 'partial' | 'miss';
/** «Eri sicuro?» after an answer: tirato a caso, abbastanza, sicurissimo (metacognition, LearnLM) */
export type LessonConfidence = 0 | 1 | 2;

/** How many main pieces a depth asks for (the model may write fewer). */
export const DEPTH_STEPS: Record<LessonDepth, { min: number; max: number; minutes: number }> = {
  quick: { min: 3, max: 4, minutes: 5 }, lesson: { min: 5, max: 7, minutes: 15 }, deep: { min: 8, max: 10, minutes: 30 },
};

export interface LessonPr { provider: 'github' | 'devops'; url: string; title: string; repo: string; number: number }

/** The start form (impara:start). */
export interface LessonStart {
  kind: LessonKind;
  /** what the user wants to understand, in their words */
  ask: string;
  /** kind pr: the PR's web address (a GitHub PR, or one of the Task page's DevOps PRs) */
  prUrl?: string;
  /** kind text: the pasted text */
  text?: string;
  depth: LessonDepth;
  level: LessonLevel;
}

export interface LessonCode { file: string; diff: string }
export interface LessonWord { term: string; meaning: string }
export interface LessonStep {
  id: string;
  title: string;
  /** what the voice says (or the caption shows when the voice is on): 1-3 short sentences, for the ear */
  say: string;
  /** the written explanation (markdown, short): shown in full when the voice is off, under «Testo completo» when on */
  text: string;
  /** node ids of the lesson's diagram this piece lights */
  focus: string[];
  /** a short note shown next to the lit nodes */
  note?: string;
  code?: LessonCode;
  /** new words this piece uses (pre-training) */
  words?: LessonWord[];
  /** a diagram of its own (any mermaid type), instead of the lesson's flowchart: a zoom on one part */
  diagram?: string;
  /** an extra piece the user asked for, after the piece `of` */
  extra?: { kind: LessonExtraKind; of: string; ask?: string };
}

export interface LessonAnswer { choice: number; confidence?: LessonConfidence; at: number }
export interface LessonCheck {
  id: string;
  /** the main piece it comes after */
  after: string;
  kind: 'choice' | 'predict';
  q: string;
  options: string[];
  correct: number;
  /** why the right answer is right (and the usual wrong turn), shown after the answer */
  why: string;
  answer?: LessonAnswer;
}

/** The final «Spiegalo tu» (ICAP: constructive): the user's own explanation, graded by the model. */
export interface LessonExplain { q: string; answer?: string; grade?: LessonGrade; feedback?: string; missing?: string; at?: number }

export type LessonState = 'preparing' | 'more' | 'ready' | 'failed';
export interface Lesson {
  id: string;
  title: string;
  kind: LessonKind;
  ask: string;
  pr?: LessonPr;
  depth: LessonDepth;
  level: LessonLevel;
  createdAt: number;
  updatedAt: number;
  /** preparing = nothing yet; more = the first pieces are here, the rest is being written; ready; failed (error) */
  state: LessonState;
  error?: string;
  diagram: string;
  /** the planned main pieces' titles (the rail shows the ones still to come) */
  outline: string[];
  steps: LessonStep[];
  checks: LessonCheck[];
  explain?: LessonExplain;
  /** where the user is: a play-list key (playlist) */
  at: string;
  /** an extra piece or a grade being written now */
  busy?: { kind: LessonExtraKind | 'grade'; of: string; ask?: string; since: number };
  /** the last follow-up that failed (shown once, with «Riprova») */
  busyError?: string;
  /** what the lesson cost so far, by the engines' own reports (null = unknown) */
  costUsd: number | null;
  engine: string | null;
  model: string | null;
  /** the material's sources, shown on the rail («Fonti») */
  sources: string[];
  /** the folder the model reads around the material (a PR's local clone); absent = the lesson's own folder */
  readDir?: string;
  doneAt?: number;
}

/** One line of the Impara page's list. */
export interface LessonSummary {
  id: string; title: string; kind: LessonKind; pr?: LessonPr; depth: LessonDepth; createdAt: number; updatedAt: number;
  state: LessonState; steps: number; planned: number; seen: number; right: number; asked: number; done: boolean;
  /** the first lines of the diagram, for the card's thumbnail */
  diagram: string;
}

export interface ImparaState { lessons: LessonSummary[]; dir: string; canTeach: boolean; why?: string }

// ── the play-list ──────────────────────────────────────────────────────────────────────────────────────────────────

export type PlayItem = { key: string; kind: 'step'; step: LessonStep } | { key: string; kind: 'check'; check: LessonCheck } | { key: 'end'; kind: 'end' };
export const stepKey = (id: string): string => `s:${id}`;
export const checkKey = (id: string): string => `c:${id}`;

/** The order the user goes through: each main piece, then its extra pieces (each followed by its own extras and
 *  checks), then its checks; then the end («Spiegalo tu»), there only once every planned piece arrived (state ready). */
export function playlist(l: Pick<Lesson, 'steps' | 'checks' | 'state'>): PlayItem[] {
  const out: PlayItem[] = [];
  const visit = (s: LessonStep, depth: number) => {
    out.push({ key: stepKey(s.id), kind: 'step', step: s });
    if (depth < 20) for (const e of l.steps.filter(x => x.extra?.of === s.id)) visit(e, depth + 1);
    for (const c of l.checks.filter(x => x.after === s.id)) out.push({ key: checkKey(c.id), kind: 'check', check: c });
  };
  for (const s of l.steps.filter(x => !x.extra)) visit(s, 0);
  if (l.state === 'ready' && out.length) out.push({ key: 'end', kind: 'end' });
  return out;
}

/** The main piece an item belongs to (an extra's root, a check's piece). */
export function rootOf(l: Pick<Lesson, 'steps' | 'checks'>, key: string): LessonStep | null {
  let id = key.startsWith('c:') ? l.checks.find(c => checkKey(c.id) === key)?.after : key.startsWith('s:') ? key.slice(2) : undefined;
  for (let i = 0; id && i < 50; i++) {
    const s = l.steps.find(x => x.id === id);
    if (!s) return null;
    if (!s.extra) return s;
    id = s.extra.of;
  }
  return null;
}

/** Main pieces seen, right answers, checks answered, extras asked: the card's and the end's numbers. */
export function progressOf(l: Pick<Lesson, 'steps' | 'checks' | 'state' | 'at' | 'outline'>): { seen: number; total: number; right: number; answered: number; checks: number; asked: number } {
  const list = playlist(l), i = Math.max(0, list.findIndex(p => p.key === l.at));
  const main = l.steps.filter(s => !s.extra);
  const seenIds = new Set(list.slice(0, i + 1).filter(p => p.kind === 'step').map(p => (p as Extract<PlayItem, { kind: 'step' }>).step.id));
  const answered = l.checks.filter(c => c.answer);
  return {
    seen: l.at === 'end' ? main.length : main.filter(s => seenIds.has(s.id)).length,
    total: Math.max(main.length, l.outline.length),
    right: answered.filter(c => c.answer!.choice === c.correct).length,
    answered: answered.length, checks: l.checks.length,
    asked: l.steps.filter(s => s.extra).length,
  };
}

/** How well each main piece went: its checks (a right answer counts 1, a wrong one 0, unanswered is left out) and how
 *  many extras it needed (each extra lowers it a little: it needed more explaining). null = nothing to judge. */
export function pieceScores(l: Pick<Lesson, 'steps' | 'checks'>): { id: string; title: string; score: number | null }[] {
  return l.steps.filter(s => !s.extra).map(s => {
    const mine = l.checks.filter(c => c.answer && rootOfIds(l.steps, c.after) === s.id);
    const extras = l.steps.filter(x => x.extra && rootOfIds(l.steps, x.id) === s.id).length;
    if (!mine.length && !extras) return { id: s.id, title: s.title, score: null };
    const base = mine.length ? mine.filter(c => c.answer!.choice === c.correct).length / mine.length : 1;
    return { id: s.id, title: s.title, score: Math.max(0, Math.min(1, base - 0.1 * extras)) };
  });
}
function rootOfIds(steps: readonly LessonStep[], id: string): string | null {
  let cur = steps.find(s => s.id === id);
  for (let i = 0; cur?.extra && i < 50; i++) cur = steps.find(s => s.id === cur!.extra!.of);
  return cur && !cur.extra ? cur.id : null;
}

export function summaryOf(l: Lesson): LessonSummary {
  const p = progressOf(l);
  return {
    id: l.id, title: l.title, kind: l.kind, ...(l.pr ? { pr: l.pr } : {}), depth: l.depth, createdAt: l.createdAt, updatedAt: l.updatedAt,
    state: l.state, steps: l.steps.filter(s => !s.extra).length, planned: p.total, seen: p.seen, right: p.right, asked: p.asked,
    done: !!l.doneAt, diagram: l.diagram.slice(0, 1200),
  };
}

// ── the diagram ────────────────────────────────────────────────────────────────────────────────────────────────────

const NODE_ID = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const KEYWORDS = new Set(['flowchart', 'graph', 'subgraph', 'end', 'classDef', 'class', 'style', 'linkStyle', 'click', 'direction', 'TB', 'TD', 'BT', 'RL', 'LR', 'call', 'href']);
/** A lesson's base diagram: a flowchart (the only kind whose nodes take classes), at most this long. */
export const DIAGRAM_MAX = 4000;
const STEP_DIAGRAM_MAX = 3000;

export const isFlowchart = (src: string): boolean => /^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/i.test(src);

/** The node ids a flowchart declares (shaped nodes and the ends of its edges), labels and directives left out. */
export function diagramNodes(src: string): string[] {
  const ids = new Set<string>();
  for (const raw of src.split('\n')) {
    const line = raw.replace(/%%.*$/, '').trim();
    if (!line || /^(?:flowchart|graph|classDef|class|style|linkStyle|click|direction|end)\b/.test(line)) continue;
    // a subgraph's own id is not a node
    if (/^subgraph\b/.test(line)) continue;
    const bare = line
      .replace(/"[^"]*"/g, ' ')
      .replace(/\|[^|]*\|/g, ' ')
      // an edge's text written between its dashes (A -- text --> B) is a label, not a node
      .replace(/(?<![-=.])(?:--|==|-\.)(?![-=.>])\s+[^-=.>\s][^>]*?\s+(?=-->|==>|\.->|---|===)/g, ' ')
      // shapes: [..] (..) {..} and the asymmetric id>..] (only right after an id, never an arrow's head)
      .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|(?<=[A-Za-z0-9_])>[^\]]*\]/g, ' ')
      .replace(/:::[A-Za-z0-9_]+/g, ' ');
    for (const part of bare.split(/(?:<?[-=.]{2,}[>ox]?|~~~|&|;)/)) {
      const word = part.trim().split(/\s+/)[0] ?? '';
      if (NODE_ID.test(word) && !KEYWORDS.has(word)) ids.add(word);
    }
  }
  return [...ids];
}

/** The colours of the three states, as hex (mermaid's classDef splits on commas: no rgba). */
export interface FocusColors { now: { fill: string; stroke: string; text: string }; done: { fill: string; stroke: string; text: string }; dim: { fill: string; stroke: string; text: string } }
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const safeHex = (c: string, fb: string): string => (HEX.test(c) ? c : fb);

/** The lesson's flowchart with this piece lit: `now` strong, `done` (nodes of the pieces before) calm, the rest dimmed.
 *  Only ids the diagram declares are used: the model's focus cannot inject a line. */
export function withFocus(src: string, now: readonly string[], done: readonly string[], c: FocusColors): string {
  const known = new Set(diagramNodes(src));
  const lit = [...new Set(now)].filter(id => known.has(id));
  const calm = [...new Set(done)].filter(id => known.has(id) && !lit.includes(id));
  const rest = [...known].filter(id => !lit.includes(id) && !calm.includes(id));
  const def = (name: string, s: { fill: string; stroke: string; text: string }, width: number) =>
    `classDef ${name} fill:${safeHex(s.fill, '#272930')},stroke:${safeHex(s.stroke, '#3a404d')},stroke-width:${width}px,color:${safeHex(s.text, '#eceef3')}`;
  const lines = [def('sbNow', c.now, 3), def('sbDone', c.done, 1.5), def('sbDim', c.dim, 1)];
  if (lit.length) lines.push(`class ${lit.join(',')} sbNow`);
  if (calm.length) lines.push(`class ${calm.join(',')} sbDone`);
  if (rest.length && lit.length) lines.push(`class ${rest.join(',')} sbDim`);
  return `${src.trimEnd()}\n${lines.join('\n')}`;
}

/** The nodes lit by the main pieces before this one (play order), for the «done» state. */
export function doneNodes(l: Pick<Lesson, 'steps' | 'checks' | 'state'>, key: string): string[] {
  const list = playlist(l), i = list.findIndex(p => p.key === key);
  const before = (i < 0 ? list : list.slice(0, i)).filter((p): p is Extract<PlayItem, { kind: 'step' }> => p.kind === 'step' && !p.step.diagram);
  return [...new Set(before.flatMap(p => p.step.focus))];
}

// ── reading what the model wrote ───────────────────────────────────────────────────────────────────────────────────

/** The JSON object in a model's answer: a ```json fence, else the text from the first { to the last }. */
export function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1];
  const raw = fenced ?? (() => { const a = text.indexOf('{'), b = text.lastIndexOf('}'); return a >= 0 && b > a ? text.slice(a, b + 1) : ''; })();
  if (!raw) throw new Error('nessun JSON nella risposta');
  return JSON.parse(raw);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown, what: string): Obj => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: atteso un oggetto`); return v as Obj; };
const text = (v: unknown, max: number, what: string, required = true): string => {
  const s = typeof v === 'string' ? v.replace(/\r/g, '').trim() : '';
  if (!s && required) throw new Error(`${what}: manca`);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

let seq = 0;
/** A short id for a piece or a check; `prefix` keeps extras apart. */
export const newId = (prefix: string, now = Date.now()): string => `${prefix}${now.toString(36).slice(-5)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;

function parseCode(v: unknown): LessonCode | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Obj, file = text(o.file, 200, 'code.file', false), diff = text(o.diff, 2500, 'code.diff', false);
  if (!diff) return undefined;
  const lines = diff.split('\n').slice(0, 40).join('\n');
  return { file: file || '', diff: lines };
}

/** One piece the model wrote. `nodes` = the base diagram's ids: a focus on another id is dropped. */
export function parseStep(v: unknown, nodes: readonly string[], id: string): LessonStep {
  const o = obj(v, 'pezzo');
  const own = text(o.diagram, STEP_DIAGRAM_MAX, 'diagram', false);
  const focus = list(o.focus).filter((x): x is string => typeof x === 'string' && NODE_ID.test(x) && nodes.includes(x)).slice(0, 8);
  const words = list(o.words).map(w => (w && typeof w === 'object' ? w as Obj : {})).map(w => ({ term: text(w.term, 60, 'term', false), meaning: text(w.meaning, 240, 'meaning', false) }))
    .filter(w => w.term && w.meaning).slice(0, 4);
  const code = parseCode(o.code), note = text(o.note, 220, 'note', false);
  return {
    id, title: text(o.title, 120, 'title'), say: text(o.say, 600, 'say'), text: text(o.text, 1800, 'text', false) || text(o.say, 600, 'say'),
    focus, ...(note ? { note } : {}), ...(code ? { code } : {}), ...(words.length ? { words } : {}), ...(own ? { diagram: own } : {}),
  };
}

export function parseCheck(v: unknown, after: string, id: string): LessonCheck {
  const o = obj(v, 'domanda');
  const options = list(o.options).map(x => text(x, 220, 'option', false)).filter(Boolean).slice(0, 4);
  if (options.length < 2) throw new Error('domanda: servono da 2 a 4 risposte');
  const correct = Number(o.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new Error('domanda: correct fuori dalle risposte');
  return { id, after, kind: o.kind === 'predict' ? 'predict' : 'choice', q: text(o.q, 320, 'q'), options, correct, why: text(o.why, 700, 'why') };
}

export interface ParsedPlan { title: string; diagram: string; outline: string[]; steps: LessonStep[]; checks: LessonCheck[]; explainQ: string }

/** The first answer (plan, diagram, the first pieces) or the second (the rest): pieces with their checks, in order.
 *  A check is tied to a piece by its index in the answer's own `steps` (afterStep, from 1). */
export function parsePlan(v: unknown, opts: { now?: number; base?: string } = {}): ParsedPlan {
  const o = obj(v, 'lezione');
  const diagram = opts.base ?? text(o.diagram, DIAGRAM_MAX + 1, 'diagram');
  if (!isFlowchart(diagram)) throw new Error('diagram: deve essere un flowchart mermaid');
  if (diagram.length > DIAGRAM_MAX) throw new Error(`diagram: al massimo ${DIAGRAM_MAX} caratteri`);
  const nodes = diagramNodes(diagram);
  if (nodes.length < 2) throw new Error('diagram: servono almeno 2 nodi');
  const now = opts.now ?? Date.now();
  const steps: LessonStep[] = [];
  for (const s of list(o.steps).slice(0, 12)) { try { steps.push(parseStep(s, nodes, newId('p', now))); } catch { /* a piece that does not hold is left out */ } }
  if (!steps.length) throw new Error('nessun pezzo valido');
  const checks: LessonCheck[] = [];
  for (const c of list(o.checks).slice(0, 8)) {
    const at = Number((c as Obj | null)?.afterStep);
    const after = Number.isInteger(at) && at >= 1 && at <= steps.length ? steps[at - 1]! : null;
    if (!after) continue;
    try { checks.push(parseCheck(c, after.id, newId('q', now))); } catch { /* left out */ }
  }
  const outline = list(o.outline).map(x => text(x, 120, 'outline', false)).filter(Boolean).slice(0, 12);
  return { title: text(o.title, 120, 'title', !opts.base) || '', diagram, outline, steps, checks, explainQ: text(o.explain, 320, 'explain', false) };
}

/** An extra piece the user asked for: one piece, maybe with one check. */
export function parseExtra(v: unknown, nodes: readonly string[], of: string, kind: LessonExtraKind, ask: string | undefined, now = Date.now()): { step: LessonStep; check: LessonCheck | null } {
  const o = obj(v, 'pezzo extra');
  const step: LessonStep = { ...parseStep(o.step ?? o, nodes, newId('x', now)), extra: { kind, of, ...(ask ? { ask } : {}) } };
  let check: LessonCheck | null = null;
  if (o.check) { try { check = parseCheck(o.check, of, newId('q', now)); } catch { check = null; } }
  return { step, check };
}

export function parseGrade(v: unknown): { grade: LessonGrade; feedback: string; missing?: string } {
  const o = obj(v, 'giudizio');
  const grade: LessonGrade = o.grade === 'ok' || o.grade === 'partial' ? o.grade : 'miss';
  const missing = text(o.missing, 400, 'missing', false);
  return { grade, feedback: text(o.feedback, 700, 'feedback'), ...(missing ? { missing } : {}) };
}

// ── what the user says ─────────────────────────────────────────────────────────────────────────────────────────────

export type LessonCommand = 'next' | 'back' | 'repeat' | 'better' | 'example' | 'code' | 'pause';
const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const COMMANDS: [LessonCommand, RegExp][] = [
  ['pause', /^(?:pausa|basta|stop|zitto|zitta|silenzio|fermati|ferma|aspetta|pause|be quiet)$/],
  ['back', /^(?:indietro|torna indietro|torna|prima|precedente|back|go back|previous)$/],
  ['repeat', /^(?:ripeti|ripetilo|di nuovo|ancora una volta|puoi ripetere|repeat|again|say it again)$/],
  ['better', /^(?:spiegamelo meglio|spiega meglio|non ho capito|non capisco|piu semplice|in modo piu semplice|me lo rispieghi|rispiegamelo|explain better|i don't understand|i dont understand|simpler)$/],
  ['example', /^(?:fammi un esempio|un esempio|esempio|per esempio|mi fai un esempio|give me an example|an example|example)$/],
  ['code', /^(?:mostrami il codice|fammi vedere il codice|il codice|codice|show me the code|the code|code)$/],
  ['next', /^(?:avanti|vai avanti|prossimo|il prossimo|continua|vai|ok avanti|ho capito|capito|ok|okay|next|go on|continue|got it)$/],
];

/** A short utterance that is a command, else null (then it is a question, or an answer). */
export function parseLessonCommand(raw: string): LessonCommand | null {
  const n = norm(raw).replace(/^(?:ok |allora |dai |si |sì )/, '').replace(/ (?:grazie|per favore|please)$/, '').trim();
  if (!n || n.split(' ').length > 6) return null;
  for (const [cmd, re] of COMMANDS) if (re.test(n)) return cmd;
  return null;
}

const ORDINALS: Record<string, number> = {
  a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3, uno: 0, una: 0, due: 1, tre: 2, quattro: 3,
  prima: 0, primo: 0, seconda: 1, secondo: 1, terza: 2, terzo: 2, quarta: 3, quarto: 3, first: 0, second: 1, third: 2, fourth: 3,
  one: 0, two: 1, three: 2, four: 3, ultima: -1, ultimo: -1, last: -1,
};

/** A spoken choice among `n` options («la b», «la seconda», «risposta 3»), else null. */
export function parseSpokenChoice(raw: string, n: number): number | null {
  const words = norm(raw).replace(/\b(?:la|il|lo|risposta|opzione|scelgo|direi|e|è|answer|option|the|letter|lettera)\b/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || words.length > 3) return null;
  for (const w of words) {
    const i = ORDINALS[w];
    if (i === undefined) continue;
    const idx = i < 0 ? n - 1 : i;
    return idx < n ? idx : null;
  }
  return null;
}
