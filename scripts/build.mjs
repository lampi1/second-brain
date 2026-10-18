// Build: main (ESM) and preload (CJS, sandboxed) with esbuild, renderer with Vite, plus the icons and the publish guard's
// scanner (out/guard/scan.mjs). Output in out/.
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
// the hybrid search's worker thread (src/main/search/hybrid/worker.ts), next to the main bundle
await esbuild({ ...common, entryPoints: [path.join(root, 'src/main/search/hybrid/worker.ts')], outfile: path.join(root, 'out/main/search-worker.js'), format: 'esm',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
// its runtime packages (loaded with createRequire, never bundled: native code, ADR 0068) travel in out/node_modules, so
// the dev build and every release (a copy of out/) resolve them; onnxruntime-node keeps only this platform's CPU binaries
const runtime = ['onnxruntime-node', 'onnxruntime-common', '@huggingface/tokenizers', 'sqlite-vec', `sqlite-vec-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`];
for (const pkg of runtime) {
  const src = path.join(root, 'node_modules', pkg);
  if (!fs.existsSync(src)) continue; // another platform's optional package
  fs.cpSync(src, path.join(root, 'out', 'node_modules', pkg), { recursive: true, filter: f => {
    const rel = path.relative(src, f).replace(/\\/g, '/');
    if (pkg !== 'onnxruntime-node' || !rel.startsWith('bin/')) return true;
    const [, , plat, arch, file] = rel.split('/'); // bin/napi-v6/<platform>/<arch>/<file>
    if (plat && plat !== process.platform) return false;
    if (arch && arch !== process.arch) return false;
    return !file || !/^(DirectML|dxcompiler|dxil)\.dll$/i.test(file); // GPU (DirectML) only: the search runs on CPU
  } });
}
await esbuild({ ...common, entryPoints: [path.join(root, 'src/preload/index.ts')], outfile: path.join(root, 'out/preload/index.cjs'), format: 'cjs', external: ['electron'] });
// Page scripts injected into browser tabs: plain strings built from TS sources
await vite({ configFile: path.join(root, 'vite.config.ts'), mode: dev ? 'development' : 'production', logLevel: 'warn' });
// the app icon (window, taskbar, shortcuts): build/icon.ico from scripts/make-icon.cjs
for (const f of ['icon.ico', 'icon.png']) fs.copyFileSync(path.join(root, 'build', f), path.join(root, 'out', f));
// the publish guard's scanner (tools/guard/scan.mjs, ADR 0061): brain/guard.ts runs it before each domain push; here it
// travels with out/, so the dev build and every release (a copy of out/, scripts/release.mjs) find it at out/guard/
fs.mkdirSync(path.join(root, 'out', 'guard'), { recursive: true });
fs.copyFileSync(path.join(root, 'tools', 'guard', 'scan.mjs'), path.join(root, 'out', 'guard', 'scan.mjs'));
console.log(`built ${dev ? '(dev) ' : ''}→ out/`);
