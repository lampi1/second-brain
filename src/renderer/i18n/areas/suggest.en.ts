// English texts of the chat composer's inline suggestion (issue #167, ADR 0118); same keys as suggest.it.ts.
import type { suggestIt } from './suggest.it';
export const suggestEn: typeof suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Suggestion: “${p.text}”. Tab accepts it, Esc hides it.`,
  'suggest.group': 'Writing',
  'suggest.groupDesc': 'How the app helps while you write in the chats.',
  'suggest.title': 'Suggestions while you type',
  'suggest.hint': 'Grey text after the cursor: Tab accepts it, Esc hides it, any other key ignores it. First from your past messages, the “/” commands, the roles, the chats and the files: zero tokens.',
  'suggest.model': 'Ask the model when nothing else fits',
  'suggest.modelHint': 'Only after a pause in your typing, with the last line and the chat’s last message, on the smallest model of the API key. Repeated answers come from the cache, with no tokens.',
  'suggest.budget': 'Model daily budget ($)',
  'suggest.budgetHint': 'Once reached, the model stops until tomorrow; local suggestions stay.',
  'suggest.budgetBad': 'An amount from 0.01 to 1 $.',
  'suggest.today': (p: { usd: string; limit: string; calls: number; hits: number }) => `Today ${p.usd} of ${p.limit} · ${p.calls} calls · ${p.hits} from the cache`,
  'suggest.kpi': 'Suggestions today',
  'suggest.kpiSub': (p: { calls: number; hits: number; limit: string }) => `${p.calls} calls, ${p.hits} from the cache · budget ${p.limit}`,
  'suggest.kpiOff': 'model off: local suggestions only, zero tokens',
  'suggest.kpiHelp': 'What the grey text shown while you type in the chats cost today, when the local sources had nothing. At list price, on the API key.',
};
