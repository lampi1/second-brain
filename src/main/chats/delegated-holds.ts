// What a delegated chat never does without the user (ADR 0352, issue #472): a write on a database, a production release,
// a write on a cloud account. A delegated chat's requests pass the gate without a panel, so these three keep waiting
// here also where no rule of the user's brain names them (manager-requests.ts permitDecision, after the user's own
// rules: those may only refuse more). Read from the text of the command, of a script it runs, or of a connector's call.
// A cloud or database client passes only when its words are known to read; a database on this machine is free. A net
// over what the app can read, not a wall: a compiled program or a script built at run time is not seen (ADR 0352).
// Pure apart from reading a script's file; pinned by test/unit/chats/delegated-holds.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { COMMAND_TOOLS, readOnlyCommand, type ReadScripts } from '../agents/tool-policy';
import { toolClass } from './permit-policy';

export type HoldKind = 'db-write' | 'prod-release' | 'cloud-write' | 'unreadable';
/** why: English, for the log */
export interface Hold { kind: HoldKind; why: string }
export interface HoldContext { cwd: string; readScripts?: ReadScripts; readFile?: (abs: string) => string | null }
export interface HoldRequest { type: string; tool: string; title?: string; input?: unknown; whole?: boolean }

const MAX_TEXT = 100_000, MAX_SCRIPT = 256 * 1024;
const CUT = /… \(\+\d+\)$/;

