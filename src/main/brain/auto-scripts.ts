// Saves a reusable command the user ran with "Esegui" as a brain script by itself (issue #111, ADR 0096). Why: the
// brain's Script section stayed empty although reusable commands (a deploy to a test web app, a local Populator, the
// migration of the test databases) ran fine every day: the save was a manual Orchestrator step (brain_script_save),
// and the Orchestrator never sees the runs of its work chats. The owner's rule: brain changes apply by themselves, with
// a log line and a way back, no approval.
// How: when a run ends with exit code 0, a deterministic heuristic (no model call, zero tokens) decides whether the
// command is worth keeping: not a one-word look-around (ls, git status, cd…), at least a command with arguments or a
// few steps. A command that may hold a credential is skipped, never stored or redacted into a broken script. Dedupe by
// the command itself (the file name carries its hash; an existing script with the same body counts too), and a script
// the user deleted (scripts/.deleted/) is not added again. Every save is a changelog line ("app"), undone by deleting
// the script (a copy stays in scripts/.deleted/).
// Used by wiring.ts and demo-wiring.ts (the "Esegui" runner's end of run). Unit tests: test/unit/brain/auto-scripts.test.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunInfo } from '../../shared/contract';
import { prodRisk } from '../../shared/runnable';
import { maskSecrets } from './mask';
import { SCRIPTS_DIR, secretLine, stripHeader, type BrainScripts, type ScriptMeta } from './scripts';
import { errText, log } from '../log';

/** Commands that only look around or move: a block made of these alone is not a script worth keeping. */
const TRIVIAL = new Set([
  'ls', 'dir', 'cd', 'pwd', 'echo', 'cat', 'type', 'cls', 'clear', 'whoami', 'where', 'where.exe', 'which', 'hostname',
  'get-childitem', 'gci', 'get-content', 'gc', 'get-location', 'gl', 'set-location', 'sl', 'push-location', 'pop-location',
  'test-path', 'write-host', 'write-output', 'get-date', 'get-process', 'ps', 'env', 'printenv', 'set', 'exit', 'code',
  'explorer', 'explorer.exe', 'start', 'open', 'notepad', 'history', 'help', 'man', 'tree', 'head', 'tail', 'wc', 'date',
  'select-string', 'sls', 'grep', 'find', 'get-command', 'gcm', 'get-help', 'get-item', 'gi', 'resolve-path',
]);
/** Read-only or one-word tool calls (git status, npm -v…). */
const TRIVIAL_LINE = /^(?:git\s+(?:status|log|diff|show|branch|remote|stash\s+list|rev-parse|fetch|pull)\b|(?:node|npm|npx|python|py|pip|dotnet|az|git|docker|java|go)\s+(?:-v|--version|version|--help|-h|help)\b)/i;
/** The shortest single command kept: a few words, not "npm test". */
const MIN_WORDS = 3;
const MIN_CHARS = 24;

