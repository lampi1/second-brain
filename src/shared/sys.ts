// System chat items in Italian and English (ADR 0057): the chat adapters (main/chats/claude.ts, acp.ts, api.ts,
// transcript.ts, manager.ts, demo.ts) build a `kind: 'system'` ChatItem with a code and params instead of writing the
// Italian text themselves; the renderer picks SYS_IT or SYS_EN through t() (src/renderer/i18n/index.ts, sysText()).
// Two flat dictionaries, same keys ('sys.<code>'): SYS_IT is the source (byte-identical to the old fixed Italian
// strings), SYS_EN is typed by it so a missing or extra key fails the typecheck. A value is a string, or a function of
// one flat params object (strings and numbers only: a nested choice, e.g. which setting a model restart affects, is
// encoded as a short English key inside a string param and mapped to a localized word by the function itself, not by
// the renderer). sysEn() renders the English text main writes into an item's `text` (for agents, logs, and so every
// item has a readable fallback even when the UI does not know a code yet).

export const SYS_IT = {
  // ---- stopped / interrupted (claude.ts, acp.ts, api.ts, transcript.ts, demo.ts) ----
  'sys.stoppedByYou': 'Interrotto da te.',
  'sys.stoppedByYouResend': 'Interrotto da te: riparto col tuo messaggio.',
  'sys.interrupted': 'Interrotto.',
  'sys.queueCancelled': (p: { n: number }) => `Messaggi in coda annullati: ${p.n}.`,

  // ---- claude.ts: API_ERRORS (onAssistant m.error) ----
  'sys.api.authentication_failed': 'Login di Claude non valido: esegui `claude` nel terminale e fai /login, poi riprova.',
  'sys.api.oauth_org_not_allowed': 'Questo account non può usare Claude Code: controlla il login (`claude /login`).',
  'sys.api.rate_limit': 'Limite di utilizzo raggiunto: aspetta il reset o cambia modello.',
  'sys.api.overloaded': 'API di Anthropic sovraccarica: riprova tra poco.',
  'sys.api.billing_error': 'Problema di fatturazione sull’account Claude.',
  'sys.api.model_not_found': 'Modello non trovato: scegline un altro.',
  'sys.api.max_output_tokens': 'Risposta troncata: raggiunto il limite di token in uscita.',
  'sys.api.other': (p: { err: string }) => `Errore dell’API: ${p.err}`,

  // ---- claude.ts: RESULT_ERRORS (onResult, a failed turn with no words from the CLI) ----
  'sys.turnFailed.error_max_turns': 'Turno finito con errore: raggiunto il limite di passi del turno.',
  'sys.turnFailed.error_max_budget_usd': 'Turno finito con errore: raggiunto il budget massimo del turno.',
  'sys.turnFailed.error_during_execution': 'Turno finito con errore: errore durante l’esecuzione (il motore non ha detto altro).',
  'sys.turnFailed.error_max_structured_output_retries': 'Turno finito con errore: risposta strutturata non valida dopo più tentativi.',
  'sys.turnFailed.other': (p: { subtype: string }) => `Turno finito con errore: ${p.subtype}.`,
  'sys.turnFailed.none': 'Turno finito con errore: il motore non ha detto il motivo.',

  // ---- claude.ts: onSystem ----
  'sys.compacting': 'Compattazione del contesto…',
  'sys.compacted': (p: { pre: string | number; post: string | number }) => `Contesto compattato (${p.pre} → ${p.post} token).`,
  'sys.apiRetry': (p: { attempt: string | number; max: string | number; error: string }) => `Nuovo tentativo API ${p.attempt}/${p.max} (${p.error || 'errore'}).`,
  'sys.permissionDenied': (p: { tool: string; message: string }) => `Permesso negato: ${p.tool}${p.message ? ` · ${p.message}` : ''}`,
  'sys.modelRefusal': 'Il modello ha rifiutato la richiesta.',

  // ---- transcript.ts ----
  'sys.compactedPlain': 'Contesto compattato.',
  'sys.commandNoOutput': '(comando eseguito)',

  // ---- acp.ts ----
  'sys.resumeFailed': (p: { label: string; error: string }) => `${p.label} non ha ripreso la sessione precedente (${p.error}): ne apro una nuova.`,
  'sys.noResume': (p: { label: string }) => `Questa versione di ${p.label} non riprende le sessioni: ne apro una nuova.`,
  // p.misses: semicolon-joined fragments of kind "askedModel:<model>" / "notOffered:<name>:<value>" /
  // "notApplied:<name>:<value>" / "refused:<name>:<value>" (parsed by missText below, not translated per word by the
  // renderer: a rare development-time diagnostic, kept as one function so both languages read the same fragments).
  'sys.runningOther': (p: { label: string; variant: string; misses: string }) => `${p.label} gira ${p.variant} (${missesIt(p.misses)}).`,
  'sys.imagesNotSent': (p: { label: string; error: string }) => `Immagini non inviate a ${p.label}: ${p.error}`,
  'sys.engineError': (p: { label: string; error: string }) => `Errore di ${p.label}: ${p.error}`,
  'sys.turnCut': (p: { label: string; stop: string }) => `Turno interrotto da ${p.label} (${p.stop}).`,
  'sys.netRetriesExhausted': (p: { label: string; error: string; n: string | number }) => `${p.label} si è fermata di nuovo per un errore di rete (${p.error}) dopo ${p.n} ripartenze automatiche: scrivi «continua» quando la rete è tornata.`,
  'sys.netRetryScheduled': (p: { label: string; seconds: string | number; attempt: string }) => `Errore di rete di ${p.label}: riparto da sola tra ${p.seconds} s (${attemptIt(p.attempt)}).`,
  'sys.netRetried': (p: { label: string; attempt: string }) => `Ripartita da sola dopo un errore di rete di ${p.label} (${attemptIt(p.attempt)}).`,
  'sys.netRetryCancelledStopped': 'Ripartenza automatica annullata (interrotta).',
  'sys.netRetryCancelledHandoff': 'Ripartenza automatica annullata (passaggio di consegne interrotto).',
  'sys.netRetryCancelledClosed': 'Ripartenza automatica annullata (sessione chiusa).',
  'sys.todos': (p: { list: string }) => `Attività:\n${p.list}`,
  'sys.plan': (p: { list: string }) => `Piano:\n${p.list}`,
  'sys.subagent': (p: { description: string }) => `Subagente: ${p.description}`,

  // ---- manager.ts ----
  'sys.modelChangeQueued': (p: { model: string; label: string; reopen: string | number }) => `Modello ${p.model || 'predefinito'}: ${p.label} riparte con questo modello dal prossimo messaggio${p.reopen ? ', finito questo turno' : ''}.`,
  // p.items: comma-joined keys among title|model|effort|permissionMode
  'sys.appliedLater': (p: { items: string }) => `Applicato dal prossimo avvio: ${laterIt(p.items)}.`,
  'sys.handoffSavedChat': 'Passaggio di consegne salvato: «Riprendi» apre una chat nuova che parte da qui.',
  'sys.handoffSavedAuto': 'Passaggio di consegne automatico salvato (la chat non lo ha scritto): «Riprendi» apre una chat nuova che parte da qui.',
  'sys.continuedIn': (p: { title: string }) => `Il lavoro continua nella chat «${p.title}». Questa resta consultabile.`,
  'sys.dayCompactStart': 'Giorno nuovo: compatto il contesto della Regia in un riassunto (le chat che segue e la coda restano).',
  'sys.dayCompactFailed': 'Non sono riuscito a riassumere il contesto della Regia: ci riprovo domani; intanto si compatta da sola al limite impostato.',
  'sys.handoffAsking': 'Chiedo alla chat il passaggio di consegne (un turno breve).',
  'sys.coldContinued': 'Continua da qui: sessione nuova dal passaggio di consegne (la cache della precedente era scaduta).',

  // ---- demo.ts ----
  'sys.recap': (p: { summary: string }) => `Dove eravamo: ${p.summary}`,

  // ---- api.ts ----
  'sys.apiTextOnly': 'Questo motore accetta solo testo: le immagini non sono state inviate.',
  'sys.apiMissingKey': 'Manca la chiave API: impostala in Impostazioni → Motori.',
  'sys.apiMissingModel': 'Manca il modello: sceglilo per questa chat.',
  'sys.apiTimeout': (p: { host: string; seconds: string | number }) => `${p.host} non ha risposto entro ${p.seconds} s.`,
  'sys.apiNoBody': (p: { host: string }) => `${p.host} non ha mandato una risposta.`,
  'sys.apiProviderError': (p: { host: string; detail: string }) => `Errore da ${p.host}: ${p.detail}`,
  'sys.apiKeyRejected': (p: { host: string }) => `Chiave API rifiutata da ${p.host}.`,
  'sys.apiTooManyRequests': (p: { host: string }) => `Troppe richieste a ${p.host} (429): riprova tra poco.`,
  'sys.apiServerError': (p: { host: string; status: string | number }) => `${p.host} ha un problema (errore ${p.status}): riprova tra poco.`,
  'sys.apiRedirect': (p: { host: string }) => `${p.host} ha risposto con un reindirizzamento: richiesta non seguita.`,
  'sys.apiRequestRejected': (p: { host: string; status: string | number; detail: string }) => `Richiesta rifiutata da ${p.host} (${p.status})${p.detail ? `: ${p.detail}` : '.'}`,
  'sys.apiNetworkUnreachable': (p: { host: string; code: string }) => `Rete: ${p.host} non raggiungibile${p.code ? ` (${p.code})` : ''}.`,
};

