// Accuracy floors of the rule-based classifiers on the hand-labelled requests of test/fixtures/classifiers/requests.ts:
// the job-ledger kind (brain/estimates.ts classify), the routing kind on a clean install (brain/routing.ts taskOf with
// no brain rules, i.e. the built-in work words of shared/work-concepts.ts) and the agent classifier's words channel
// over the packaged role agents (agents/classifier.ts, model unavailable). The floors are the values measured when the
// rules were last changed (2026-10-18; before → after: DEV job 45→47, task 9→47, agent 10→36 of 50; HOLDOUT job 26→28,
// task 6→28, agent 7→18 of 30), so a rule change that makes any of them worse fails here. Also pins the Orchestrator mail
// classifier (chats/orchestrator-delivery.ts) on typical agent mail: it holds back only clear progress notes.
import { describe, expect, it } from 'vitest';
import { DEV, HOLDOUT, type Labelled } from '../../fixtures/classifiers/requests';
import { classify } from '../../../src/main/brain/estimates';
import { taskOf } from '../../../src/main/brain/routing';
import { classifyByWords } from '../../../src/main/agents/classifier';
import { mailClassifier, type DeliveryClass } from '../../../src/main/chats/orchestrator-delivery';
import { roleAgentPresets } from '../../../src/shared/agent-presets';
import type { AgentProfile } from '../../../src/shared/agents';

const profiles = roleAgentPresets().map(p => ({ ...p, status: 'active', activeVersion: 1 }) as unknown as AgentProfile);
async function score(set: readonly Labelled[]) {
  let job = 0, task = 0, agent = 0;
  for (const [text, j, t, a] of set) {
    if (classify(text) === j) job++;
    if (taskOf('', text, undefined) === t) task++;
    const r = await classifyByWords(text, profiles);
    if ((r.noneCloseEnough ? null : r.candidates[0]!.id.replace(/^default-/, '')) === a) agent++;
  }
  return { job, task, agent };
}

describe('classifier accuracy on labelled requests', () => {
  it('DEV (used while tuning)', async () => {
    const s = await score(DEV);
    expect(s.job).toBeGreaterThanOrEqual(47); expect(s.task).toBeGreaterThanOrEqual(47); expect(s.agent).toBeGreaterThanOrEqual(36);
  });
  it('HOLDOUT (written beforehand, measured once at the end)', async () => {
    const s = await score(HOLDOUT);
    expect(s.job).toBeGreaterThanOrEqual(28); expect(s.task).toBeGreaterThanOrEqual(28); expect(s.agent).toBeGreaterThanOrEqual(18);
  });
});

describe('Orchestrator mail classifier on typical agent mail', () => {
  const MAIL: [string, DeliveryClass][] = [
    ['URGENTE: la build di main è rossa e blocca il rilascio', 'now'],
    ['Serve subito una tua decisione: i test di produzione falliscono', 'now'],
    ['Fatto: PR #12 aperta, test verdi, sha 3f2a9c1', 'group'],
    ['Ho finito l’analisi, il report è in analisi/report.md', 'group'],
    ['Mi serve il permesso per leggere il database di staging', 'group'],
    ['Puoi dirmi quale branch usare?', 'group'],
    ['Bloccato: manca la chiave API per il servizio mail', 'group'],
    ['Errore: il deploy di staging è fallito con 502', 'group'],
    ['Done: merged into main, all checks green', 'group'],
    ['Pronto per la review: branch feat/classifier', 'group'],
    ['Sto ancora lavorando sui test, nessun problema finora', 'quiet'],
    ['Per info: ho letto i log, sto provando la seconda ipotesi', 'quiet'],
    ['Ricevuto, procedo', 'quiet'],
    ['In corso: migrazione al 60%', 'quiet'],
    ['FYI the e2e suite is still running', 'quiet'],
    ['Nota: ho scritto le decisioni in docs/adr/0074.md', 'quiet'],
    // by design an action word ("aspett*") wins over a progress word: a request held by mistake costs more than a wait
    ['Sto aspettando che finisca la build', 'group'],
  ];
  const c = mailClassifier();
  for (const [text, cls] of MAIL) it(`${cls}: ${text}`, () => expect(c(text)).toBe(cls));
});
