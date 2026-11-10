// Types for the filesystem discovery shared by TypeScript runtime code and the unbuilt Node doctor script.
export type ClaudeSource = 'override' | 'release' | 'embedded' | 'path';
export function findCli(name: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string | null;
export function codexAppInstall(env?: NodeJS.ProcessEnv, home?: string): string | null;
export function newestCursorVersion(versionsDir: string, node?: string): string | null;
export function cursorInstall(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string | null;
/** fallback: no installed Claude Code, the app's own copy (release or embedded) runs instead (ADR 0267). */
export function discoverClaude(options?: { override?: string | null; release?: string | null; starts?: string[]; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; arch?: string }): { path: string; source: ClaudeSource; fallback?: true } | null;
export function bundledClaude(options?: { release?: string | null; starts?: string[]; platform?: NodeJS.Platform; arch?: string }): { path: string; source: 'release' | 'embedded' } | null;
export function isClaudePackageScript(p: string): boolean;
export function claudeScriptCommand(cli: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): { command: string; args: string[]; env: NodeJS.ProcessEnv } | null;
