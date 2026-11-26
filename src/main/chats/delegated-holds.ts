// What a delegated chat never does without the user (ADR 0355, issue #472): a write on a database, a production release,
// a write on a cloud account. A delegated chat's requests pass the gate without a panel, so these three keep waiting
// here also where no rule of the user's brain names them (manager-requests.ts permitDecision, after the user's own
// rules: those may only refuse more). Read from the text of the command, of a script it runs (with its arguments), or of
// a connector's call. A cloud or database client passes only when its words are known to read; a database on this
// machine is free. A net over what the app can read, not a wall (known gaps: ADR 0355). Pure apart from reading a
// script's file; pinned by test/unit/chats/delegated-holds.test.ts and delegated-holds-review.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { literalBashStdin } from '../agents/command-steps';
import { COMMAND_TOOLS, type ReadScripts } from '../agents/tool-policy';
import { cliWrite, cloudCommand, cloudWords, httpMethods, httpWrite, PLAIN_READ, PLAIN_SWITCH, positionals, READ, releaseRead, sdkWrite, WRITE } from './cloud-verbs';
import { toolClass } from './permit-policy';
import { command, readCommands, type Command, type Shell } from './shell-commands';
import { clientCall, looksLikeStatement, looseWrite, mongoRead, statementReads, statementWrites, wholeStatementReads } from './sql-writes';

export type HoldKind = 'db-write' | 'prod-release' | 'cloud-write' | 'unreadable';
/** why: reason shown by the gate's log */
export interface Hold { kind: HoldKind; why: string }
export interface HoldContext { cwd: string; readScripts?: ReadScripts; readFile?: (abs: string) => string | null }
export interface HoldRequest { type: string; tool: string; title?: string; input?: unknown; whole?: boolean }

const MAX_TEXT = 100_000, MAX_SCRIPT = 256 * 1024;
const CUT = /… \(\+\d+\)$/;