export type SysCode = { [K in keyof typeof SYS_IT]: K extends `sys.${infer C}` ? C : never }[keyof typeof SYS_IT];
export type SysParams = Record<string, string | number>;

/** acp.ts applyModelConfig's misses, in Italian (SYS_IT.runningOther); keep in step with missEn below. */
function missesIt(joined: string): string {
  return (joined ? joined.split(';;') : []).map(missIt).join('; ');
}
function missIt(one: string): string {
  const [kind, a, b] = parts(one);
  if (kind === 'askedModel') return `modello chiesto ${a}`;
  if (kind === 'notOffered') return `${a} ${b} non offerto`;
  if (kind === 'notApplied') return `${a} ${b} non applicato`;
  if (kind === 'refused') return `${a} ${b} rifiutato`;
  return one;
}
function missEn(one: string): string {
  const [kind, a, b] = parts(one);
  if (kind === 'askedModel') return `asked model ${a}`;
  if (kind === 'notOffered') return `${a} ${b} not offered`;
  if (kind === 'notApplied') return `${a} ${b} not applied`;
  if (kind === 'refused') return `${a} ${b} refused`;
  return one;
}
function missesEn(joined: string): string {
  return (joined ? joined.split(';;') : []).map(missEn).join('; ');
}

/** acp.ts retryNet's attempt, "n/m" → "tentativo n di m" / "attempt n of m". */
function attemptIt(nm: string): string {
  const [n, m] = nm.split('/');
  return `tentativo ${n} di ${m}`;
}
function attemptEn(nm: string): string {
  const [n, m] = nm.split('/');
  return `attempt ${n} of ${m}`;
}

