// Which stable release this process is (ADR 0007), read once at start and then removed from the environment. The
// launcher (scripts/release.mjs) sets SB_RELEASE / SB_ENGINE_CLAUDE for the stable app only; left in process.env they
// reached every CLI, shell and Esegui run the stable app started, so a dev instance launched from one of its chats
// (`npm run dev` in a worktree) believed it was the stable release: stable userData, sync, Start Menu shortcuts
// rewritten to itself (2026-10-13). So: a build run from a repo checkout (its app folder holds `.git`) is never a
// release, whatever it inherited; and the stable-only variables never reach a child. Read by index.ts (first, before
// any service starts), shortcuts.ts, wiring.ts, chats/claude.ts, chats/cli.ts. Pure apart from init(); no Electron.
import fs from 'node:fs';
import path from 'node:path';

/** Set by the launcher for the stable app only; never inherited by what the app starts. */
export const STABLE_ENV = ['SB_RELEASE', 'SB_RELEASE_ID', 'SB_ENGINE_CLAUDE'] as const;

export interface StableInfo { /** the release id, null for a dev build */ release: string | null; /** the release's Claude engine copy */ engine: string | null }

/** A repo checkout (a clone or a worktree: `.git` is a folder or a file) is a dev build, never a release. */
export const isCheckout = (appPath: string): boolean => fs.existsSync(path.join(appPath, '.git'));

/** Reads the stable-only variables and deletes them from `env` (mutated: the process environment children inherit). */
export function takeStableEnv(env: NodeJS.ProcessEnv, appPath: string): StableInfo {
  const release = env.SB_RELEASE && !isCheckout(appPath) ? env.SB_RELEASE : null;
  const engine = release ? env.SB_ENGINE_CLAUDE ?? null : null;
  for (const k of STABLE_ENV) delete env[k];
  return { release, engine };
}

let info: StableInfo | null = null;

/** index.ts, first thing: this process's release, the environment scrubbed for every child it will start. */
export function initRelease(appPath: string, env: NodeJS.ProcessEnv = process.env): StableInfo {
  info = takeStableEnv(env, appPath);
  return info;
}

/** The release this process runs as, null for a dev build. Before initRelease (unit tests) the environment decides. */
export const releaseId = (): string | null => (info ? info.release : process.env.SB_RELEASE ?? null);
/** The release's own Claude engine (SB_ENGINE_CLAUDE as the launcher passed it). */
export const releaseEngine = (): string | null => (info ? info.engine : process.env.SB_ENGINE_CLAUDE ?? null);
