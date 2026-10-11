// install-inbox-hooks: adds the two Claude hooks of D1/D4 (reviews/2026-10-10-architettura-agenti.md) to
// ~/.claude/settings.json, run ONLY by {{OWNER}} (agents never change settings, brain-rules.md 7):
//   Stop                  → node "{{BRAIN}}/ops/tools/inbox.mjs" hook claude   (mail at turn end)
//   SessionStart compact  → node "{{BRAIN}}/.claude/hooks/compact-now.mjs"     (now.md after compaction)
// Idempotent (an entry already there is not added twice), backup next to the file first, nothing else touched.
// Cursor needs nothing: its mail comes through harness/cursor/correction-log.mjs, already wired.
// Usage: node "{{BRAIN}}/ops/tools/install-inbox-hooks.mjs" [--dry] [--remove]   (--file: tests only)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INBOX = 'node "{{BRAIN}}/ops/tools/inbox.mjs" hook claude';
export const COMPACT = 'node "{{BRAIN}}/.claude/hooks/compact-now.mjs"';
const has = (groups, cmd) => (groups ?? []).some(g => (g.hooks ?? []).some(h => h.command === cmd));

export function apply(settings, { remove = false } = {}) {
  const s = structuredClone(settings);
  s.hooks ??= {};
  const changes = [];
  if (remove) {
    for (const [ev, cmd] of [['Stop', INBOX], ['SessionStart', COMPACT]]) {
      if (!has(s.hooks[ev], cmd)) continue;
      s.hooks[ev] = s.hooks[ev].map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => h.command !== cmd) })).filter(g => g.hooks.length);
      if (!s.hooks[ev].length) delete s.hooks[ev];
      changes.push(`tolto ${ev}: ${cmd}`);
    }
    return { settings: s, changes };
  }
  if (!has(s.hooks.Stop, INBOX)) {
    s.hooks.Stop ??= [];
    const plain = s.hooks.Stop.find(g => !g.matcher);
    const entry = { type: 'command', command: INBOX, timeout: 10 };
    if (plain) plain.hooks = [...(plain.hooks ?? []), entry]; else s.hooks.Stop.push({ hooks: [entry] });
    changes.push(`aggiunto Stop: ${INBOX}`);
  }
  if (!has(s.hooks.SessionStart, COMPACT)) {
    s.hooks.SessionStart ??= [];
    s.hooks.SessionStart.push({ matcher: 'compact', hooks: [{ type: 'command', command: COMPACT, timeout: 10 }] });
    changes.push(`aggiunto SessionStart (compact): ${COMPACT}`);
  }
  return { settings: s, changes };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--file');
  const file = i >= 0 ? argv[i + 1] : path.join(os.homedir(), '.claude', 'settings.json');
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const { settings, changes } = apply(JSON.parse(raw), { remove: argv.includes('--remove') });
  if (!changes.length) { console.log('niente da fare: gli hook sono già come chiesto'); process.exit(0); }
  if (argv.includes('--dry')) { console.log(`(prova, niente scritto)\n${changes.join('\n')}`); process.exit(0); }
  const bak = `${file}.bak-${new Date().toISOString().slice(0, 10)}-inbox`;
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`${changes.join('\n')}\nbackup: ${bak}\nvale per le chat che partono da adesso (o dopo /clear)`);
}
