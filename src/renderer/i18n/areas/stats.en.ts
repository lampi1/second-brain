// English UI texts of the statistics redesign: the same keys as stats.it.ts (typed by it), spread into en.ts.
import type { statsIt } from './stats.it';
type N = { n: number };

export const statsEn: typeof statsIt = {
  'stats.cost.factDay': (p: { day: string; usd: string; x: string }) => `The priciest day was ${p.day}: ${p.usd}, ${p.x}× the period’s average.`,
  'stats.cost.factModel': (p: { model: string; pct: string }) => `${p.model} takes ${p.pct} of the period’s spend.`,
  'stats.cost.factKind': (p: { kind: string; usd: string }) => `The priciest kind of work is "${p.kind}": ${p.usd} in the period.`,

  'stats.err.recurring': 'Recurring errors',
  'stats.err.recurringHelp': 'Groups of app and tool errors with the same cause (usage limit, network, login…) or, when the cause is unknown, the same text once numbers, ids, paths and links are removed; those seen at least twice in the retained data (feed and open chats) count.',
  'stats.err.events': 'Error events',
  'stats.err.eventsHelp': 'Every error retained in the app’s feed and in the messages of the chats still in memory: a turn that ended badly, a failed tool, a system warning. It is not the complete log history.',
  'stats.err.recurringNote': 'Seen at least twice in the retained data', 'stats.err.eventsNote': 'In the feed and the chats in memory',
  'stats.err.groups': 'App and tool errors, grouped',
  'stats.err.groupsLead': 'Each card is an error that comes back: how often, when last, where, what it means and what to do.',
  'stats.err.groupsEmpty': 'No app or tool error in the retained data. If one happens, here you find what it means and what to do.',
  'stats.err.times': (p: N) => (p.n === 1 ? 'once' : `${p.n} times`),
  'stats.err.last': (p: { at: string }) => `last ${p.at}`,
  'stats.err.first': (p: { at: string }) => `first seen ${p.at}`,
  'stats.err.where': 'Where',
  'stats.err.skills': 'Skills in use',
  'stats.err.what': 'What it means',
  'stats.err.todo': 'What to do',
  'stats.err.trend.up': 'rising', 'stats.err.trend.down': 'falling', 'stats.err.trend.flat': 'steady',
  'stats.err.trendHelp': 'Compares the last 7 days with the 7 before: rising when it has more, falling when fewer. Each bar is one day, today is the last.',
  'stats.err.memory': 'Every logged error with the rule each produced is also on the Memory page.',
  'stats.err.openMemory': 'Open Memory',
  'stats.err.factWorst': (p: { pct: string; what: string }) => `${p.pct} of the app errors have one cause: ${p.what}.`,

  'stats.cause.rateLimit.t': 'Usage limit reached', 'stats.cause.rateLimit.w': 'The engine refused more requests for a while: you used the plan’s quota or too many chats ask at once.', 'stats.cause.rateLimit.f': 'Wait for the reset (shown in the top bar) or pause the less urgent chats; if it happens often, move light jobs to a cheaper model.',
  'stats.cause.overloaded.t': 'Service overloaded', 'stats.cause.overloaded.w': 'The model provider was temporarily full: it depends neither on you nor on the app.', 'stats.cause.overloaded.f': 'Retry in a few minutes; if it lasts, check the provider’s status page.',
  'stats.cause.context.t': 'Context full', 'stats.cause.context.w': 'The chat reached the most the model can read at once.', 'stats.cause.context.f': 'Continue in a new chat (the hand-off carries the summary) or lower "Max context" in the role’s profile.',
  'stats.cause.auth.t': 'Login expired or refused', 'stats.cause.auth.w': 'The engine or a service no longer recognises your login.', 'stats.cause.auth.f': 'Log in again from the engine’s command line or Settings → Engines; the app never touches your credentials.',
  'stats.cause.timeout.t': 'Timed out', 'stats.cause.timeout.w': 'A command or request took longer than allowed and was stopped.', 'stats.cause.timeout.f': 'Retry; if it comes back on the same command, ask the agent to split it into smaller steps.',
  'stats.cause.network.t': 'Network problem', 'stats.cause.network.w': 'A service was unreachable: no network, VPN off or a wrong address.', 'stats.cause.network.f': 'Check the connection and the VPN, then retry.',
  'stats.cause.notFound.t': 'Missing file or resource', 'stats.cause.notFound.w': 'An agent looked for a file, folder or page that does not exist (often a path written from memory).', 'stats.cause.notFound.f': 'If it comes back on the same path, write it in a rule or in the agent’s memory.',
  'stats.cause.permission.t': 'Permission denied', 'stats.cause.permission.w': 'An action was blocked: by you, by the role (read only) or by the operating system.', 'stats.cause.permission.f': 'If the role really needs it, widen its permissions from its card in Agents; otherwise it is fine.',
  'stats.cause.mcp.t': 'MCP tool unavailable', 'stats.cause.mcp.w': 'A tool server (MCP) did not answer or disconnected.', 'stats.cause.mcp.f': 'Restart the chat; if it is always the same server, check it in Settings → Connectors.',
  'stats.cause.turn.t': 'Turn ended with an error', 'stats.cause.turn.w': 'The engine closed its answer reporting an error, without saying which.', 'stats.cause.turn.f': 'Open the chat and read the last message; the app’s logs (npm run logs) have the detail.',
  'stats.cause.tool.t': 'Tool failed', 'stats.cause.tool.w': 'A tool call (command, read, search) came back with an error; the agent usually retries by itself.', 'stats.cause.tool.f': 'If it repeats on the same tool, look at the example: often a command or path to fix in a skill.',
  'stats.cause.other.t': 'Error', 'stats.cause.other.w': 'An error without a recognised cause: the text says what happened.', 'stats.cause.other.f': 'If it comes back, discuss it with the Orchestrator: it has the details and can propose a rule.',
};
