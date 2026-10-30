// Impara in the demo (ADR 0185): no engine runs there, so the lessons come from here. `demoRun` answers the app's own
// read-only commands (gh pr view / diff, git) with the real PR #251 of second-brain («replies stream word by word»),
// `demoTeach` answers each of the model's rounds with a lesson about it written by hand (the research and its check, with
// one fact the check corrects; a question before a topic lesson; plan, the rest, the four extras, the grade), after a
// short wait so the screens in between are seen. `seedDemoLessons` writes two saved lessons the
// first time, so the page has a list. Since ADR 0205 the lessons show every kind of visual (flow, code walkthrough,
// sequence, formula, chart, mind map), the pieces' roles, the quality gate (it rewrites the one piece of the rest that
// cites nothing) and the «Studio» outputs (the lesson about Impara has most of them made already).
// Deterministic under SB_DEMO_FREEZE. Used by demo-wiring.ts; e2e: test/e2e/impara.spec.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Lesson } from '@shared/lesson';
import type { ReviewCard } from '@shared/review';
import { stepKey } from '@shared/lesson';
import type { Run } from './material';
import type { TeachResult, TeachRun } from './service';
import type { LessonStore } from './store';

export const DEMO_PR_URL = 'https://github.com/lampi1/second-brain/pull/251';

const DIFF = `diff --git a/src/main/chats/manager.ts b/src/main/chats/manager.ts
--- a/src/main/chats/manager.ts
+++ b/src/main/chats/manager.ts
@@ -465,6 +465,8 @@ function sysItem<C extends SysCode>(code: C, params: SysParams | undefined, level
 const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
+/** One screen frame: how long newer versions of a streamed item are collapsed before they go to the window (emitItem). */
+const ITEM_FRAME_MS = 16;
@@ -3390,7 +3392,7 @@ export class ChatManager {
       if (!b) {
-        const timer = setTimeout(() => this.flushItems(chatId), 100);
+        const timer = setTimeout(() => this.flushItems(chatId), ITEM_FRAME_MS);
         timer.unref();
diff --git a/src/renderer/store/store.ts b/src/renderer/store/store.ts
--- a/src/renderer/store/store.ts
+++ b/src/renderer/store/store.ts
@@ -24,7 +24,9 @@ import { costHistory } from '../lib/live-costs';
 export const app = createStore<AppState>(initialState, { batch: true });
-export const STREAM_MS = 100;
+/** How often streamed text reaches the screen (startStore): one frame, so words show as they come. */
+export const STREAM_MS = 16;
+/** The same while the window is hidden: nobody sees those renders ("Lag nell'app", 2026-10-12). */
+export const STREAM_HIDDEN_MS = 250;
@@ -91,5 +93,5 @@ export function startStore(sb: Bridge): void {
     held.set(\`\${chatId}/\${item.id}\`, { type: 'chat:item', chatId, item, replace });
-    heldTimer ??= setTimeout(release, STREAM_MS);
+    heldTimer ??= setTimeout(release, typeof document !== 'undefined' && document.hidden ? STREAM_HIDDEN_MS : STREAM_MS);
   });
`;

const VIEW = {
  number: 251, title: 'Replies stream word by word', url: DEMO_PR_URL, author: { login: 'lampi1' }, baseRefName: 'main', headRefName: 'claude/word-streaming',
  body: 'Two 100 ms holds (main coalescing + renderer store) made replies appear in chunks. Both now wait one frame (16 ms); a hidden window keeps 250 ms.',
  additions: 7, deletions: 3, changedFiles: 2,
  files: [{ path: 'src/main/chats/manager.ts', additions: 3, deletions: 1 }, { path: 'src/renderer/store/store.ts', additions: 4, deletions: 2 }],
  commits: [{ messageHeadline: 'perf(chat): stream replies one frame at a time' }],
};

/** The app's read-only commands in the demo: gh for PR #251, nothing else. */
export const demoRun: Run = async (cmd, args) => {
  if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return JSON.stringify(VIEW);
  if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'diff') return DIFF;
  throw new Error('non disponibile nella demo');
};

export const DEMO_DIAGRAM = `flowchart LR
  engine["Motore<br/>Claude CLI"] -->|"pezzi"| manager["ChatManager<br/>(main)"]
  manager -->|"IPC"| store["Store<br/>(finestra)"]
  store --> view["La chat<br/>a schermo"]
  store -.->|"nascosta"| hidden["250 ms<br/>in pausa"]`;

const MANAGER_CODE = { file: 'src/main/chats/manager.ts', diff: `+/** One screen frame: how long newer versions of a streamed item are collapsed before they go to the window (emitItem). */
+const ITEM_FRAME_MS = 16;
 ...
-        const timer = setTimeout(() => this.flushItems(chatId), 100);
+        const timer = setTimeout(() => this.flushItems(chatId), ITEM_FRAME_MS);` };
const STORE_CODE = { file: 'src/renderer/store/store.ts', diff: `-export const STREAM_MS = 100;
+export const STREAM_MS = 16;
+export const STREAM_HIDDEN_MS = 250;
 ...
-    heldTimer ??= setTimeout(release, STREAM_MS);
+    heldTimer ??= setTimeout(release, typeof document !== 'undefined' && document.hidden ? STREAM_HIDDEN_MS : STREAM_MS);` };

/** The lines of manager.ts the code walkthrough goes through (the PR's version, abridged). */
const MANAGER_WALK = `/** One screen frame: how long newer versions of a streamed item are collapsed before they go to the window (emitItem). */
const ITEM_FRAME_MS = 16;

private emitItem(chatId: string, item: ChatItem): void {
  this.pending.set(item.id, item);
  const b = this.batches.get(chatId);
  if (!b) {
    const timer = setTimeout(() => this.flushItems(chatId), ITEM_FRAME_MS);
    timer.unref();
    this.batches.set(chatId, { timer });
  }
}`;

