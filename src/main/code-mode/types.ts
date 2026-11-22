// Code Mode's typed API (ADR 0331, after Cloudflare's Code Mode: models write better batched code against a typed
// TypeScript API than against a list of names). Turns the tools a script may call into one `declare const tools: {…}`
// block: hand-written input and output types for the native wrappers, input types generated from each app tool's JSON
// Schema (a compact converter: objects, arrays, enums, unions; deeper levels become `object`), its description's first
// sentence as a doc comment. Also the check of a call's required inputs before it reaches the permission chain.
// Used by code-mode/tool.ts (run_code's schema and list_tools) and code-mode/bridge.ts; tested in test/unit/code-mode/.
import type { McpTool } from '../mcp/server';
import type { NativeWrapper } from './policy';

type Schema = Record<string, unknown>;
const obj = (v: unknown): Schema => (v && typeof v === 'object' && !Array.isArray(v) ? v as Schema : {});

const COMMAND_OUT = '{ exitCode: number | null; stdout: string; stderr: string; timedOut?: true }';

/** The native wrappers as typed signatures: what a script passes and what it gets back. */
export const NATIVE_TYPES: Record<NativeWrapper, { doc: string; sig: string }> = {
  Bash: { doc: 'A Git Bash command in the chat\'s folder (timeout in ms, default 2 min).', sig: `(input: { command: string; timeout?: number }) => Promise<${COMMAND_OUT}>` },
  PowerShell: { doc: 'A PowerShell command (Windows PowerShell 5.1; pwsh elsewhere): $_ and $var work, no Bash quoting.', sig: `(input: { command: string; timeout?: number }) => Promise<${COMMAND_OUT}>` },
  Read: { doc: 'A text file as numbered lines ("12\\tcode"), at most 2000 from offset (1-based).', sig: '(input: { file_path: string; offset?: number; limit?: number }) => Promise<string>' },
  Write: { doc: 'Writes a whole file (folders made as needed).', sig: '(input: { file_path: string; content: string }) => Promise<string>' },
  Edit: { doc: 'Replaces old_string (unique unless replace_all) in a file.', sig: '(input: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }) => Promise<string>' },
  Grep: { doc: 'Searches files under path (default the chat\'s folder); pattern is a JavaScript regex, no inline flags such as (?i): pass "-i": true. One path, "file:line:text" or "file:count" per line.', sig: '(input: { pattern: string; path?: string; glob?: string; output_mode?: "files_with_matches" | "content" | "count"; "-i"?: boolean; head_limit?: number }) => Promise<string>' },
  Glob: { doc: 'The files matching a glob (**, *, ?, {a,b}) under path.', sig: '(input: { pattern: string; path?: string }) => Promise<string[]>' },
};

const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (k: string): string => (IDENT.test(k) ? k : JSON.stringify(k));
const lit = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : v === null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : 'unknown');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A JSON Schema as a one-line TypeScript type; past `depth` levels an object is `object`. */
export function schemaType(schema: unknown, depth = 2): string {
  if (schema === true || schema === undefined) return 'unknown';
  if (schema === false) return 'never';
  const s = obj(schema);
  const union = (s.anyOf ?? s.oneOf) as unknown;
  if (Array.isArray(union) && union.length) return [...new Set(union.map(u => schemaType(u, depth)))].join(' | ');
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.map(lit).join(' | ');
  if ('const' in s) return lit(s.const);
  const t = s.type;
  if (Array.isArray(t)) return [...new Set(t.map(x => schemaType({ ...s, type: x }, depth)))].join(' | ');
  switch (t) {
    case 'string': return 'string';
    case 'integer': case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': { const item = schemaType(s.items, depth - 1); return /[|&]/.test(item) ? `(${item})[]` : `${item}[]`; }
    default: {
      const props = obj(s.properties);
      const names = Object.keys(props);
      if (t !== 'object' && !names.length) return 'unknown';
      if (!names.length) return s.additionalProperties && typeof s.additionalProperties === 'object' ? `Record<string, ${schemaType(s.additionalProperties, depth - 1)}>` : 'object';
      if (depth <= 0) return 'object';
      const req = new Set(strings(s.required));
      return `{ ${names.map(n => `${key(n)}${req.has(n) ? '' : '?'}: ${schemaType(props[n], depth - 1)}`).join('; ')} }`;
    }
  }
}

/** A description's first sentence, made safe for a doc comment and cut. */
export function docLine(text: string | undefined, max = 140): string {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  const end = one.search(/[.;](\s|$)/);
  const first = (end > 0 ? one.slice(0, end + 1) : one).replace(/\*\//g, '* /');
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

const schemaOf = (t: McpTool, chatId: string): Schema => obj(t.inputSchemaFor?.({ chatId }) ?? t.inputSchema);

/** One MCP tool as a typed signature: its input from the schema it shows this chat, its output text (or `output`). */
export function toolSignature(t: McpTool, chatId: string, output = 'string'): string {
  const schema = schemaOf(t, chatId);
  const input = schemaType(schema);
  const optional = !strings(schema.required).length;
  return `(input${optional ? '?' : ''}: ${input === 'object' || input === 'unknown' ? 'Record<string, unknown>' : input}) => Promise<${output}>`;
}

/** The typed API of a chat's scripts: natives, app tools, then the generic call and list_tools. Connectors are named
 *  by server; list_tools gives their typed signatures. */
export function declarations(natives: readonly NativeWrapper[], app: McpTool[], chatId: string, servers: string[]): string {
  const line = (doc: string, name: string, sig: string): string => `  /** ${doc} */\n  ${key(name)}: ${sig};`;
  const rows = [
    ...natives.map(n => line(NATIVE_TYPES[n].doc, n, NATIVE_TYPES[n].sig)),
    ...app.filter(t => IDENT.test(t.name)).map(t => line(docLine(t.description) || t.name, t.name, toolSignature(t, chatId))),
    line(servers.length ? `Any tool by name; a connector's as "<server>__<tool>" (servers: ${servers.join(', ')}).` : 'Any tool by name.', 'call', '(name: string, input?: object) => Promise<unknown>'),
    line('The tools with their typed signatures (only one connector\'s with server).', 'list_tools', '(input?: { server?: string }) => Promise<{ name: string; description: string; signature: string }[]>'),
  ];
  return `declare const tools: {\n${rows.join('\n')}\n};`;
}

/** The required inputs a call of an app or connector tool left out, by its schema: [] when none. */
export function missingRequired(t: McpTool, chatId: string, input: unknown): string[] {
  const given = obj(input);
  return strings(schemaOf(t, chatId).required).filter(k => given[k] === undefined || given[k] === null);
}
