// The demo's Proposte (SB_DEMO=1, ADR 0123): made-up items waiting for the user, written once into the demo brain and
// its change log through the real stores, so the deck shows every kind of card without the user's data: three memory
// facts the roles proposed (from the demo chats' runs: who, where and when resolve to «QA · Rimborsi», «App ·
// Feedback», «App · Mappa 3D»), a fact that contradicts one Scout already confirmed (ADR 0126), a script the maintenance
// wrote (its card shows the code), a skill candidate the maintenance wrote from a repeated job, a memory merge the
// maintenance applied by itself (beside the demo's rule and skill of demo-learning.ts), and an Orchestrator's request
// for a protected setting. Deterministic (dates relative to `now`). Used by demo-wiring.ts; the e2e spec
// test/e2e/proposals-deck.spec.ts decides them.
import fs from 'node:fs';
import path from 'node:path';
import { readLocal, writeLocal } from '../agents/local-store';
import { confirmMemory, proposeMemory, readMemoryRecords } from '../rules/memory-records';
import type { StoredChange } from '../brainmodel/changes';
import type { BrainService } from '../services';
import { localize, tr } from '../demo-text';

const MIN = 60_000, DAY = 86_400_000;
/** the skill candidate's name and text, in the UI language (demo-text.ts) */
export const demoCandidate = (): string => tr('triage-errori-500');
const candidateText = (): string => tr(`---
name: triage-errori-500
description: Cerca nei log gli errori 500 di un modulo, li raggruppa per causa e propone il primo da correggere. Usala quando l'utente chiede "errori 500" o "cosa si è rotto oggi".
---

# Triage degli errori 500

## Passi
1. Leggi i log del modulo indicato nelle ultime 24 ore e filtra le righe con stato 500.
2. Raggruppa gli errori per messaggio e stack, contando quante volte compare ciascuno.
3. Per il gruppo più frequente apri il file e la riga dello stack e scrivi la causa probabile.
4. Riporta i gruppi in una tabella breve con conteggio, prima occorrenza e file.
`).replace('name: triage-errori-500', `name: ${demoCandidate()}`);

