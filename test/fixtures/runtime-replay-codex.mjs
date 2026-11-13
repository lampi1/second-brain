// Fixed Codex recording for the hidden runtime baseline; selected explicitly so no installed CLI can run.
import { fileURLToPath } from 'node:url';
process.env.SB_REPLAY_FILE = fileURLToPath(new URL('./wire/codex/turns.ndjson', import.meta.url));
await import('./replay-engine.mjs');
