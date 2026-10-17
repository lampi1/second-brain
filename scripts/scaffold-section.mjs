// Generate one data-only section from a validated specification. Used by agents; no model/network calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSection } from '../src/shared/extension-section.ts';

export function scaffold(specPath, outputDirectory) {
  if (fs.statSync(specPath).size > 128 * 1024) throw new Error('Specification exceeds byte budget');
  const manifest = parseSection(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, `${manifest.id}.section.json`);
  // wx preserves existing work; validation completes before a file can be created.
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return target;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node --experimental-strip-types scripts/scaffold-section.mjs spec.json output-directory');
  console.log(scaffold(process.argv[2], process.argv[3]));
}
