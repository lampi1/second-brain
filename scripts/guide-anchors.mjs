// The Guida's anchors (ADR 0196): bundles src/main/guide/anchors-cli.ts with esbuild into a temporary file and runs it.
// Writes the hash of every code symbol the concept cards point at to src/shared/guide-anchors.json (commit it). Run it
// after re-reading a card whose code changed (the unit test test/unit/guide-anchors.test.ts names the card and point).
// Usage: node scripts/guide-anchors.mjs [--check]   (--check: write nothing, exit 1 when a card is stale)
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guide-anchors-'));
const out = path.join(dir, 'guide-anchors.mjs');
process.env.SB_REPO_ROOT = root;
try {
  await build({ entryPoints: [path.join(root, 'src/main/guide/anchors-cli.ts')], outfile: out, bundle: true, platform: 'node', target: 'node22', format: 'esm',
    logLevel: 'warning', external: ['electron'], alias: { '@shared': path.join(root, 'src/shared') } });
  await import(pathToFileURL(out).href);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
