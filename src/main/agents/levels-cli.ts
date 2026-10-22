// `npm run levels -- [<agent-runs.json>] [--dev] [--json] [--demo]` (ADR 0131): read only, zero tokens. Recomputes every
// role's level and performance from an agent-runs.json with the card's own rules and prints why each role is where it
// is (level-diagnosis.ts). Default file: the stable app's (%APPDATA%/second-brain/agent-runs.json; --dev the dev
// instance's). --demo diagnoses the frozen demo history instead (demo-agent-runs.ts). Bundled and run by
// scripts/levels.mjs; never writes anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnose, diagnoseFile, formatDiagnosis } from './level-diagnosis';
import { demoAgentRuns, demoFlashLog, DEMO_NOW } from '../demo-agent-runs';

const argv = process.argv.slice(2);
const flag = (k: string): boolean => argv.includes(k);
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

function main(): number {
  if (flag('--help') || flag('-h')) { console.log('usage: npm run levels -- [<agent-runs.json>] [--dev] [--json] [--demo]'); return 0; }
  let d;
  if (flag('--demo')) d = diagnose(demoAgentRuns(DEMO_NOW), [], DEMO_NOW, demoFlashLog(DEMO_NOW));
  else {
    const file = argv.find(a => !a.startsWith('--')) ?? path.join(appData, flag('--dev') ? 'second-brain-dev' : 'second-brain', 'agent-runs.json');
    if (!fs.existsSync(file)) { console.error(`no file: ${file} (pass the path of an agent-runs.json)`); return 2; }
    try { d = diagnoseFile(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown, Date.now()); } catch (e) { console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`); return 2; }
    console.log(`file: ${file}`);
  }
  console.log(flag('--json') ? JSON.stringify(d, null, 2) : formatDiagnosis(d));
  return 0;
}
process.exitCode = main();
