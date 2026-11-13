// Claude plugin executable shipped with each release; all user paths come from data, never interpolated shell code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook } from '../runtime.mjs';

try {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(fs.readFileSync(path.join(base, 'launch.json'), 'utf8'));
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.length > 2_000_000) throw new Error('Hook input too large.');
  const input = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const result = runHook(config.root, config.state, input, { tools: config.tools, correctionHook: config.correctionHook === true });
  if (result.deny) { process.stderr.write(result.deny); process.exitCode = 2; }
  else if (result.context) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: result.context } }));
} catch {
  process.stderr.write('Product hook could not validate its input/configuration. Repair the per-launch plugin before retrying.');
  process.exitCode = 2;
}