/** Programs that read, move or print text: a write named in their words is not run. */
const TEXT = /^(?:grep|egrep|fgrep|rg|findstr|select-string|sls|echo|printf|write-output|write-host|cat|type|get-content|gc|head|tail|less|wc|ls|dir|get-childitem|gci|tree|stat|cd|pushd|set-location|which|where|sort|uniq|cut|tr|jq|diff|mkdir|cp|mv|rm|touch|test|set-content|add-content|out-file|tee)$/i;
const WRITER = /^(?:tee|cp|mv|set-content|add-content|out-file|sc|ac)$/i;
/** runs text as code: then what feeds it is not only text */
const EXECUTES = /(?:^|[\s;&|("'`])(?:ba|z|da|k)?sh\b(?!\.)|\b(?:pwsh|powershell|eval|iex|invoke-expression|xargs|parallel|ssh|wsl|source)\b|\bcmd(?:\.exe)?\s+\/[ck]|\.(?:sh|ps1|cmd|bat)\b/i;
const INTERPRETER = /^(?:node|deno|bun|tsx|ts-node|python3?|py|perl|ruby)$/i, SHELL = /^(?:(?:ba|z|da|k)?sh|pwsh|powershell|cmd)$/i;
/** programs whose quoted words are commands themselves */
const RUNS_WORDS = /^(?:(?:ba|z|da|k)?sh|pwsh|powershell|cmd|eval|iex|invoke-expression|ssh|wsl|xargs|sudo|su|nohup|env|timeout|watch|start-process|invoke-command|icm|parallel|docker|kubectl|trap|exec)$/i;
const CHECKERS = /^(?:npx\s+|npm\s+(?:run\s+)?|pnpm\s+|yarn\s+)?(?:vitest|jest|mocha|tsc|eslint|prettier|pytest|playwright|test|lint|typecheck)\b|^dotnet\s+(?:test|build|restore|format)\b|^(?:cargo|go)\s+test\b|^(?:sed|g?awk|tar|zip|unzip|code)\b(?![^\n]*\bsystem\()/i;

const CLIENT_NAME = /^(?:sqlcmd|invoke-sqlcmd|osql|bcp|psql|mysql|mariadb|mongosh|mongo|redis-cli|sqlplus|sqlpackage)$/i;
const CLIENT = /(?<=^|[\s;&|(){}=!"'`]|bin[\\/])(?:sqlcmd|invoke-sqlcmd|osql|bcp|psql|mysql|mariadb|mongosh|mongo|redis-cli|sqlplus|sqlpackage)(?:\.exe)?(?=["'\s]|$)/im;
const REACHES = /\b(?:pyodbc|pymssql|psycopg\w*|asyncpg|mssql|tedious|sqlalchemy|pymongo|mongodb|mongoose|oracledb|npgsql|SqlClient|SqlConnection|SqlCommand|OleDb\w*|Odbc\w*|database\.windows\.net|mysql2?|pg)\b|\b[\w-]*(?:query|sql)[\w-]*\.(?:sh|ps1|mjs|js|py)\b|\b(?:jdbc|postgres(?:ql)?|mysql|mssql|mongodb(?:\+srv)?|sqlserver):/i;
const MIGRATES = /\bdotnet[\s-]+ef\s+database\s+(?:update|drop)\b|\bsqlpackage\b[^\n]*[/-]a(?:ction)?:(?:publish|import)|\b(?:flyway|liquibase)\b[^\n]*\b(?:migrate|update|clean|rollback|repair)\b|\bprisma\s+(?:migrate\s+(?:deploy|reset|dev)|db\s+push)\b|\balembic\b[^\n]*\b(?:upgrade|downgrade)\b|\bknex\b[^\n]*\bmigrate:|\bmanage\.py\s+(?:migrate|flush|loaddata)\b|\b(?:mongorestore|mongoimport|pg_restore|mysqlimport|dropdb|createdb)\b/i;
const MIGRATION_TOOL = /^(?:flyway|liquibase|alembic)$/i;
const MIGRATION_READ = /^(?:info|status|validate|history|current|heads|branches|list|show|help|version|changelog-sync-sql|update-sql)$/i;
const RELEASE = /(?:^|[^a-z])(?:deploy|release|publish|roll-?out|promote|swap)(?![a-z])/i, PROD = /(?:^|[^a-z])(?:prod|production|prd|produzione)(?![a-z])/i;
const TEST_TARGET = /^(?:test|tst|dev|develop|development|staging|stage|qa|uat|local|localhost|sandbox|preview|demo|canary)(?:[-_.:]?\d+)?$/i;
const PUBLISHES = /\bgh\s+(?:release\s+(?:create|edit|delete|upload)|workflow\s+run)\b|\bgh\s+api\b[^\n]*(?:dispatches|deployments|releases)[^\n]*(?:-X|--method|-f|-F|--input)[ =]|\b(?:npm|pnpm|yarn|cargo|vsce)\s+publish\b(?![^;&|\n]*--dry-run)|\bnuget\s+push\b|\btwine\s+upload\b/i;
const RUNS_PROGRAMS = /child_process|subprocess|\bexec\w*\s*\(|\bspawn\w*\s*\(|\bsystem\s*\(|popen|\bfetch\s*\(|requests\.|axios/i;

const SERVER = /localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|\(local(?:db)?\)|\.(?=$|[\\,;:])/;
const NON_PROD_DB_TAG = /(?:^|[-_])(?:dev|tst|qa|uat|staging|stage|sandbox)(?:[-_.\d]|$)|(?:^|[-_])test(?:[-_\d]|$)|(?<=[a-z])(?:Dev|Test|Tst|Staging|Sandbox)(?:[A-Z]|[-_\d]|$)/;
/** Every database server the text names is this machine, and it names one: the user's local database is free. */
function onThisMachine(text: string): boolean {
  const hosts = [...text.matchAll(/(?:\s-S\s*|\s-ServerInstance\s+|\s-h\s+|--host[= ]|\b(?:Server|Data Source)\s*=\s*)["']?([^\s;"'&]+)|:\/\/(?:[^\s/@'"]*@)?([^\s/'"?]+)/gi)].map(m => m[1] ?? m[2] ?? '');
  return hosts.length > 0 && hosts.every(h => new RegExp(`^(?:tcp:)?(?:${SERVER.source})(?:[\\\\,:].*)?$`, 'i').test(h)) && !/database\.windows\.net|\.rds\.amazonaws/i.test(text);
}
/** Every explicitly named database (or server) is clearly a non-prod/dev/test target, with no prod marker anywhere. */
function onNonProdDb(text: string): boolean {
  if (PROD.test(text)) return false;
  const hosts = [...text.matchAll(/(?:\s-S\s*|\s-ServerInstance\s+|\s-h\s+|--host[= ]|\b(?:Server|Data Source)\s*=\s*)["']?([^\s;"'&]+)/gi)].map(m => m[1] ?? '').filter(Boolean);
  if (hosts.length > 0 && hosts.every(h => NON_PROD_DB_TAG.test(h.split('.')[0] ?? h))) return true;
  const dbs = [...text.matchAll(/(?:\s-d\s+|--database[= ]|\b(?:Database|Initial Catalog)\s*=\s*)["']?([^\s;"'&]+)/gi)].map(m => m[1] ?? '').filter(Boolean);
  return dbs.length > 0 && (hosts.length === 0 || dbs.length >= hosts.length) && dbs.every(d => NON_PROD_DB_TAG.test(d));
}

const base = (w: string): string => w.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd)$/i, '');
const LEAD = /^(?:do|then|else|elif|if|while|until|!|time|\{|\}|\.|command|builtin|exec|nohup|sudo|env)$/;
/** where the program of a command is: after `do`, `if`, `sudo`, `VAR=x` */
function progAt(c: Command): number { let i = 0; while (i < c.words.length && (LEAD.test(c.words[i]!) || /^[A-Za-z_]\w*\+?=/.test(c.words[i]!))) i++; return i; }
const prog = (c: Command): string => base(c.words[progAt(c)] ?? '');

/** What a line or a script runs. raw: as written, only what runs. code: not a shell's, read as one text. */
interface Run { all: Command[]; kept: Command[]; raw: string; shell: Shell; code?: boolean }

/** A single literal sqlcmd invocation may use -s (separator) and -h (heading interval). They are not host flags.
 *  Keep the existing host scan for other commands and for SQL fed from a file, pipe or variable. */
function localSqlcmdWithDisplayOptions(run: Run): boolean {
  if (run.code || run.all.length !== 1) return false;
  const c = run.all[0]!;
  const [name = '', ...args] = c.words;
  if (!/^sqlcmd$/i.test(base(name)) || c.value || c.nested || c.body || c.inputs.length || /[$`%]/.test(c.raw)) return false;
  let host: string | undefined, query: string | undefined, display = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '-S' && host === undefined) host = args[++i];
    else if (w === '-Q' && query === undefined) query = args[++i];
    else if (w === '-s' && /^[|,;:]$/.test(args[i + 1] ?? '')) { i++; display = true; }
    else if (w === '-h' && /^-?\d+$/.test(args[i + 1] ?? '')) { i++; display = true; }
    else if (w === '-d' && /^[\w.-]+$/.test(args[i + 1] ?? '')) i++;
    else if (!/^(?:-E|-C|-b|-I|-W)$/.test(w ?? '')) return false;
  }
  return display && !!host && /^(?:tcp:)?(?:localhost|127\.0\.0\.1|\(localdb\))(?:\\[\w-]+)?(?:,\d+)?$/i.test(host)
    && !!query && !/(?:^|\n)\s*[:!]|database\.windows\.net|\.rds\.amazonaws/i.test(query);
}

/** The commands of a text whose quotes cannot be trusted: its stretches, nothing left out. */
function roughly(text: string): Command[] {
  return (text.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^;&|\n"'])+|["']/g) ?? []).map(s => s.trim()).filter(Boolean)
    .map((s, n) => ({ ...command(s.split(/["'\s]+/).filter(Boolean), s, { pipe: -2 - n }), text: s }));
}

let serial = 1_000_000;   // numbers for the pipelines of a nested text
/** the commands inside the words of a shell that is given them as text */
function unfold(cmds: Command[], shell: Shell, depth: number): Command[] {
  return cmds.flatMap(c => {
    const p = prog(c), out = [c];
    if (depth >= 3 || !RUNS_WORDS.test(p)) return out;
    const inner: Shell = /^(?:pwsh|powershell|iex|invoke|icm|start-process|cmd)/i.test(p) ? 'powershell' : /^(?:eval|timeout|watch)$/i.test(p) ? shell : 'bash';
    for (const text of [...c.words.slice(1).filter(w => /\s/.test(w)), ...(SHELL.test(p) || /^(?:ssh|wsl)$/i.test(p) ? [c.body] : [])]) {
      if (!text.trim()) continue;
      const from = (serial += 100_000);
      out.push(...unfold(readCommands(text, inner)?.map(x => ({ ...x, pipe: x.pipe + from })) ?? roughly(text), inner, depth + 1));
    }
    return out;
  });
}

function onlyText(c: Command): boolean {
  const p = prog(c);
  return TEXT.test(p) || (/^git$/i.test(p) && !c.words.some(w => /^(?:!|-c$|-x$|--exec|exec$|foreach$|bisect$|filter-branch$)/i.test(w)));
}

/** Leaves out the commands that only handle text, unless what they print or write is run. */
function runOf(raw: string, shell: Shell, args: readonly string[] | null = null, named?: ReadonlyMap<string, string>): Run {
  const read = readCommands(raw, shell, args, named);
  const all = unfold(read ?? roughly(raw), shell, 0);
  if (!read) return { all, kept: all, raw, shell };
  const runs = all.filter(c => !onlyText(c));
  const executes = runs.some(c => EXECUTES.test(c.text)), starts = executes || runs.some(c => INTERPRETER.test(prog(c)) || /^\.[\\/]/.test(c.words[progAt(c)] ?? ''));
  const mates = new Map<number, Command[]>();
  for (const c of all) mates.set(c.pipe, [...(mates.get(c.pipe) ?? []), c].slice(-50));
  const feeds = (c: Command): boolean => {
    const line = mates.get(c.pipe) ?? [c];
    return (executes && (c.nested || line.some(m => m.writes || WRITER.test(prog(m))))) || (starts && line.some(m => m.body !== '')) || (c.body !== '' && !c.asText)
      || line.some(m => !onlyText(m) && (EXECUTES.test(m.text) || INTERPRETER.test(prog(m)) || m.words.some(w => CLIENT_NAME.test(base(w)))));
  };
  const kept = all.filter(c => !onlyText(c) || feeds(c));
  const lines = new Map<number, string[]>();
  for (const c of kept) lines.set(c.pipe, [...(lines.get(c.pipe) ?? []), c.raw].slice(-50));
  return { all, kept, raw: [...lines.values()].map(l => l.join(' | ')).join('\n'), shell };
}

const piece = (c: Command): string => c.body ? `${c.text}\n${c.body}` : c.text;

function cloudHold(run: Run): Hold | null {
  const whole = run.kept.map(piece).join('\n'), strict = !!run.code && !RUNS_PROGRAMS.test(whole);
  for (const c of run.kept) {
    const text = piece(c), isProd = (s: string): boolean => PROD.test(s);
    const direct = cloudCommand(prog(c), c.words.slice(progAt(c) + 1), isProd);
    if (direct) return direct;
    const cli = strict ? null : cliWrite(text, isProd);
    if (cli) return cli;
    if (!strict && cloudWords(text)) return { kind: 'cloud-write', why: 'il comando modifica un servizio cloud' };
    if (!/^(?:az|invoke-azrestmethod)$/i.test(prog(c)) && httpWrite(text, whole)) return { kind: 'cloud-write', why: 'non riconosco la richiesta al servizio cloud come lettura' };
    if (sdkWrite(text, strict)) return { kind: 'cloud-write', why: 'il codice modifica un servizio cloud' };
  }
  return null;
}

/** a program's name that is only looked for or installed */
const MENTION = /^(?:which|where|type|get-command|gcm|hash|for|foreach|alias|apt|apt-get|brew|choco|winget|npm|pip3?)$/i;

/** @param given the script's arguments; a read is evidence only for the call that consumes it. */
function dbHold(run: Run, given: readonly string[], ctx: HoldContext): Hold | null {
  const code = run.kept.map(piece).join('\n');
  if (MIGRATES.test(code)) return { kind: 'db-write', why: 'il comando modifica un database' };
  for (const c of run.kept) {
    const p = prog(c).toLowerCase();
    const [area = '', action = '', verb = ''] = positionals(c.words.slice(progAt(c) + 1), PLAIN_SWITCH).sure;
    const family = MIGRATION_TOOL.test(p) || (p === 'dotnet' && area === 'ef' && /^(?:database|migrations|dbcontext)$/.test(action)) || (p === 'prisma' && /^(?:migrate|db)$/.test(area));
    if (family && !MIGRATION_READ.test(p === 'dotnet' ? verb : p === 'prisma' ? action : area) && !c.words.some(w => /^(?:-h|--help|--version)$/.test(w))) return { kind: 'db-write', why: 'non riconosco il comando di migrazione come lettura' };
  }
  const whole = [...run.all.map(piece), ...given].join('\n');
  const statements: string[] = [], loose: string[] = [];
  let client = false, unknown = false;
  const load = (name: string): string => /\.sql$/i.test(name) && !/[\r\n$`]/.test(name) ? scriptText(name, ctx) ?? '' : '';
  const previous = new Map<Command, Command>(), last = new Map<number, Command>();
  for (const c of run.all) {
    const prev = last.get(c.pipe);
    if (prev && c.pipe !== -1) previous.set(c, prev);
    last.set(c.pipe, c);
  }
  for (const g of given) (looksLikeStatement(g) || /\s--\s|;/.test(g) ? statements : loose).push(g);
  for (const c of run.kept) {
    const at = run.code || c.words.includes('-v') && c.words.includes('command') || MENTION.test(prog(c)) ? -1
      : c.words.findIndex((w, n) => CLIENT_NAME.test(base(w)) || (n === progAt(c) && /^["']?\$\{?\w+\}?$/.test(w) && CLIENT.test(code) && !/^[+-]?=$/.test(c.words[n + 1] ?? '')));
    if (at >= 0) {
      client = true;
      const call = clientCall(c.words.slice(at));
      const payloads = [...call.statements, ...call.files.map(load), ...(c.body ? [c.body] : c.inputs.map(load))];
      loose.push(call.rest.join(' '), c.words.slice(0, at).join(' '));
      const source = previous.get(c);
      if (source) {
        if (/^(?:cat|type|get-content|gc)$/i.test(prog(source))) payloads.push(...source.words.slice(progAt(source) + 1).map(load));
        else if (/^(?:echo|printf|write-output)$/i.test(prog(source))) payloads.push(source.words.slice(progAt(source) + 1).join(' '));
        else if (source.body) payloads.push(source.body); else if (!call.reads && !payloads.length) payloads.push('');
      }
      statements.push(...payloads);
      if ((!call.reads && !payloads.length) || payloads.some(s => !(call.mongo ? mongoRead(s) : wholeStatementReads(s)))) unknown = true;
    } else {
      loose.push(piece(c).replace(/^exec\s+/, ''));
      if (run.code || INTERPRETER.test(prog(c))) {
        if (CLIENT.test(piece(c))) client = unknown = true;
        if (REACHES.test(code)) {
          const text = run.code ? c.text : [...c.words.slice(progAt(c) + 1), c.body].join('\n');
          if (/\b(?:sql|conn(?:ection)?|pool|cursor|db)\.(?!(?:query|execute(?:Query|Many)?|exec|executemany|run|raw|sql|connect|close|end|release|request|input|cursor|collection|find|findOne|count|countDocuments|distinct|get)(?=\s*\())\w+\s*\(/i.test(text)) client = unknown = true;
          for (const m of text.matchAll(/\.(?:query|execute(?:Query|Many)?|exec|executemany|run|raw|sql)\s*\(\s*(?:(["'`])((?:(?!\1)[^\\]|\\.)*)\1\s*(?=[,)])|sys\.argv\[(\d+)\]|process\.argv\[(\d+)\])?/gi)) {
            client = true;
            const sql = m[2] ?? (m[3] ? given[+m[3] - 1] : m[4] ? given[+m[4] - 2] : undefined) ?? '';
            if (!wholeStatementReads(sql)) unknown = true;
          }
        }
      }
    }
  }
  if ((!client && !REACHES.test(code)) || onThisMachine(whole) || onNonProdDb(whole) || localSqlcmdWithDisplayOptions(run)) return null;
  if (statements.some(statementWrites) || loose.some(looseWrite)) return { kind: 'db-write', why: 'l’istruzione modifica un database' };
  if (unknown) return { kind: 'db-write', why: 'non riconosco tutte le istruzioni al database come letture' };
  return null;
}

const UNREADABLE = /\s-e(?:c|n|nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{24,}|\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|base64)\b[^;&\n]*\|\s*(?:(?:ba|z|da)?sh|pwsh|powershell|iex|invoke-expression|node|python3?)\b|\b(?:eval|iex|invoke-expression)\s+["']?\$(?!\()/i;
const OPERATOR = /^(?:[+-]?=|-(?:eq|ne|gt|lt|ge|le|c?like|i?match|notmatch|notlike|in|notin|contains|replace|split|join|is|as|and|or|f))$/i;

const SCRIPT = /\.(?:sh|bash|ps1|cmd|bat|py|js|mjs|cjs|ts)$/i, SHELL_SCRIPT = /\.(?:sh|bash|ps1|cmd|bat)$/i;
interface Ref { file: string; args: string[]; shell: boolean }
/** the files of code a command runs, with what they are called with */
function scripts(c: Command): Ref[] {
  const out: Ref[] = [], at = progAt(c), w = c.words, sourced = at > 0 && w[at - 1] === '.';
  const own = w[at] ?? '';
  if (SCRIPT.test(own) || (sourced && own)) out.push({ file: own, args: w.slice(at + 1), shell: sourced || SHELL_SCRIPT.test(own) });
  else for (let j = at; j < w.length && !out.length; j++) {
    const sh = SHELL.test(base(w[j]!)) || /^source$/.test(w[j]!);
    if (!sh && !INTERPRETER.test(base(w[j]!))) { if (j > at && /^(?:xargs|timeout|start-process|find|watch)$/i.test(base(own)) && SCRIPT.test(w[j]!)) out.push({ file: w[j]!, args: w.slice(j + 1), shell: SHELL_SCRIPT.test(w[j]!) }); continue; }
    for (let n = j + 1; n < w.length; n++) {
      const x = w[n]!;
      if (/^(?:-c|-[a-z]*lc|-command|-e|--eval|-p|--print|-encodedcommand|-m)$/i.test(x) && !(sh && x === '-e')) break;
      if (/^(?:--require|-r|--import|--loader|--rcfile|--init-file)$/.test(x)) { out.push({ file: w[++n] ?? '', args: [], shell: sh }); continue; }
      if (/^-(?:executionpolicy|ep|o)$/i.test(x)) { n++; continue; }
      if (/^-|^\/[a-z]$/i.test(x)) continue;
      if (sh || SCRIPT.test(x)) out.push({ file: x, args: w.slice(n + 1), shell: sh });
      break;
    }
  }
  if (SHELL.test(base(own))) for (const f of c.inputs) out.push({ file: f, args: [], shell: true });
  return out.filter(r => r.file && !/\s/.test(r.file.replace(/[\w] [\w]/g, '')));
}

/** a script told to release, with no target that is only a test */
function promotes(r: Ref): boolean {
  if (!SHELL_SCRIPT.test(r.file)) return false;
  const { sure, after } = positionals(r.args, PLAIN_SWITCH);
  if (READ.test(sure[0] ?? '') || !(/^(?:release|promote|swap|rollout)$/i.test(sure[0] ?? '') || after.some(w => /^(?:promote|swap|rollout)$/i.test(w)))) return false;
  const target = r.args.some((w, n) => TEST_TARGET.test(w.replace(/^--?[\w-]+[=:]/, '')) && !/^--?(?:from|source|src)\b/i.test(w) && !/^--?(?:from|source|src)$/i.test(r.args[n - 1] ?? ''));
  return !target || PROD.test(r.args.join(' '));
}

const NO_RELEASE = /^(?:\[\[?|test|function|case|for|foreach|param|export|local|declare|readonly|typeset|set|az|aws|gcloud|kubectl|helm|git)$/i;
const CALLS_OUT = /exec|spawn|system\s*\(|subprocess|popen|\bfetch\s*\(|requests\.|axios|urlopen/i;
const GH_WRAPPER = /^(?:ssh|wsl|xargs|timeout|watch|start-process|docker|kubectl)$/i;
function releaseHold(run: Run): Hold | null {
  const publishes: Hold = { kind: 'prod-release', why: 'il comando pubblica una release' }, releases: Hold = { kind: 'prod-release', why: 'non riconosco il comando di rilascio in produzione come lettura' };
  for (const c of run.kept) {
    for (const said of (run.code ? c.text : c.body).split('\n')) {
      const line = said.replace(/\b(?:console\.\w+|print)\s*\([^)]*\)/g, '');
      if (!CALLS_OUT.test(line)) continue;
      if (PUBLISHES.test(line)) return publishes;
      const gh = /\bgh\s+release(?:\s+([\w-]+))?/i.exec(line);
      if (gh && !releaseRead.test(gh[1] ?? '')) return releases;
      if (RELEASE.test(line) && PROD.test(line)) return releases;
    }
    if (run.code) continue;
    const at = progAt(c), p = prog(c);
    const rest = c.words.slice(at + 1), action = positionals(rest, PLAIN_SWITCH).sure;
    const gh = /^gh$/i.test(p) ? at : GH_WRAPPER.test(p) ? c.words.findIndex((w, n) => n > at && /^gh$/i.test(base(w))) : -1;
    if (gh >= 0) {
      const args = c.words.slice(gh + 1), [area = '', verb = ''] = positionals(args, PLAIN_SWITCH).sure;
      if (/^release$/i.test(area) && !releaseRead.test(verb) && !args.some(w => /^--?(?:help|h)$/.test(w))) return releases;
    }
    // a quoted phrase is text, unless it is code that calls out (what a shell is given is a command of its own here)
    const text = c.words.filter(w => !/\s/.test(w) || (INTERPRETER.test(p) && CALLS_OUT.test(w))).join(' ');
    if (PUBLISHES.test(text) || scripts(c).some(promotes)) return publishes;
    if (!p || c.value || NO_RELEASE.test(p) || /^\[[\w.]+\]?(?!.*::)/.test(p) || ((run.shell === 'powershell' || /^\$/.test(p)) && OPERATOR.test(c.words[at + 1] ?? '')) || /\(\)$/.test(p) || CHECKERS.test(c.words.slice(at).join(' '))) continue;
    if (/^(?:curl|wget|iwr|irm)$/i.test(p)) { const h = httpMethods(c.text); if (!h.writes && !h.posts) continue; }
    if (!RELEASE.test(text) || !PROD.test(text)) continue;
    if (!rest.some(w => /^--?(?:help|h|dry-run)$/.test(w)) && !releaseRead.test(action[0] ?? '')) return releases;
  }
  return null;
}

/** @param script its arguments, when this is a script's own text */
function judge(run: Run, ctx: HoldContext, script?: readonly string[]): Hold | null {
  if (!run.kept.length) return null;
  if (UNREADABLE.test(run.raw) || run.kept.some(c => UNREADABLE.test(c.text))) return { kind: 'unreadable', why: 'l’app non può leggere il codice da eseguire' };
  if (!run.code) for (const c of run.kept) {
    const w = c.words.slice(progAt(c));
    if (!/^\$(?:\w+$|\{)/.test(w[0] ?? '') || OPERATOR.test(w[1] ?? '') || (run.shell === 'powershell' && !c.called)) continue;
    const verb = w.slice(1).find(x => WRITE.test(x) || PLAIN_READ.test(x));
    if (verb && !PLAIN_READ.test(verb)) return { kind: 'unreadable', why: 'il nome del programma è in una variabile e il comando indica una scrittura' };
  }
  const cloud = cloudHold(run);
  if (cloud) return cloud;
  if (!script) for (const c of run.kept) for (const r of scripts(c)) {
    const text = scriptText(r.file, ctx), h = text === null ? null : scriptHold(r, text, ctx);
    if (h) return { ...h, why: `${path.basename(r.file)}: ${h.why}` };
  }
  return dbHold(run, script ?? [], ctx) ?? releaseHold(run);
}

/** PowerShell's parameters by name, from how the script is called */
function namedArgs(text: string, args: readonly string[]): Map<string, string> {
  const names = [...(/\bparam\s*\(([\s\S]{0,4000}?)\)\s*(?:\n|$|[A-Za-z$&])/i.exec(text)?.[1] ?? '').matchAll(/\$(\w+)/g)].map(m => m[1]!.toLowerCase());
  const out = new Map<string, string>(), left: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^-(\w+)(?::(.*))?$/s.exec(args[i]!), name = m && names.find(n => n.startsWith(m[1]!.toLowerCase()));
    if (!name) { left.push(args[i]!); continue; }
    if (m![2] !== undefined) out.set(name, m![2]); else if (i + 1 < args.length && !/^-[A-Za-z]/.test(args[i + 1]!)) out.set(name, args[++i]!);
  }
  for (const n of names) if (!out.has(n) && left.length) out.set(n, left.shift()!);
  return out;
}

/** Select the arm only for a whole Bash script that is a literal, non-fallthrough case on $1. */
function caseBody(text: string, args: readonly string[]): string {
  const body = /^\s*case\s+"\$1"\s+in\s+([\s\S]+)\s+esac\s*$/.exec(text)?.[1];
  if (!body) return text;
  const arms = body.split(';;');
  if (arms.pop()?.trim()) return text;
  const parsed = arms.map(arm => /^\s*([\w-]+)\)\s*([^;&|\n`$()]+(?: "\$2")?)\s*$/.exec(arm));
  if (parsed.some(arm => !arm)) return text;
  const selected = parsed.find(arm => arm?.[1] === args[0]) ?? (args[0] === '-v' ? parsed.find(arm => arm?.[1] === args[1]) : undefined);
  return selected?.[2] ?? text;
}

function scriptHold(r: Ref, text: string, ctx: HoldContext): Hold | null {
  let run: Run;
  if (/\.(?:py|js|mjs|cjs|ts)$/i.test(r.file) || !r.shell) {
    const body = text.replace(/^[ \t]*(?:#|\/\/).*$/gm, '');
    run = { all: [], kept: [{ ...command([], body), text: body }], raw: body, shell: 'bash', code: true };
  } else if (/\.ps1$/i.test(r.file)) run = runOf(text.replace(/`\r?\n/g, ' ').replace(/\r\n/g, '\n'), 'powershell', r.args, namedArgs(text, r.args));
  else if (/\.(?:cmd|bat)$/i.test(r.file)) {
    const body = text.replace(/\^\r?\n/g, ' ').replace(/^[ \t]*@?(?:(?:rem\b|::).*|echo\b[^|&\r\n]*)$/gim, '').replace(/%(?:~?([1-9])|\*)/g, (_, n: string) => n ? r.args[+n - 1] ?? '' : r.args.join(' '));
    run = runOf(body.replace(/\r\n/g, '\n'), 'powershell');
  } else run = runOf(caseBody(text.replace(/\r\n/g, '\n').replace(/\\\n/g, ' '), r.args), 'bash', r.args);
  return judge(run, ctx, r.args);
}

function scriptText(file: string, ctx: HoldContext): string | null {
  const p = process.platform === 'win32' ? file.replace(/^\/([a-z])\//i, '$1:/') : file;
  const abs = path.resolve(ctx.cwd || '.', p);
  if (ctx.readFile) return ctx.readFile(abs);
  try { const st = fs.statSync(abs); return st.isFile() && st.size <= MAX_SCRIPT ? fs.readFileSync(abs, 'utf8') : null; } catch { return null; }
}

/** A tool that does not say its shell is read as both; a reading with open quotes would not run. */
function lineHold(line: string, tool: string, ctx: HoldContext): Hold | null {
  const raw = line.replace(/\r\n/g, '\n');
  const shells: Shell[] = /powershell/i.test(tool) ? ['powershell'] : /^(?:bash|monitor)$/i.test(tool) ? ['bash'] : ['bash', 'powershell'];
  const joined = (s: Shell): string => raw.replace(s === 'bash' ? /\\\n/g : /`\n/g, ' ');
  // PowerShell makes the whole body a string; Bash stdin executes it. Check the executable payload as well as the
  // outer command, so a read-only classification of the wrapper never takes the place of the hold checks.
  const stdin = shells.includes('powershell') ? literalBashStdin(raw) : undefined;
  if (stdin !== undefined) {
    const h = judge(runOf(stdin.replace(/\\\n/g, ' '), 'bash'), ctx);
    if (h) return h;
  }
  const sound = shells.filter(s => readCommands(joined(s), s) !== null);
  for (const s of sound.length ? sound : shells.slice(0, 1)) { const h = judge(runOf(joined(s), s), ctx); if (h) return h; }
  return null;
}

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const CLOUD_SERVER = /azure|aws|gcp|gcloud|cloudflare|kubernetes|k8s|terraform|vercel|netlify|heroku/i;
const DB_SERVER = /sql|postgres|mongo|redis|(?:^|[-_])(?:db|database)(?:[-_]|$)|supabase|snowflake|bigquery|cosmos/i;
const named = (re: RegExp, name: string): boolean => name.split(/[_\s.]+/).some(w => re.test(w));
/** `deleteRows`, `rows-delete`: the parts of a name; one that begins with a read reads. To execute is not yet to write. */
const writesByName = (name: string): boolean => name.split(/[_\s.]+/).some(w => { const p = w.split(/-|(?<=[a-z])(?=[A-Z])/); return (p.length === 1 || !READ.test(p[0]!)) && p.some(x => WRITE.test(x) && !/^exec/i.test(x)); });

/** A connector's call: the names of its server and tool, and the statement or command it carries. */
function connectorHold(req: HoldRequest): Hold | null {
  const input = obj(req.input);
  const name = [req.tool, req.tool.includes('__') ? '' : req.title, input.server, input.tool].filter(x => typeof x === 'string' && x).join('_');
  if (/second-brain/.test(name)) return null;   // the app's own tools check themselves
  const parts = name.split('__').filter(Boolean), action = parts.length > 2 ? parts.slice(2).join('_') : name;
  const db = DB_SERVER.test(name), statements: string[] = [], texts: string[] = [];
  const walk = (v: unknown, key: string, depth: number): void => {
    if (typeof v === 'string') { texts.push(v.slice(0, MAX_TEXT)); if (/^(?:sql|query|statement|command|script)$/i.test(key)) statements.push(v); }
    else if (v && typeof v === 'object' && depth < 6) for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k, depth + 1);
  };
  walk(input, '', 0);
  // on a database every field may carry the statement; elsewhere only one that begins like a statement
  if (statements.some(t => /^\s*(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|exec(?:ute)?)\b/i.test(t)) || texts.some(t => (db || looksLikeStatement(t)) && /\s/.test(t) && statementWrites(t))) return { kind: 'db-write', why: `${action} carries a statement that writes on a database` };
  const reads = named(READ, action) && !writesByName(action);
  if (db && writesByName(action)) return { kind: 'db-write', why: `${action} writes on a database` };
  if (db && /(?:^|[_\s.-])(?:execute|exec|run|call|eval)(?![a-z])/i.test(action) && !texts.some(statementReads)) return { kind: 'db-write', why: `${action} carries no statement the app can read` };
  if (CLOUD_SERVER.test(name) && !/devops/i.test(name)) {
    const cmd = statements.find(t => named(READ, t) || named(WRITE, t));
    if (writesByName(action) || (cmd ? named(WRITE, cmd) : !reads)) return { kind: 'cloud-write', why: `${action} is not known to only read a cloud account` };
  }
  if (RELEASE.test(action) && !reads && PROD.test(`${name}\n${JSON.stringify(input).slice(0, 20_000)}`)) return { kind: 'prod-release', why: `${action} releases in production` };
  return null;
}

/** Why a delegated chat's request waits for the user, or null. */
export function heldForUser(req: HoldRequest, ctx: HoldContext): Hold | null {
  if (req.type !== 'permission') return null;
  const cls = toolClass(req.tool, COMMAND_TOOLS), input = obj(req.input);
  if (cls === 'command' || req.tool === 'Monitor') {
    const raw = Array.isArray(input.command) ? input.command.join(' ') : input.command;
    if (typeof raw !== 'string' || !raw.trim()) return { kind: 'unreadable', why: 'la richiesta non indica il comando da eseguire' };
    if ((!req.whole && CUT.test(raw)) || raw.length > MAX_TEXT) return { kind: 'unreadable', why: 'la richiesta non contiene il comando completo' };
    const own = [input.cwd, input.workdir, input.working_directory].find((x): x is string => typeof x === 'string' && !!x);
    // a leading cd moves where the scripts are read from
    const moved = /^\s*cd\s+["']?([^\s"';&|$]+)["']?\s*(?:&&|;|\n)/.exec(raw)?.[1];
    const from = own ? path.resolve(ctx.cwd || '.', own) : ctx.cwd;
    const cwd = moved ? path.resolve(from || '.', process.platform === 'win32' ? moved.replace(/^\/([a-z])\//i, '$1:/') : moved) : from;
    return lineHold(raw, req.tool, { ...ctx, cwd });
  }
  return cls === 'mcp' ? connectorHold(req) : null;
}
