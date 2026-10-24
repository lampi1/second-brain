// Runs a routine's script and query steps (ADR 0154): the saved brain file pinned by content hash, its arguments filled
// from typed params, run inputs and attachments, launched without a shell, output bounded, every run journaled as a
// receipt by runtime.ts. A hash that no longer matches refuses to run. A prod step is never launched here by the runner:
// runtime.ts only calls `execute` for it from the user's «Esegui» click. `resolve` alone backs the dry-run, which
// spawns nothing. Attachments (a pasted list or a dropped file) are stored content-addressed next to the flow state.
// Unit tests: test/unit/flows/executor.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { FlowAttachment, FlowRun, FlowStep } from '../../shared/flows';
import { SCRIPTS_DIR } from '../brain/scripts';
import { QUERIES_DIR, parseQueryNote } from '../brain/queries';
import { placeholders } from './schema';

export interface ResolvedCommand {
  kind: 'script' | 'query'; ref: string; env: 'test' | 'prod';
  /** what the user reads (and copies): the program and its arguments, quoted */
  command: string; program: string; args: string[]; file: string;
  sha256: string; values: Record<string, string>; problems: string[];
}
export interface CommandResult { exitCode: number | null; output: string }

const MAX_ATTACHMENT = 5 * 1024 * 1024;
const OUTPUT_KEEP = 64 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const quote = (value: string): string => /^[A-Za-z0-9_./:\\=@+-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;

/** Stores one attachment by its content hash (same content = same file) and returns its record. */
export function saveAttachment(dir: string, name: string, content: string, now = Date.now()): FlowAttachment {
  if (!NAME.test(name)) throw new Error(`Allegato «${name.slice(0, 40)}»: nome non valido (lettere, numeri, spazi, . _ -)`);
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_ATTACHMENT) throw new Error(`Allegato «${name}»: più di 5 MB`);
  const hash = sha256(data), file = path.join(dir, hash);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, data, { mode: 0o600 }); fs.renameSync(temp, file); }
  const lines = content ? content.split(/\r?\n/).filter((line, i, all) => line !== '' || i < all.length - 1).length : 0;
  return { name, sha256: hash, size: data.length, lines, at: now };
}
/** The stored file of an attachment, checked against its hash (a changed file is refused). */
export function attachmentFile(dir: string, attachment: FlowAttachment): string {
  const file = path.join(dir, attachment.sha256);
  if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== attachment.sha256) throw new Error(`Allegato «${attachment.name}» mancante o cambiato`);
  return file;
}
/** The saved file a step names, inside the brain's scripts/ or queries/ folder (symlinks may not leave it). */
function stepFile(root: string, step: FlowStep): string {
  const kind = step.action!.kind, dir = path.join(root, kind === 'script' ? SCRIPTS_DIR : QUERIES_DIR), file = path.join(dir, step.action!.ref);
  const real = fs.realpathSync(file), realDir = fs.realpathSync(dir);
  if (path.dirname(real) !== realDir) throw new Error(`${step.action!.ref} è fuori dalla cartella ${kind === 'script' ? SCRIPTS_DIR : QUERIES_DIR}`);
  return real;
}
/** The sha256 of a brain script/query now (null = missing or outside its folder): pinned on propose. */
export function contentHash(root: string, kind: 'script' | 'query', ref: string): string | null {
  try { return sha256(fs.readFileSync(stepFile(root, { action: { kind, ref } } as FlowStep))); } catch { return null; }
}
/** A brain script/query's text now (null = missing or outside its folder): exported with the routine. */
export function stepFileText(root: string, kind: 'script' | 'query', ref: string): string | null {
  try { return fs.readFileSync(stepFile(root, { action: { kind, ref } } as FlowStep), 'utf8'); } catch { return null; }
}
/** Fills {{name}} with a run input (typed params are run inputs under their own name), {{attachment:name}} with the attachment's path. */
function fill(template: string, run: FlowRun, attachmentsDir: string, problems: string[]): string {
  let out = template;
  for (const key of placeholders(template)) {
    let value: string | undefined;
    if (key.startsWith('attachment:')) {
      const found = run.attachments?.find(item => item.name.toLowerCase() === key.slice(11));
      if (found) { try { value = attachmentFile(attachmentsDir, found); } catch (error) { problems.push((error as Error).message); } }
      else problems.push(`manca l'allegato «${key.slice(11)}»`);
    } else value = run.inputs[key];
    if (value === undefined) { if (!key.startsWith('attachment:')) problems.push(`manca il valore di {{${key}}}`); continue; }
    out = out.replace(new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi'), () => value!);
  }
  return out;
}
/** How a script runs, by its extension; null = this language has no runner here. */
function interpreter(file: string): { program: string; lead: string[]; flag: (key: string) => string } | null {
  const win = process.platform === 'win32';
  switch (path.extname(file).toLowerCase()) {
    case '.ps1': return { program: win ? 'powershell.exe' : 'pwsh', lead: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], flag: key => `-${key}` };
    case '.py': return { program: win ? 'python' : 'python3', lead: [file], flag: key => `--${key}` };
    case '.js': case '.mjs': case '.cjs': return { program: 'node', lead: [file], flag: key => `--${key}` };
    case '.sh': return { program: 'bash', lead: [file], flag: key => `--${key}` };
    case '.cmd': case '.bat': return win ? { program: 'cmd.exe', lead: ['/d', '/c', file], flag: key => `/${key}` } : null;
    default: return null;
  }
}
/** The exact command of a script/query step for this run, without running anything. */
export function resolve(root: string, step: FlowStep, run: FlowRun, attachmentsDir: string, workDir: string): ResolvedCommand {
  const problems: string[] = [], kind = step.action!.kind as 'script' | 'query', ref = step.action!.ref, env = step.env ?? 'test';
  const values = Object.fromEntries(Object.entries(step.args ?? {}).map(([key, value]) => [key, fill(value, run, attachmentsDir, problems)]));
  // what a run input put into an argument (a work item, a param, an agent's start): it may never turn a test step to
  // production, nor become an option of the program
  for (const [key, template] of Object.entries(step.args ?? {})) {
    if (!placeholders(template).length || template.includes('{{attachment:')) continue;
    const value = values[key]!.trim();
    if (env !== 'prod' && /^prod(uction)?$/i.test(value)) problems.push(`${key}: un passaggio di test non riceve "${value}" (la produzione si esegue solo con «Esegui»)`);
    if (value.startsWith('-')) problems.push(`${key}: un valore da input non può iniziare con "-"`);
  }
  let file = path.join(root, kind === 'script' ? SCRIPTS_DIR : QUERIES_DIR, ref), hash = '';
  try { file = stepFile(root, step); hash = sha256(fs.readFileSync(file)); } catch (error) { problems.push((error as NodeJS.ErrnoException).code === 'ENOENT' ? `${ref} non esiste più nel brain` : (error as Error).message); }
  if (hash && hash !== step.action!.hash) problems.push(`${ref} è cambiato dopo l'approvazione: serve il tuo ok sul nuovo contenuto`);
  let program = '', args: string[] = [];
  if (kind === 'script') {
    const how = interpreter(file);
    if (!how) problems.push(`${path.extname(file) || ref}: questo tipo di script non si esegue da una routine`);
    else {
      program = how.program; args = [...how.lead, ...Object.entries(values).flatMap(([key, value]) => [how.flag(key), value])];
      if (program === 'cmd.exe' && [...Object.values(values), ...how.lead].some(value => /[&|<>^%"!\r\n]/.test(value))) problems.push('un argomento o un percorso contiene caratteri speciali che cmd interpreterebbe');
    }
  } else {
    const { server, database, ...vars } = values;
    let sql = file;
    if (path.extname(file).toLowerCase() === '.md' && hash) {
      const note = parseQueryNote(fs.readFileSync(file, 'utf8'));
      if (!note || !['sql', 'tsql', 't-sql', 'mssql'].includes(note.lang)) problems.push(`${ref}: solo le query SQL si eseguono da una routine`);
      else { sql = path.join(workDir, `${hash}.sql`); if (!fs.existsSync(sql)) { fs.mkdirSync(workDir, { recursive: true }); fs.writeFileSync(sql, note.code); } }
    } else if (path.extname(file).toLowerCase() !== '.sql') problems.push(`${ref}: solo le query SQL si eseguono da una routine`);
    if (!server) problems.push('la query non ha l\'argomento server');
    if (!database) problems.push('la query non ha l\'argomento database');
    for (const key of Object.keys(vars)) if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) problems.push(`variabile ${key} non valida per sqlcmd`);
    // sqlcmd -v substitutes text into the SQL: no quote, statement end, comment or line break from a value
    for (const [key, value] of Object.entries(vars)) if (/['";\r\n]|--|\/\*/.test(value)) problems.push(`variabile ${key}: contiene caratteri che cambierebbero la query`);
    // integrated auth (-E): credentials never pass through the app; -b exits non-zero on a SQL error
    program = 'sqlcmd'; args = ['-S', server ?? '', '-d', database ?? '', '-E', '-b', ...(step.effect === 'read-only' ? ['-K', 'ReadOnly'] : []), '-i', sql, ...Object.entries(vars).flatMap(([key, value]) => ['-v', `${key}=${value}`])];
  }
  return { kind, ref, env, command: program ? [program, ...args].map(quote).join(' ') : `(${ref})`, program, args, file, sha256: hash, values, problems };
}
/** Launches a resolved command: no shell, bounded output, killed at the timeout or on abort. */
export function execute(resolved: ResolvedCommand, options: { cwd: string; timeoutMs: number; signal?: AbortSignal; env?: Record<string, string> }): Promise<CommandResult> {
  if (resolved.problems.length) return Promise.reject(new Error(resolved.problems.join('; ')));
  // recheck the hash right before launching: the file could change between the preview and the run
  if (sha256(fs.readFileSync(resolved.file)) !== resolved.sha256) return Promise.reject(new Error(`${resolved.ref} è cambiato prima dell'avvio`));
  return new Promise(done => {
    let output = '', finished = false;
    const keep = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-OUTPUT_KEEP); };
    const child = spawn(resolved.program, resolved.args, { cwd: options.cwd, shell: false, windowsHide: true, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const end = (exitCode: number | null, note?: string) => { if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); done({ exitCode, output: note ? `${output}\n${note}` : output }); };
    const timer = setTimeout(() => { child.kill(); end(null, `[fermato: oltre ${Math.round(options.timeoutMs / 1000)} s]`); }, options.timeoutMs);
    const abort = () => { child.kill(); end(null, '[fermato]'); };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', keep); child.stderr?.on('data', keep);
    child.on('error', error => end(null, `[non avviato: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? `${resolved.program} non è installato` : error.message}]`));
    child.on('close', code => end(code));
  });
}