const steps = (code: string): string[] => code.replace(/\r\n/g, '\n').split('\n').map(l => l.trim())
  .filter(l => l && !/^(?:#|\/\/|::|rem\b)/i.test(l));
const firstWord = (line: string): string => (line.replace(/^[&.]\s*/, '').split(/\s+/)[0] ?? '').replace(/^["']|["']$/g, '').toLowerCase();
const trivial = (line: string): boolean => TRIVIAL.has(firstWord(line)) || TRIVIAL_LINE.test(line);
/** Flat command: lines trimmed, blank and comment lines out (what dedupe compares). */
export const flatCommand = (code: string): string => steps(code).join('\n');

/** Why a successful command is NOT kept as a script, or null when it is (pure, deterministic, no tokens). */
export function skipReason(code: string): string | null {
  const all = steps(code);
  if (!all.length) return 'empty';
  const real = all.filter(l => !trivial(l));
  if (!real.length) return 'trivial';
  if (real.length === 1) {
    const words = real[0]!.split(/\s+/).length;
    if (words < MIN_WORDS || real[0]!.length < MIN_CHARS) return 'short';
  }
  if (secretLine(code) || maskSecrets(code).masked) return 'secret';
  return null;
}

const slugOf = (line: string): string => line.replace(/^[&.]\s*/, '').split(/\s+/).slice(0, 3).join('-').toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'comando';

/** The script file a command becomes: cmd-<first words>-<hash of the command>.<ps1 on Windows, sh elsewhere>. */
export function scriptNameOf(code: string, platform: NodeJS.Platform = process.platform): string {
  const flat = flatCommand(code);
  const first = steps(code).find(l => !trivial(l)) ?? flat;
  const hash = crypto.createHash('sha256').update(flat).digest('hex').slice(0, 8);
  return `cmd-${slugOf(first)}-${hash}.${platform === 'win32' ? 'ps1' : 'sh'}`;
}

export interface AutoScriptsDeps {
  scripts: BrainScripts;
  /** the brain root (to look for a script the user deleted) */
  root: () => string | null;
  /** the chat's title, for the description and the changelog summary */
  chatTitle?: (chatId: string) => string | null;
  platform?: NodeJS.Platform;
}

export class AutoScripts {
  private seen = new Set<string>();
  constructor(private readonly d: AutoScriptsDeps) {}

  /** Called on every run update: acts once, on a run that ended with exit code 0. Returns the saved file, or null. */
  onRun(run: RunInfo): string | null {
    if (run.state !== 'ok' || run.exitCode !== 0 || this.seen.has(run.id)) return null;
    this.seen.add(run.id);
    if (this.seen.size > 500) this.seen = new Set([run.id]);
    try { return this.save(run); } catch (e) {
      log.warn('brain', 'auto script not saved', { chat: run.chatId, cause: errText(e), hint: 'the run stays in app_command_runs; the Orchestrator may save it with brain_script_save' });
      return null;
    }
  }

  private save(run: RunInfo): string | null {
    const why = skipReason(run.code);
    if (why) { log.debug('brain', 'auto script skipped', { chat: run.chatId, data: { id: run.id, why } }); return null; }
    const root = this.d.root();
    if (!root) return null;
    const platform = this.d.platform ?? process.platform;
    const name = scriptNameOf(run.code, platform);
    const dir = path.join(root, SCRIPTS_DIR);
    if (fs.existsSync(path.join(dir, name)) || this.deletedByUser(dir, name) || this.sameBody(run.code)) return null;
    const chat = this.d.chatTitle?.(run.chatId)?.trim() || 'una chat';
    const first = steps(run.code).find(l => !trivial(l)) ?? '';
    const prod = run.prod ?? prodRisk(run.code);
    const at = new Date(run.endedAt ?? Date.now()).toISOString().slice(0, 10);
    const ms = run.endedAt ? run.endedAt - run.startedAt : null;
    const meta: ScriptMeta = {
      title: first.length > 70 ? `${first.slice(0, 69)}…` : first,
      description: `Comando eseguito con successo con Esegui in «${chat}» (cartella ${run.cwd}), salvato in automatico dall'app. Controlla percorsi e parametri prima di riusarlo.${prod ? ` Attenzione: ${prod}, lo lancia solo l'utente.` : ''}`,
      usage: platform === 'win32' ? `powershell -NoProfile -File ${SCRIPTS_DIR}/${name}` : `sh ${SCRIPTS_DIR}/${name}`,
      tags: ['auto', 'esegui', ...(prod ? ['produzione'] : [])],
      tested: { ok: true, at, note: `exit 0${ms !== null ? ` in ${Math.max(1, Math.round(ms / 1000))} s` : ''}` },
    };
    const r = this.d.scripts.save({
      name, code: `${run.code.replace(/\r\n/g, '\n').trimEnd()}\n`, meta, by: 'app',
      summary: `Salvato in automatico dopo un Esegui riuscito in «${chat}». Per annullare elimina lo script (ne resta una copia in ${SCRIPTS_DIR}/.deleted/).`,
    });
    log.info('brain', 'auto script saved', { chat: run.chatId, data: { file: r.file } });
    return r.file;
  }

  /** A script the user (or the Orchestrator) deleted is a "no": it is not added back. */
  private deletedByUser(dir: string, name: string): boolean {
    try { return fs.readdirSync(path.join(dir, '.deleted')).some(f => f.endsWith(`-${name}`)); } catch { return false; }
  }

  /** An existing script whose code is this very command (saved by hand under another name). */
  private sameBody(code: string): boolean {
    const want = flatCommand(code);
    for (const s of this.d.scripts.list().scripts) {
      try {
        const full = path.join(this.d.root() ?? '', s.file);
        if (flatCommand(stripHeader(fs.readFileSync(full, 'utf8'))) === want) return true;
      } catch { /* unreadable: not the same */ }
    }
    return false;
  }
}
