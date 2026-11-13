// Which code blocks of a chat can be run with "Esegui", and which ones touch production. Why: the user wants Copia on
// every block and Esegui on shell blocks, run by his click in a visible PowerShell 5.1 inside the app; production
// commands are his alone (the user's brain rule "Safety": the agent proposes, the user runs), so they ask one more click and say
// why. Pure: used by the code block toolbar (renderer) and by the runner (main), which checks again.
import type { RunInfo } from './contract';

/** Languages whose blocks get "Esegui". Bash blocks too: in the user's chats they carry PowerShell commands (me.md
 *  "Commands for him to run: … block `bash` … PowerShell syntax"); they run in PowerShell 5.1 either way. */
const RUNNABLE = new Set(['bash', 'sh', 'shell', 'powershell', 'ps', 'ps1', 'pwsh', 'console', 'cmd', 'bat']);

export function isRunnable(lang: string | null | undefined): boolean {
  return RUNNABLE.has((lang ?? '').trim().toLowerCase());
}

/** The longest block the app runs (an -EncodedCommand line stays far below Windows' 32 767 characters). */
export const MAX_RUN_CODE = 8000;

const PROD: { re: RegExp; why: string }[] = [
  { re: /\b(sqlcmd|sqlpackage)\b[\s\S]*database\.windows\.net/i, why: 'interroga un database Azure' },
  { re: /\bro-query\b/i, why: 'interroga un database di produzione' },
  { re: /\bops[/\\]runner[/\\]|\bops\.sh\b/i, why: 'lancia uno script di produzione' },
  { re: /(^|[\s;|&(])az\s+(?!(?:account|login|version|extension|config)\b)\S+[^\n]*\s(create|delete|update|set|restart|stop|start|swap|deploy|import|purge|add|remove|assign|scale|config-zip|upload|reset|renew|invoke)\b/im, why: 'cambia una risorsa Azure' },
  { re: /(^|[\s;|&(])az\s+rest\b[^\n]*--method\s+(post|put|patch|delete)\b/im, why: 'cambia una risorsa Azure' },
  { re: /\b(Set|Remove|New|Stop|Restart|Start|Update|Publish|Invoke)-Az[A-Z]\w*/i, why: 'cambia una risorsa Azure' },
  { re: /\bInvoke-Sqlcmd\b/i, why: 'interroga un database' },
];

/** Why a block looks like a production command (Italian, short), or null. The UI asks one more click for these. */
export function prodRisk(code: string): string | null {
  for (const p of PROD) if (p.re.test(code)) return p.why;
  return null;
}

/** One message for the chat with the outcome of a run (the "Manda l'esito alla chat" button, and app_command_runs). */
export function runReport(run: RunInfo, maxOutput = 3000): string {
  const out = run.output.trim();
  const shown = out.length > maxOutput ? `…${out.slice(-maxOutput)}` : out;
  const how = run.state === 'running' ? 'ancora in corso' : run.state === 'stopped' ? 'fermato da me' : `exit code ${run.exitCode ?? '?'}`;
  return `Ho eseguito il comando (${how}):\n\`\`\`powershell\n${run.code}\n\`\`\`\nOutput:\n\`\`\`\n${shown || '(nessun output)'}\n\`\`\``;
}
