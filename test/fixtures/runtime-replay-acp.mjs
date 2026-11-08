// Fixed synthetic ACP recording for the hidden runtime baseline; never starts the real Cursor CLI.
import { fileURLToPath } from 'node:url';
process.env.SB_REPLAY_FILE = fileURLToPath(new URL('./wire/acp/turns.ndjson', import.meta.url));
await import('./replay-engine.mjs');
