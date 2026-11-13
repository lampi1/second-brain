// Builds the `routine` command (ADR 0175): dist/routine.mjs (the CLI, src/bin.ts) and dist/routine-mcp.mjs (the
// runtime's stdio MCP servers, src/mcp-main.ts: testdb, devops, browser) with esbuild. Everything is bundled except
// playwright-core (the routine browser, a dependency of this package). Run by `npm run build` in this folder.
// Usage: node scripts/build.mjs [--out <folder>]   (default: dist/ beside this script's package)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--out');
const out = at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
const common = {
  bundle: true, platform: 'node', target: 'node20', format: 'esm', logLevel: 'warning', external: ['playwright-core'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
await build({ ...common, entryPoints: [path.join(root, 'src/bin.ts')], outfile: path.join(out, 'routine.mjs'),
  banner: { js: `#!/usr/bin/env node\n${common.banner.js}` } });
await build({ ...common, entryPoints: [path.join(root, 'src/mcp-main.ts')], outfile: path.join(out, 'routine-mcp.mjs') });
process.stdout.write(`routine built in ${out}\n`);
