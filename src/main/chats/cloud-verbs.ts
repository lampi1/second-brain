// What a cloud command line does (ADR 0352): the verb at the place where that program has it, never a service's name, a
// flag's value or an argument that only looks like one. Also the requests to a cloud account's own API and code over its
// SDK. Pure; used by delegated-holds.ts.
export const READ = /^(?:list|ls|show|get|describe|query|search|check|exists|tail|head|scan|lookup|view|status|inspect|download|wait|validate|what-if|diff|plan|preview|output|explain|top|history|whoami|info|filter|select|batch-get|read|fmt|providers|graph|template|lint|can-i|events|stat|cat|du|start-query|get-log-events)(?:[-:].*)?$/i;
export const WRITE = /^(?:create|delete|update|set|add|remove|restart|start|stop|deploy|import|purge|swap|assign|reset|upload|scale|apply|invoke|put|patch|edit|exec|execute|install|upgrade|uninstall|rollback|drain|replace|destroy|terminate|modify|publish|up|down|copy|cp|mv|rm|sync|move|send|attach|detach|enable|disable|promote|release|insert|drop|truncate|regenerate|renew|rotate|failover|write|upsert|alter|rename|cancel|pause|resume|submit|suspend|undo|trigger|restore|migrate|flush|clear|kill)(?:[-:].*)?$/i;
/** words that say «read» also as a script's own action: no service or group has these names */
export const PLAIN_READ = /^(?:list|ls|show|get|describe|check|exists|tail|head|view|status|inspect|validate|what-if|diff|preview|explain|whoami|info|read|stat|query|help|plan|history|logs?)(?:[-:].*)?$/i;

const PROGRAMS = 'az|azd|aws|gcloud|gsutil|kubectl|helm|terraform|tofu|pulumi|eksctl|doctl|vercel|netlify|wrangler|firebase|heroku|flyctl|azcopy';
const CLI = new RegExp(`(?<=^|[\\s;&|(){}[=!"'\`]|bin[\\\\/])(${PROGRAMS})(?:\\.cmd|\\.exe)?["']?((?:[ \\t]+(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s;&|()"'\`,\\]]+))+)`, 'gim');
/** a cloud program handed the script's own arguments as its command */
export const PASSES_ON = new RegExp(`(?:^|[\\s;&|("'\`])(?:${PROGRAMS})(?:\\.cmd|\\.exe)?["']?[ \\t]+["']?(?:\\$\\{?[1@*]|[$@]args|%[1*])`, 'im');
const SWITCH = /^(?:--(?:only-show-errors|debug|verbose|no-[\w-]+|quiet|yes|all|all-namespaces|watch|recursive|dryrun|dry-run|force|json|help|follow|wide)|-[yqAwm])$|=/;
/** az: -q, -w, -m and -A take a value */
const AZ_SWITCH = /^--(?:only-show-errors|debug|verbose|no-[\w-]+|yes|all|force|help)$|^-[yh]$|=/;
/** switches of any script or program, not followed by a value */
export const PLAIN_SWITCH = /^(?:--?(?:v|verbose|debug|q|quiet|y|yes|json|force|f|all|a|dry-run|whatif|noprofile|noninteractive|no-[\w-]+|help|h))$|[=:]/i;

/** The words that are no flag and no flag's value, and the words right after a flag that may be its value. */
export function positionals(words: readonly string[], isSwitch: RegExp): { sure: string[]; after: string[] } {
  const sure: string[] = [], after: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--') continue;
    if (!/^-./.test(w)) { sure.push(w); continue; }
    if (!isSwitch.test(w) && i + 1 < words.length && !/^-./.test(words[i + 1]!)) after.push(words[++i]!);
  }
  return { sure, after };
}

type Verdict = 'read' | 'write';
const is = (ok: boolean): Verdict => (ok ? 'read' : 'write');

