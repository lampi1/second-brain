// Read the app's structured logs (for agents and humans). Default folder: <appData>/second-brain/logs (%APPDATA% on Windows).
// Usage: node scripts/logs.mjs [--dir <logs dir>] [--level warn] [--scope chats] [--chat <id>] [--grep <text>]
//                              [--since 10m|2h|2026-10-11T09:00] [--tail 100] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
// Electron's appData per OS (same rule as scripts/release.mjs)
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const dir = opt('--dir', process.env.SB_LOG_DIR ?? path.join(appData, process.argv.includes('--dev') ? 'second-brain-dev' : 'second-brain', 'logs'));
const order = { debug: 0, info: 1, warn: 2, error: 3 };
const min = order[opt('--level', 'debug')] ?? 0;
const scope = opt('--scope'), chat = opt('--chat'), grep = opt('--grep')?.toLowerCase(), tail = Number(opt('--tail', '200'));
const sinceArg = opt('--since');
const since = !sinceArg ? 0 : /^\d+[mh]$/.test(sinceArg) ? Date.now() - Number(sinceArg.slice(0, -1)) * (sinceArg.endsWith('h') ? 36e5 : 6e4) : Date.parse(sinceArg);

if (!fs.existsSync(dir)) { console.error(`no logs folder: ${dir} (start the app once, or pass --dir)`); process.exit(2); }
const files = fs.readdirSync(dir).filter(f => /^app-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
const out = [];
for (const f of files) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if ((order[e.lvl] ?? 0) < min) continue;
    if (scope && e.scope !== scope) continue;
    if (chat && e.chat !== chat) continue;
    if (since && Date.parse(e.t) < since) continue;
    if (grep && !line.toLowerCase().includes(grep)) continue;
    out.push(e);
  }
}
for (const e of out.slice(-tail)) {
  if (argv.includes('--json')) { console.log(JSON.stringify(e)); continue; }
  const extra = [e.chat && `chat=${e.chat}`, e.cause && `cause: ${e.cause}`, e.hint && `→ ${e.hint}`, e.data !== undefined && JSON.stringify(e.data).slice(0, 300)].filter(Boolean).join(' · ');
  console.log(`${e.t.slice(11, 23)} ${e.lvl.toUpperCase().padEnd(5)} ${e.scope.padEnd(8)} ${e.msg}${extra ? ` · ${extra}` : ''}`);
}
console.error(`${out.length} entries${out.length > tail ? ` (last ${tail} shown)` : ''} in ${dir}`);
