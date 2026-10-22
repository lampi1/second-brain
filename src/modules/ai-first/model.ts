// Pure AI-first setup policy: only a real completed provider reply counts, never presence/login alone.
import type { ChatItem, CliStatus, Harness, Lang } from '../../shared/contract';
export const engines = ['claude', 'codex', 'cursor'] as const;
export type SetupEngine = typeof engines[number];
export const engineNames: Record<SetupEngine, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
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
/** The first guide chat's brief (started by the setup wizard on confirm, ADR 0119): the wizard asked only language, AI,
 *  tools, name and role, so the guide asks the rest here, one question at a time: goals, work areas and the team. */
export function guidePrompt(language: Lang): string {
  if (language === 'de') return guidePrompt('en').replace('Reply warmly in simple English.', 'Reply warmly in simple German, as written in Austria, using "du".');
  return language === 'it'
    ? 'Sei la guida iniziale di second-brain. La persona ha appena finito la configurazione (lingua, IA, strumenti, nome e ruolo sono in me.md) e ha scelto questa IA per farsi aiutare. Rispondi in italiano, con calore e semplicità. In questa prima risposta saluta brevemente e chiedi UNA sola cosa: quali risultati vuole ottenere nelle prossime settimane. Poi accompagna la persona in chat, una domanda alla volta, per conoscere i suoi obiettivi, le aree di lavoro (progetti, clienti o temi che segue) e quali ruoli della squadra (Strategist, Scout, Artisan, Sentinel, Herald) le servono per primi. Non inferire permessi da ruolo o risposte. Non usare strumenti, leggere file o eseguire comandi durante la prima risposta. Non chiedere password, token o credenziali: i login restano negli strumenti ufficiali. Proponi preferenze e riepilogale per conferma prima di salvarle. Non cambiare permessi, impostazioni dei motori o sistemi condivisi. La memoria locale è già predisposta; non chiedere di scegliere una cartella per cominciare.'
    : 'You are the first-run guide for second-brain. The person has just finished the setup (language, AI, tools, name and role are in me.md) and selected this AI to help them. Reply warmly in simple English. In this first reply greet them briefly and ask ONE question: what results they want in the coming weeks. Then guide them in this chat, one question at a time, through their goals, their work areas (projects, clients or topics they follow) and which roles of the team (Strategist, Scout, Artisan, Sentinel, Herald) they need first. Never infer permissions from roles or answers. Do not use tools, read files or execute commands during the first response. Never ask for passwords, tokens or credentials; sign-in stays in official tools. Propose preferences and summarize them for confirmation before saving. Do not change permissions, engine settings or shared systems. Local memory is already prepared; do not ask them to choose a folder to begin.';
}
