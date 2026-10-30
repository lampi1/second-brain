// Every MCP tool the app exposes is known to the Orchestrator and to the docs (ADR 0208, the owner 2026-10-30: «metti
// proprio dei constraint a codice … tra cui i tool nuovi dell'Orchestrator»). The registered tools are enumerated two
// ways: the real app-control list (appControlTools with every optional module present, on /mcp/app and on the
// Orchestrator's own endpoint) and a scan of src/main for every other tool definition (an object with a snake_case
// `name` and an `inputSchema`: the work chats', the browser's, the brain hooks'). Each must have a row in
// src/main/appctl/tool-catalog.ts (which app_guide reads) with the right mount, appear in app_guide, and be listed in
// docs/agents/commands.md «MCP tools». Always run by `npm run check:branch` (scripts/check-branch.mjs DOC_TESTS).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appControlTools } from '../../src/main/appctl/tools';
import { entries, guideTool, otherTools } from '../../src/main/appctl/guide';
import { TOOL_CATALOG } from '../../src/main/appctl/tool-catalog';

const root = path.resolve(import.meta.dirname, '../..');

/** A stand-in for every dependency: any property, call or `new` gives itself back, so each optional module counts as
 *  present and the tool list is the fullest one. Tool factories only build closures, they call nothing heavy. */
function anything(): never {
  const target = function () { /* callable */ };
  const p: unknown = new Proxy(target, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 'x' : k === 'then' ? undefined : k === Symbol.iterator ? function* () { /* empty */ } : p),
    apply: () => p,
    construct: () => p as object,
  });
  return p as never;
}

/** Tool definitions in the source: a snake_case or one-word `name: '…'` followed by an `inputSchema` before the next
 *  `name:` (a mount has `instructions`/`tools` instead). The literal `tool('…'` helpers are covered by the live list. */
function scanToolDefs(files: { path: string; text: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\bname\s*:\s*['"]([a-z][a-z0-9_]*)['"]/g;
  for (const f of files) {
    const ms = [...f.text.matchAll(re)];
    ms.forEach((m, i) => {
      const end = Math.min(ms[i + 1]?.index ?? f.text.length, m.index + 3000);
      if (/\binputSchema\b/.test(f.text.slice(m.index, end))) out.set(m[1]!, f.path);
    });
  }
  return out;
}
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);

const orchestrator = appControlTools(anything(), 'orchestrator').map(t => t.name);
const open = appControlTools(anything()).map(t => t.name);
const scanned = scanToolDefs(walk(path.join(root, 'src', 'main')).map(p => ({ path: path.relative(root, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') })));
const registered = new Set([...orchestrator, ...open, ...scanned.keys()]);
const FIX = 'add a row to src/main/appctl/tool-catalog.ts TOOL_CATALOG (where + one line) and to docs/agents/commands.md «MCP tools»';

describe('the scanner', () => {
  it('finds tool definitions and skips mounts and other names', () => {
    const text = [
      "mcp.mount('/mcp/x', { name: 'x', instructions: 'i', tools: [{",
      "  name: 'x_tool', description: 'd',",
      '  inputSchema: {} }] });',
      "const engine = { name: 'claude_code', args: [] };",
      "const t = { name: 'one', annotations: W, description: 'd', inputSchema: {} };",
    ].join('\n');
    expect([...scanToolDefs([{ path: 'a.ts', text }]).keys()]).toEqual(['x_tool', 'one']);
  });
  it('sees the tools of every mount family in this checkout', () => {
    for (const n of ['agent_delegate', 'navigate', 'recall', 'text_complete', 'show_ui', 'brain_search']) expect(scanned.has(n), n).toBe(true);
    expect(orchestrator).toContain('app_update_code');
    expect(open).not.toContain('app_update_code');
  });
});

describe('every registered tool is in the catalog, app_guide and the docs', () => {
  it('has a catalog row (else: ' + FIX + ')', () => {
    expect([...registered].filter(n => !TOOL_CATALOG[n]).map(n => `${n} (${scanned.get(n) ?? 'appctl'}): ${FIX}`)).toEqual([]);
  });
  it('has no catalog row for a tool that is gone (remove it from tool-catalog.ts and commands.md)', () => {
    expect(Object.keys(TOOL_CATALOG).filter(n => !registered.has(n))).toEqual([]);
  });
  it('says the right mount for the app-control tools', () => {
    const wrong: string[] = [];
    for (const n of open) if (!TOOL_CATALOG[n]?.where.includes('app')) wrong.push(`${n}: on /mcp/app, its where needs 'app'`);
    for (const n of orchestrator.filter(x => !open.includes(x))) {
      const w = TOOL_CATALOG[n]?.where ?? [];
      if (!w.includes('orchestrator') || w.includes('app')) wrong.push(`${n}: only on the Orchestrator's endpoint, its where needs 'orchestrator' (not 'app')`);
    }
    for (const [n, info] of Object.entries(TOOL_CATALOG)) {
      if ((info.where.includes('app') || info.where.includes('orchestrator')) && !orchestrator.includes(n)) wrong.push(`${n}: not on the Orchestrator's endpoint, drop 'app'/'orchestrator' from its where`);
      if (!info.line.trim()) wrong.push(`${n}: empty line`);
    }
    expect(wrong).toEqual([]);
  });
  it('appears in app_guide, either as the caller\'s own tool or as another mount\'s', async () => {
    const deps = { window: () => null, settings: { schema: () => [], get: () => ({}) as never }, tools: () => [{ name: 'app_state', description: 'own' }] };
    const titles = new Set(entries(null, deps, 'en').filter(e => e.kind === 'tool').map(e => e.title));
    expect(Object.keys(TOOL_CATALOG).filter(n => !titles.has(n))).toEqual([]);
    expect(otherTools(deps.tools()).some(([n]) => n === 'app_state')).toBe(false);
    const guide = guideTool(deps);
    expect(String(await guide.run({ topic: 'agent_delegate' }))).toContain('not on your endpoint');
    expect(String(await guide.run({}))).toContain('agent_delegate');
  });
  it('is listed in docs/agents/commands.md «MCP tools» (else: ' + FIX + ')', () => {
    const doc = fs.readFileSync(path.join(root, 'docs', 'agents', 'commands.md'), 'utf8');
    const section = doc.slice(doc.indexOf('## MCP tools'));
    expect(doc.includes('## MCP tools'), 'docs/agents/commands.md needs its «## MCP tools» section').toBe(true);
    expect(Object.keys(TOOL_CATALOG).filter(n => !section.includes(`\`${n}\``))).toEqual([]);
    const listed = [...section.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map(m => m[1]!);
    expect(listed.filter(n => !TOOL_CATALOG[n]), 'rows in commands.md for tools that are gone').toEqual([]);
  });
});
