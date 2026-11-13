// Italian texts of «Controllo remoto» (ADR 0222): the phone button on the Orchestrator's head and the line under it
// with the claude.ai link. The source: the other languages are typed by it.
export const remoteIt = {
  'remote.turnOn': 'Controllo remoto: continua l’Orchestrator dal telefono (claude.ai)',
  'remote.starting': 'Controllo remoto: accensione…',
  'remote.ready': 'Controllo remoto acceso: apri il link sul telefono, nell’app Claude o su claude.ai.',
  'remote.connected': 'Controllo remoto collegato: apri il link sul telefono, nell’app Claude o su claude.ai.',
  'remote.paused': 'Controllo remoto in pausa: si riaggancia quando l’Orchestrator riparte.',
  'remote.failed': (p: { error: string }) => `Controllo remoto non acceso: ${p.error}`,
  'remote.copy': 'Copia link',
  'remote.off': 'Spegni',
  'remote.retry': 'Riprova',
  'remote.noQr': 'Niente QR code: l’app non ha una libreria per disegnarlo. Copia il link e aprilo sul telefono.',
};
