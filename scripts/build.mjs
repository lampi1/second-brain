// Build: main (ESM) and preload (CJS, sandboxed) with esbuild, renderer with Vite. Output in out/.
// Usage: node scripts/build.mjs [--dev]   (--dev: sourcemaps, no minify)
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: dev ? 'inline' : false, minify: false, logLevel: 'warning', alias: { '@shared': path.join(root, 'src/shared') } };
await esbuild({ ...common, entryPoints: [path.join(root, 'src/main/index.ts')], outfile: path.join(root, 'out/main/index.js'), format: 'esm', external: ['electron'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
await esbuild({ ...common, entryPoints: [path.join(root, 'src/preload/index.ts')], outfile: path.join(root, 'out/preload/index.cjs'), format: 'cjs', external: ['electron'] });
// Page scripts injected into browser tabs: plain strings built from TS sources
await vite({ configFile: path.join(root, 'vite.config.ts'), mode: dev ? 'development' : 'production', logLevel: 'warn' });
console.log(`built ${dev ? '(dev) ' : ''}→ out/`);
