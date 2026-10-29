// `npm run levels -- [<app.db | agent-runs.json | userData folder>] [--dev] [--json] [--demo]` (ADR 0131, 0199): read
// only, zero tokens. Recomputes every role's level and performance from the agent runs with the card's own rules and
// prints why each role is where it is (level-diagnosis.ts), and whether the review sampler is off (config.json and
// changes.jsonl beside the file). The runs come from app.db (opened read only, also while the app runs) or from an
// agent-runs.json (the file before ADR 0199, its agent-runs.json.migrated-* copy, or the JSON fallback); default: the
// stable app's userData folder (%APPDATA%/second-brain; --dev the dev instance's), its app.db when that holds runs.
// --demo diagnoses the frozen demo history instead (demo-agent-runs.ts). Bundled and run by scripts/levels.mjs; never
// writes anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnose, diagnoseFile, formatDiagnosis } from './level-diagnosis';
import { readRunsSource } from './runs-db';
import { judgingOffSince, type SamplerState } from '../../shared/judging';
import type { SettingChange } from '../../shared/contract';
import { demoAgentRuns, demoFlashLog, DEMO_NOW } from '../demo-agent-runs';

const argv = process.argv.slice(2);
const USAGE = 'usage: npm run levels -- [<app.db | agent-runs.json | userData folder>] [--dev] [--json] [--demo]';

/** The review switch from the app's config.json and changes.jsonl beside the file (ADR 0186); undefined = not there. */
function samplerBeside(file: string): SamplerState | undefined {
  const dir = path.dirname(file);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8').replace(/^﻿/, '')) as { judging?: unknown };
    // a config without the key takes the default (on, settings-schema.ts)
    if (cfg.judging !== false) return { on: true, offSince: null };
    let changes: SettingChange[] = [];
    try { changes = fs.readFileSync(path.join(dir, 'changes.jsonl'), 'utf8').split(/\r?\n/).flatMap(l => { try { return l.trim() ? [JSON.parse(l) as SettingChange] : []; } catch { return []; } }); } catch { /* no log */ }
    return { on: false, offSince: judgingOffSince(changes) };
  } catch { return undefined; }
}
const flag = (k: string): boolean => argv.includes(k);
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

function main(): number {
  if (flag('--help') || flag('-h')) { console.log(USAGE); return 0; }
  let d;
  if (flag('--demo')) d = diagnose(demoAgentRuns(DEMO_NOW), [], DEMO_NOW, demoFlashLog(DEMO_NOW));
  else {
    const target = argv.find(a => !a.startsWith('--')) ?? path.join(appData, flag('--dev') ? 'second-brain-dev' : 'second-brain');
    if (!fs.existsSync(target)) { console.error(`no file: ${target} (pass an app.db, an agent-runs.json or the app's userData folder)`); return 2; }
    try {
      const source = readRunsSource(target);
      d = diagnoseFile(source.content, Date.now(), samplerBeside(source.file));
      console.log(`file: ${source.file}`);
    } catch (e) { console.error(`${target}: ${e instanceof Error ? e.message : String(e)}`); return 2; }
  }
  console.log(flag('--json') ? JSON.stringify(d, null, 2) : formatDiagnosis(d));
  return 0;
}
process.exitCode = main();
