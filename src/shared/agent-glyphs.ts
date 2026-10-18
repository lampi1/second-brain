// Stable IDs for the designed role set; shared validation accepts IDs, never SVG supplied by users or models.
export const ROLE_GLYPHS = ['role-implementer', 'role-reviewer', 'role-bug', 'role-browser', 'role-ops', 'role-runbook', 'role-research', 'role-writer', 'role-mail', 'role-planner', 'role-data', 'role-security', 'role-deploy', 'role-chat', 'role-wrench', 'role-list', 'role-map', 'role-flask', 'role-palette', 'role-lightning', 'role-key', 'role-folder', 'role-chart', 'role-spark'] as const;
export type RoleGlyph = typeof ROLE_GLYPHS[number];
export function isRoleGlyph(value: string): value is RoleGlyph { return (ROLE_GLYPHS as readonly string[]).includes(value); }