const PLAN = {
  title: 'Risposte parola per parola (PR #251)',
  subject: 'second-brain',
  diagram: DEMO_DIAGRAM,
  outline: ['Il problema: risposte a blocchi', 'Il primo freno: ChatManager', 'Il secondo freno: lo store', 'Quanto dura un fotogramma', 'La finestra nascosta', 'Cosa non risolve'],
  steps: [
    { title: 'Il problema: risposte a blocchi', role: 'problem', focus: ['engine', 'view'], cites: ['f4'],
      beats: [
        { say: 'Prima di questa PR la risposta compariva a blocchi, non parola per parola.', focus: ['view'], note: 'Qui il testo arrivava a salti' },
        { say: 'Il testo arrivava già dal motore, ma restava fermo lungo la strada.', focus: ['engine', 'manager'], flow: { from: 'engine', to: 'manager' } },
      ],
      text: 'Il motore manda il testo a pezzetti, ogni pochi millisecondi. Sullo schermo però si vedeva un salto ogni **100 ms** o più: due attese di 100 ms in fila, una in main e una nel renderer.',
      note: 'Il testo c’era: si fermava due volte' },
    { title: 'Il primo freno: ChatManager', role: 'example', focus: ['manager'], cites: ['f1', 'f5'],
      visual: { type: 'code', file: 'src/main/chats/manager.ts', code: MANAGER_WALK },
      beats: [
        { say: 'Il primo freno è in main, in ChatManager.', focus: ['manager'], lines: [1, 2] },
        { say: 'Quando arriva un pezzo nuovo, il messaggio aspetta qui prima di partire verso la finestra.', focus: ['manager', 'store'], lines: [6, 9] },
        { say: 'Prima aspettava cento millisecondi, ora un fotogramma.', focus: ['manager'], lines: [8, 8], note: '100 ms → 16 ms, un fotogramma' },
      ],
      text: '`emitItem` mette da parte le versioni di un messaggio che cambia e le spedisce con `flushItems`. Il timer era `100`, ora è `ITEM_FRAME_MS = 16`: circa un fotogramma a 60 Hz, quindi l’IPC non si intasa ma le parole passano subito.',
      note: '100 ms → 16 ms, un fotogramma', code: MANAGER_CODE,
      words: [{ term: 'IPC', meaning: 'il canale tra il processo main e la finestra (renderer)' }, { term: 'coalescing', meaning: 'unire più aggiornamenti dello stesso messaggio in uno solo' }] },
  ],
  checks: [
    { afterStep: 2, kind: 'predict', q: 'Se cambiassi solo il timer di ChatManager a 16 ms e lasciassi lo store del renderer a 100 ms, cosa vedresti?',
      options: ['Ancora scatti di circa 100 ms', 'Uno streaming fluido, parola per parola', 'Nessun testo fino alla fine della risposta', 'Ogni parola due volte'],
      correct: 0, why: 'La strada ha due attese in fila: basta la più lenta per vedere i blocchi. Lo store del renderer tratteneva ancora tutto per 100 ms, per questo la PR cambia entrambi.' },
  ],
  explain: 'Spiega con parole tue perché le risposte arrivavano a blocchi e cosa ha cambiato la PR #251.',
};

const REST = {
  steps: [
    { title: 'Il secondo freno: lo store', role: 'rule', focus: ['store', 'view'], cites: ['f2'],
      visual: { type: 'sequence', mermaid: `sequenceDiagram
  participant E as Motore
  participant M as ChatManager
  participant S as Store
  participant V as Schermo
  E->>M: pezzo di testo
  M->>S: chat:item dopo 16 ms
  S->>S: tiene in held
  S->>V: release dopo 16 ms` },
      beats: [
        { say: 'Il pezzo di testo arriva dal motore a ChatManager.' },
        { say: 'Dopo un fotogramma ChatManager lo manda alla finestra.' },
        { say: 'Lo store lo tiene da parte insieme agli altri cambi.', note: 'held: i cambi in attesa' },
        { say: 'E dopo un altro fotogramma lo disegna: la regola è un fotogramma per ogni freno.' },
      ],
      text: 'In `startStore` ogni `chat:item` che sostituisce un messaggio va in `held`; `release` li applica in un colpo solo. `STREAM_MS` passa da `100` a `16`: React disegna al massimo una volta per fotogramma, quanto basta per vedere le parole una alla volta.',
      code: STORE_CODE },
    { title: 'Quanto dura un fotogramma', role: 'worked', focus: ['store'], cites: ['f5'],
      visual: { type: 'formula', tex: 't_{frame} = \\frac{1000\\,\\text{ms}}{f} = \\frac{1000\\,\\text{ms}}{60} \\approx 16{,}7\\,\\text{ms}', where: [{ sym: 'f', meaning: 'quante volte al secondo lo schermo si aggiorna (60 Hz)' }, { sym: 't_frame', meaning: 'quanto dura un fotogramma' }, { sym: '16 ms', meaning: 'il timer scelto dalla PR, arrotondato per difetto' }] },
      beats: [
        { say: 'Un secondo sono mille millisecondi.', mark: 't_frame' },
        { say: 'Lo schermo li divide in sessanta aggiornamenti.', mark: 'f' },
        { say: 'Ogni fotogramma dura circa sedici millisecondi: è il numero della PR.', mark: '16 ms', note: 'Più spesso, lo schermo non lo mostrerebbe' },
      ],
      text: 'Con uno schermo a **60 Hz** un fotogramma dura `1000 / 60 ≈ 16,7 ms`. Aggiornare più spesso costerebbe CPU senza che tu veda differenze (fatto da verificare: dipende dallo schermo).' },
    { title: 'La finestra nascosta', role: 'faded', focus: ['hidden', 'store'], cites: ['f3', 'f1', 'f2'],
      visual: { type: 'chart', chart: { type: 'bar', title: 'Attesa prima di mostrare il testo', labels: ['ChatManager', 'Store', 'Store (nascosta)'], series: [{ name: 'Prima', data: [100, 100, 100] }, { name: 'Dopo la PR', data: [16, 16, 250] }], unit: 'ms' } },
      beats: [
        { say: 'Prima della PR ogni freno aspettava cento millisecondi.', mark: 'ChatManager' },
        { say: 'Ora lo store aspetta un fotogramma.', mark: 'Store' },
        { say: 'Ma se la finestra è nascosta aspetta di più: duecentocinquanta millisecondi.', mark: 'Store (nascosta)', note: 'Nascosta: nessuno guarda' },
      ],
      text: 'Con `document.hidden` il timer usa `STREAM_HIDDEN_MS = 250`. È la stessa idea del problema «Lag nell’app» del 12 ottobre: niente render che nessuno guarda.',
      words: [{ term: 'document.hidden', meaning: 'vero quando la finestra è ridotta a icona o coperta' }] },
    { title: 'Cosa non risolve', role: 'recap', focus: ['engine', 'manager'],
      visual: { type: 'mindmap', mermaid: `mindmap
  root((Risposte parola per parola))
    Il problema
      Due attese da 100 ms
    ChatManager
      Un fotogramma, 16 ms
    Lo store
      held e release
      Nascosta: 250 ms
    Non risolve
      Il ritmo del motore` },
      say: 'Questa PR toglie le attese dell’app, non quelle del motore. Se il motore manda pezzi grandi, la risposta arriva comunque a pezzi grandi.',
      text: 'Il motore resta letto alla stessa velocità di prima: niente aspetta lo schermo. Se il computer è carico (vedi la PR #249 sui blocchi della CPU) un fotogramma può durare di più, ma il testo non si perde: arriva al giro dopo.',
      note: 'Il ritmo del motore resta il suo' },
  ],
  checks: [
    { afterStep: 2, kind: 'choice', q: 'Perché la PR sceglie 16 ms e non 0 ms per i due timer?',
      options: ['È circa un fotogramma a 60 Hz: più spesso lo schermo non lo mostrerebbe', 'Perché Electron non accetta timer più brevi di 16 ms', 'Perché il motore manda il testo solo ogni 16 ms', 'Perché un timer più breve spenderebbe più token'],
      correct: 0, why: 'Lo schermo si aggiorna circa 60 volte al secondo. Disegnare più spesso costerebbe CPU senza che tu veda differenze; il timer non dipende né dal motore né da Electron.' },
    { afterStep: 4, kind: 'predict', q: 'Il motore manda la risposta in un solo blocco alla fine. Cosa cambia con questa PR?',
      options: ['Niente: appare tutta insieme, come prima', 'Appare parola per parola', 'Appare dopo 250 ms', 'Non appare più'],
      correct: 0, why: 'La PR toglie le attese dell’app, ma non può dividere un testo che arriva intero: lo streaming parte dal motore.' },
  ],
};

