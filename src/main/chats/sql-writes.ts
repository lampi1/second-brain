// Does a statement write on a database (ADR 0355)? Two readings: a whole statement (a client's -Q, a .sql file, a
// connector's field), where its place says what a word is; and loose text (code, a pipe), where only shapes that are no
// prose count. Temporary tables and variables are free. Pure; used by delegated-holds.ts.

const NAME = '(?![#@])[\\w.[\\]"$@{}-]+', TOP = '(?:top\\s*\\([^)]{0,20}\\)\\s*)?', HINT = '(?:with\\s*\\([^)]{0,60}\\)\\s*)?';
const LOOSE = [
  new RegExp(`\\binsert\\s+(?:(?:top\\s*\\([^)]{0,20}\\)|ignore|overwrite|low_priority|delayed|or\\s+\\w+)\\s+)?(?:into\\s+)?${NAME}\\s*${HINT}(?:\\(|select\\b|values\\b|default\\b|exec\\b)`, 'i'),
  /\binsert\s+(?:(?:top\s*\([^)]{0,20}\)|ignore|low_priority|delayed|or\s+\w+)\s+)?into\s+(?![#@])/i, /\breplace\s+(?:low_priority\s+)?into\s+\w/i,
  new RegExp(`\\bupdate\\s+${TOP}${NAME}\\s+${HINT}(?:(?:as\\s+)?\\w+\\s+)?${HINT}set\\b`, 'i'),
  /\bupdate\s+(?:only\s+|low_priority\s+|ignore\s+)?(?![#@])[\w.[\]"`][\w.[\]"`,=()\s<>@$-]{0,200}?\sset\s+\(?[\w.@"`[\]]{1,80}(?:\s*,\s*[\w"`]{1,80}){0,20}\)?\s*[-+*/|]?=/i,
  new RegExp(`\\bdelete\\s+${TOP}(?:from\\s+(?:only\\s+)?(?![#@])|(?![#@])[\\w.[\\]]+\\s+(?:from|where|output|option)\\b|(?![#@])[\\w.[\\]]+\\s+with\\s*\\()`, 'i'),
  new RegExp(`\\bmerge\\s+${TOP}(?:into\\s+)?(?![#@])[\\w.[\\]]+\\s+${HINT}(?:as\\s+)?(?:\\w+\\s+)?${HINT}using\\b`, 'i'), /\btruncate\s+table\s/i, /\bbulk\s+insert\s/i,
  /\b(?:create|alter|drop)\s+(?:or\s+\w+\s+)?(?:(?:unique|clustered|nonclustered|temporary|materialized)\s+){0,2}(?:table|view|proc\w*|function|trigger|index|schema|database|user|login|role|type|sequence)\s+(?!#)/i,
  /\bexec(?:ute)?\s+(?!(?:sys\.)?sp_(?:help\w*|who\w*|columns|spaceused|tables|lock)\b)[a-z_[][\w.[\]]*/i, /\b(?:grant|revoke|deny)\s+(?:all|select|insert|update|delete|execute|control|alter)\b/i,
  /\binto\s+(?![#@])[\w.[\]]+\s+from\b/i, /\binto\s+(?:out|dump)file\b/i, /\b(?:backup|restore)\s+(?:database|log)\s/i, /\bcopy\s+[\w.]+\s+from\b/i, /\b(?:execute|query)\w*\s*\(\s*[rfu]?["'`]+\s*(?:delete|truncate)\s+\w/i,
  /\.(?:insert(?:One|Many)|update(?:One|Many)|delete(?:One|Many)|replaceOne|drop(?:Database)?|findOneAnd\w+|bulkWrite|createIndex)\s*\(/, /\bdb\.[\w.]+\.(?:insert|remove|update|save|renameCollection)\s*\(/,
];
/** where a statement begins */
const AT = '(?:^|[;)\\n]|\\b(?:begin|then|else|do|go)\\s)\\s*';
const WHOLE = [
  new RegExp(`${AT}delete\\s+${TOP}(?![#@])[\\w"[]`, 'i'), new RegExp(`${AT}(?:truncate|call)\\s+(?![#@])\\w`, 'i'), new RegExp(`${AT}kill\\s+[\\d@'"]`, 'i'), new RegExp(`${AT}(?:shutdown|reconfigure)\\b`, 'i'),
  new RegExp(`${AT}replace\\s+[\\w.]+\\s*(?:\\([^)]{0,200}\\)\\s*)?(?:values|select)\\b`, 'i'), /\bexec(?:ute)?\s*\(/i, /\bdbcc\s+(?:shrink|checkident|free|dropcleanbuffers|writepage)/i,
  /\bselect\s[^;]{0,400}?\sinto\s+(?![#@])[\w.[\]]+\s*(?:$|[;,])/i, /\b(?:create|alter|drop)\s+(?:extension|domain|server|partition|credential|certificate|synonym|statistics|event|tablespace)\b/i,
];
export const looseWrite = (text: string): boolean => LOOSE.some(re => re.test(text));

/** A statement without its comments, and without its strings unless it runs a string as code. Unchanged when its quotes
 *  cannot be trusted. */
function bare(sql: string, maskValues = false): string {
  if (sql.includes("\\'")) return sql;
  const runsText = /\b(?:exec(?:ute)?|sp_executesql|openquery|openrowset|dblink\w*|prepare|do)\b/i.test(sql);
  return sql.replace(/'(?:[^']|'')*(?:'|$)|"[^"\n]*"|\[[^\]\n]*\]|--[^\n]*|\/\*(?!!)(?:[\s\S]*?\*\/|[\s\S]*$)/g, m => (m[0] === "'" ? runsText || !m.endsWith("'") ? m : "''" : m[0] === '-' || m[0] === '/' ? ' ' : maskValues ? 'identifier' : m));
}
export function statementWrites(sql: string): boolean { const s = bare(sql.trim()); return LOOSE.some(re => re.test(s)) || WHOLE.some(re => re.test(s)); }

/** the text of a statement that reads, not a word that could be anything */
const READS = /\bselect\s+(?:[\w*'"[\]@(.$-]|\*)|\bwith\s+\w+\s*(?:\([^)]{0,200}\)\s*)?as\s*\(|\b(?:show|describe|explain)\s+\w|\bpragma\s+\w|\bsp_(?:help|who|columns|spaceused|tables|lock)\w*|\bdbcc\s+\w|\.(?:find\w*|count\w*|aggregate|distinct|stats|getIndexes|getCollectionNames)\s*\(|\bshow\s+dbs\b|(?:^|\s)\\[dlcxt]/i;
export const statementReads = (sql: string): boolean => READS.test(sql);

const CTE = /(?:recursive\s+)?\w+\s*(?:\([^()]*\)\s*)?as\s+(?:(?:not\s+)?materialized\s+)?\(\s*(?=select\b|with\b)/iy;
function cteSelect(s: string): boolean {
  let at = /^with\s+/i.exec(s)?.[0].length ?? 0;
  if (!at) return false;
  for (;;) {
    CTE.lastIndex = at;
    if (!CTE.test(s)) return false;
    let depth = 1;
    for (at = CTE.lastIndex; at < s.length && depth; at++) {
      if (s[at] === '(') depth++;
      else if (s[at] === ')') depth--;
    }
    if (depth) return false;
    while (/\s/.test(s[at] ?? '')) at++;
    if (s[at] !== ',') return /^select\s+\S/i.test(s.slice(at));
    while (/\s/.test(s[++at] ?? '')) { /* skip the separator */ }
  }
}

/** Unlike loose evidence for connector fields, this must cover every SQL batch passed to a shell client. */
export function wholeStatementReads(sql: string): boolean {
  if (statementWrites(sql) || /\/\*!|\\(?:['";]|[a-z])/i.test(sql.replace(/^\s*\\[dltx]\+?\s*$/i, ''))) return false;
  const parts = bare(sql, true).split(/;|^\s*go\s*$/im).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(s => !/\bfor\s+(?:update|share)\b|\$(?:\{|\(|[A-Za-z_])|(?:^|\n)\s*[:.][a-z]/i.test(s)
    && (/^(?:select\s+\S|(?:show|describe|desc)\s+\w|explain\s+select\b|\\[dltx]\+?$)/i.test(s) || cteSelect(s)));
}

export function mongoRead(code: string): boolean {
  return /^\s*(?:show\s+(?:dbs|collections)|db(?:\.[\w$]+)*\.(?:find|findOne|count|countDocuments|estimatedDocumentCount|distinct|stats|getIndexes|getCollectionNames)\s*\([^;]*\)(?:\.(?:limit|sort|skip|toArray)\s*\([^;]*\))*\s*;?)\s*$/i.test(code)
    && (code.match(/\bdb\b/g)?.length ?? 0) <= 1 && !statementWrites(code);
}
const BEGINS = /^\s*(?:--[^\n]*\n\s*)*(?:with|insert|update|delete|merge|replace|truncate|create|alter|drop|grant|revoke|deny|exec(?:ute)?|call|begin|declare|set|use|go|if|select)\b/i;
/** text that begins like a statement: a search for «how to delete from a list» does not */
export const looksLikeStatement = (text: string): boolean => BEGINS.test(text);

const REDIS = /^(?:get|mget|getrange|keys|scan|[hsz]scan|info|ping|dbsize|ttl|pttl|exists|type|strlen|hgetall|hget|hmget|hkeys|hvals|hlen|hexists|llen|lrange|lindex|smembers|scard|sismember|zrange\w*|zcard|zscore|zrank|xlen|xrange|xinfo|memory|object|slowlog|time|lastsave|monitor)$/i;
/** the flag that carries the statement, its value glued to it or in the next word */
const FLAGS: Record<string, RegExp> = {
  sqlcmd: /^-[qQ](.*)$/s, osql: /^-[qQ](.*)$/s, 'invoke-sqlcmd': /^-q(?:uery)?(?::([\s\S]*))?$/i, psql: /^(?:--command(?:=([\s\S]*))?|-[aAtqXxwb1]*c(.*))$/s,
  mysql: /^(?:--execute(?:=([\s\S]*))?|-[sNBtrv]*e(.*))$/s, mariadb: /^(?:--execute(?:=([\s\S]*))?|-[sNBtrv]*e(.*))$/s, mongosh: /^--eval(?:=([\s\S]*))?$/, mongo: /^--eval(?:=([\s\S]*))?$/,
};
/** What a database client's words say it runs: the statements it names, and whether it needs none. */
export function clientCall(words: readonly string[]): { statements: string[]; rest: string[]; files: string[]; reads: boolean; mongo: boolean } {
  const prog = words[0]!.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd)$/i, '').toLowerCase(), args = words.slice(1), statements: string[] = [], rest: string[] = [], files: string[] = [];
  const help = args.some(w => /^(?:-\?|--help|--version)$/.test(w));
  if (prog === 'redis-cli') {
    let i = 0;
    while (i < args.length && /^-./.test(args[i]!)) i += /^(?:-[hpnaru]|--user|--pass)$/.test(args[i]!) ? 2 : 1;
    const verb = (args[i] ?? '').toLowerCase(), sub = args[i + 1] ?? '';
    const nested: Record<string, RegExp> = { memory: /^(?:doctor|malloc-stats|stats|usage|help)$/i, slowlog: /^(?:get|len|help)$/i, object: /^(?:encoding|freq|idletime|refcount|help)$/i, xinfo: /^(?:stream|groups|consumers|help)$/i };
    return { statements, rest: args, files, mongo: false, reads: help || (REDIS.test(verb) && (!nested[verb] || nested[verb].test(sub))) || (i >= args.length && args.some(w => /^--(?:scan|stat|bigkeys|latency)/.test(w))) };
  }
  if (prog === 'sqlpackage') return { statements, rest: args, files, mongo: false, reads: help || args.some(w => /^[/-](?:a|action):(?:extract|export|script|deployreport|driftreport)$/i.test(w)) };
  if (prog === 'bcp') return { statements: args[1]?.toLowerCase() === 'queryout' ? [args[0]!] : [], rest: args, files, mongo: false, reads: help || /^(?:out|format)$/i.test(args[1] ?? '') };
  const flag = FLAGS[prog];
  const fileFlag = /^(?:sqlcmd|osql)$/.test(prog) ? /^-i(.*)$/ : prog === 'psql' ? /^(?:--file(?:=(.*))?|-[aAtqXxwb1]*f(.*))$/ : prog === 'invoke-sqlcmd' ? /^-(?:InputFile)(?::(.*))?$/i : null;
  for (let i = 0; i < args.length; i++) {
    const m = flag?.exec(args[i]!);
    const f = !m && fileFlag?.exec(args[i]!);
    if (f) { files.push(f[1] || f[2] || args[++i] || ''); continue; }
    if (!m) { rest.push(args[i]!); continue; }
    const glued = m[1] || m[2];
    statements.push(glued || args[++i] || '');
  }
  const lists = (prog === 'psql' && args.some(w => /^-[a-zA-Z]*l$|^--list$/.test(w))) || (/^(?:sqlcmd|osql)$/.test(prog) && args.includes('-L'));
  return { statements, rest, files, reads: help || lists, mongo: /^(?:mongo|mongosh)$/.test(prog) };
}