const LATER_WORD_IT: Record<string, string> = { title: 'titolo', model: 'modello', effort: 'effort', permissionMode: 'permessi' };
const LATER_WORD_EN: Record<string, string> = { title: 'title', model: 'model', effort: 'effort', permissionMode: 'permissions' };
function laterIt(joined: string): string {
  return (joined ? joined.split(',') : []).map(k => LATER_WORD_IT[k] ?? k).join(', ');
}
function laterEn(joined: string): string {
  return (joined ? joined.split(',') : []).map(k => LATER_WORD_EN[k] ?? k).join(', ');
}

export const SYS_EN: typeof SYS_IT = {
  'sys.stoppedByYou': 'Stopped by you.',
  'sys.stoppedByYouResend': 'Stopped by you: restarting with your message.',
  'sys.interrupted': 'Interrupted.',
  'sys.queueCancelled': (p: { n: number }) => `Queued messages cancelled: ${p.n}.`,

  'sys.api.authentication_failed': 'Claude login not valid: run `claude` in a terminal and `/login`, then retry.',
  'sys.api.oauth_org_not_allowed': 'This account cannot use Claude Code: check the login (`claude /login`).',
  'sys.api.rate_limit': 'Usage limit reached: wait for the reset or change the model.',
  'sys.api.overloaded': 'Anthropic API overloaded: try again shortly.',
  'sys.api.billing_error': 'Billing problem on the Claude account.',
  'sys.api.model_not_found': 'Model not found: choose another one.',
  'sys.api.max_output_tokens': 'Answer truncated: output token limit reached.',
  'sys.api.other': (p: { err: string }) => `API error: ${p.err}`,

  'sys.turnFailed.error_max_turns': 'Turn ended with an error: reached the turn’s step limit.',
  'sys.turnFailed.error_max_budget_usd': 'Turn ended with an error: reached the turn’s maximum budget.',
  'sys.turnFailed.error_during_execution': 'Turn ended with an error: an error during execution (the engine said nothing else).',
  'sys.turnFailed.error_max_structured_output_retries': 'Turn ended with an error: no valid structured answer after several attempts.',
  'sys.turnFailed.other': (p: { subtype: string }) => `Turn ended with an error: ${p.subtype}.`,
  'sys.turnFailed.none': 'Turn ended with an error: the engine did not say why.',

  'sys.compacting': 'Compacting the context…',
  'sys.compacted': (p: { pre: string | number; post: string | number }) => `Context compacted (${p.pre} → ${p.post} tokens).`,
  'sys.apiRetry': (p: { attempt: string | number; max: string | number; error: string }) => `New API attempt ${p.attempt}/${p.max} (${p.error || 'error'}).`,
  'sys.permissionDenied': (p: { tool: string; message: string }) => `Permission denied: ${p.tool}${p.message ? ` · ${p.message}` : ''}`,
  'sys.modelRefusal': 'The model refused the request.',

  'sys.compactedPlain': 'Context compacted.',
  'sys.commandNoOutput': '(command run)',

  'sys.resumeFailed': (p: { label: string; error: string }) => `${p.label} did not resume the previous session (${p.error}): opening a new one.`,
  'sys.noResume': (p: { label: string }) => `This version of ${p.label} does not resume sessions: opening a new one.`,
  'sys.runningOther': (p: { label: string; variant: string; misses: string }) => `${p.label} runs ${p.variant} (${missesEn(p.misses)}).`,
  'sys.imagesNotSent': (p: { label: string; error: string }) => `Images not sent to ${p.label}: ${p.error}`,
  'sys.engineError': (p: { label: string; error: string }) => `${p.label} error: ${p.error}`,
  'sys.turnCut': (p: { label: string; stop: string }) => `Turn cut by ${p.label} (${p.stop}).`,
  'sys.netRetriesExhausted': (p: { label: string; error: string; n: string | number }) => `${p.label} stopped again on a network error (${p.error}) after ${p.n} automatic retries: write "continue" once the network is back.`,
  'sys.netRetryScheduled': (p: { label: string; seconds: string | number; attempt: string }) => `${p.label} network error: restarting by itself in ${p.seconds} s (${attemptEn(p.attempt)}).`,
  'sys.netRetried': (p: { label: string; attempt: string }) => `Restarted by itself after a ${p.label} network error (${attemptEn(p.attempt)}).`,
  'sys.netRetryCancelledStopped': 'Automatic retry cancelled (stopped).',
  'sys.netRetryCancelledHandoff': 'Automatic retry cancelled (hand-off interrupted).',
  'sys.netRetryCancelledClosed': 'Automatic retry cancelled (session closed).',
  'sys.todos': (p: { list: string }) => `Tasks:\n${p.list}`,
  'sys.plan': (p: { list: string }) => `Plan:\n${p.list}`,
  'sys.subagent': (p: { description: string }) => `Subagent: ${p.description}`,

  'sys.modelChangeQueued': (p: { model: string; label: string; reopen: string | number }) => `Model ${p.model || 'default'}: ${p.label} restarts with this model on the next message${p.reopen ? ', once this turn ends' : ''}.`,
  'sys.appliedLater': (p: { items: string }) => `Applied from the next start: ${laterEn(p.items)}.`,
  'sys.handoffSavedChat': 'Hand-off saved: "Resume" opens a new chat that starts from here.',
  'sys.handoffSavedAuto': 'Automatic hand-off saved (the chat did not write it): "Resume" opens a new chat that starts from here.',
  'sys.continuedIn': (p: { title: string }) => `The work continues in the chat "${p.title}". This one stays readable.`,
  'sys.dayCompactStart': 'New day: compacting the Regia’s context into a summary (the chats it is following and the queue stay).',
  'sys.dayCompactFailed': 'Could not summarise the Regia’s context: trying again tomorrow; meanwhile it compacts by itself at its set limit.',
  'sys.handoffAsking': 'Asking the chat for its hand-off (a short turn).',
  'sys.coldContinued': 'Continuing from here: a new session from the hand-off (the previous one’s cache had expired).',

  'sys.recap': (p: { summary: string }) => `Where we left off: ${p.summary}`,

  'sys.apiTextOnly': 'This engine accepts text only: images were not sent.',
  'sys.apiMissingKey': 'No API key: set it in Settings → Motori.',
  'sys.apiMissingModel': 'No model: choose one for this chat.',
  'sys.apiTimeout': (p: { host: string; seconds: string | number }) => `${p.host} did not answer within ${p.seconds} s.`,
  'sys.apiNoBody': (p: { host: string }) => `${p.host} sent no response body.`,
  'sys.apiProviderError': (p: { host: string; detail: string }) => `Error from ${p.host}: ${p.detail}`,
  'sys.apiKeyRejected': (p: { host: string }) => `API key rejected by ${p.host}.`,
  'sys.apiTooManyRequests': (p: { host: string }) => `Too many requests to ${p.host} (429): try again shortly.`,
  'sys.apiServerError': (p: { host: string; status: string | number }) => `${p.host} has a problem (error ${p.status}): try again shortly.`,
  'sys.apiRedirect': (p: { host: string }) => `${p.host} answered with a redirect: the request was not followed.`,
  'sys.apiRequestRejected': (p: { host: string; status: string | number; detail: string }) => `Request rejected by ${p.host} (${p.status})${p.detail ? `: ${p.detail}` : '.'}`,
  'sys.apiNetworkUnreachable': (p: { host: string; code: string }) => `Network: ${p.host} unreachable${p.code ? ` (${p.code})` : ''}.`,
};

/** Keys built from askedModel/notOffered/notApplied/refused fragments (acp.ts applyModelConfig), joined with ";;".
 *  Names and values come from the engine: URI-encoded, so a "|" or ";;" in them can't break the split. */
const enc = encodeURIComponent;
export const missFragment = {
  askedModel: (model: string): string => `askedModel|${enc(model)}`,
  notOffered: (name: string, value: string): string => `notOffered|${enc(name)}|${enc(value)}`,
  notApplied: (name: string, value: string): string => `notApplied|${enc(name)}|${enc(value)}`,
  refused: (name: string, value: string): string => `refused|${enc(name)}|${enc(value)}`,
};
/** one fragment's parts, decoded (a malformed escape stays as it is) */
function parts(one: string): string[] {
  return one.split('|').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
}

/** The English rendering of a code + params (main writes it into an item's `text`: agents, logs, old items). */
export function sysEn<C extends SysCode>(code: C, params?: SysParams): string {
  const key = `sys.${code}` as keyof typeof SYS_EN;
  const v = SYS_EN[key];
  return typeof v === 'function' ? (v as (p: SysParams) => string)(params ?? {}) : v;
}
