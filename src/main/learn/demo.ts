// Impara in the demo (ADR 0181): no engine runs there, so the lessons come from here. `demoRun` answers the app's own
// read-only commands (gh pr view / diff, git) with the real PR #251 of second-brain («replies stream word by word»),
// `demoTeach` answers each of the model's rounds with a lesson about it written by hand (plan, the rest, the four extras,
// the grade), after a short wait so the screens in between are seen. `seedDemoLessons` writes two saved lessons the
// first time, so the page has a list. Deterministic under SB_DEMO_FREEZE. Used by demo-wiring.ts; e2e: test/e2e/impara.spec.ts.
import type { Lesson } from '@shared/lesson';
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

const PLAN = {
  title: 'Risposte parola per parola (PR #251)',
  diagram: DEMO_DIAGRAM,
  outline: ['Il problema: risposte a blocchi', 'Il primo freno: ChatManager', 'Il secondo freno: lo store', 'La finestra nascosta', 'Cosa non risolve'],
  steps: [
    { title: 'Il problema: risposte a blocchi', focus: ['engine', 'view'],
      say: 'Prima di questa PR la risposta compariva a blocchi, non parola per parola. Il testo arrivava già dal motore, ma restava fermo lungo la strada.',
      text: 'Il motore manda il testo a pezzetti, ogni pochi millisecondi. Sullo schermo però si vedeva un salto ogni **100 ms** o più: due attese di 100 ms in fila, una in main e una nel renderer.',
      note: 'Il testo c’era: si fermava due volte' },
    { title: 'Il primo freno: ChatManager', focus: ['manager'],
      say: 'Il primo freno è in main. ChatManager raccoglie le versioni nuove dello stesso messaggio e le manda alla finestra tutte insieme. Prima aspettava cento millisecondi, ora un fotogramma.',
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
    { title: 'Il secondo freno: lo store', focus: ['store', 'view'],
      say: 'Il secondo freno è nella finestra. Lo store tiene i messaggi che cambiano e li disegna tutti insieme. Anche lui aspettava cento millisecondi; ora aspetta un fotogramma.',
      text: 'In `startStore` ogni `chat:item` che sostituisce un messaggio va in `held`; `release` li applica in un colpo solo. `STREAM_MS` passa da `100` a `16`: React disegna al massimo una volta per fotogramma, quanto basta per vedere le parole una alla volta.',
      note: 'Un render per fotogramma', code: STORE_CODE },
    { title: 'La finestra nascosta', focus: ['hidden', 'store'],
      say: 'Se la finestra è nascosta nessuno vede il testo. Allora lo store aspetta di più, duecentocinquanta millisecondi, e risparmia lavoro al computer.',
      text: 'Con `document.hidden` il timer usa `STREAM_HIDDEN_MS = 250`. È la stessa idea del problema «Lag nell’app» del 12 ottobre: niente render che nessuno guarda.',
      note: 'Nascosta: 250 ms, nessuno guarda',
      words: [{ term: 'document.hidden', meaning: 'vero quando la finestra è ridotta a icona o coperta' }] },
    { title: 'Cosa non risolve', focus: ['engine', 'manager'],
      say: 'Questa PR toglie le attese dell’app, non quelle del motore. Se il motore manda pezzi grandi, la risposta arriva comunque a pezzi grandi.',
      text: 'Il motore resta letto alla stessa velocità di prima: niente aspetta lo schermo. Se il computer è carico (vedi la PR #249 sui blocchi della CPU) un fotogramma può durare di più, ma il testo non si perde: arriva al giro dopo.',
      note: 'Il ritmo del motore resta il suo' },
  ],
  checks: [
    { afterStep: 1, kind: 'choice', q: 'Perché 16 ms e non 0?',
      options: ['È circa un fotogramma a 60 Hz: più spesso lo schermo non lo mostrerebbe', 'Perché Electron non accetta timer sotto i 16 ms', 'Perché il motore manda testo solo ogni 16 ms', 'Per risparmiare token'],
      correct: 0, why: 'Lo schermo si aggiorna circa 60 volte al secondo. Disegnare più spesso costerebbe CPU senza che tu veda differenze; il timer non dipende né dal motore né da Electron.' },
    { afterStep: 3, kind: 'predict', q: 'Il motore manda la risposta in un solo blocco alla fine. Cosa cambia con questa PR?',
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

/** The model's rounds in the demo: the lesson above, a bit at a time. */
export async function demoTeach(r: TeachRun): Promise<TeachResult> {
  const out = (v: unknown, cost: number): TeachResult => ({ ok: true, text: JSON.stringify(v), costUsd: cost, engine: 'claude', model: 'claude-opus (demo)' });
  if (r.round === 'impara-plan') { await wait(900); return out(PLAN, 0.21); }
  if (r.round === 'impara-rest') { await wait(1500); return out(REST, 0.18); }
  if (r.round === 'impara-grade') {
    await wait(700);
    return out({ grade: 'partial', feedback: 'Hai colto il punto: le due attese da 100 ms in fila e il nuovo fotogramma da 16 ms in ChatManager e nello store.', missing: 'Manca la finestra nascosta (250 ms) e cosa la PR non risolve: un motore che manda pezzi grandi.' }, 0.03);
  }
  await wait(800);
  const kind = /did not get this piece/.test(r.prompt) ? 'better' : /concrete example/.test(r.prompt) ? 'example' : /real code of this piece/.test(r.prompt) ? 'code' : 'question';
  return out(EXTRA[kind], 0.04);
}

/** Two saved lessons the first time the demo opens Impara: one half done, one finished. */
export function seedDemoLessons(store: LessonStore, now: number): void {
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
  store.save(half);
  store.save(done);
}
