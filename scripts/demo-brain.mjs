// A throwaway brain folder for the demo: the synthetic brain of test/fixtures (its data server ops/tools/brain-site.mjs,
// its data, a fake DevOps reader), so the brain pages (Oggi, Esplora, Mappa 3D, Qualità, DevOps) have content with no
// real brain, no CLI and no network. Fictional data only. Used by scripts/demo.mjs (`npm run demo`) and by the README
// screenshots (test/shots/readme.spec.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

/** Creates the demo brain in a new temp folder and returns its path. */
export function demoBrain(prefix = 'sb-demo-brain-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tools = path.join(d, 'ops', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'brain-site.mjs'), path.join(tools, 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'data.mjs'), path.join(tools, 'brain-ui-data.mjs'));
  fs.copyFileSync(path.join(FIX, 'devops', 'devops-me.mjs'), path.join(tools, 'devops-me.mjs'));
  return d;
}
