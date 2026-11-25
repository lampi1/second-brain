// What a cloud command line does (ADR 0355): the verb at the place where that program has it, never a service's name, a
// flag's value or an argument that only looks like one. Also the requests to a cloud account's own API and code over its
// SDK. Pure; used by delegated-holds.ts.
export const READ = /^(?:list|ls|show|get|describe|query|search|check|exists|tail|head|scan|lookup|view|status|inspect|download|wait|validate|what-if|diff|plan|preview|output|explain|top|history|whoami|info|filter|select|batch-get|read|fmt|providers|graph|template|lint|can-i|events|stat|cat|du|start-query|get-log-events)(?:[-:].*)?$/i;
export const WRITE = /^(?:create|delete|update|set|add|remove|restart|start|stop|deploy|import|purge|swap|assign|reset|upload|scale|apply|invoke|put|patch|edit|exec|execute|install|upgrade|uninstall|rollback|drain|replace|destroy|terminate|modify|publish|up|down|copy|cp|mv|rm|sync|move|send|attach|detach|enable|disable|promote|release|insert|drop|truncate|regenerate|renew|rotate|failover|write|upsert|alter|rename|cancel|pause|resume|submit|suspend|undo|trigger|restore|migrate|flush|clear|kill)(?:[-:].*)?$/i;
/** words that say «read» also as a script's own action: no service or group has these names */
export const PLAIN_READ = /^(?:list|ls|show|get|describe|check|exists|tail|head|view|status|inspect|validate|what-if|diff|preview|explain|whoami|info|read|stat|query|help|plan|history|logs?)(?:[-:].*)?$/i;

const PROGRAMS = 'az|azd|aws|gcloud|gsutil|kubectl|helm|terraform|tofu|pulumi|eksctl|doctl|vercel|netlify|wrangler|firebase|heroku|flyctl|azcopy';
const CLI = new RegExp(`(?<=^|[\\s;&|(){}[=!"'\`]|bin[\\\\/])(${PROGRAMS})(?:\\.cmd|\\.exe)?["']?((?:[ \\t]+(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s;&|()"'\`,\\]]+))+)`, 'gim');
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

