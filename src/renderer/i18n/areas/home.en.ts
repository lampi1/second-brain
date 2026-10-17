// English counterparts of the Home dashboard dictionary.
import type { homeIt } from './home.it';
export const homeEn: typeof homeIt = {
  'home.greeting': (p: { name: string }) => `Hey ${p.name}, what shall we do today?`,
  'home.agents': 'Agents', 'home.manageAgents': 'Manage agents', 'home.backAgents': 'Back to agents', 'home.workspace': 'The agents workspace',
  'home.chooseEngine': 'Choose the coordinator engine', 'home.createRegia': 'Start the app coordinator',
  'home.title': 'Your workspace', 'home.lead': 'Read the data, open the details and discuss them with your coordinator.',
  'home.map': 'Your workspace map', 'home.summary': 'Summary from recorded data',
  'home.spend': 'List-price spend', 'home.works': 'What works', 'home.errors': 'Recurring errors', 'home.ideas': 'Open ideas',
  'home.spendReading': (p: { calls: number }) => `${p.calls} calls in the period. API list prices: not a bill and not automatically complete across engines.`,
  'home.rulesReading': (p: { days: number; pending: number }) => `Rules whose error did not recur within ${p.days} observed days; ${p.pending} cannot yet be assessed. This does not establish causal success.`,
  'home.noRules': 'No rules can yet be assessed in the observed window.',
  'home.errorsReading': (p: { count: number; unknown: number }) => `Repeated categories among ${p.count} recorded errors; ${p.unknown} have no recognized category. This is not a per-turn rate.`,
  'home.ideasReading': (p: { active: number }) => `Ideas still to evaluate; another ${p.active} are in progress.`,
  'home.registeredThrough': 'Recorded history through', 'home.loading': 'Reading available data…', 'home.unavailable': 'Data unavailable: open the details to check the source.',
  'home.updated': 'Read at', 'home.readFailed': 'Refresh failed; any previous data remains visible.',
  'home.retry': 'Retry', 'home.details': 'View details', 'home.conversation': 'Talk with the app and its brain',
  'home.ask': 'Write to the existing app coordinator. The model runs only when you send.',
  'home.noRegia': 'The app coordinator is not active. Open the changes workspace or create an App coordinator from its panel; this page never starts it automatically.',
  'home.question': 'Your request', 'home.placeholder': 'What would you like to understand or improve?', 'home.send': 'Send to coordinator',
  'home.openRegia': 'Open conversation', 'home.sent': 'Request sent.', 'home.queued': 'Request queued in the coordinator.', 'home.notSent': 'Request not sent: your text is preserved. Retry when the chat is available.',
  'home.improve': 'Changes and updates', 'home.compare': 'Model comparison',
};
