// Pure AI-first setup policy: only a real completed provider reply counts, never presence/login alone.
import type { ChatItem, CliStatus, Harness } from '../../shared/contract';
export const engines = ['claude', 'codex', 'kimi', 'cursor'] as const;
export type SetupEngine = typeof engines[number];
export const engineNames: Record<SetupEngine, string> = { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi', cursor: 'Cursor' };
export type GuideProgress = { engine: SetupEngine; chatId: string; stage: 'connecting' | 'guided' | 'fallback' };
export function setupEngine(value: Harness): value is SetupEngine { return (engines as readonly string[]).includes(value); }
export function replyProof(items: ChatItem[]): 'pending' | 'verified' | 'failed' {
  const result = [...items].reverse().find(item => item.kind === 'result');
  if (!result || result.kind !== 'result') return 'pending';
  if (items.indexOf(result) < items.findLastIndex(item => item.kind === 'user')) return 'pending';
  if (result.isError || result.interrupted) return 'failed';
  const end = items.indexOf(result);
  const start = items.slice(0, end).findLastIndex(item => item.kind === 'user');
  return items.slice(start + 1, end).some(item => item.kind === 'assistant' && !!item.text.trim() && !item.streaming) ? 'verified' : 'failed';
}
export function installation(status: CliStatus | undefined): 'found' | 'missing' | 'unknown' { return !status ? 'unknown' : status.found ? 'found' : 'missing'; }
export function guidePrompt(language: 'it' | 'en'): string {
  return language === 'it'
    ? 'Sei la guida iniziale di second-brain. La persona ha scelto questa IA per essere aiutata a configurare il proprio spazio. Rispondi in italiano, con calore e semplicità. In questa prima risposta saluta brevemente e chiedi UNA sola cosa: come lavora la persona (in azienda, in autonomia, studio o altro). Poi accompagna la persona in chat, una domanda alla volta, per conoscere obiettivi, strumenti, cartelle e ruolo preferito. Non inferire permessi da ruolo o risposte. Non usare strumenti, leggere file o eseguire comandi durante la prima risposta. Non chiedere password, token o credenziali: i login restano negli strumenti ufficiali. Proponi preferenze e riepilogale per conferma prima di salvarle. Non cambiare permessi, impostazioni dei motori o sistemi condivisi. La memoria locale è già predisposta; non chiedere di scegliere una cartella per cominciare.'
    : 'You are the first-run guide for second-brain. The person selected this AI to help set up their workspace. Reply warmly in simple English. In this first reply greet them briefly and ask ONE question: how they work (in an organization, independently, studying, or otherwise). Then guide them in this chat, one question at a time, through goals, tools, work folders and preferred role. Never infer permissions from roles or answers. Do not use tools, read files or execute commands during the first response. Never ask for passwords, tokens or credentials; sign-in stays in official tools. Propose preferences and summarize them for confirmation before saving. Do not change permissions, engine settings or shared systems. Local memory is already prepared; do not ask them to choose a folder to begin.';
}
