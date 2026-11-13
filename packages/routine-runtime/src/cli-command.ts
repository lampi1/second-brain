// The exact `routine` command line a person copies (ADR 0175): the app's Routine section shows it for a package or a run
// folder, the README uses the same shapes. Pure: PowerShell 5.1 quoting on Windows, POSIX shell quoting elsewhere. The
// command is `routine` (the package's bin, installed with `npm install -g <repo>/packages/routine-runtime`); a host that
// runs the built file directly passes `bin` (e.g. `node C:\…\routine.mjs`, already quoted by `cliCommand` itself).

export type CliKind = 'run' | 'resume' | 'watch';
export interface CliArgs {
  /** the package folder, its routine.json or its .zip (run, watch) */
  pkg?: string;
  /** the run folder (resume) */
  runDir?: string;
  /** --input k=v, in order (a single work item: { workItem: '123' }) */
  inputs?: Record<string, string>;
  /** --from-step <step id> (run) */
  fromStep?: string;
  /** --engine (only `claude` today) */
  engine?: string;
  /** --runs-dir (default: defaultRunsDir()) */
  runsDir?: string;
}

const SAFE = /^[A-Za-z0-9_./:=@%+,\\-]+$/;

/** One argument quoted for PowerShell 5.1 (single quotes, ' doubled) or a POSIX shell (single quotes, '\''). */
export function quoteArg(value: string, platform: NodeJS.Platform = process.platform): string {
  if (value && SAFE.test(value)) return value;
  return platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The copyable command, e.g. `routine run 'C:\pkg\air bug.zip' --input workItem=123`. */
export function cliCommand(kind: CliKind, args: CliArgs = {}, platform: NodeJS.Platform = process.platform, bin?: string[]): string {
  const q = (v: string) => quoteArg(v, platform);
  const parts: string[] = bin?.length ? bin.map(q) : ['routine'];
  if (bin?.length && platform === 'win32' && /['\s]/.test(bin[0]!)) parts[0] = `& ${parts[0]}`; // PowerShell runs a quoted path only with &
  parts.push(kind);
  if (kind === 'resume') {
    if (!args.runDir) throw new Error('resume needs the run folder');
    parts.push(q(args.runDir));
  } else {
    if (!args.pkg) throw new Error(`${kind} needs the package`);
    parts.push(q(args.pkg));
  }
  if (kind === 'run') for (const [k, v] of Object.entries(args.inputs ?? {})) parts.push('--input', q(`${k}=${v}`));
  if (kind === 'run' && args.fromStep) parts.push('--from-step', q(args.fromStep));
  if (kind !== 'resume' && args.engine) parts.push('--engine', q(args.engine));
  if (args.runsDir) parts.push('--runs-dir', q(args.runsDir));
  return parts.join(' ');
}
