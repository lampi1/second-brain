// Diagrams drawn from the code (ADR 0196), not written by hand: the Guida cards about roles, delegation and the app's
// IPC show a mermaid flowchart built here from the data the app itself runs on (roles.ts ROLE_DEFAULTS with each role's
// tier and launches, DELEGATION_DEFAULTS, contract.ts INVOKE_CHANNELS / EVENT_CHANNELS grouped by area). A change to
// those constants changes the picture with no text to update. Labels are the app's own words in the user's language.
// Pure; drawn by renderer/components/GuidePage.tsx through lib/viz/mermaid.ts (strict, an image). Tests:
// test/unit/guide-diagrams.test.ts.
import { EVENT_CHANNELS, INVOKE_CHANNELS } from './contract';
import { DELEGATION_DEFAULTS, ROLE_DEFAULTS, WORK_ROLE_IDS } from './roles';
import type { GuideLang } from './concept-guide';

type Words = Record<'you' | 'root' | 'level' | 'delegate' | 'ask' | 'report' | 'parallel' | 'stall' | 'page' | 'main' | 'channels' | 'events' | 'others' | 'tier', string>;
const WORDS: Record<GuideLang, Words> = {
  it: { you: 'Tu', root: 'Chat radice', level: 'livello', delegate: 'agent_delegate', ask: 'domande', report: 'agent_report', parallel: 'al massimo', stall: 'ferma dopo', page: 'Pagina (renderer)', main: 'Main (servizi)', channels: 'canali per area', events: 'eventi', others: 'altri', tier: 'livello modello' },
  en: { you: 'You', root: 'Root chat', level: 'level', delegate: 'agent_delegate', ask: 'questions', report: 'agent_report', parallel: 'at most', stall: 'stalled after', page: 'Page (renderer)', main: 'Main (services)', channels: 'channels by area', events: 'events', others: 'others', tier: 'model tier' },
  de: { you: 'Du', root: 'Wurzel-Chat', level: 'Ebene', delegate: 'agent_delegate', ask: 'Fragen', report: 'agent_report', parallel: 'höchstens', stall: 'steht nach', page: 'Seite (Renderer)', main: 'Main (Dienste)', channels: 'Kanäle nach Bereich', events: 'Ereignisse', others: 'weitere', tier: 'Modellstufe' },
};

/** The text of a mermaid label: quotes and brackets out, so data never breaks the syntax. */
const q = (s: string) => `"${s.replace(/["[\]{}<>|]/g, ' ').trim()}"`;

/** Who starts whom: the Orchestrator and every work role with its tier, an arrow for each role it may launch. */
export function rolesDiagram(lang: GuideLang): string {
  const w = WORDS[lang];
  const lines = ['flowchart TB', `  you(${q(w.you)}) --> orchestrator`];
  lines.push(`  orchestrator[${q(`${ROLE_DEFAULTS.orchestrator.name} · ${ROLE_DEFAULTS.orchestrator.tier}`)}]`);
  for (const id of WORK_ROLE_IDS) lines.push(`  ${id}[${q(`${ROLE_DEFAULTS[id].name} · ${ROLE_DEFAULTS[id].tier}`)}]`);
  for (const from of ['orchestrator', ...WORK_ROLE_IDS] as const) for (const to of ROLE_DEFAULTS[from].launches) if (to !== from) lines.push(`  ${from} --> ${to}`);
  return lines.join('\n');
}

/** Delegation as the limits say: one chain down to maxDepth levels, questions up first, one report back. */
export function delegationDiagram(lang: GuideLang, limits = DELEGATION_DEFAULTS): string {
  const w = WORDS[lang];
  const lines = ['flowchart TB', `  l0[${q(w.root)}]`];
  for (let i = 1; i <= limits.maxDepth; i++) {
    lines.push(`  l${i}[${q(`${w.level} ${i} · ${w.parallel} ${limits.maxParallel}`)}]`);
    lines.push(`  l${i - 1} -->|${q(w.delegate)}| l${i}`);
    lines.push(`  l${i} -.->|${q(`${w.ask} · ${w.report}`)}| l${i - 1}`);
  }
  lines.push(`  lim[${q(`${w.stall} ${limits.stallMin} min`)}]`, `  l${limits.maxDepth} --- lim`);
  return lines.join('\n');
}

/** The typed IPC: the page calls main only through the contract's channels, grouped by their area prefix. */
export function ipcGroups(channels: readonly string[] = INVOKE_CHANNELS): { area: string; count: number }[] {
  const by = new Map<string, number>();
  for (const c of channels) { const a = c.split(':')[0]!; by.set(a, (by.get(a) ?? 0) + 1); }
  return [...by].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area, 'en'));
}
export function ipcDiagram(lang: GuideLang, top = 6): string {
  const w = WORDS[lang], groups = ipcGroups();
  const shown = groups.slice(0, top), rest = groups.slice(top).reduce((n, g) => n + g.count, 0);
  // nodes first, the subgraph before any edge names it (mermaid would make a plain node of an id it has not seen)
  const lines = ['flowchart LR', `  page[${q(w.page)}]`, `  main[${q(w.main)}]`, `  subgraph grp[${q(`${INVOKE_CHANNELS.length} ${w.channels}`)}]`, '    direction TB'];
  shown.forEach((g, i) => lines.push(`    g${i}[${q(`${g.area} · ${g.count}`)}]`));
  if (rest) lines.push(`    gx[${q(`${w.others} · ${rest}`)}]`);
  lines.push('  end', `  page -->|${q('window.sb.invoke')}| grp`, '  grp --> main', `  main -.->|${q(`${EVENT_CHANNELS.length} ${w.events}`)}| page`);
  return lines.join('\n');
}

/** The card ids that carry a diagram drawn from the code. */
export const CODE_DIAGRAMS: Readonly<Record<string, (lang: GuideLang) => string>> = {
  'every-task-agent': rolesDiagram,
  agents: rolesDiagram,
  delegation: lang => delegationDiagram(lang),
  'orchestrator-app': lang => ipcDiagram(lang),
};
export const codeDiagram = (cardId: string, lang: GuideLang): string | null => CODE_DIAGRAMS[cardId]?.(lang) ?? null;