// `read` is not a prefix: no az group was verified to have that verb, and a suffix would free invented actions.
// Prefixes already accepted keep the base suffix.
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
  if (path.length === 1 && /^(?:login|logout|version|configure|init|find|self-test|help)$/i.test(group)) return 'read';
  if (/^account$/i.test(group) && path.length === 2 && /^(?:set|clear)$/i.test(verb)) return 'read';
  if (/^bicep$/i.test(group) && path.length === 2 && /^(?:build|build-params|decompile|version|list-versions)$/i.test(verb)) return 'read';
  // what comes after the verb: only a value not known here
  while (path.length > 1 && /[$@]|^[[{]/.test(path[path.length - 1]!)) path.pop();
  const last = path[path.length - 1] ?? '';
  return is(path.length > 1 && !path.slice(0, -1).some((w, n) => /[$@]/.test(w) || (n > 0 && WRITE.test(w))) && ((AZ_READ.test(last) && !AZ_NAMES.test(last)) || /^(?:logs|tail)$/i.test(last)));
}

const AWS_READ = /^(?:describe|list|get|head|batch-get|batch-describe|lookup|search|select|scan|query|filter|tail|wait|presign|ls|simulate|estimate|view|check|validate|preview|test|detect|help)(?:-.*)?$/i;
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

const CLI_NAME = new RegExp(`^(?:${PROGRAMS})$`, 'i');
export const releaseRead = /^(?:list|show|get|view|status|history|logs?|download|verify|inspect|describe|query)$/i;
export function cloudCommand(program: string, words: readonly string[], isProd: (s: string) => boolean): CloudHit | null {
  const prog = program.toLowerCase();
  if (prog === 'func' && words[0]?.toLowerCase() === 'azure' && words[1]?.toLowerCase() === 'functionapp') {
    return /^(?:list-functions|logstream|fetch-app-settings|help)$/i.test(words[2] ?? '') ? null : { kind: 'cloud-write', why: 'non riconosco il comando di Azure Functions come lettura' };
  }
  if (/^[a-z]+-az[a-z]\w*$/i.test(prog)) {
    if (/^(?:get|find|show|search|read|export|test|measure|compare)-az/i.test(prog) || /^(?:connect|disconnect|select|set|clear|enable|disable)-azcontext$/i.test(prog)) return null;
    if (/^invoke-azrestmethod$/i.test(prog) && !restWrites(words)) return null;
    if (/^invoke-azoperationalinsightsquery$/i.test(prog)) return null;
    return { kind: 'cloud-write', why: 'non riconosco la chiamata Azure PowerShell come lettura' };
  }
  if (!CLI_NAME.test(prog)) return null;
  if (words.includes('--help') || words[words.length - 1] === '-h' || (words.length === 1 && /^(?:--version|-v|help)$/.test(words[0]!))) return null;
  if (prog === 'az') {
    let i = 0;
    while (i < words.length && /^-./.test(words[i]!)) i += AZ_SWITCH.test(words[i]!) ? 1 : 2;
    const group = (words[i] ?? '').toLowerCase(), rest = words.slice(i + 1);
    if (group === 'rest') return restWrites(words) ? { kind: 'cloud-write', why: 'non riconosco la richiesta az rest come lettura' } : null;
    // Work items, pull requests and the test CI queue are not covered by the cloud-resource hold.
    if (/^(?:repos|boards|devops|pipelines)$/.test(group)) {
      const [area = '', action = ''] = positionals(rest, AZ_SWITCH).sure;
      const release = (area.toLowerCase() === 'release' && !releaseRead.test(action)) || (rest.includes('release') && rest.includes('create')) || (rest.includes('run') && isProd(rest.join(' ')));
      return group === 'pipelines' && release ? { kind: 'prod-release', why: 'non riconosco il comando della pipeline di rilascio come lettura' } : null;
    }
  }
  return verdict(prog, words) === 'write' ? { kind: 'cloud-write', why: `non riconosco il comando ${prog} come lettura` } : null;
}

/** @param text a command as one line, or code: a list of arguments (['az', 'group', 'delete']) reads as words too */
export function cliWrite(text: string, isProd: (s: string) => boolean): CloudHit | null {
  for (const m of text.replace(/["'][ \t]*,[ \t]*["']/g, ' ').matchAll(CLI)) {
    const hit = cloudCommand(m[1]!, split(m[2]!), isProd);
    if (hit) return hit;
  }
  return null;
}

const QUERY_URL = /https:\/\/(?:management\.azure\.com\/providers\/Microsoft\.ResourceGraph\/resources|api\.(?:loganalytics\.io|loganalytics\.azure\.com)\/v1\/workspaces\/[\w-]+\/query)(?=[?"'`\s]|$)/i;
function restWrites(words: readonly string[]): boolean {
  const methods = words.flatMap((w, i) => {
    const flag = /^(?:--method|-method|-m)(?:[=:](.*))?$/i.exec(w);
    return flag ? [(flag[1] ?? words[i + 1] ?? '').toLowerCase()] : [];
  });
  const urls = words.flatMap((w, i) => {
    const flag = /^(?:--url|--uri|-u|-uri|-path)(?:[=:](.*))?$/i.exec(w);
    return flag ? [flag[1] ?? words[i + 1] ?? ''] : [];
  });
  if (methods.length && methods.every(m => /^(?:get|head)$/.test(m))) return false;
  if (!methods.length && !words.some(w => /^(?:--body|-b|-body)(?:[=:]|$)/i.test(w))) return false;
  return methods.some(m => m !== 'post') || urls.length !== 1 || !QUERY_URL.test(urls[0]!);
}

/** other programs that only write on a cloud account with these words */
const CLOUD_WORDS = /\bcdk\s+(?:deploy|destroy|bootstrap)\b|\b(?:sam|swa|fly|sls|serverless)\s+(?:deploy|remove|destroy)\b|\bfunc\s+azure\s+functionapp\s+publish\b|\boc\s+(?:apply|create|delete|patch|scale|rollout\s+(?:latest|restart|undo)|new-app)\b|\bbq\s+(?:rm|mk|load|insert|update|cp)\b|\b(?:new|set|remove|update|start|stop|restart|publish|invoke|add|import|reset|move|copy|register|enable|disable|save|clear|swap|switch|grant|revoke)-az(?!context|default|config|operationalinsightsquery|restmethod\b(?![^;|\n]*-method\s+["']?(?:post|put|patch|delete)))[a-z]\w*/i;
export const cloudWords = (text: string): boolean => CLOUD_WORDS.test(text);

const HOSTS = /management\.(?:core\.windows|azure)\.(?:com|net)|\.scm\.azurewebsites\.net|\.vault\.azure\.net|graph\.microsoft\.com|\.(?:blob|queue|table|file)\.core\.windows\.net|\.documents\.azure\.com|\.servicebus\.windows\.net|\.googleapis\.com|\.amazonaws\.com|api\.(?:cloudflare|vercel|netlify|heroku|digitalocean)\.com|vsrm\.dev\.azure\.com|dev\.azure\.com\S*\/_apis\/release/i;
const METHOD = /(?:^|[\s"'])(?:-X|--request\b|--?method\b)[ =:]?["']?([\w$-]*)|\.(get|head|post|put|patch|delete|options)\s*\(|\bmethod["']?\s*[:=]\s*["']?([\w$-]*)/gi;
const DATA = /(?:^|\s)(?:-d|--data\S*|-F|--form|-T|--upload-file|--json|--body|-b|-Body|-InFile)[ =:]/i;
export function httpMethods(text: string): { writes: boolean; posts: boolean } {
  const all = [...text.matchAll(METHOD)].map(m => (m[1] ?? m[2] ?? m[3])!.toLowerCase());
  return { writes: all.some(m => !/^(?:get|head|post)$/.test(m)), posts: all.includes('post') || (DATA.test(text) && !all.some(m => m === 'get' || m === 'head')) };
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
export function sdkWrite(text: string, strict = false): boolean {
  if (!SDK.test(text)) return false;
  if ((strict ? SDK_CALL : SDK_WRITE).test(text)) return true;
  const read = /^(?:get|list|describe|show|query|search|head|download|peek|read|exists|check|validate)(?:$|[_A-Z-])/;
  for (const m of text.matchAll(/\bnew\s+([A-Z]\w*?)Command\b|\b(?:\w*[cC]lient|\w*[mM]anager)\.([a-z]\w*)\s*\(/g)) {
    const name = m[1] ? m[1][0]!.toLowerCase() + m[1].slice(1) : m[2]!;
    if (!read.test(name)) return true;
  }
  return false;
}
