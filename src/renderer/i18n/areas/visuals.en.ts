// English UI texts of the "visuals" area (ADR 0057): the same keys as visuals.it.ts (typed by it), spread into en.ts.
import type { visualsIt } from './visuals.it';

export const visualsEn: typeof visualsIt = {
  'visuals.diagram': 'Diagram',
  'visuals.chart': 'Chart',
  'visuals.drawing': 'Drawing it…',
  'visuals.showCode': 'Code',
  'visuals.showVisual': 'Drawing',
  'visuals.copy': 'Copy',
  'visuals.copied': 'Copied',
  'visuals.zoom': 'Open large',
  'visuals.diagramAlt': 'Diagram of the reply',
  'visuals.chartAlt': (p: { title: string }) => `Chart: ${p.title}`,
  'splash.label': 'Line of the day',
  'splash.skip': 'Click or press a key to enter',
  'splash.line.0': 'We grind. Coffee is for the weak, tokens are for the strong.',
  'splash.line.1': 'Today we sharpen ideas and file down bugs.',
  'splash.line.2': 'The wheel spins, sparks fly, tasks fall.',
  'splash.line.3': 'A day without grinding is a day with fewer PRs.',
  'splash.line.4': 'The gears are oiled. The agents, slightly less.',
  'splash.line.5': 'Grind today, celebrate Friday.',
  'splash.line.6': 'Every spark is a test turning green.',
  'splash.line.7': 'The backlog won’t empty itself. Luckily, there are agents.',
  'splash.line.8': 'The grinder is on: safety goggles recommended.',
  'splash.line.9': 'The grind never stops. At most it takes a coffee break.',
  'splash.line.10': 'You leave only when the work is done. Or after a restart.',
  'splash.line.11': 'Double shift for the agents. The union has been notified.',
};
