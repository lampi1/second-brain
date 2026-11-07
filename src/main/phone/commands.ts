// The bot's commands from the paired phone (design §4): /stato (PC on, Orchestrator busy or free, how many chats wait,
// their neutral labels), /pausa and /riprendi (outgoing messages only: what the phone sends still arrives), /stop (the
// bridge stops until it is switched on again on the PC), /start when already paired. Unpairing is only on the PC.
// Replies go through outbound.ts (filtered). Used by bridge.ts; tests: test/unit/phone/commands.test.ts.
export type CommandName = 'stato' | 'pausa' | 'riprendi' | 'stop' | 'start' | 'aiuto' | 'unknown';

export const HELP_TEXT = 'Comandi: /stato /pausa /riprendi /stop. Scrivimi o mandami un vocale per l\'Orchestrator.';
export const STOP_TEXT = '⛔ Bridge fermato dal telefono. Riaccendilo dal PC (Impostazioni → Telefono).';

const NAMES: Record<string, CommandName> = { stato: 'stato', status: 'stato', pausa: 'pausa', riprendi: 'riprendi', stop: 'stop', start: 'start', aiuto: 'aiuto', help: 'aiuto' };

/** "/stato", "/stato@MioBot", "/STATO" → the command; null when the text is not a command. */
export function parseCommand(text: string): { name: CommandName; arg: string } | null {
  const m = /^\/([A-Za-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  return { name: NAMES[m[1]!.toLowerCase()] ?? 'unknown', arg: (m[2] ?? '').trim() };
}

export function statoText(s: { waiting: number; orchestratorBusy: boolean; labels: string[] }, paused: boolean): string {
  const lines = [`🟢 PC acceso · Orchestrator ${s.orchestratorBusy ? 'occupato' : 'libero'}`];
  if (s.waiting === 0) lines.push('Nessuna chat ti aspetta.');
  else {
    const shown = s.labels.slice(0, 5).map(l => `«${l.slice(0, 40)}»`).join(', ');
    lines.push(`${s.waiting === 1 ? '1 chat ti aspetta' : `${s.waiting} chat ti aspettano`}${shown ? `: ${shown}` : ''}`);
  }
  if (paused) lines.push('⏸️ In pausa: /riprendi per ricevere i messaggi.');
  return lines.join('\n');
}

export interface CommandContext {
  summary(): { waiting: number; orchestratorBusy: boolean; labels: string[] };
  paused(): boolean;
  setPaused(paused: boolean): void;
  stopFromPhone(): void;
}

/** Runs a command; returns the reply text. */
export function runCommand(name: CommandName, ctx: CommandContext): string {
  switch (name) {
    case 'stato': return statoText(ctx.summary(), ctx.paused());
    case 'pausa': ctx.setPaused(true); return '⏸️ In pausa: niente messaggi dal PC tranne le urgenze. /riprendi per riattivarli.';
    case 'riprendi': ctx.setPaused(false); return '▶️ Ripreso: ti scrivo di nuovo.';
    case 'stop': ctx.stopFromPhone(); return STOP_TEXT;
    case 'start': return '✅ Già collegato a questo PC.';
    default: return HELP_TEXT;
  }
}
