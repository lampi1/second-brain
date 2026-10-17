// Accessible onboarding copy shared by the wizard screen and the Regia action.
export const copy = {
  it: {
    title: 'Collega i tuoi strumenti', intro: 'Troviamo le cartelle di lavoro nei posti noti. Leggiamo solo metadati locali, senza aprire file cloud o contattare servizi.',
    discover: 'Mostrami cosa trovi', project: 'Cartella del progetto', service: 'Servizio', organization: 'Organizzazione Azure DevOps', tools: 'Strumenti da collegare',
    preview: 'Mostra il piano', confirm: 'Conferma e collega', undo: 'Annulla collegamento', retry: 'Verifica di nuovo', skip: 'Più tardi', details: 'Dettagli delle modifiche',
    plan: 'Aggiungeremo il collegamento solo a questo progetto. Conserveremo una copia protetta per annullare. L’accesso si completa nello strumento ufficiale.',
    limits: 'Ricerca limitata: puoi scegliere un’altra cartella.', unknown: 'Accesso non verificato', pending: 'Accesso o verifica da completare', verified: 'Collegamento verificato', failed: 'Verifica non riuscita', busy: 'Operazione in corso…', undone: 'Collegamento annullato. L’accesso al servizio rimane gestito dallo strumento ufficiale.',
  },
  en: {
    title: 'Connect your tools', intro: 'Find work folders in known locations. We read local metadata only, skipping cloud-only files and making no service requests.',
    discover: 'Show what you find', project: 'Project folder', service: 'Service', organization: 'Azure DevOps organization', tools: 'Tools to connect',
    preview: 'Show the plan', confirm: 'Confirm and connect', undo: 'Undo connection', retry: 'Check again', skip: 'Later', details: 'Change details',
    plan: 'We will add the connection only to this project and keep a protected copy for undo. Complete sign-in in your official tool.',
    limits: 'Search limit reached: you can choose another folder.', unknown: 'Sign-in not verified', pending: 'Sign-in or verification pending', verified: 'Connection verified', failed: 'Verification failed', busy: 'Working…', undone: 'Connection undone. Service sign-in remains managed by your official tool.',
  },
} as const;
export const setupCopy = {
  it: {
    eyebrow: 'IL TUO SPAZIO DI LAVORO', title: 'Partiamo da quello che usi già.',
    intro: 'Scegli un progetto e collega i tuoi strumenti. Al resto pensiamo noi, con il tuo ok.',
    discovering: 'Sto cercando i tuoi progetti e strumenti…', detectedTitle: 'Ecco cosa ho trovato',
    projects: 'I tuoi progetti', services: 'Servizi da collegare', tools: 'I tuoi strumenti', repository: 'Repository trovato', workFolder: 'Cartella di lavoro',
    noProject: 'Non ho ancora trovato un progetto. Puoi scegliere la cartella qui sotto.', detected: 'Rilevato nei tuoi progetti', available: 'Disponibile da collegare',
    connect: 'Collega', installed: 'Installato', notDetected: 'Non rilevato', signInUnknown: 'Accesso da verificare',
    command: 'Che cosa vuoi collegare?', placeholder: 'Scrivi, per esempio: collega Jira', send: 'Mostra il piano',
    chooseProject: 'Scegli prima un progetto dalle card, oppure indica una cartella nelle altre opzioni.', chooseTools: 'Seleziona almeno uno strumento installato. Se non lo trovi, puoi riprovare il rilevamento.',
    unknownCommand: 'Puoi scrivere “collega Jira”, “collega GitHub” o “collega Azure DevOps”.',
    more: 'Altre opzioni', folder: 'Cartella del progetto', useFolder: 'Usa questa cartella', refresh: 'Cerca di nuovo',
    planTitle: 'Questo è il collegamento che prepareremo', projectScope: 'Solo per il progetto', backup: 'Copia protetta e annullamento inclusi',
    diff: 'Modifiche alla configurazione', organizationHelp: 'Come si chiama la tua organizzazione Azure DevOps?', organizationGo: 'Prepara il piano Azure DevOps',
    localOnly: 'Solo metadati locali · nessun accesso ai servizi durante il rilevamento',
    repos: 'repository', found: 'Ho trovato', noResults: 'Nessun progetto o strumento rilevato per ora.',
    detectedTools: 'strumenti installati', chosen: 'Selezionato', resultTitle: 'Il tuo collegamento', change: 'Cambia scelta',
  },
  en: {
    eyebrow: 'YOUR WORKSPACE', title: 'Start with what you already use.',
    intro: 'Choose a project and connect your tools. We handle the setup, with your approval.',
    discovering: 'Looking for your projects and tools…', detectedTitle: 'Here is what I found',
    projects: 'Your projects', services: 'Services to connect', tools: 'Your tools', repository: 'Repository found', workFolder: 'Work folder',
    noProject: 'No project found yet. You can choose a folder below.', detected: 'Detected in your projects', available: 'Available to connect',
    connect: 'Connect', installed: 'Installed', notDetected: 'Not detected', signInUnknown: 'Sign-in not verified',
    command: 'What would you like to connect?', placeholder: 'For example: connect Jira', send: 'Show the plan',
    chooseProject: 'Choose a project card first, or enter a folder under more options.', chooseTools: 'Select at least one installed tool. You can retry discovery if your tool is missing.',
    unknownCommand: 'Try “connect Jira”, “connect GitHub” or “connect Azure DevOps”.',
    more: 'More options', folder: 'Project folder', useFolder: 'Use this folder', refresh: 'Search again',
    planTitle: 'Here is the connection we will set up', projectScope: 'Only for project', backup: 'Protected backup and undo included',
    diff: 'Configuration changes', organizationHelp: 'What is your Azure DevOps organization called?', organizationGo: 'Prepare the Azure DevOps plan',
    localOnly: 'Local metadata only · no service access during discovery',
    repos: 'repositories', found: 'I found', noResults: 'No projects or tools detected yet.',
    detectedTools: 'tools installed', chosen: 'Selected', resultTitle: 'Your connection', change: 'Change selection',
  },
} as const;
// Only module-owned messages reach the UI. Unexpected filesystem/provider errors never leak config excerpts.
const messages: Record<string, string> = {
  'Native cloud-attribute adapter unavailable': 'La verifica dei file cloud non è disponibile su questo sistema. Nessun file aperto o modificato.',
  'Choose supported tools': 'Scegli gli strumenti da collegare.',
  'Choose a project folder': 'Scegli una cartella di progetto.',
  'Choose an absolute local folder': 'Scegli una cartella locale con percorso completo.',
  'Choose your Azure DevOps organization': 'Indica il nome della tua organizzazione Azure DevOps.',
  'Local path unavailable': 'Il percorso locale non è disponibile.',
  'Cloud-only or linked path skipped': 'Percorso cloud o collegato saltato.',
  'Existing authentication settings require secure migration before connecting': 'La configurazione contiene dati di accesso: serve una migrazione protetta prima del collegamento.',
  'Existing Codex settings need a preserving TOML adapter; no file changed': 'Le impostazioni Codex esistenti richiedono un adattatore che le conservi. Nessun file modificato.',
  'Invalid JSON configuration; no file changed': 'La configurazione non è valida. Nessun file modificato.',
  'A connector with this name already exists; review it first': 'Esiste già un collegamento con questo nome. Controllalo prima di continuare.',
  'Configuration changed; prepare a new preview': 'La configurazione è cambiata. Prepara un nuovo piano.',
  'Concurrent edit preserved; prepare another preview': 'Le modifiche successive sono conservate. Prepara un nuovo piano.',
  'Concurrent edit preserved; undo needs review': 'Le modifiche successive sono conservate. Serve un controllo prima di annullare.',
  'Trust or policy changed; prepare a new preview': 'Le autorizzazioni sono cambiate. Prepara un nuovo piano.',
  'Saved. Official harness login and provider verification are still required': 'Configurazione salvata. Completa l’accesso nello strumento ufficiale e verifica il servizio.',
  'Configuration check failed; backup and undo remain available': 'La verifica del file non è riuscita. Copia protetta e annullamento restano disponibili.',
  'Read-only harness connection check failed': 'La verifica in sola lettura del collegamento non è riuscita.',
  'Undo interrupted; retry Undo to complete restoration': 'Annullamento interrotto. Premi di nuovo Annulla per completarlo.',
  'No compatible tools selected; configuration remains unchanged': 'Nessuno strumento compatibile selezionato. La configurazione resta invariata.',
  'Secure backup unavailable': 'Copia protetta non disponibile. Collegamento interrotto.',
  'Azure remote authentication is unsupported by Codex; configuration is not changed.': 'Codex non supporta questo accesso Azure. La configurazione resta invariata.',
  'Azure requires an organization-managed Entra application; configuration is not changed until a supported adapter exists.': 'Azure richiede un’app Entra gestita dall’organizzazione. Il collegamento rimane in attesa di un adattatore compatibile.',
  'project trust, installation or company policy needs confirmation': 'Verifica installazione, autorizzazione del progetto e regole aziendali.',
};
export function message(text: string, language: 'it' | 'en'): string {
  const prefix = text.match(/^(claude|codex|cursor): (.*)$/);
  if (prefix) return `${({ claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' } as Record<string, string>)[prefix[1]!]}: ${message(prefix[2]!, language)}`;
  if (Object.hasOwn(messages, text)) return language === 'it' ? messages[text]! : text;
  return language === 'it' ? 'Operazione non completata. I dati sono conservati; riprova o controlla il collegamento.' : 'Operation incomplete. Data is preserved; retry or review the connection.';
}
