// Types for the filesystem discovery shared by TypeScript runtime code and the unbuilt Node doctor script.
export type ClaudeSource = 'override' | 'release' | 'embedded' | 'path';
export function findCli(name: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string | null;
export function codexAppInstall(env?: NodeJS.ProcessEnv, home?: string): string | null;
export function newestCursorVersion(versionsDir: string, node?: string): string | null;
export function cursorInstall(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string | null;
export function discoverClaude(options?: { override?: string | null; release?: string | null; starts?: string[]; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; arch?: string }): { path: string; source: ClaudeSource } | null;
