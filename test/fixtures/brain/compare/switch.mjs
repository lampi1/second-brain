// Fake of the brain's harness/compare/switch.mjs: `<experiment> on|off [agent]` writes switch.json, exit 1 on a bad
// name. Records every call in calls.log so the test can prove the app switched through this script.
// Used by test/unit/brain/compare.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { HERE, STATE, readJson } from './lib.mjs';
import { SWITCH_FILE, experiment, stateOf } from './config.mjs';

const [name, cmd, agent] = process.argv.slice(2);
fs.appendFileSync(path.join(HERE, 'calls.log'), `${process.argv.slice(2).join(' ')}\n`);
const e = experiment(name);
if (!e || !['on', 'off'].includes(cmd)) { console.error('usage: switch.mjs <experiment> on|off [agent]'); process.exit(1); }
if (agent && !(e.source?.agents ?? []).includes(agent)) { console.error(`agente sconosciuto: ${agent}`); process.exit(1); }
const all = readJson(SWITCH_FILE, {})?.experiments ?? {};
const cur = stateOf(name);
all[name] = agent ? { ...cur, agents: { ...cur.agents, [agent]: cmd === 'on' }, changed_at: '2026-10-11 21:00:00' } : { ...cur, on: cmd === 'on', changed_at: '2026-10-11 21:00:00' };
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(SWITCH_FILE, JSON.stringify({ experiments: all }));
console.log(`Esperimento ${name}: ${all[name].on ? 'ACCESO' : 'SPENTO'}`);
