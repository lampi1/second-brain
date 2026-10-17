// Build-time integrity manifest for the public empty brain. The installed create helper checks it before any copy.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function templateManifest(root) {
  const files = {};
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('the distributed template cannot contain links');
      const relative = prefix + entry.name;
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(source, relative + '/');
      else if (entry.isFile()) files[relative] = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
      else throw new Error('unexpected template asset type');
    }
  };
  walk(root);
  return { schema: 1, files };
}
