// Tool arguments as the tool's schema expects them (issue #487). Cursor's CallDynamicTool with Gemini sends nested objects
// and arrays inside arguments as null (agent_delegate's tasks[i].contract, show_ui's props.done): the data is gone before
// it reaches the app, so nothing can rebuild it. What does pass is text, so a nested object or array the schema expects
// may come as its JSON text and is read back here; and a null where the schema wants an object or array makes the
// tool's error say so and how to send it, so the engine's next call works. Pure; used by mcp/server.ts tools/call; pinned
// by test/unit/mcp/json-args.test.ts.

type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_DEPTH = 12;

/** The JSON types a schema allows (type, or each branch of anyOf / oneOf); empty = not said. */
function kinds(s: Schema): Set<string> {
  const out = new Set<string>();
  const t = s.type;
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
  for (const k of ['anyOf', 'oneOf'] as const) {
    const list = s[k];
    if (Array.isArray(list)) for (const b of list) if (isObj(b)) for (const x of kinds(b)) out.add(x);
  }
  return out;
}

/** The branch of a schema that describes an object (or an array): the schema itself or one of its anyOf / oneOf. */
function branch(s: Schema, kind: 'object' | 'array'): Schema | null {
  if (kinds({ type: s.type }).has(kind)) return s;
  for (const k of ['anyOf', 'oneOf'] as const) {
    const list = s[k];
    if (Array.isArray(list)) for (const b of list) if (isObj(b) && kinds(b).has(kind)) return branch(b, kind) ?? b;
  }
  return null;
}

/** JSON text as a model writes it by hand, made valid where the intent is plain (ADR 0371 point 2: app_create_chat's
 *  contract refused 5 times as invalid JSON): a raw line break or tab inside a string escaped, a comma before } or ]
 *  dropped. Nothing else is guessed. */
export function repairJson(t: string): string {
  let out = '', inString = false, escaped = false;
  for (const ch of t) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === '\\') { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : ch;
      continue;
    }
    if (ch === '"') inString = true;
    // a comma left before a closing bracket (outside any string)
    if (ch === '}' || ch === ']') out = out.replace(/,(\s*)$/, '$1');
    out += ch;
  }
  return out;
}

/** JSON text of an object or array, when the schema wants one and not text; `bad` gets why a text that looks like one
 *  does not parse, even after repairJson. */
function parsed(v: string, k: Set<string>, bad?: (why: string) => void): unknown {
  if (k.has('string')) return undefined;
  const t = v.trim();
  if (!((k.has('object') && t.startsWith('{')) || (k.has('array') && t.startsWith('[')))) return undefined;
  const fits = (p: unknown) => (k.has('object') && isObj(p)) || (k.has('array') && Array.isArray(p)) ? p : undefined;
  try { return fits(JSON.parse(t)); } catch (first) {
    try { return fits(JSON.parse(repairJson(t))); } catch { bad?.(first instanceof Error ? first.message : String(first)); return undefined; }
  }
}

/** The arguments with every nested object or array the schema expects read back from its JSON text, and the paths
 *  where the schema wanted an object or array and null came (`tasks[0].contract`). */
export function schemaArgs(args: Record<string, unknown>, schema: Schema | undefined): { args: Record<string, unknown>; nulls: string[]; badJson: { at: string; why: string }[] } {
  const nulls: string[] = [], badJson: { at: string; why: string }[] = [];
  // where the schema says nothing: a list holding null is what the lossy call leaves of a list of values
  const look = (v: unknown, at: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(v)) v.forEach((x, i) => x === null ? nulls.push(`${at}[${i}]`) : look(x, `${at}[${i}]`, depth + 1));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) look(x, at ? `${at}.${k}` : k, depth + 1);
  };
  const walk = (v: unknown, s: Schema | undefined, at: string, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (!s) { look(v, at, depth); return v; }
    const k = kinds(s);
    if (typeof v === 'string') {
      const p = parsed(v, k, why => badJson.push({ at: at || '(arguments)', why }));
      if (p === undefined) return v;
      v = p;
    }
    if (v === null) {
      if (k.size && !k.has('null')) nulls.push(at || '(arguments)');
      return v;
    }
    if (Array.isArray(v)) {
      const items = branch(s, 'array')?.items;
      const mapped = v.map((x, i) => walk(x, isObj(items) ? items : undefined, `${at}[${i}]`, depth + 1));
      return mapped.some((x, i) => x !== v[i]) ? mapped : v;
    }
    if (isObj(v)) {
      const o = branch(s, 'object');
      const props = o && isObj(o.properties) ? o.properties : {};
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, x] of Object.entries(v)) {
        const sub = props[key];
        const y = walk(x, isObj(sub) ? sub : undefined, at ? `${at}.${key}` : key, depth + 1);
        if (y !== x) changed = true;
        out[key] = y;
      }
      return changed ? out : v;
    }
    return v;
  };
  const out = walk(args, schema, '', 0);
  return { args: isObj(out) ? out : args, nulls, badJson };
}

/** What the tool's error adds when a nested argument came as JSON text that does not parse: where, why, and how. */
export function badJsonHint(bad: { at: string; why: string }[]): string {
  const shown = bad.slice(0, 3).map(b => `${b.at} (${b.why.slice(0, 120)})`).join('; ');
  return ` Note: ${shown} came as JSON text that does not parse. Send it as an object (not a string), or as valid JSON text: double quotes around every key and string, quotes inside a string escaped as \\", line breaks as \\n, no comma before } or ].`;
}

/** What the tool's error adds when nested arguments came as null: the engine's call lost them, and how to send them. */
export function nullsHint(nulls: string[]): string {
  const shown = nulls.slice(0, 5).join(', ') + (nulls.length > 5 ? ` and ${nulls.length - 5} more` : '');
  return ` Note: ${shown} arrived as null, though the call should carry a value there: some engines drop nested objects and lists from a tool's arguments. Use the tool's flat *Json parameter (tasksJson, contractJson, propsJson) if present, or send each of them as its JSON text instead (e.g. "contract": "{\\"goal\\": \\"…\\", \\"doneWhen\\": [\\"…\\"]}"): the app reads it back.`;
}
