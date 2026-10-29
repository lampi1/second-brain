// The levels diagnostic (ADR 0131): bundles src/main/agents/levels-cli.ts with esbuild into a temporary file and runs it.
// Read only, zero tokens: says per role why its level and performance are what they are, from the app's app.db (opened
// read only, ADR 0199) or an agent-runs.json. node:sqlite is a Node built-in (esbuild leaves it external).
// Usage: npm run levels -- [<app.db | agent-runs.json | userData folder>] [--dev] [--json] [--demo]
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-levels-'));
const out = path.join(dir, 'levels.mjs');
try {
  await build({ entryPoints: [path.join(root, 'src/main/agents/levels-cli.ts')], outfile: out, bundle: true, platform: 'node', target: 'node22', format: 'esm',
    logLevel: 'warning', external: ['electron'], alias: { '@shared': path.join(root, 'src/shared') },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  await import(pathToFileURL(out).href);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