/** Facts, candidate and changes: written before the brain model starts (its change log reads the file once). */
export function writeDemoProposals(userData: string, brainRoot: string, now: number): void {
  const iso = (ago: number) => new Date(now - ago).toISOString();
  let records: ReturnType<typeof readMemoryRecords> = [];
  try { records = readMemoryRecords(brainRoot); } catch { records = []; }
  if (!records.length) {
    proposeMemory(brainRoot, { scope: { roleId: 'sentinel', project: 'alfa-e2e', environment: 'test' }, subject: tr('Rimborsi parziali'), predicate: tr('si calcolano su'),
      value: tr('il prezzo già scontato, non su quello pieno: il test case 7 lo verifica (108,00 € su 120,00 € con sconto 10%).'), sourceEventId: 'qa-msg-7', sourceRunId: 'r_000000000002' }, iso(9 * MIN));
    proposeMemory(brainRoot, { scope: { roleId: 'scout', project: 'alfa-shop' }, subject: tr('Modulo feedback'), predicate: tr('scrive i log in'),
      value: tr('logs/feedback/AAAA-MM-GG.log, una riga JSON per richiesta; gli errori 500 hanno il campo "status": 500.'), sourceEventId: 'feedback-tool-3', sourceRunId: 'r_000000000004' }, iso(2 * MIN));
    proposeMemory(brainRoot, { scope: { roleId: 'artisan', project: 'brain' }, subject: tr('Pagina Mappa'), predicate: tr('usa per il 3D'),
      value: tr('three.js con un solo canvas condiviso; con meno di 60 fps si passa alla vista 2D da sola.'), sourceEventId: 'mappa-report', sourceRunId: 'r_000000000001' }, iso(28 * MIN));
    // a fact that says something else than one Scout already remembers: the card asks replace or keep both (ADR 0126)
    // a real predicate: free notes («nota») never contradict each other (ADR 0129)
    const known = proposeMemory(brainRoot, { scope: { roleId: 'scout', project: 'alfa-shop' }, subject: tr('Prompt preparati'), predicate: tr('stanno'),
      value: tr('nella cartella prompts/ del progetto.'), sourceEventId: 'prompts-1', sourceRunId: 'r_000000000003' }, iso(3 * DAY));
    confirmMemory(brainRoot, known.memoryId, { sourceEventId: 'demo-review', sourceRunId: 'demo-review', evidence: 'demo' }, iso(3 * DAY - MIN));
    proposeMemory(brainRoot, { scope: { roleId: 'scout', project: 'alfa-shop' }, subject: tr('Prompt preparati'), predicate: tr('stanno'),
      value: tr('in tmp/*-prompt.md e sono committati come «tmp: …»: guarda prima il git log.'), sourceEventId: 'prompts-2', sourceRunId: 'r_000000000004' }, iso(5 * MIN));
  }
  const name = demoCandidate(), text = candidateText();
  const file = path.join(fs.realpathSync(brainRoot), 'memory', 'skill-candidates', `${name}.md`);
  const logFile = path.join(userData, 'brain-changes.json');
  const log = readLocal(logFile) as { changes?: StoredChange[] } | undefined;
  const changes = Array.isArray(log?.changes) ? log!.changes : [];
  if (changes.some(c => c.id === 'demo-p1')) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, text, 'utf8');
  const extra: StoredChange[] = localize<StoredChange[]>([
    { id: 'demo-p1', at: now - 2 * DAY, job: 'repeated-task', kind: 'skill', action: 'create', target: 'triage-errori-500', summary: 'Nuova skill candidata «triage-errori-500»',
      reason: 'Lo stesso lavoro tre volte in una settimana: «cerca gli errori 500 del modulo e dimmi la causa».', evidence: ['r_000000000004'], files: [] },
    { id: 'demo-p2', at: now - 26 * 3600e3, job: 'merge-memory', kind: 'memory', action: 'merge', target: 'agents/sentinel/memory.md', summary: 'Memoria di Sentinel: 4 righe sugli ambienti di test unite in una',
      reason: 'Quattro righe dicevano la stessa cosa sull\'ambiente test-2 (accesso, dati di prova, reset notturno).', evidence: ['agents/sentinel/memory.md:12', 'agents/sentinel/memory.md:19', 'agents/sentinel/memory.md:27', 'agents/sentinel/memory.md:31'], files: [] },
  ]);
  extra[0]!.files = [{ file, before: null, after: text }];
  // a script the maintenance wrote from a repeated job: the card shows its code
  const script = path.join(fs.realpathSync(brainRoot), 'scripts', 'conta-errori-500.mjs');
  const code = `// ${tr('Conta gli errori 500 di oggi nei log del modulo indicato.')}\n// node scripts/conta-errori-500.mjs feedback\nimport fs from 'node:fs';\n\nconst mod = process.argv[2] ?? 'feedback';\nconst day = new Date().toISOString().slice(0, 10);\nconst lines = fs.readFileSync(\`logs/\${mod}/\${day}.log\`, 'utf8').split('\\n').filter(Boolean);\nconst errors = lines.map(l => JSON.parse(l)).filter(r => r.status === 500);\nconsole.log(\`\${errors.length} errori 500 in \${mod} oggi\`);\n`;
  fs.mkdirSync(path.dirname(script), { recursive: true });
  if (!fs.existsSync(script)) fs.writeFileSync(script, code, 'utf8');
  extra.push({ id: 'demo-p3', at: now - 50 * MIN, job: 'repeated-task', kind: 'script', action: 'create', target: 'scripts/conta-errori-500.mjs', summary: tr('Nuovo script «conta-errori-500»: conta gli errori 500 di oggi in un modulo'),
    reason: tr('Hai chiesto tre volte in due giorni quanti errori 500 ci sono oggi: ora basta lanciare lo script.'), evidence: ['r_000000000004'], files: [{ file: script, before: null, after: fs.readFileSync(script, 'utf8') }] });
  writeLocal(logFile, { version: 1, changes: [...changes, ...extra] });
}

/** The Orchestrator asks for a protected setting (in memory, like any agent's request): one card «Impostazioni». */
export function requestDemoSetting(brain: Pick<BrainService, 'requestSetting'>): void {
  brain.requestSetting('pulse.dailyUsd', 0.4, { by: 'agent', chatId: 'orchestrator', reason: tr('Con tre orari al giorno il Battito finisce il budget alle 13: con 0,40 $ arriva a sera.') });
}
