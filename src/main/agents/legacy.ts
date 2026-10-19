/** Converts bounded legacy routing data into editable catalog profiles; main owns persistence and availability.
 *  Each profile gets a real "when to use" and short instructions from its row's kind and area (ADR 0078), so the
 *  classifier can tell them apart; catalog.ts completes the profiles imported before that the same way. */
import { createHash } from 'node:crypto';
import { TASK_KINDS, type Effort, type RoutingRow } from '../../shared/contract';
import { AGENT_SYMBOLS, type AgentProfileV1 as AgentProfile } from '../../shared/agents';

// Keep the same model syntax accepted by the catalog, without resolving aliases or providers.
const MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;
const ENGINE = /^[a-z][a-z0-9_-]{0,59}$/;
const EFFORTS: readonly unknown[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const LABELS: Record<RoutingRow['kind'], string> = {
  '*': 'Assistente', 'qa-run': 'Verifica', review: 'Revisione', 'bug-fix': 'Correzione bug',
  'ops-read': 'Lettura operativa', writing: 'Scrittura', triage: 'Triage', 'research-web': 'Ricerca web',
  investigation: 'Indagine', 'app-feature': 'Sviluppo', regia: 'Orchestrator', altro: 'Altre attività',
};

/** What each legacy row's kind of work is for (whenToUse) and how to do it (instructions), in the user's language. */
const GUIDANCE: Record<RoutingRow['kind'], [string, string]> = {
  '*': ['Qualsiasi attività senza un agente più specifico.', 'Chiarisci il risultato atteso, lavora per passi verificabili e riporta cosa hai fatto, con le prove.'],
  'qa-run': ['Verificare che una funzione o una modifica funzioni: eseguire test e controlli e riportare l’esito.', 'Esegui i test e i controlli richiesti, riproduci i passi dell’utente, riporta cosa passa e cosa no con l’output reale. Non correggere senza che ti venga chiesto.'],
  review: ['Rivedere una modifica, un piano o un lavoro di altri: trovare errori, rischi e lacune.', 'Leggi la modifica e il suo contesto, elenca i problemi in ordine di gravità con file e riga, distingui fatti e ipotesi. Non modificare il codice.'],
  'bug-fix': ['Correggere un bug, un errore o un crash: riprodurlo, trovarne la causa e sistemarlo.', 'Riproduci il problema, trova la causa, correggila con la modifica più piccola e aggiungi un test che la prova. Riporta causa, correzione e verifiche.'],
  'ops-read': ['Leggere lo stato operativo (servizi, log, metriche, ordini, telemetria) in sola lettura e riassumerlo.', 'Solo lettura: non cambiare nulla in produzione. Raccogli i dati, riassumi lo stato con numeri e fonti, segnala anomalie e il prossimo passo da proporre all’utente.'],
  writing: ['Scrivere o rivedere testi: email, documenti, note, messaggi, descrizioni.', 'Scrivi nella lingua e nel tono dell’utente, breve e chiaro. Proponi una bozza e non inviare nulla da solo.'],
  triage: ['Smistare richieste, segnalazioni o bug: classificarli e proporre priorità e prossimo passo.', 'Per ogni voce: cosa è, quanto è urgente, chi o cosa serve dopo. Non risolvere i problemi, smistali.'],
  'research-web': ['Cercare informazioni sul web e riassumerle con le fonti.', 'Cerca in più fonti affidabili, confrontale, riassumi con i link. Distingui fatti verificati e opinioni.'],
  investigation: ['Indagare un problema o una domanda tecnica: leggere codice, log e dati e spiegare cosa succede.', 'Raccogli prove (codice, log, dati), formula ipotesi e verificale. Riporta la causa più probabile e cosa resta incerto. Non modificare senza che ti venga chiesto.'],
  'app-feature': ['Implementare una funzione nuova o una modifica del codice (feature, refactor, pull request).', 'Leggi le regole del repository, implementa con test, verifica con i controlli del progetto. Riporta cosa hai cambiato, dove e come l’hai verificato.'],
  regia: ['Coordinare altri agenti su un lavoro diviso in parti.', 'Dividi il lavoro, assegna ogni parte e verifica i risultati prima di riportarli.'],
  altro: ['Attività varie che non rientrano negli altri tipi di lavoro.', 'Chiarisci il risultato atteso, lavora per passi verificabili e riporta cosa hai fatto, con le prove.'],
};
/** The whenToUse and instructions of a legacy row's kind and areas (empty area list = any area). */
export function legacyGuidance(kind: RoutingRow['kind'], area: readonly string[]): { whenToUse: string; instructions: string } {
  const [when, how] = GUIDANCE[kind] ?? GUIDANCE.altro;
  return { whenToUse: `${when}${area.length ? ` Area: ${area.join(', ')}.` : ''}`.slice(0, 1000), instructions: how };
}
/** The kind of a profile imported from a legacy row, read back from its name ("Correzione bug · App"); null = not one. */
export function legacyKindOf(name: string): RoutingRow['kind'] | null {
  const label = name.split(' · ')[0]!.trim();
  const hit = (Object.entries(LABELS) as [RoutingRow['kind'], string][]).find(([, l]) => l === label);
  return hit ? hit[0] : null;
}

/** Null means malformed; sorted labels make equivalent area sets share a stable identity. */
function areas(value: unknown): string[] | null {
  if (value === undefined) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length === 0 || values.length > 16) return null;
  const normalized: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string' || item.length > 120 || !item.trim() || /[\u0000-\u001f\u007f]/.test(item)) return null;
    normalized.push(item.trim());
  }
  return [...new Set(normalized)].sort();
}

