// Public types for doctor configuration and login parsing, imported by the standalone script's unit tests.
export function doctorContext(options: { root: string; dev?: boolean; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string }): {
  mode: string; userData: string; userDataSource: string; configPath: string; configState: string;
  brain: string | null; brainSource: string; port: number; portSource: string; savedPort: number | null; appRoot: string; release: string | null; releaseEngine: string | null; electron: string;
};
export function claudeLogin(stdout: string): { ok: boolean; level: string; detail: string; hint: string };
export function packageVersion(cli: string, packageName: string): string | null;
