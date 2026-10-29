// Made-up Log events for the demo (npm run demo, the e2e and the README shots; no CLI, no tokens): two task chains (a
// delegation tree with a review and a duplicate reply; a single Scout whose permission closed without the user), the
// classifiers, an estimate, a brain error, a memory fact, Battito and an app warning. Kept in memory only (Journal.seed),
// never written to disk. Used by main/index.ts when SB_DEMO=1.
import type { LogEvent, LogInput } from '../../shared/activity-log';

export function demoLog(E: number): LogEvent[] {
  const MIN = 60_000;
  let n = 0;
  const ev = (ago: number, e: LogInput): LogEvent => ({ ...e, id: `demo-log-${n++}`, at: E - ago * MIN } as LogEvent);
  const plan = { rootId: 'tree-plan', task: 'Sconti in percentuale' };
  const pr = { rootId: 'demo-pr', task: 'Analizza la PR #212' };
  return [
    ev(52, { kind: 'pulse', level: 'ok', title: 'Battito: 3 carte con claude', text: 'Turno 08:00', costUsd: 0.012, ms: 21_000 }),
    ev(47, { kind: 'memory', level: 'info', title: 'Memoria di scout aggiornata: Il repo alfa-shop usa dotnet 8 e xUnit', text: 'Nuovo fatto, proposta' }),
    ev(40, { kind: 'classifier', level: 'info', title: 'Classificatore stime: «review»', text: '1 parte nella richiesta', input: 'Analizza la PR #212 e dimmi se si può unire' }),
    ev(40, { kind: 'estimate', level: 'info', title: 'Stima (per la tua richiesta): ~6 min · ~$0.21 · 9 lavori simili, affidabilità media', text: 'Percorso: un solo agente. One review job, single part.', input: 'Analizza la PR #212 e dimmi se si può unire' }),
    ev(39, { ...pr, kind: 'task', step: 'open', level: 'info', chatId: 'demo-pr', who: 'Scout', title: 'Orchestrator sceglie Scout', text: 'Lettura di codice senza modifiche: il ruolo che legge e riferisce', input: 'Analizza la PR #212 e dimmi se si può unire.' }),
    ev(39, { ...pr, kind: 'classifier', level: 'info', chatId: 'demo-pr', who: 'Scout', title: 'Classificatore: review / alfa-shop → claude · claude-sonnet-4-5', text: 'dalla tabella · review veloci su Sonnet' }),
    ev(36, { ...pr, kind: 'task', step: 'request', level: 'warn', chatId: 'demo-pr', who: 'Scout', title: 'Scout chiede il permesso: Bash', text: 'Bash · gh pr checkout 212', input: 'gh pr checkout 212', reqId: 'p1', reqType: 'permission' }),
    ev(35, { ...pr, kind: 'task', step: 'resolved', level: 'warn', chatId: 'demo-pr', who: 'Scout', title: 'Permesso di Scout chiuso senza la tua risposta', text: 'Bash · gh pr checkout 212', reqId: 'p1', reqType: 'permission', by: 'other' }),
    ev(33, { ...pr, kind: 'task', step: 'work', level: 'warn', chatId: 'demo-pr', who: 'Scout', title: 'Scout ha lavorato · 4 strumenti', costUsd: 0.19, ms: 312_000, tools: ['Read', 'Grep', 'Bash', 'WebFetch'], toolErrors: 1,
      input: 'Analizza la PR #212 e dimmi se si può unire.', output: 'La PR #212 si può unire: 2 file, test verdi. Un commento: il nome della variabile `tot` è poco chiaro.', error: 'WebFetch: 404 sulla pagina della build' }),
    ev(33, { ...pr, kind: 'task', step: 'result', level: 'ok', chatId: 'demo-pr', who: 'Scout', title: 'Scout: risultato consegnato (completato)', text: 'Si può unire: 2 file, test verdi · criteri verificati', output: 'La PR #212 si può unire: 2 file, test verdi.' }),
    ev(30, { ...pr, kind: 'task', step: 'closed', level: 'info', chatId: 'demo-pr', who: 'Scout', title: 'Scout: chiusa da sola, finito il lavoro' }),
    ev(26, { kind: 'error', level: 'warn', title: 'Errore registrato nel brain: Ho lanciato i test sul ramo sbagliato', text: 'Vero: prima git status, poi i test · Artisan' }),
    ev(18, { ...plan, kind: 'task', step: 'open', level: 'info', chatId: 'tree-plan', who: 'Strategist', title: 'Orchestrator sceglie Strategist', text: 'Lavoro in più parti: serve un piano', input: 'Porta gli sconti in percentuale su carrello, ordine e reso, con test e note di rilascio.' }),
    ev(17, { ...plan, kind: 'task', step: 'work', level: 'ok', chatId: 'tree-plan', who: 'Strategist', title: 'Strategist ha lavorato · 2 strumenti', costUsd: 0.31, ms: 64_000, tools: ['plan_propose', 'agent_delegate'],
      input: 'Porta gli sconti in percentuale su carrello, ordine e reso, con test e note di rilascio.', output: 'Piano in 3 parti: dove, come, cosa dire. Parte Scout.' }),
    ev(16, { ...plan, kind: 'task', step: 'open', level: 'info', chatId: 'tree-scout', parentId: 'tree-plan', who: 'Scout', title: 'Strategist sceglie Scout', text: 'Delegato: Trova ogni punto che applica uno sconto.', input: 'Trova ogni punto che applica uno sconto.' }),
    ev(12, { ...plan, kind: 'task', step: 'work', level: 'ok', chatId: 'tree-scout', parentId: 'tree-plan', who: 'Scout', title: 'Scout ha lavorato · 2 strumenti', costUsd: 0.18, ms: 240_000, tools: ['Grep', 'Read'],
      input: 'Trova ogni punto che applica uno sconto.', output: 'Trovati 3 punti: carrello, ordine, reso. Il reso arrotonda due volte.' }),
    ev(11, { ...plan, kind: 'task', step: 'result', level: 'ok', chatId: 'tree-scout', parentId: 'tree-plan', who: 'Scout', title: 'Scout: risultato consegnato (completato)', text: 'Trovati 3 punti: carrello, ordine, reso · criteri verificati', output: 'Trovati 3 punti: carrello, ordine, reso. Il reso arrotonda due volte.' }),
    ev(11, { ...plan, kind: 'task', step: 'result', level: 'ok', chatId: 'tree-scout', parentId: 'tree-plan', who: 'Scout', title: 'Scout: risultato consegnato (completato)', text: 'Trovati 3 punti: carrello, ordine, reso · criteri verificati', output: 'Trovati 3 punti: carrello, ordine, reso. Il reso arrotonda due volte.' }),
    ev(10, { ...plan, kind: 'task', step: 'open', level: 'info', chatId: 'tree-artisan', parentId: 'tree-plan', who: 'Artisan', title: 'Strategist sceglie Artisan', text: 'Delegato: Applica lo sconto al lordo con un solo arrotondamento, nei 3 punti.' }),
    ev(4, { ...plan, kind: 'task', step: 'work', level: 'ok', chatId: 'tree-artisan', parentId: 'tree-plan', who: 'Artisan', title: 'Artisan ha lavorato · 3 strumenti', costUsd: 0.74, ms: 356_000, tools: ['Read', 'Edit', 'Bash'],
      input: 'Applica lo sconto al lordo con un solo arrotondamento, nei 3 punti.', output: 'Fatti carrello e ordine, ora il reso.' }),
    ev(3, { ...plan, kind: 'task', step: 'open', level: 'info', chatId: 'tree-sentinel', parentId: 'tree-artisan', who: 'Sentinel', title: 'Artisan sceglie Sentinel', text: 'Delegato: Esegui la suite ordini e giudica il fix.' }),
    ev(2, { kind: 'classifier', level: 'info', title: 'Classificatore posta: Artisan → Orchestrator: solo avanzamento, consegnato col prossimo turno', text: 'l’Orchestrator è fermo e il messaggio è solo un avanzamento', input: 'Carrello e ordine fatti, manca il reso.' }),
    ev(1, { kind: 'app', level: 'warn', title: 'browser: page load slow', text: 'Prossimo passo: la pagina di test risponde dopo 9 s; riprova o controlla la VPN', error: 'timeout 8000 ms' }),
  ];
}