/** Does not mutate routing or choose an available replacement engine/model; instructions are the kind's short guidance. */
export function legacyAgentProfiles(rows: readonly RoutingRow[], now: number, options: { apiEngine?: string | null } = {}): { profiles: AgentProfile[]; skipped: number } {
  if (!Array.isArray(rows)) return { profiles: [], skipped: 1 };
  if (!Number.isFinite(now)) throw new Error('Data di importazione non valida.');
  const profiles: AgentProfile[] = [];
  const seen = new Set<string>();
  let skipped = Math.max(0, rows.length - 1000);
  for (let i = 0; i < Math.min(rows.length, 1000); i++) {
    const value: unknown = rows[i];
    if (!value || typeof value !== 'object' || Array.isArray(value)) { skipped++; continue; }
    const row = value as Record<string, unknown>;
    const area = areas(row.area);
    if (typeof row.harness !== 'string' || !ENGINE.test(row.harness)
      || typeof row.model !== 'string' || !MODEL.test(row.model)
      || !(row.effort === null || EFFORTS.includes(row.effort))
      || !(row.onApi === undefined || typeof row.onApi === 'boolean')
      || !(row.kind === '*' || (TASK_KINDS as readonly unknown[]).includes(row.kind)) || area === null) {
      skipped++; continue;
    }
    // onApi explicitly chose API billing; missing API configuration must never turn it into a CLI chat.
    const engine = row.onApi === true ? options.apiEngine : row.harness;
    if (typeof engine !== 'string' || !ENGINE.test(engine)) { skipped++; continue; }
    const kind = row.kind as RoutingRow['kind'];
    const key = JSON.stringify([engine, row.model, row.effort, kind, area, row.onApi === true]);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const label = LABELS[kind];
    const scope = area.length ? ` · ${area.join(', ')}` : '';
    profiles.push({
      id: `legacy-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
      name: `${label}${scope}`.slice(0, 80),
      purpose: `Importazione legacy: ${label}${scope}. Configurazione del motore e del modello conservata.`.slice(0, 400),
      instructions: legacyGuidance(kind, area).instructions, manifest: { whenToUse: legacyGuidance(kind, area).whenToUse }, engine, model: row.model,
      ...(row.effort === null ? {} : { effort: row.effort as Effort }),
      avatar: { kind: 'symbol', value: AGENT_SYMBOLS[0] }, createdAt: now, updatedAt: now,
    });
  }
  return { profiles, skipped };
}