const EXTRA: Record<string, unknown> = {
  better: { step: { title: 'Con altre parole: due semafori', focus: ['manager', 'store'],
    say: 'Immagina una strada con due semafori in fila. Prima ognuno restava rosso cento millisecondi; ora diventa verde a ogni fotogramma. Basta un solo semaforo lento per creare la coda.',
    text: 'I due semafori sono `ChatManager` (in main) e lo store (nel renderer). La PR accorcia **tutti e due** i rossi: se ne accorciassi uno solo, l’altro creerebbe ancora la coda.',
    note: 'Due semafori: conta il più lento' },
  check: { kind: 'choice', q: 'Quale dei due semafori sta nella finestra dell’app?', options: ['Lo store del renderer', 'ChatManager', 'Il motore', 'L’IPC'], correct: 0,
    why: 'ChatManager vive nel processo main; lo store vive nel renderer, cioè nella finestra.' } },
  example: { step: { title: 'Esempio: «Ciao, come stai?»', focus: ['engine', 'manager', 'store'],
    say: 'Il motore manda tre pezzi a pochi millisecondi l’uno dall’altro. Prima li vedevi comparire tutti insieme dopo circa duecento millisecondi; ora ognuno compare nel fotogramma dopo.',
    text: '- 0 ms: `Ciao,` · 6 ms: ` come` · 11 ms: ` stai?`\n- **Prima**: ChatManager aspetta fino a 100 ms, lo store altri 100 → tutto insieme a ~200 ms.\n- **Dopo**: 16 ms + 16 ms → la prima parola a ~32 ms, le altre subito dietro.' } },
  code: { step: { title: 'Il codice: due righe', focus: ['manager', 'store'],
    say: 'Il cambio vero sono due numeri: il timer di ChatManager e quello dello store, entrambi da cento a sedici. Il resto sono commenti e il caso della finestra nascosta.',
    text: 'In `manager.ts` il timer di `emitItem` usa `ITEM_FRAME_MS`; in `store.ts` `STREAM_MS` vale `16` e c’è `STREAM_HIDDEN_MS` per `document.hidden`.', code: STORE_CODE } },
  question: { step: { title: 'La tua domanda', focus: ['manager', 'store'],
    say: 'Bella domanda. Con sedici millisecondi i messaggi sull’IPC aumentano, ma restano pochi: al massimo uno per messaggio per fotogramma, perché le versioni intermedie vengono unite.',
    text: 'Il coalescing resta: in un fotogramma le versioni nuove dello stesso messaggio diventano **un solo** evento `chat:item`. Quindi al massimo ~60 eventi al secondo per una risposta in corso, non uno per ogni parola.' } },
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** The research of PR #251 (files only: a PR has no web research); f2 is written wrong on purpose, the check fixes it. */
const FILES_RESEARCH = { facts: [
  { claim: 'ChatManager unisce le versioni nuove di un messaggio per ITEM_FRAME_MS = 16 ms prima di mandarle alla finestra.', from: 'file', ref: 'src/main/chats/manager.ts:467', quote: 'const ITEM_FRAME_MS = 16;' },
  { claim: 'STREAM_MS nello store del renderer passa da 100 a 10 ms.', from: 'file', ref: 'src/renderer/store/store.ts:27', quote: 'export const STREAM_MS = 16;' },
  { claim: 'Con la finestra nascosta lo store aspetta STREAM_HIDDEN_MS = 250 ms.', from: 'file', ref: 'src/renderer/store/store.ts:29', quote: 'export const STREAM_HIDDEN_MS = 250;' },
  { claim: 'Prima della PR due attese da 100 ms in fila (main e store) facevano arrivare le risposte a blocchi.', from: 'file', ref: 'materiale.md', quote: 'Two 100 ms holds (main coalescing + renderer store) made replies appear in chunks.' },
  { claim: 'Uno schermo a 60 Hz mostra un fotogramma nuovo circa ogni 16,7 ms.', from: 'known' },
], questions: [] as unknown[] };
/** The check of the files side: each fact of the prompt ok, the wrong number fixed, the model's own knowledge unsure. */
function filesVerdicts(prompt: string): unknown {
  const verdicts = [...prompt.matchAll(/^\{"id":"(f\d+)","claim":"([^"]*)","source":"([^"]*)"/gm)].map(([, id, claim, source]) =>
    /da 100 a 10 ms/.test(claim!) ? { id, verdict: 'wrong', fix: 'STREAM_MS nello store del renderer passa da 100 a 16 ms.', ref: source }
      : source === 'model knowledge' ? { id, verdict: 'unsure' } : { id, verdict: 'ok' });
  return { verdicts };
}
/** A topic lesson's research in the demo: two web facts, and one question (the ask can mean two things). */
const WEB_RESEARCH = { facts: [
  { claim: 'Un browser disegna la pagina al massimo una volta per fotogramma, di solito 60 volte al secondo.', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame', quote: 'The frequency of calls to the callback function will generally match the display refresh rate.' },
  { claim: 'In Electron il processo main e la finestra parlano tramite IPC.', url: 'https://www.electronjs.org/docs/latest/tutorial/ipc', quote: 'Inter-process communication (IPC) is a key part of building feature-rich desktop applications in Electron.' },
] };
const TOPIC_QUESTION = { q: 'Ti interessa lo streaming dentro l’app o in generale nei browser?', options: ['Dentro second-brain', 'In generale, nei browser'] };

/** The model's rounds in the demo: the lesson above, a bit at a time. */
/** The demo tutor (ADR 0190): coach first (a hint and a question back), the answer and its card when asked straight
 *  or after a try; streamed a few words at a time like a real engine. */
async function demoTutor(r: TeachRun): Promise<TeachResult> {
  const prompt = await r.prompt;
  if (prompt === null) return { ok: false, error: 'non usata' };
  const now = /The learner now \(data[^)]*\): «([^»]*)»/.exec(prompt)?.[1] ?? '';
  const tried = /Learner: «/.test(prompt) && !/\?\s*$/.test(now);
  const text = /do NOT explain yet/.test(prompt) && !tried
    ? 'Guarda lo schema: le due ricerche partono dalla stessa domanda ma vanno in due posti diversi [f1]. Secondo te, cosa potrebbe succedere se chi legge il web potesse leggere anche i tuoi file?'
    : `${tried ? 'Giusto, è proprio quello il rischio. ' : ''}Chi legge il web legge pagine scritte da chiunque, e una pagina può contenere istruzioni nascoste. Se quella stessa esecuzione vedesse anche i tuoi file, potrebbe essere convinta a copiarli fuori [f1]. Per questo Impara fa due ricerche separate: quella sul web vede solo la tua domanda, quella nei file non va mai sul web, e un controllo separato verifica ogni fatto prima della lezione [f2].\nCARD: {"q": "Perché Impara tiene separate la ricerca sul web e quella nei file?", "answer": "Perché una pagina web può contenere istruzioni nascoste: se la stessa esecuzione vedesse anche i file, potrebbe portarli fuori.", "cites": ["f1"]}`;
  const words = text.split(/(?<= )/);
  let so = '';
  for (let i = 0; i < words.length; i += 3) { so += words.slice(i, i + 3).join(''); r.onText?.(so); await wait(45); }
  return { ok: true, text, costUsd: 0.01, engine: 'claude', model: 'claude-opus (demo)' };
}

/** The demo's quality gate (ADR 0205): the plan passes; in the rest, the recap cites no fact and is rewritten. */
function demoGate(prompt: string): unknown {
  const n = [...prompt.matchAll(/^\{"n":(\d+),"title":"([^"]*)"/gm)];
  const pieces = n.map(([, k, title]) => (title === 'Cosa non risolve'
    ? { n: Number(k), pass: false, fails: ['cites'], fix: { ...REST.steps[3], cites: ['f4', 'f1'] } }
    : { n: Number(k), pass: true }));
  return { pieces, checks: [] };
}

export async function demoTeach(r: TeachRun): Promise<TeachResult> {
  if (r.round === 'impara-tutor') return demoTutor(r);
  const out = (v: unknown, cost: number): TeachResult => ({ ok: true, text: JSON.stringify(v), costUsd: cost, engine: 'claude', model: 'claude-opus (demo)' });
  const prompt = typeof r.prompt === 'string' ? r.prompt : '';
  if (r.round === 'impara-web') { await wait(900); return out(WEB_RESEARCH, 0.06); }
  if (r.round === 'impara-files') {
    await wait(1000);
    // the app's files as full paths, as a real run would cite them (so «Fonti» opens them)
    const root = /app's source code: (.+?) \(src\/main/.exec(prompt)?.[1] ?? null;
    const facts = FILES_RESEARCH.facts.map(f => ({ ...f, ref: inApp(f.ref ?? '', root) }));
    return out({ ...FILES_RESEARCH, facts, ...(/wants to understand something/.test(prompt) ? { questions: [TOPIC_QUESTION] } : {}) }, 0.07);
  }
  if (r.round === 'impara-verify-web') { await wait(700); return out({ verdicts: [{ id: 'f1', verdict: 'ok' }, { id: 'f2', verdict: 'ok' }] }, 0.03); }
  if (r.round === 'impara-verify-files') { await wait(800); return out(filesVerdicts(prompt), 0.04); }
  if (r.round === 'impara-plan') { await wait(900); return out(PLAN, 0.21); }
  if (r.round === 'impara-cards') { await wait(700); return out(DEMO_CARDS, 0.03); }
  if (r.round === 'impara-rest') { await wait(1500); return out(REST, 0.18); }
  if (r.round === 'impara-quality') { await wait(500); return out(demoGate(prompt), 0.02); }
  if (r.round === 'impara-studio') { await wait(900); return out(demoStudio(prompt), 0.02); }
  if (r.round === 'impara-grade') {
    await wait(700);
    return out({ grade: 'partial', feedback: 'Hai colto il punto: le due attese da 100 ms in fila e il nuovo fotogramma da 16 ms in ChatManager e nello store.', missing: 'Manca la finestra nascosta (250 ms) e cosa la PR non risolve: un motore che manda pezzi grandi.' }, 0.03);
  }
  await wait(800);
  const kind = /did not get this piece/.test(prompt) ? 'better' : /concrete example/.test(prompt) ? 'example' : /real code of this piece/.test(prompt) ? 'code' : 'question';
  return out(EXTRA[kind], 0.04);
}

/** Three saved lessons the first time the demo opens Impara: one half done, one finished, one about the app itself
 *  (a tall diagram, researched and verified). */
/** A demo reference to the app's source (src/…) as a full path when the app runs from its clone. */
const inApp = (ref: string, root: string | null) => (root && ref.startsWith('src/') ? path.join(root, ref) : ref);

export function seedDemoLessons(store: LessonStore, now: number, appRoot: string | null = null): void {
  if (store.list().length) return;
  const day = 86_400_000;
  const half: Lesson = {
    id: store.newId(now - 2 * day), title: 'Freeze dell’app e CPU (PR #249)', kind: 'pr', ask: 'Voglio capire perché l’app si bloccava',
    pr: { provider: 'github', url: 'https://github.com/lampi1/second-brain/pull/249', title: 'Engines below normal priority', repo: 'lampi1/second-brain', number: 249 },
    depth: 'lesson', level: 'basics', createdAt: now - 2 * day, updatedAt: now - 2 * day + 600_000, state: 'ready',
    diagram: 'flowchart LR\n  agents["Agenti<br/>e loro processi"] -->|"CPU al 100%"| cpu["CPU<br/>del PC"]\n  cpu --> ui["Finestra<br/>dell’app"]\n  agents -.->|"priorità bassa"| prio["Sotto il normale"]\n  prio --> cpu',
    outline: ['Il sintomo', 'La causa vera', 'La cura: priorità'],
    steps: [
      { id: 'pa1', title: 'Il sintomo', focus: ['ui'], say: 'L’app si bloccava per qualche secondo mentre gli agenti lavoravano.', text: 'L’app si bloccava per qualche secondo mentre gli agenti lavoravano.' },
      { id: 'pa2', title: 'La causa vera', focus: ['agents', 'cpu'], say: 'Non erano le scritture su disco: era la CPU piena dei processi degli agenti.', text: 'Il log dei blocchi mostrava `cpuMs` alto: i processi degli agenti saturavano la CPU.' },
      { id: 'pa3', title: 'La cura: priorità', focus: ['prio'], say: 'Ora i motori partono con priorità più bassa, così la finestra ha sempre la CPU che le serve.', text: 'I motori partono *below normal*: Windows dà la precedenza alla finestra.' },
    ],
    checks: [{ id: 'qa1', after: 'pa2', kind: 'choice', q: 'Cosa causava i blocchi?', options: ['La CPU piena dei processi degli agenti', 'Le scritture dello store', 'La rete'], correct: 0, why: 'Il log dei blocchi lo mostrava: cpuMs alto, scritture veloci.', answer: { choice: 0, confidence: 2, at: now - 2 * day + 400_000 } }],
    explain: { q: 'Spiega con parole tue perché l’app si bloccava.' }, at: stepKey('pa2'), costUsd: 0.31, engine: 'claude', model: 'claude-opus (demo)', sources: ['PR #249 (lampi1/second-brain)'],
  };
  const done: Lesson = {
    id: store.newId(now - 5 * day), title: 'Cos’è la Content Security Policy', kind: 'topic', ask: 'Cos’è la CSP di Electron e perché l’app blocca le immagini esterne',
    depth: 'quick', level: 'new', createdAt: now - 5 * day, updatedAt: now - 5 * day + 900_000, state: 'ready',
    diagram: 'flowchart LR\n  page["La pagina<br/>dell’app"] -->|"chiede"| img["Immagine<br/>esterna"]\n  csp["CSP"] -->|"blocca"| img\n  page --> local["File<br/>dell’app"]',
    outline: ['Cosa fa la CSP', 'Cosa blocca', 'Perché conviene'],
    steps: [
      { id: 'pb1', title: 'Cosa fa la CSP', focus: ['csp'], say: 'È una lista di cosa la pagina può caricare.', text: 'È una lista di cosa la pagina può caricare.' },
      { id: 'pb2', title: 'Cosa blocca', focus: ['img'], say: 'Tutto quello che non è nella lista, come un’immagine da internet.', text: 'Tutto quello che non è nella lista.' },
      { id: 'pb3', title: 'Perché conviene', focus: ['page', 'local'], say: 'Un testo scritto da un modello non può far caricare nulla di estraneo.', text: 'Un testo scritto da un modello non può far caricare nulla di estraneo.' },
    ],
    checks: [{ id: 'qb1', after: 'pb2', kind: 'predict', q: 'Un agente scrive un link a una GIF. Cosa succede?', options: ['Non si carica', 'Si carica', 'L’app si chiude'], correct: 0, why: 'La CSP non ammette immagini esterne.', answer: { choice: 0, at: now - 5 * day + 300_000 } }],
    explain: { q: 'Spiega cos’è la CSP.', answer: 'Una lista di cosa la pagina può caricare.', grade: 'ok', feedback: 'Esatto e chiaro.', at: now - 5 * day + 800_000 },
    at: 'end', costUsd: 0.12, engine: 'claude', model: 'claude-opus (demo)', sources: [], doneAt: now - 5 * day + 850_000,
  };
  const app: Lesson = {
    id: store.newId(now - 3 * day), title: 'Come nasce una lezione di Impara', kind: 'topic', ask: 'Come fa Impara a preparare una lezione affidabile?',
    depth: 'quick', level: 'basics', createdAt: now - 3 * day, updatedAt: now - 3 * day + 300_000, state: 'ready', doneAt: now - 3 * day + 300_000, // read before: its cards are in the review
    diagram: 'flowchart TB\n  ask["La tua domanda"] --> web["Ricerca sul web<br/>(vede solo la domanda)"]\n  ask --> files["Ricerca nei file<br/>(brain, app, materiale)"]\n  subgraph check["Verifica"]\n    vweb["Controllo<br/>delle pagine"]\n    vfiles["Controllo<br/>dei file"]\n  end\n  web --> vweb\n  files --> vfiles\n  vweb --> facts["Fatti verificati"]\n  vfiles --> facts\n  files -.->|"se ambigua"| q["Domande"]\n  q --> plan["Piano e pezzi"]\n  facts --> plan\n  plan --> you["La lezione"]',
    outline: ['Due ricerche separate', 'La verifica', 'La lezione'],
    steps: [
      { id: 'pc1', title: 'Due ricerche separate', role: 'problem', focus: ['ask', 'web', 'files'], cites: ['f1', 'f3'],
        say: 'La tua domanda parte verso due ricerche. Quella sul web vede solo la domanda. Quella nei file legge il materiale, il tuo brain e l’app.',
        text: 'Le due ricerche non si incontrano mai: chi legge il web non vede i tuoi file, chi legge i file non va sul web.',
        beats: [
          { say: 'La tua domanda parte verso due ricerche.', focus: ['ask'] },
          { say: 'Quella sul web vede solo la domanda.', focus: ['web'], flow: { from: 'ask', to: 'web' }, note: 'Niente file qui' },
          { say: 'Quella nei file legge il materiale, il tuo brain e l’app.', focus: ['files'], flow: { from: 'ask', to: 'files' } },
        ] },
      { id: 'pc2', title: 'La verifica', role: 'example', focus: ['vweb', 'vfiles', 'facts'], cites: ['f2', 'f4'],
        say: 'Un secondo modello controlla ogni fatto sulla sua fonte. Quello sbagliato viene corretto o scartato.', text: 'Ogni fatto ha la sua fonte e un esito: verificato, corretto o da verificare. Chi verifica non ha scritto il fatto: per questo sbaglia meno.',
        visual: { kind: 'sequence', src: VERIFY_SEQUENCE },
        beats: [
          { say: 'La ricerca nei file propone un fatto con la sua riga.', focus: [] },
          { say: 'Un secondo modello, che non l’ha scritto, apre il file a quella riga.', focus: [], note: 'Chi verifica non ha scritto il fatto' },
          { say: 'Se il file dice altro, il fatto viene corretto.', focus: [] },
          { say: 'Solo i fatti confermati o corretti arrivano alla lezione.', focus: [] },
        ] },
      { id: 'pc3', title: 'La lezione', role: 'recap', focus: ['plan', 'you'], cites: ['f1', 'f5'], say: 'Solo dopo nasce la lezione, e ogni pezzo dice da quali fatti viene.', text: 'Ogni pezzo cita i suoi fatti: li trovi sotto «Fonti». Un controllo di qualità rilegge la bozza prima che tu la veda.',
        visual: { kind: 'mindmap', src: APP_MINDMAP } },
    ],
    checks: [], explain: { q: 'Spiega perché le due ricerche sono separate.' }, at: stepKey('pc1'), costUsd: 0.44, engine: 'claude', model: 'claude-opus (demo)', sources: [],
    facts: [
      { id: 'f1', claim: 'Prima di scrivere, Impara cerca le fonti sul web e nei file.', from: 'file', ref: inApp('src/main/learn/service.ts:150', appRoot), check: 'ok' },
      { id: 'f2', claim: 'Chain-of-Verification: un modello che risponde a domande di verifica indipendenti sbaglia meno fatti.', from: 'web', ref: 'https://arxiv.org/abs/2309.11495', quote: 'CoVe decreases hallucinations across a variety of tasks', check: 'ok' },
      { id: 'f3', claim: 'La ricerca sul web vede solo la domanda dell’utente, mai i suoi file: una pagina può contenere istruzioni nascoste.', from: 'file', ref: inApp('src/main/learn/prompt.ts:260', appRoot), check: 'ok' },
      { id: 'f4', claim: 'Un fatto che la verifica trova sbagliato viene corretto con la sua fonte, o scartato se non si può correggere.', from: 'file', ref: inApp('src/shared/lesson.ts:560', appRoot), check: 'ok' },
      { id: 'f5', claim: 'Ogni lezione lascia carte di ripasso, riproposte con FSRS quando stai per dimenticarle.', from: 'file', ref: inApp('src/shared/review.ts:1', appRoot), check: 'ok' },
    ],
    quality: { checked: 3, fixed: 1, fails: { cites: 1 }, at: now - 3 * day + 200_000 },
    studio: {
      mindmap: { state: 'done', at: now - 3 * day + 320_000, out: { kind: 'mindmap', src: APP_MINDMAP } },
      summary: { state: 'done', at: now - 3 * day + 330_000, out: { kind: 'summary', md: APP_SUMMARY } },
      glossary: { state: 'done', at: now - 3 * day + 340_000, out: { kind: 'glossary', terms: APP_GLOSSARY } },
      flashcards: { state: 'done', at: now - 3 * day + 350_000, out: { kind: 'flashcards', n: 3, cards: APP_FLASHCARDS } },
      podcast: { state: 'done', at: now - 3 * day + 360_000, out: { kind: 'podcast', title: 'Perché fidarsi di una lezione', lines: APP_PODCAST } },
    },
    prep: { phases: { gather: 'done', web: 'done', files: 'done', verify: 'done', ask: 'skip', plan: 'done' }, web: 1, files: 4, ok: 5, fixed: 0, unsure: 0, dropped: 0 },
  };
  half.subject = 'second-brain'; app.subject = 'second-brain'; done.subject = 'Sicurezza web';
  app.cards = { state: 'done', n: 3 };
  store.save(half);
  store.save(app);
  store.save(done);
  // the review (ADR 0189): the checks already answered, and the cards of the lesson about Impara, some due today
  const mem = (lastDays: number, s: number, reps = 1) => ({ due: now - lastDays * day + Math.max(1, Math.round(s)) * day, s, d: 5, reps, lapses: 0, last: now - lastDays * day });
  const card = (l: Lesson, k: string, extra: Partial<ReviewCard>): ReviewCard => ({ id: `${l.id}:${k}`, lessonId: l.id, subject: l.subject!, kind: 'recall', origin: 'cards', q: '', answer: '', createdAt: l.createdAt, mem: null, ...extra });
  const cards: ReviewCard[] = [
    card(half, 'k:qa1', { kind: 'choice', origin: 'check', q: half.checks[0]!.q, options: half.checks[0]!.options, correct: 0, answer: half.checks[0]!.why, mem: mem(2, 1.2) }),
    card(done, 'k:qb1', { kind: 'choice', origin: 'check', q: done.checks[0]!.q, options: done.checks[0]!.options, correct: 0, answer: done.checks[0]!.why, mem: mem(5, 15, 2) }),
    card(app, 'c1', { kind: 'recall', q: 'Perché Impara fa due ricerche separate, una sul web e una nei file?', answer: 'Perché chi legge il web non deve vedere i tuoi file: così un testo trovato online non può portare fuori i tuoi dati.', cites: ['f1'], mem: mem(4, 3) }),
    card(app, 'c2', { kind: 'choice', q: 'Chi controlla un fatto trovato nella ricerca?', options: ['Un secondo modello che non l’ha scritto', 'Lo stesso modello che l’ha trovato', 'Nessuno'], correct: 0, answer: 'Chain-of-Verification: chi verifica non ha scritto il fatto, così sbaglia meno.', cites: ['f2'], mem: mem(1, 2.5) }),
    card(app, 'c3', { kind: 'node', q: 'In quale parte dello schema un fatto sbagliato viene corretto?', node: 'vfiles', answer: 'Il controllo dei file rilegge ogni file alla riga citata e corregge il fatto.', cites: ['f1'] }),
    // the «Studio» flashcards (ADR 0205), already in the review
    ...APP_FLASHCARDS.map((c, i) => card(app, `s:f${i + 1}`, { kind: 'recall', origin: 'studio', q: c.q, answer: c.answer, cites: [['f3', 'f4', 'f2'][i]!], mem: mem(1, 10) })),
  ];
  try { fs.writeFileSync(path.join(store.root, 'review.json'), JSON.stringify({ v: 1, cards, log: [{ card: cards[1]!.id, at: now - 5 * day, grade: 3 }, { card: cards[2]!.id, at: now - 4 * day, grade: 3 }, { card: cards[0]!.id, at: now - 2 * day, grade: 2 }, { card: cards[3]!.id, at: now - day, grade: 3 }] })); } catch { /* the demo goes on without reviews */ }
}

// ── the «Studio» in the demo (ADR 0205): the lesson about Impara has most outputs made; any lesson can ask for more ──

const VERIFY_SEQUENCE = `sequenceDiagram
  participant R as Ricerca nei file
  participant V as Verifica
  participant F as File citato
  participant L as Lezione
  R->>V: fatto e riga
  V->>F: apre la riga
  F-->>V: dice altro
  V->>L: fatto corretto`;

const APP_MINDMAP = `mindmap
  root((Una lezione affidabile))
    Due ricerche
      Web: solo la domanda
      File: brain, app, materiale
    Verifica
      Un altro modello
      Corretto o scartato
    La lezione
      Ogni pezzo cita i fatti
      Controllo qualità
    Dopo
      Carte di ripasso
      Studio`;

const APP_SUMMARY = `Impara non scrive una lezione finché non ha fatti di cui fidarsi.

- La domanda parte verso due ricerche che non si incontrano: il web vede solo la domanda, i file restano sul PC [f1] [f3].
- Ogni fatto torna con la sua fonte: una pagina web o un file alla riga giusta [f1].
- Un secondo modello, che non ha scritto il fatto, lo controlla sulla fonte e lo conferma, lo corregge o lo scarta [f2] [f4].
- Solo allora nasce la lezione, e ogni pezzo dice da quali fatti viene [f1].
- Alla fine restano carte di ripasso che tornano quando stai per dimenticare [f5].`;

const APP_GLOSSARY = [
  { term: 'Chain-of-Verification', meaning: 'Il metodo per cui chi controlla un fatto risponde a domande di verifica senza aver scritto il fatto.', cites: ['f2'] },
  { term: 'Fatto verificato', meaning: 'Un’affermazione con la sua fonte che il secondo modello ha confermato o corretto.', cites: ['f4'] },
  { term: 'FSRS', meaning: 'Il modello che decide quando riproporti una carta: quando la probabilità di ricordarla scende al 90%.', cites: ['f5'] },
  { term: 'Ricerca nei file', meaning: 'La ricerca che legge il materiale, il tuo brain e l’app, senza mai andare sul web.', cites: ['f1', 'f3'] },
  { term: 'Ricerca sul web', meaning: 'La ricerca che vede solo la tua domanda, mai i tuoi file.', cites: ['f3'] },
];

const APP_FLASHCARDS = [
  { q: 'Perché in Impara la ricerca sul web non vede mai i file dell’utente?', answer: 'Perché una pagina web può contenere istruzioni nascoste: se la stessa esecuzione vedesse i file, potrebbe portarli fuori.' },
  { q: 'Cosa succede a un fatto che la verifica trova sbagliato?', answer: 'Viene corretto con la sua fonte; se non si può correggere viene scartato e non arriva alla lezione.' },
  { q: 'Perché chi verifica un fatto non deve essere chi l’ha scritto?', answer: 'Chi risponde a domande di verifica indipendenti sbaglia meno: non ripete il proprio errore (Chain-of-Verification).' },
];

const APP_PODCAST: { who: 0 | 1; say: string }[] = [
  { who: 0, say: 'Oggi una domanda semplice: perché dovrei fidarmi di una lezione scritta da un modello?' },
  { who: 1, say: 'Perché Impara non scrive niente finché non ha fatti con una fonte. Prima cerca, poi controlla, poi spiega.' },
  { who: 0, say: 'Cerca dove, esattamente?' },
  { who: 1, say: 'In due posti separati. Sul web, ma lì vede solo la tua domanda. E nei tuoi file, che invece non vanno mai sul web.' },
  { who: 0, say: 'Perché tenerle separate? Non sarebbe più comodo fare tutto insieme?' },
  { who: 1, say: 'Comodo sì, sicuro no. Una pagina web può nascondere istruzioni. Se chi la legge vedesse anche i tuoi file, potrebbe copiarli fuori.' },
  { who: 0, say: 'E una volta trovati i fatti?' },
  { who: 1, say: 'Un secondo modello li controlla. Apre il file alla riga citata, o la pagina, e dice: confermato, corretto o scartato.' },
  { who: 0, say: 'Facciamo un esempio concreto.' },
  { who: 1, say: 'La ricerca scrive che un timer vale dieci millisecondi. La verifica apre il file e legge sedici. Il fatto viene corretto prima della lezione.' },
  { who: 0, say: 'Quindi la lezione parte solo da fatti controllati.' },
  { who: 1, say: 'Esatto. E ogni pezzo ti dice da quali fatti viene: li apri con un clic.' },
  { who: 0, say: 'La cosa da ricordare?' },
  { who: 1, say: 'Prima le fonti, poi la verifica, poi la lezione. Mai il contrario.' },
];

/** The demo's «Studio» runs: about the lesson on Impara when the prompt is its, else about PR #251. */
function demoStudio(prompt: string): unknown {
  const app = /Come nasce una lezione di Impara/.test(prompt);
  const kind = /A mind map/.test(prompt) ? 'mindmap' : /one-page summary/.test(prompt) ? 'summary' : /The glossary/.test(prompt) ? 'glossary'
    : /Flashcards for spaced/.test(prompt) ? 'flashcards' : /A quiz of 10/.test(prompt) ? 'quiz' : /A timeline, only/.test(prompt) ? 'timeline' : 'podcast';
  if (kind === 'quiz') return app ? APP_QUIZ : prQuiz();
  if (kind === 'timeline') return app ? { none: 'La lezione spiega un procedimento, non una storia nel tempo.' } : { mermaid: PR_TIMELINE };
  if (app) return kind === 'mindmap' ? { mermaid: APP_MINDMAP } : kind === 'summary' ? { summary: APP_SUMMARY } : kind === 'glossary' ? { terms: APP_GLOSSARY }
    : kind === 'flashcards' ? { cards: APP_FLASHCARDS.map((c, i) => ({ ...c, cites: [['f3', 'f4', 'f2'][i]] })) } : { title: 'Perché fidarsi di una lezione', lines: APP_PODCAST };
  if (kind === 'mindmap') return { mermaid: (REST.steps[3]!.visual as { mermaid: string }).mermaid };
  if (kind === 'summary') return { summary: 'La PR #251 fa arrivare le risposte parola per parola togliendo due attese.\n\n- Prima due attese da 100 ms in fila, in main e nella finestra, raccoglievano il testo [f4].\n- ChatManager ora aspetta un fotogramma, 16 ms [f1].\n- Lo store della finestra anche: 16 ms [f2].\n- Con la finestra nascosta lo store aspetta 250 ms, perché nessuno guarda [f3].' };
  if (kind === 'glossary') return { terms: [{ term: 'ChatManager', meaning: 'La parte di main che riceve il testo dal motore e lo manda alla finestra.', cites: ['f1'] }, { term: 'STREAM_MS', meaning: 'Ogni quanto lo store della finestra disegna i messaggi che cambiano: ora 16 ms.', cites: ['f2'] }, { term: 'STREAM_HIDDEN_MS', meaning: 'La stessa attesa con la finestra nascosta: 250 ms.', cites: ['f3'] }] };
  if (kind === 'flashcards') return { cards: [
    { q: 'Perché prima della PR #251 le risposte comparivano a blocchi?', answer: 'Due attese da 100 ms in fila, in main e nella finestra.', cites: ['f4'] },
    { q: 'Quanto aspetta ora ChatManager prima di mandare un pezzo alla finestra?', answer: 'Un fotogramma: 16 ms.', cites: ['f1'] },
    { q: 'Cosa fa lo store della finestra con la finestra nascosta?', answer: 'Aspetta 250 ms: nessuno guarda.', cites: ['f3'] },
  ] };
  return { title: 'Le parole che arrivano subito', lines: [
    { who: 0, say: 'Prima le risposte arrivavano a blocchi. Perché?' }, { who: 1, say: 'Due attese da cento millisecondi in fila, una in main e una nella finestra.' },
    { who: 0, say: 'E la PR cosa cambia?' }, { who: 1, say: 'Le porta tutte e due a un fotogramma, sedici millisecondi.' },
    { who: 0, say: 'E se la finestra è nascosta?' }, { who: 1, say: 'Lo store aspetta duecentocinquanta millisecondi: nessuno guarda, niente lavoro inutile.' },
  ] };
}

const APP_QUIZ = { cards: [
  { kind: 'choice', q: 'Cosa vede la ricerca sul web di Impara?', options: ['Solo la domanda dell’utente', 'La domanda e i file del materiale', 'Tutto il brain dell’utente'], correct: 0, answer: 'Solo la domanda: i file restano alla ricerca nei file, che non va sul web.', cites: ['f3'] },
  { kind: 'truefalse', q: 'Il modello che verifica un fatto è lo stesso che l’ha trovato.', options: ['Vero', 'Falso'], correct: 1, answer: 'Falso: chi verifica non ha scritto il fatto (Chain-of-Verification).', cites: ['f2'] },
  { kind: 'recall', q: 'Cosa succede a un fatto che la verifica trova sbagliato?', answer: 'Viene corretto con la sua fonte, o scartato se non si può correggere.', cites: ['f4'] },
  { kind: 'node', q: 'In quale parte dello schema si controllano le pagine web trovate?', node: 'vweb', answer: 'Nel controllo delle pagine: riapre ogni pagina e conferma o corregge il fatto.', cites: ['f2'] },
  { kind: 'choice', q: 'Perché un pezzo della lezione mostra le sue fonti?', options: ['Per poter controllare da dove viene ogni frase', 'Per far sembrare la lezione più lunga', 'Perché lo chiede il motore'], correct: 0, answer: 'Ogni pezzo sta in piedi sui fatti verificati: le fonti si aprono con un clic.', cites: ['f1'] },
  { kind: 'truefalse', q: 'Le carte di ripasso tornano quando stai per dimenticarle.', options: ['Vero', 'Falso'], correct: 0, answer: 'Vero: FSRS le ripropone quando la probabilità di ricordarle scende.', cites: ['f5'] },
  { kind: 'recall', q: 'Perché la ricerca sul web non deve mai leggere i file?', answer: 'Una pagina può nascondere istruzioni: chi la legge non deve poter portare fuori i file.', cites: ['f3'] },
  { kind: 'choice', q: 'Cosa fa la verifica con un fatto che trova sbagliato ma correggibile?', options: ['Lo corregge e tiene la fonte', 'Lo lascia com’è', 'Lo cancella sempre'], correct: 0, answer: 'Lo corregge con la sua fonte; scarta solo quello che non si può correggere.', cites: ['f4'] },
  { kind: 'truefalse', q: 'Un pezzo della lezione può dire una cosa che nessun fatto verificato sostiene.', options: ['Vero', 'Falso'], correct: 1, answer: 'Falso: ogni pezzo cita i fatti verificati da cui viene.', cites: ['f1'] },
  { kind: 'choice', q: 'Quando nasce la lezione vera e propria?', options: ['Dopo la ricerca e la verifica dei fatti', 'Prima della ricerca', 'Mentre la ricerca è in corso'], correct: 0, answer: 'Prima le fonti, poi la verifica, poi la lezione.', cites: ['f1'] },
] };
const prQuiz = () => ({ cards: [
  ...DEMO_CARDS.cards,
  { kind: 'truefalse', q: 'Con la finestra nascosta lo store disegna ogni 16 ms.', options: ['Vero', 'Falso'], correct: 1, answer: 'Falso: nascosta aspetta STREAM_HIDDEN_MS = 250 ms.', cites: ['f3'] },
] });
const PR_TIMELINE = `timeline
  title Una parola, dal motore allo schermo
  0 ms : il motore manda il pezzo
  16 ms : ChatManager lo spedisce
  32 ms : lo store lo disegna`;

/** The review cards the demo's model writes at the end of a lesson: from the PR #251 facts (one cites only the
 *  unconfirmed fact and is dropped). */
const DEMO_CARDS = { cards: [
  { kind: 'recall', q: 'Perché prima della PR #251 le risposte comparivano a blocchi?', answer: 'Due attese da 100 ms in fila, una in main e una nello store della finestra, raccoglievano il testo prima di mostrarlo.', cites: ['f4'] },
  { kind: 'choice', q: 'Dopo la PR #251, ogni quanto ChatManager manda alla finestra le versioni nuove di un messaggio?', options: ['Ogni 16 ms', 'Ogni 100 ms', 'Ogni 250 ms'], correct: 0, answer: 'ITEM_FRAME_MS = 16: un fotogramma. 250 ms vale solo con la finestra nascosta.', cites: ['f1'] },
  { kind: 'node', q: 'Quale parte aspetta 250 ms quando la finestra è nascosta?', node: 'store', answer: 'Lo store della finestra: STREAM_HIDDEN_MS = 250, perché nessuno guarda.', cites: ['f3'] },
  { kind: 'choice', q: 'Se STREAM_MS tornasse a 100 ms, cosa vedresti?', options: ['Il testo di nuovo a scatti', 'Nessuna differenza', 'La chat non si aggiornerebbe più'], correct: 0, answer: 'Tornerebbe una delle due attese da 100 ms: il testo arriverebbe a scatti.', cites: ['f2'] },
  { kind: 'recall', q: 'Quanti fotogrammi al secondo mostra uno schermo a 60 Hz?', answer: '60.', cites: ['f5'] },
] };