const AZ_READ = /^(?:list|show|get|check|exists|query|tail|download|wait|validate|what-if|diff|describe|view|summarize|peek|test)(?:-.*)?$/i;
const AZ_NAMES = /^(?:query-(?!by)|test-(?:line|run|plan|suite|case))/i;   // groups that begin like a verb
function az(words: readonly string[]): Verdict {
  let i = 0;
  while (i < words.length && /^-./.test(words[i]!)) i += AZ_SWITCH.test(words[i]!) ? 1 : 2;
  const path: string[] = [];
  const doing = (w: string): boolean => (AZ_READ.test(w) && !AZ_NAMES.test(w)) || WRITE.test(w);
  for (; i < words.length; i++) {
    const w = words[i]!;
    if (!/^-./.test(w)) { path.push(w); continue; }
    if (AZ_SWITCH.test(w)) continue;
    if (path.some(doing)) break;
    i++;   // a flag among the groups: its value is not one
  }
  const [group = '', verb = ''] = path;
  if (/^(?:login|logout|version|configure|config|extension|cloud|init|find|interactive|self-test|feedback|help)$/i.test(group)) return 'read';
  if (/^account$/i.test(group) && /^(?:list|show|set|clear|get-access-token|list-locations)$/i.test(verb)) return 'read';
  if (/^bicep$/i.test(group)) return is(!/^publish$/i.test(verb));
  // what comes after the verb: only a value not known here
  while (path.length > 1 && /[$@]|^[[{]/.test(path[path.length - 1]!)) path.pop();
  const last = path[path.length - 1] ?? '';
  return is(path.length > 1 && ((AZ_READ.test(last) && !AZ_NAMES.test(last)) || /^(?:logs|tail)$/i.test(last)));
}

const AWS_READ = /^(?:describe|list|get|head|batch-get|batch-describe|lookup|search|select|scan|query|filter|tail|wait|presign|ls|simulate|estimate|view|check|validate|preview|test|detect|start-query|help)(?:-.*)?$/i;
function aws(words: readonly string[]): Verdict {
  const { sure } = positionals(words, SWITCH), [service = '', verb = ''] = sure;
  if (/^(?:sts|configure|sso|login|logout|help)$/i.test(service)) return 'read';
  // from a bucket to this machine
  if (/^s3$/i.test(service) && /^(?:cp|sync)$/i.test(verb)) return is(/^s3:/i.test(sure[2] ?? '') && words.filter(w => /^s3:/i.test(w)).length === 1 && sure.length > 3 && !/\$/.test(sure[3]!));
  return is(AWS_READ.test(verb));
}

const FIRST = /^(?:get|describe|logs|top|explain|diff|version|cluster-info|api-resources|api-versions|events|options|plugin|completion|help|wait|kustomize|config)$/i;
const HELM = /^(?:list|ls|get|status|history|show|search|template|lint|diff|version|env|pull|verify|help|completion|inspect)$/i;
const TERRAFORM = /^(?:plan|show|output|validate|fmt|version|providers|graph|init|get|metadata|login|logout)$/i;
const PULUMI = /^(?:preview|about|whoami|version|logs|login|logout|config|help)$/i;
function sub(sure: string[], group: string, reads: RegExp): boolean { return sure[0]?.toLowerCase() === group && reads.test(sure[1] ?? ''); }

function verdict(prog: string, words: readonly string[]): Verdict {
  const { sure, after } = positionals(words, SWITCH), first = sure[0] ?? '';
  switch (prog) {
    case 'az': return az(words);
    case 'aws': return aws(words);
    case 'kubectl': return is(FIRST.test(first) || sub(sure, 'rollout', /^(?:status|history)$/i) || sub(sure, 'auth', /^(?:can-i|whoami)$/i));
    case 'helm': return is(HELM.test(first) || sub(sure, 'repo', /^(?:list|update)$/i));
    case 'terraform': case 'tofu': return is(TERRAFORM.test(first) || sub(sure, 'state', /^(?:list|show|pull)$/i) || sub(sure, 'workspace', /^(?:list|show|select)$/i));
    case 'pulumi': return is(PULUMI.test(first) || sub(sure, 'stack', /^(?:ls|output|history|export|select)$/i));
    case 'gcloud': {
      const path = sure.filter((w, n) => !(n < 2 && /^(?:alpha|beta)$/i.test(w)));
      if (/^(?:auth|config|init|version|info|help|components|topic|cheat-sheet)$/i.test(path[0] ?? '')) return 'read';
      const verb = path.slice(1).find(w => READ.test(w) || WRITE.test(w) || /^(?:run|ssh|scp|call|log|stream)(?:-.*)?$/i.test(w)) ?? '';
      return is((READ.test(verb) && !WRITE.test(verb)) || /^(?:log|stream)(?:-.*)?$/i.test(verb));
    }
    case 'gsutil': return is(/^(?:ls|cat|du|stat|hash|version|help)$/i.test(first));
    default: {
      if (!/:/.test(first) && /^(?:login|logout|version|help|configure|config|init|completion|auth)$/i.test(first)) return 'read';
      // `apps:destroy`: the verb is after the colon
      for (const w of sure.length ? sure : after) {
        const v = w.split(':').pop()!;
        if (WRITE.test(v)) return 'write';
        if (READ.test(v) || /^logs$/i.test(v)) return 'read';
      }
      return 'write';
    }
  }
}

const split = (rest: string): string[] => (rest.match(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g) ?? []).map(w => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
export type CloudHit = { kind: 'cloud-write' | 'prod-release'; why: string };

/** @param text a command as one line, or code: a list of arguments (['az', 'group', 'delete']) reads as words too */
export function cliWrite(text: string, isProd: (s: string) => boolean): CloudHit | null {
  for (const m of text.replace(/["'][ \t]*,[ \t]*["']/g, ' ').matchAll(CLI)) {
    const prog = m[1]!.toLowerCase(), words = split(m[2]!);
    if (words.includes('--help') || words[words.length - 1] === '-h' || (words.length === 1 && /^(?:--version|-v|help)$/.test(words[0]!))) continue;
    if (prog === 'az') {
      let i = 0;
      while (i < words.length && /^-./.test(words[i]!)) i += AZ_SWITCH.test(words[i]!) ? 1 : 2;
      const group = (words[i] ?? '').toLowerCase(), rest = words.slice(i + 1);
      if (group === 'rest') { if (restWrites(words)) return { kind: 'cloud-write', why: 'az rest writes' }; continue; }
      // work items, pull requests and the CI queue are no cloud resource; a release or a production run is
      if (/^(?:repos|boards|devops|pipelines)$/.test(group)) {
        if (group === 'pipelines' && ((rest.includes('release') && rest.includes('create')) || (rest.includes('run') && isProd(rest.join(' '))))) return { kind: 'prod-release', why: 'az pipelines starts a release' };
        continue;
      }
    }
    if (verdict(prog, words) === 'write') return { kind: 'cloud-write', why: `${prog} ${words.slice(0, 4).join(' ')} is not known to only read` };
  }
  return null;
}

const QUERY_URL = /\/query(?=[?"'`\s]|$)|ResourceGraph\/resources/i;
function restWrites(words: readonly string[]): boolean {
  const value = (names: RegExp): string => { const n = words.findIndex(w => names.test(w)); return n < 0 ? '' : words[n]!.includes('=') ? words[n]!.split('=').slice(1).join('=') : words[n + 1] ?? ''; };
  const method = value(/^(?:--method|-m)(?:=|$)/).toLowerCase(), url = value(/^(?:--ur[il]|-u)(?:=|$)/);
  if (method === 'get' || method === 'head') return false;
  if (method === '' && !words.some(w => /^(?:--body|-b)(?:=|$)/.test(w))) return false;
  return !((method === 'post' || method === '') && QUERY_URL.test(url));
}

/** other programs that only write on a cloud account with these words */
const CLOUD_WORDS = /\bcdk\s+(?:deploy|destroy|bootstrap)\b|\b(?:sam|swa|fly|sls|serverless)\s+(?:deploy|remove|destroy)\b|\bfunc\s+azure\s+functionapp\s+publish\b|\boc\s+(?:apply|create|delete|patch|scale|rollout\s+(?:latest|restart|undo)|new-app)\b|\bbq\s+(?:rm|mk|load|insert|update|cp)\b|\b(?:new|set|remove|update|start|stop|restart|publish|invoke|add|import|reset|move|copy|register|enable|disable|save|clear|swap|switch|grant|revoke)-az(?!context|default|config|operationalinsightsquery|restmethod\b(?![^;|\n]*-method\s+["']?(?:post|put|patch|delete)))[a-z]\w*/i;
export const cloudWords = (text: string): boolean => CLOUD_WORDS.test(text);

const HOSTS = /management\.(?:core\.windows|azure)\.(?:com|net)|\.scm\.azurewebsites\.net|\.vault\.azure\.net|graph\.microsoft\.com|\.(?:blob|queue|table|file)\.core\.windows\.net|\.documents\.azure\.com|\.servicebus\.windows\.net|\.googleapis\.com|\.amazonaws\.com|api\.(?:cloudflare|vercel|netlify|heroku|digitalocean)\.com|vsrm\.dev\.azure\.com|dev\.azure\.com\S*\/_apis\/release/i;
const METHOD = /(?:-X|--request|--method|-Method)[ =:]?["']?(get|head|post|put|patch|delete|\$)|\.(get|post|put|patch|delete)\s*\(|method["']?\s*[:=]\s*["'](get|post|put|patch|delete)/gi;
const DATA = /(?:^|\s)(?:-d|--data\S*|-F|--form|-T|--upload-file|--json|--body|-b|-Body|-InFile)[ =]/i;
export function httpMethods(text: string): { writes: boolean; posts: boolean } {
  const all = [...text.matchAll(METHOD)].map(m => (m[1] ?? m[2] ?? m[3])!.toLowerCase());
  return { writes: all.some(m => /^(?:put|patch|delete|\$)$/.test(m)), posts: all.includes('post') || (DATA.test(text) && !all.some(m => m === 'get' || m === 'head')) };
}
/** @param whole where a variable's address may be written; a command with its own literal address is judged by it */
export function httpWrite(text: string, whole: string): boolean {
  const { writes, posts } = httpMethods(text);
  if (!writes && !posts) return false;
  if (!HOSTS.test(/https?:\/\/[\w.-]/i.test(text) ? text : whole)) return false;
  return writes || !QUERY_URL.test(text);
}

const SDK = /\bazure[.-](?:mgmt|storage|keyvault|servicebus|cosmos)\b|@azure\/|\bboto3\b|@aws-sdk\/|\bgoogle[.-]cloud\b/i;
const SDK_WRITE = /\.(?:begin_)?(?:create|delete|update|put|set|start|stop|restart|terminate|purge|upload|deploy|patch|send|publish|upsert)(?:_\w+|[A-Z]\w*)?\s*\(|new\s+(?:Create|Delete|Update|Put|Start|Stop|Terminate)\w*Command\b/;
/** the same, only names that no other library has: for a script that runs no program */
const SDK_CALL = /\.(?:begin_\w+|(?:create|delete|update|put|set|start|stop|restart|terminate|purge|upload|deploy|publish|upsert)(?:_\w+|(?!Hash|Hmac|ReadStream|WriteStream|Interface|Server|Client|Element|Timeout|Interval|Immediate|With)[A-Z]\w*))\s*\(|new\s+(?:Create|Delete|Update|Put|Start|Stop|Terminate)\w*Command\b/;
export const sdkWrite = (text: string, strict = false): boolean => SDK.test(text) && (strict ? SDK_CALL : SDK_WRITE).test(text);
