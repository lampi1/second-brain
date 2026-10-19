// Hand-drawn identity artwork, independent of generic UI icons. Renderer and approval sheets share these paths.
import type { RoleGlyph } from '../../shared/agent-glyphs';
export interface GlyphArt { label: string; outline: string; accent: string; detail?: string; small?: string }
export const GLYPH_ART: Record<RoleGlyph, GlyphArt> = {
  'role-implementer': { label: 'Implementer', outline: 'M8 5 3 10l5 5M16 5l5 5-3 3M11 9v11l3-3 3 1Z', accent: 'M11 9v11l3-3 3 1Z' },
  'role-reviewer': { label: 'Reviewer', outline: 'M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM16 16l5 5M7 10l3 3 4-5', accent: 'M7 10l3 3 4-5-4 1Z' },
  'role-bug': { label: 'Bug investigator', outline: 'M8 9h8v7a4 4 0 0 1-8 0ZM9 9V7a3 3 0 0 1 6 0v2M4 12h4m8 0h4M4 17h4m8 0h4', accent: 'M8 9h8v7H8Z', detail: 'M12 10v8M6 5l2 2m8 0 2-2M3 14h3m12 0h3' },
  'role-browser': { label: 'Browser tester', outline: 'M10 19H4V4h16v9M4 8h16M13 11v10l3-3 4-1Z', accent: 'M4 4h16v4H4ZM13 11v10l3-3 4-1Z', detail: 'M7 6h1m3 0h1' },
  'role-ops': { label: 'Ops investigator', outline: 'M4 4h16v16H4ZM4 12h4l2-4 3 8 2-4h5', accent: 'M4 4h16v4H4Z', detail: 'M7 18h3' },
  'role-runbook': { label: 'Runbook keeper', outline: 'M5 4h14v16H7a2 2 0 0 1-2-2ZM5 17h14M12 4v8l2-2 2 2V4', accent: 'M12 4v8l2-2 2 2V4Z', detail: 'M8 7h1m-1 3h1' },
  'role-research': { label: 'Researcher', outline: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 7l-2 7-7 3 3-7Z', accent: 'm16 7-2 7-4-4Z', detail: 'M12 3v2m0 14v2M3 12h2m14 0h2' },
  'role-writer': { label: 'Writer', outline: 'm5 20 3-12 9-4 3 3-4 9ZM5 20l7-7M13 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z', accent: 'm8 8 9-4 3 3-4 9-1-7Z' },
  'role-mail': { label: 'Mail & journal', outline: 'M11 19H3V5h18v5M3 5l9 8 9-8M13 20l1-4 4-5 3 3-4 5Z', accent: 'M3 5l9 8 9-8ZM13 20l1-4 3 3Z' },
  'role-planner': { label: 'Day planner', outline: 'M4 6h16v15H4ZM8 3v5m8-5v5M4 10h16M15 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', accent: 'M4 6h16v4H4ZM15 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', detail: 'M12 11v1m0 6v1M8 15h1m6 0h1' },
  'role-data': { label: 'Data', outline: 'M4 6c0-4 16-4 16 0v12c0 4-16 4-16 0ZM4 6c0 4 16 4 16 0M4 12c0 4 16 4 16 0', accent: 'M4 6c0-4 16-4 16 0s-16 4-16 0Z' },
  'role-security': { label: 'Security', outline: 'M12 3 4 6v7c0 4 8 8 8 8s8-4 8-8V6ZM12 7v9M9 11h6', accent: 'M12 3v18s8-4 8-8V6Z' },
  'role-deploy': { label: 'Deploy', outline: 'M8 15c0-7 5-11 12-11 0 7-4 12-11 12ZM8 10H5l-2 6h5m6 0v3l-6 2v-5M5 19l-2 2', accent: 'M8 15c0-7 5-11 12-11l-5 7Z', detail: 'M16 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z' },
  'role-chat': { label: 'Chat', outline: 'M4 4h16v12H10l-6 4ZM8 8h8M8 12h5', accent: 'M4 16h6l-6 4ZM16 4h4v12h-4Z' },
  'role-wrench': { label: 'Maintenance', outline: 'M14 4a6 6 0 0 0-7 8l-4 5 4 4 5-5a6 6 0 0 0 8-7l-4 3-4-4Z', accent: 'm7 12-4 5 4 4 5-5Z' },
  'role-list': { label: 'Checklist', outline: 'M9 4h11v16H4V9M3 5l2 2 4-4M8 12h8m-8 4h6', accent: 'M16 4h4v16h-4Z' },
  'role-map': { label: 'Mapping', outline: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15m6-12v15', accent: 'm9 3 6 3v15l-6-3Z' },
  'role-flask': { label: 'Experiment', outline: 'M9 3h6M10 3v7L4 20h16l-6-10V3M7 15h10', accent: 'M7 15h10l3 5H4Z', detail: 'M11 17h2' },
  'role-palette': { label: 'Design', outline: 'M21 10c0-9-18-9-18 2 0 6 5 9 9 9 3 0 4-3 2-5-2-3 7 0 7-6Z', accent: 'M5 12c0 4 3 7 7 7 2 0 2-2 0-3-2-2-5-1-7-4Z', detail: 'M7 8h1m4-2h1m4 2h1' },
  'role-lightning': { label: 'Automation', outline: 'M13 3 4 14h7l-1 7 10-12h-8Z', accent: 'm13 3-2 11H4ZM11 14l-1 7 10-12Z' },
  'role-key': { label: 'Access', outline: 'M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM13 12l8 8m-3-3 3-3m-6 0 3-3', accent: 'M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z', detail: 'M8 7h1' },
  'role-folder': { label: 'Organization', outline: 'M3 6h7l2 3h9l-2 11H3ZM3 6V4h7l2 2h7v3', accent: 'M3 9h18l-2 11h-4l2-8H3Z' },
  'role-chart': { label: 'Analytics', outline: 'M3 3v18h18M7 17v-5h3v5m3 0V9h3v8m3 0V5h2v12', accent: 'M13 9h3v8h-3ZM19 5h2v12h-2Z', small: 'M3 3v18h18M7 17v-4m6 4V9m6 8V5' },
  'role-spark': { label: 'Ideation', outline: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z', accent: 'm12 3 3 6 6 3h-9Z', detail: 'M18 4v2m-1-1h2' },
};
export const GLYPH_SIZES = [16, 20, 28, 40] as const;
export type GlyphSize = typeof GLYPH_SIZES[number];
// Optical weights are specified per output size; tiny variants omit decorative detail.
export const GLYPH_METRICS: Record<GlyphSize, { stroke: number; detail: boolean }> = {
  16: { stroke: 2, detail: false }, 20: { stroke: 1.8, detail: false },
  28: { stroke: 1.75, detail: true }, 40: { stroke: 1.8, detail: true },
};
export function glyphSize(size: number): GlyphSize { return size <= 16 ? 16 : size <= 20 ? 20 : size <= 28 ? 28 : 40; }
export const GLYPH_LABELS_IT: Record<RoleGlyph, string> = {
  'role-implementer': 'Implementatore', 'role-reviewer': 'Revisore', 'role-bug': 'Investigatore bug', 'role-browser': 'Tester browser',
  'role-ops': 'Investigatore operativo', 'role-runbook': 'Custode skill', 'role-research': 'Ricercatore', 'role-writer': 'Scrittore',
  'role-mail': 'Posta e diario', 'role-planner': 'Pianificatore', 'role-data': 'Dati', 'role-security': 'Sicurezza',
  'role-deploy': 'Rilascio', 'role-chat': 'Conversazione', 'role-wrench': 'Manutenzione', 'role-list': 'Lista di controllo',
  'role-map': 'Mappatura', 'role-flask': 'Esperimenti', 'role-palette': 'Design', 'role-lightning': 'Automazione',
  'role-key': 'Accessi', 'role-folder': 'Organizzazione', 'role-chart': 'Analisi', 'role-spark': 'Ideazione',
};