/** Programs that read, move or print text: a write named in their words is not run. */
const TEXT = /^(?:grep|egrep|fgrep|rg|findstr|select-string|sls|echo|printf|write-output|write-host|cat|type|get-content|gc|head|tail|less|wc|ls|dir|get-childitem|gci|tree|stat|cd|pushd|set-location|which|where|sort|uniq|cut|tr|jq|diff|mkdir|cp|mv|rm|touch|test|set-content|add-content|out-file)$/i;
/** something in the line runs text as code: then no word is only text */
const EXECUTES = /(?:^|[\s;&|("'`])(?:ba|z|da|k)?sh\b(?!\.)|\b(?:pwsh|powershell|eval|iex|invoke-expression|xargs|parallel|ssh|wsl|source)\b|\bcmd(?:\.exe)?\s+\/[ck]|\|\s*(?:node|python3?|py|perl|ruby|sqlcmd|psql|mysql|mongosh|osql)\b|\.(?:sh|ps1|cmd|bat)\b/i;
const CHECKERS = /^(?:npx\s+|npm\s+(?:run\s+)?|pnpm\s+|yarn\s+)?(?:vitest|jest|mocha|tsc|eslint|prettier|pytest|playwright|test|lint|typecheck)\b|^(?:dotnet|cargo|go)\s+test\b/i;

const READ = /^(?:list|ls|show|get|describe|query|search|check|exists|tail|head|scan|lookup|view|status|inspect|download|wait|validate|what-if|diff|plan|preview|output|explain|top|history|whoami|info|filter|select|batch-get|read|fmt|providers|graph|template|lint|can-i|events|stat|cat|du|start-query|get-log-events)(?:[-:].*)?$/i;
const WRITE = /^(?:create|delete|update|set|add|remove|restart|start|stop|deploy|import|purge|swap|assign|reset|upload|scale|apply|invoke|put|patch|edit|exec|install|upgrade|uninstall|rollback|drain|replace|destroy|terminate|modify|publish|up|down|copy|cp|mv|rm|sync|move|send|attach|detach|enable|disable|promote|release|insert|drop|truncate|regenerate|renew|rotate|failover)(?:[-:].*)?$/i;
/** the CLI's own sign-in and settings: this machine only */
const LOCAL = /^(?:login|logout|version|help|configure|config|extension|cloud|auth|sso|sts|init|completion|account|bicep)$/i;
const CLI = /(?<=^|[\s;&|(){}[=!"'`]|bin[\\/])(az|azd|aws|gcloud|gsutil|kubectl|helm|terraform|tofu|pulumi|eksctl|doctl|vercel|netlify|wrangler|firebase|heroku|flyctl|azcopy)(?:\.cmd|\.exe)?["']?[ \t]+([^;&|\n)]*)/gim;
/** other programs that only write on a cloud account with these words */
const CLOUD_WORDS = /\bcdk\s+(?:deploy|destroy|bootstrap)\b|\b(?:sam|swa|fly|sls|serverless)\s+(?:deploy|remove|destroy)\b|\bfunc\s+azure\s+functionapp\s+publish\b|\boc\s+(?:apply|create|delete|patch|scale|rollout\s+(?:latest|restart|undo)|new-app)\b|\bbq\s+(?:rm|mk|load|insert|update|cp)\b|\b(?:new|set|remove|update|start|stop|restart|publish|invoke|add|import|reset|move|copy|register|enable|disable|save|clear|swap|switch|grant|revoke)-az(?!context|default|config|operationalinsightsquery|restmethod\b(?![^;|\n]*-method\s+["']?(?:post|put|patch|delete)))[a-z]\w*/i;
const HOSTS = /management\.(?:core\.windows|azure)\.(?:com|net)|\.scm\.azurewebsites\.net|\.vault\.azure\.net|graph\.microsoft\.com|\.(?:blob|queue|table|file)\.core\.windows\.net|\.documents\.azure\.com|\.servicebus\.windows\.net|\.googleapis\.com|\.amazonaws\.com|api\.(?:cloudflare|vercel|netlify|heroku|digitalocean)\.com|vsrm\.dev\.azure\.com|dev\.azure\.com\S*\/_apis\/release/i;
const HTTP_WRITE = /(?:-X|--request|--method|-m|-Method)[ =:]?["']?(?:post|put|patch|delete|\$)|(?:^|\s)(?:-d|--data\S*|-F|--form|-T|--upload-file|--json|--body|-b|-Body|-InFile)[ =]|\.(?:post|put|patch|delete)\s*\(|method["']?\s*[:=]\s*["'](?:post|put|patch|delete)/i;
const HTTP_READ = /(?:-X|--request|--method|-m|-Method)[ =:]?["']?(?:get|head)\b|\/query\b|ResourceGraph\/resources/i;
const SDK = /\bazure[.-](?:mgmt|storage|keyvault|servicebus|cosmos)\b|@azure\/|\bboto3\b|@aws-sdk\/|\bgoogle[.-]cloud\b/i;
const SDK_WRITE = /\.(?:begin_)?(?:create|delete|update|put|set|start|stop|restart|terminate|purge|upload|deploy|patch|send|publish|upsert)(?:_\w+|[A-Z]\w*)?\s*\(|new\s+(?:Create|Delete|Update|Put|Start|Stop|Terminate)\w*Command\b/;

const CLIENT = /(?<=^|[\s;&|(){}=!"'`]|bin[\\/])(?:sqlcmd|invoke-sqlcmd|osql|bcp|psql|mysql|mariadb|mongosh|mongo|redis-cli|sqlplus|sqlpackage)(?:\.exe)?(?=["'\s]|$)/im;
const REACHES = /\b(?:pyodbc|pymssql|psycopg\w*|asyncpg|mssql|tedious|sqlalchemy|pymongo|mongodb|mongoose|oracledb|npgsql|SqlClient|SqlConnection|SqlCommand|OleDb\w*|Odbc\w*|database\.windows\.net|mysql2?|pg)\b|\b[\w-]*(?:query|sql)[\w-]*\.(?:sh|ps1|mjs|js|py)\b|\b(?:jdbc|postgres(?:ql)?|mysql|mssql|mongodb(?:\+srv)?|sqlserver):/i;
const SQL_WRITE = [
  /\binsert\s+(?:into\s+)?(?![#@])[\w.[\]"$@{}-]+\s*(?:\(|select\b|values\b|default\b|exec\b)/i, /\binsert\s+into\s+(?![#@])/i, /\bupdate\s+(?:top\s*\([^)]{0,20}\)\s*)?(?![#@])[\w.[\]"$@{}-]+\s+(?:(?:as\s+)?\w+\s+)?set\b/i,
  /\bdelete\s+(?:top\s*\([^)]{0,20}\)\s*)?(?:from\s+(?![#@])|(?![#@])[\w.[\]]+\s+(?:from|where)\b)/i, /\bmerge\s+(?:into\s+)?(?![#@])[\w.[\]]+\s+(?:as\s+)?(?:\w+\s+)?using\b/i, /\btruncate\s+table\s/i, /\bbulk\s+insert\s/i,
  /\b(?:create|alter|drop)\s+(?:or\s+\w+\s+)?(?:(?:unique|clustered|nonclustered|temporary|materialized)\s+){0,2}(?:table|view|proc\w*|function|trigger|index|schema|database|user|login|role|type|sequence)\s+(?!#)/i,
  /\bexec(?:ute)?\s+(?!(?:sys\.)?sp_(?:help\w*|who\w*|columns|spaceused|tables|lock)\b)[a-z_[][\w.[\]]*/i, /\b(?:grant|revoke|deny)\s+(?:all|select|insert|update|delete|execute|control|alter)\b/i,
  /\binto\s+(?![#@])[\w.[\]]+\s+from\b/i, /\b(?:backup|restore)\s+(?:database|log)\s/i, /\bcopy\s+[\w.]+\s+from\b/i,
  /\.(?:insert(?:One|Many)|update(?:One|Many)|delete(?:One|Many)|replaceOne|drop(?:Database)?|findOneAnd\w+|bulkWrite|createIndex)\s*\(/,
];
const SQL_READ = /\b(?:select|show|describe|explain|sp_help\w*|sp_who\w*|dbsize|keys|get|ping|info)\b|\.(?:find|count\w*|aggregate|distinct)\s*\(|\s-l\b|\\d|\b(?:out|queryout)\b/i;
const MIGRATES = /\bdotnet[\s-]+ef\s+database\s+(?:update|drop)\b|\bsqlpackage\b[^\n]*[/-]a(?:ction)?:(?:publish|import)|\b(?:flyway|liquibase)\b[^\n]*\b(?:migrate|update|clean|rollback|repair)\b|\bprisma\s+(?:migrate\s+(?:deploy|reset|dev)|db\s+push)\b|\balembic\b[^\n]*\b(?:upgrade|downgrade)\b|\bknex\b[^\n]*\bmigrate:|\bmanage\.py\s+(?:migrate|flush|loaddata)\b|\b(?:mongorestore|mongoimport|pg_restore|mysqlimport|dropdb|createdb)\b/i;
const RELEASE = /(?:^|[^a-z])(?:deploy|release|publish|roll-?out|promote|swap)(?![a-z])/i, PROD = /(?:^|[^a-z])(?:prod|production|prd|produzione)(?![a-z])/i;
const PUBLISHES = /\bgh\s+(?:release\s+(?:create|edit|delete|upload)|workflow\s+run)\b|\bgh\s+api\b[^\n]*(?:dispatches|deployments|releases)[^\n]*(?:-X|--method|-f|-F|--input)[ =]|\b(?:npm|pnpm|yarn|cargo|vsce)\s+publish\b(?![^;&|\n]*--dry-run)|\bnuget\s+push\b|\btwine\s+upload\b|\.(?:sh|ps1|cmd|bat)["']?\s+(?:release|promote|swap|rollout)\b/i;
const RUNS_PROGRAMS = /child_process|subprocess|\bexec\w*\s*\(|\bspawn\w*\s*\(|\bsystem\s*\(|popen|\bfetch\s*\(|requests\.|axios/i;

const SERVER = /localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|\(local(?:db)?\)|\.(?=$|[\\,;:])/;
/** Every database server the text names is this machine, and it names one: the user's local database is free. */
function onThisMachine(text: string): boolean {
  const hosts = [...text.matchAll(/(?:\s-S\s*|\s-ServerInstance\s+|\s-h\s+|--host[= ]|\b(?:Server|Data Source)\s*=\s*)["']?([^\s;"'&]+)|:\/\/(?:[^\s/@'"]*@)?([^\s/'"?]+)/gi)].map(m => m[1] ?? m[2] ?? '');
  return hosts.length > 0 && hosts.every(h => new RegExp(`^(?:tcp:)?(?:${SERVER.source})(?:[\\\\,:].*)?$`, 'i').test(h)) && !/database\.windows\.net|\.rds\.amazonaws/i.test(text);
}

function cloudHold(line: string): Hold | null {
  // a list of arguments (['az', 'group', 'delete']) reads as words too
  const code = line.replace(/["'][ \t]*,[ \t]*["']/g, ' ');
  for (const m of code.matchAll(CLI)) {
    const prog = m[1]!.toLowerCase(), rest = m[2]!;
    const all = rest.split(/[\s"'`,\]]+/).filter(Boolean);
    if (!all.length || all.some(w => /^(?:--help|-h|--version)$/.test(w))) continue;
    if (prog === 'az' && all[0] === 'rest') { if (HTTP_WRITE.test(rest) && !HTTP_READ.test(rest)) return { kind: 'cloud-write', why: 'az rest writes' }; continue; }
    // work items, pull requests and the CI queue are no cloud resource; a release or a production run is
    if (prog === 'az' && /^(?:repos|boards|devops|pipelines)$/.test(all[0]!)) {
      if (all[0] === 'pipelines' && (/\brelease\s+create\b/.test(rest) || (/\brun\b/.test(rest) && PROD.test(rest)))) return { kind: 'prod-release', why: 'az pipelines starts a release' };
      continue;
    }
    if (/\bs3\s+(?:cp|sync)\s+s3:\S+\s+(?!s3:)\S/.test(rest)) continue;
    const words = all.filter(w => !w.startsWith('-'));
    if (LOCAL.test(words[0] ?? '')) continue;
    // the first word that says what it does; «logs» alone is a reader, beside another verb a service's name
    const verb = words.find(w => READ.test(w) || WRITE.test(w)) ?? words.find(w => /^logs$/i.test(w) && prog !== 'aws');
    if (!verb || (WRITE.test(verb) && !READ.test(verb))) return { kind: 'cloud-write', why: `${prog} ${words.slice(0, 3).join(' ')} is not known to only read` };
  }
  if (CLOUD_WORDS.test(code)) return { kind: 'cloud-write', why: 'a cloud command that writes' };
  if (HOSTS.test(code) && HTTP_WRITE.test(code) && !HTTP_READ.test(code)) return { kind: 'cloud-write', why: 'a request that writes to a cloud account' };
  if (SDK.test(code) && SDK_WRITE.test(code)) return { kind: 'cloud-write', why: 'code that changes a cloud account' };
  return null;
}

/** sql: the line, the files it names included (a statement may be in a variable or a pipe) */
function dbHold(code: string, sql: string, file: boolean): Hold | null {
  if (MIGRATES.test(code)) return { kind: 'db-write', why: 'a command that changes a database' };
  const client = CLIENT.test(code);
  if ((!client && !REACHES.test(code)) || onThisMachine(sql)) return null;
  if (SQL_WRITE.some(re => re.test(sql))) return { kind: 'db-write', why: 'a statement that writes on a database' };
  if (client && !file && !SQL_READ.test(sql) && !/(?:^|\s)(?:-\?|--help|--version)(?:\s|$)/.test(code)) return { kind: 'db-write', why: 'a database client whose statement the app cannot read' };
  return null;
}

/** The commands of a line: quoted stretches stay whole. */
const segments = (text: string): string[] => text.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^;&|\n"'])+|["']/g)?.map(s => s.trim()) ?? [];

/** What of a line runs: the commands that only handle text are left out, unless something in it runs text as code or
 *  its quotes cannot be trusted. */
function executed(raw: string): string {
  // a file written from a quoted heredoc: its body is text, unless the line goes on to run something
  const bare = raw.replace(/(^|[;&|\n])[ \t]*(?:cat|tee)\b[^\n]*<<-?[ \t]*(['"])(\w+)\2[^\n]*\n[\s\S]*?\n[ \t]*\3(?=\s|$)/g, '$1');
  const line = bare !== raw && !EXECUTES.test(bare) && !/(?:^|[\s;&|])(?:node|python3?|py|perl|ruby|\.\/)/i.test(bare) ? bare : raw;
  if (EXECUTES.test(line) || /\\["']|[`#]|\$\(|<<|<\(/.test(line)) return line;
  return segments(line).filter(s => {
    const prog = /^[({!\s]*(?:(?:do|then|else|if|while)\s+)*([\w-]+)/i.exec(s)?.[1] ?? '';
    return !TEXT.test(prog) && !(/^git$/i.test(prog) && !/!|\s-c\s|exec|\s-x\s|foreach|bisect|filter-branch/i.test(s));
  }).join('\n');
}

const UNREADABLE = /\s-e(?:c|n|nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{24,}|\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|base64)\b[^;&\n]*\|\s*(?:(?:ba|z|da)?sh|pwsh|powershell|iex|invoke-expression|node|python3?)\b|\b(?:eval|iex|invoke-expression)\s+["']?\$(?!\()/i;

function lineHold(raw: string, ctx: HoldContext, inScript = false): Hold | null {
  const code = executed(raw.replace(/[\\`]\r?\n/g, ' ').replace(/\r\n/g, '\n'));
  if (!code.trim()) return null;
  if (!inScript) {
    if (UNREADABLE.test(code)) return { kind: 'unreadable', why: 'code the app cannot read' };
    for (const m of code.matchAll(/(?:^|[;&|\n]|\bdo\s|\bthen\s)\s*&?\s*["']?\$\{?\w+\}?["']?\s+([^;&|\n]*)/g)) {
      const verb = m[1]!.split(/\s+/).find(w => READ.test(w) || WRITE.test(w));
      if (!/^\+?=/.test(m[1]!) && verb && !READ.test(verb)) return { kind: 'unreadable', why: 'a program named by a variable, asked to write' };
    }
  }
  const cloud = cloudHold(code);
  if (cloud) return cloud;
  // the files the line runs
  let sql = raw, file = false;
  for (const m of code.matchAll(/(?:(?:^|[;&|\n(]|\bdo\s|\bthen\s)\s*(?:[.&]\s+)?|\b(?:bash|sh|zsh|pwsh|powershell|node|python3?|py|tsx|ruby|perl)(?:\.exe)?\s+(?:-{1,2}[\w-]+(?:\s+Bypass)?\s+)*|(?:-i|-f|-InputFile|--file|<)[= ]?\s*)["']?([\w./\\:~+-]+\.(?:sh|bash|ps1|cmd|bat|py|js|mjs|cjs|ts|sql))["']?([^;&|\n]*)/gi)) {
    if (inScript) break;
    const text = scriptText(m[1]!, ctx);
    if (text === null) continue;
    if (/\.sql$/i.test(m[1]!)) { sql += `\n${text}`; file = true; continue; }
    const arg = m[2]!.trim().split(/\s+/).find(w => w && !w.startsWith('-')) ?? '';
    // a script that does several things by its first word, asked to read
    if (READ.test(arg) && /\$\{?[1-9@*]|\$args\b|\bparam\s*\(|\bargv\b|%[1-9*]/i.test(text)) continue;
    const shell = /\.(?:sh|bash|ps1|cmd|bat)$/i.test(m[1]!);
    const body = text.replace(/^[ \t]*(?:#|\/\/|::|rem\b).*$/gim, '');
    const h = shell || RUNS_PROGRAMS.test(body) ? lineHold(body, ctx, true) : dbHold(body, body, false);
    if (h) return { ...h, why: `${path.basename(m[1]!)}: ${h.why}` };
  }
  const db = dbHold(code, sql, file);
  if (db || inScript) return db;
  if (PUBLISHES.test(code)) return { kind: 'prod-release', why: 'a command that publishes a release' };
  for (const s of segments(code)) {
    if (CHECKERS.test(s) || /^(?:az|aws|gcloud|kubectl|helm)\b/i.test(s) || (/^(?:curl|wget|iwr|irm)\b/i.test(s) && !HTTP_WRITE.test(s))) continue;
    if (RELEASE.test(s) && PROD.test(s) && !s.split(/\s+/).slice(1).some(w => READ.test(w) || /^--?(?:help|h|dry-run)$/.test(w))) return { kind: 'prod-release', why: 'a release in production' };
  }
  return null;
}

function scriptText(file: string, ctx: HoldContext): string | null {
  const p = process.platform === 'win32' ? file.replace(/^\/([a-z])\//i, '$1:/') : file;
  const abs = path.resolve(ctx.cwd || '.', p);
  if (ctx.readFile) return ctx.readFile(abs);
  try { const st = fs.statSync(abs); return st.isFile() && st.size <= MAX_SCRIPT ? fs.readFileSync(abs, 'utf8') : null; } catch { return null; }
}

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const CLOUD_SERVER = /azure|aws|gcp|gcloud|cloudflare|kubernetes|k8s|terraform|vercel|netlify|heroku/i;
const DB_SERVER = /sql|postgres|mongo|redis|(?:^|[-_])(?:db|database)(?:[-_]|$)|supabase|snowflake|bigquery|cosmos/i;
const named = (re: RegExp, name: string): boolean => name.split(/[_\s.]+/).some(w => re.test(w));

/** A connector's call: the names of its server and tool, and the statement or command it carries. */
function connectorHold(req: HoldRequest): Hold | null {
  const input = obj(req.input);
  const name = [req.tool, req.tool.includes('__') ? '' : req.title, input.server, input.tool].filter(x => typeof x === 'string' && x).join('_');
  if (/second-brain/.test(name)) return null;   // the app's own tools check themselves
  const parts = name.split('__').filter(Boolean), action = parts.length > 2 ? parts.slice(2).join('_') : name;
  const statements: string[] = [];
  const walk = (v: unknown, key: string, depth: number): void => {
    if (typeof v === 'string') { if (/^(?:sql|query|statement|command|script)$/i.test(key)) statements.push(v); }
    else if (v && typeof v === 'object' && depth < 6) for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k, depth + 1);
  };
  walk(input, '', 0);
  if (statements.some(t => /^\s*(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|exec(?:ute)?)\b/i.test(t) || (DB_SERVER.test(name) && SQL_WRITE.some(re => re.test(t))))) return { kind: 'db-write', why: `${action} carries a statement that writes on a database` };
  const reads = named(READ, action) && !named(WRITE, action);
  if (DB_SERVER.test(name) && named(WRITE, action)) return { kind: 'db-write', why: `${action} writes on a database` };
  if (CLOUD_SERVER.test(name) && !/devops/i.test(name)) {
    const cmd = statements.find(t => named(READ, t) || named(WRITE, t));
    if (named(WRITE, action) || (cmd ? named(WRITE, cmd) : !reads)) return { kind: 'cloud-write', why: `${action} is not known to only read a cloud account` };
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
    if (typeof raw !== 'string' || !raw.trim()) return { kind: 'unreadable', why: 'the request does not say what it runs' };
    if (readOnlyCommand(raw, ctx.readScripts)) return null;
    if ((!req.whole && CUT.test(raw)) || raw.length > MAX_TEXT) return { kind: 'unreadable', why: 'the command is not all there to read' };
    const own = [input.cwd, input.workdir, input.working_directory].find((x): x is string => typeof x === 'string' && !!x);
    // a leading cd moves where the scripts are read from
    const moved = /^\s*cd\s+["']?([^\s"';&|$]+)["']?\s*(?:&&|;|\n)/.exec(raw)?.[1];
    const base = own ? path.resolve(ctx.cwd || '.', own) : ctx.cwd;
    const cwd = moved ? path.resolve(base || '.', process.platform === 'win32' ? moved.replace(/^\/([a-z])\//i, '$1:/') : moved) : base;
    return lineHold(raw, { ...ctx, cwd });
  }
  return cls === 'mcp' ? connectorHold(req) : null;
}
