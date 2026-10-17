// First screen copy: the person chooses an AI before any questions about folders, work or role.
export const aiCopy = {
  it: {
    title: 'Collega la tua IA', intro: 'Comincia dall’IA che usi già. Sarà lei ad aiutarti a preparare il tuo spazio, una domanda alla volta.',
    checking: 'Cerco le IA installate su questo computer…', found: 'Installata', missing: 'Non rilevata', unknown: 'Da verificare', login: 'Accedi',
    connect: 'Prova e inizia', needsLogin: 'Accesso da completare', ready: 'Disponibile per la prova', loginOpened: 'Completa l’accesso nella finestra ufficiale, poi premi “Prova e inizia”.',
    trial: 'La prova invia un messaggio reale all’IA che scegli e può usare il tuo abbonamento. Password e credenziali restano nel suo accesso ufficiale.',
    memory: 'La memoria locale si prepara da sola. Potrai cambiarla più avanti.', waiting: 'Aspetto la prima risposta della tua IA…', verified: 'La tua IA ha risposto. Ora ti accompagna in chat.',
    fallback: 'Continua senza IA', fallbackHint: 'Se non riesci a collegarla, puoi usare il questionario e tornare qui più avanti.', refresh: 'Rileva di nuovo', cancel: 'Interrompi la prova', resume: 'Riprendi con la tua IA',
    error: 'Il collegamento non è riuscito. Puoi accedere di nuovo, provare un’altra IA o continuare senza.', memoryError: 'La memoria locale non è disponibile. Riprova; le cartelle già scelte non verranno sostituite.',
    timeout: 'Non è arrivata una risposta entro il tempo previsto. La prova è stata interrotta; puoi riprovare.', cancelled: 'Prova interrotta. Puoi scegliere un’altra IA.', known: 'Accesso rilevato: verifichiamolo con una risposta reale.', close: 'Più tardi', details: 'Dettagli dello strumento', retryTrial: 'Riprova la verifica della chat',
  },
  en: {
    title: 'Connect your AI', intro: 'Start with the AI you already use. It will help you set up your workspace, one question at a time.',
    checking: 'Looking for AI tools installed on this computer…', found: 'Installed', missing: 'Not detected', unknown: 'Not yet verified', login: 'Sign in',
    connect: 'Try and get started', needsLogin: 'Sign-in needed', ready: 'Ready for a trial', loginOpened: 'Complete sign-in in the official window, then choose “Try and get started”.',
    trial: 'The trial sends a real message to the AI you choose and may use your subscription. Passwords and credentials stay in its official sign-in.',
    memory: 'Local memory is prepared automatically. You can change it later.', waiting: 'Waiting for the first reply from your AI…', verified: 'Your AI replied. It will now guide you in chat.',
    fallback: 'Continue without AI', fallbackHint: 'If you cannot connect an AI, use the questionnaire and come back later.', refresh: 'Check again', cancel: 'Stop the trial', resume: 'Continue with your AI',
    error: 'Unable to connect. Sign in again, try another AI, or continue without one.', memoryError: 'Local memory is unavailable. Retry; folders you have already chosen will not be replaced.',
    timeout: 'No reply arrived in time. The trial was stopped; you can retry.', cancelled: 'Trial stopped. You can choose another AI.', known: 'Sign-in detected: let us verify it with a real reply.', close: 'Later', details: 'Tool details', retryTrial: 'Check the setup chat again',
  },
} as const;
