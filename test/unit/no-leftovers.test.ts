// The grep gate of the generic roles (ADR 0083): no trace of the coordinating chats' old name, of the routed
// `legacy-*` profiles, of the general starter or of the Italian role presets in the product (source, tests, scripts,
// the brain template and the main docs), and no "legacy / formerly / v2 / shim" comment in the agent code. The ADRs
// and the CHANGELOG are historical records and stay out. Run by `npm test` and `npm run check:branch`.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SELF = path.relative(ROOT, import.meta.filename).replace(/\\/g, '/');
const TREES = ['src', 'test', 'scripts', 'brain-template', 'README.md', 'AGENTS.md', 'docs/VISION.md', 'docs/architecture.md', 'docs/ux-principles.md'];
const SKIP_DIR = /^(node_modules|out|dist|test-results|\.git)$/;
const TEXT = /\.(ts|tsx|mts|mjs|js|cjs|json|md|css|html|txt|yml|yaml)$/i;

function files(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) return SKIP_DIR.test(e.name) ? [] : files(r);
    return e.isFile() && TEXT.test(e.name) ? [r] : [];
  });
}
function hits(list: readonly string[], re: RegExp, onLine?: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of list) {
    if (f === SELF) continue;
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((l, i) => { if (re.test(l) && (!onLine || onLine(l))) out.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  return out;
}

describe('no leftovers of the old agent model', () => {
  const all = TREES.flatMap(files);
  it('no old coordinator name, no legacy-* or default-general ids, no Italian role presets', () => {
    expect(all.length).toBeGreaterThan(500);
    expect(hits(all, /regia|legacy-|default-general|\b(Implementatore|Ricercatore|Redattore|Stratega|Segugio|Artigiano|Sentinella|Messaggero|Smistatore|Scriba)\b/i)).toEqual([]);
  });
  it('no legacy, formerly, v2 or shim comments in the agent code', () => {
    const agentCode = ['src/main/agents', 'src/shared/roles.ts', 'src/shared/agents.ts', 'src/shared/delegation.ts', 'src/shared/characters.ts',
      'src/main/chats/orchestrator-wake.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/renderer/components/AgentStrips.tsx', 'src/renderer/components/DelegationCard.tsx',
      'src/renderer/components/SidebarTree.tsx', 'src/renderer/lib/chat-tree.ts'].flatMap(files);
    const comment = (l: string) => /^\s*(\/\/|\*|\/\*\*?)/.test(l) || /\s\/\/\s/.test(l);
    expect(hits(agentCode, /\b(legacy|formerly|v2|shim|backward[- ]compat\w*)\b/i, comment)).toEqual([]);
  });
});
