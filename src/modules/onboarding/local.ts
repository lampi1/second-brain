// Cloud-safe local filesystem gate. Checks every ancestor before any content access; never follows links.
import fs from 'node:fs/promises';
import path from 'node:path';
export type Attributes = (absolute: string) => Promise<number>;
const BLOCKED = 0x400 | 0x1000 | 0x40000 | 0x400000; // reparse, offline, recall-on-open/access
// Node does not expose portable recall/offline attributes. A native host bridge is required;
// do not guess from directory names, execute shells or hydrate a placeholder to find out.
export class LocalFiles {
  constructor(private readonly attributes?: Attributes) {}
  requireMetadata(): void { if (!this.attributes) throw new Error('Native cloud-attribute adapter unavailable'); }
  async check(target: string, allowMissing = false): Promise<void> {
    if (!path.isAbsolute(target) || /^[\\/]{2}/.test(target)) throw new Error('Choose an absolute local folder');
    const absolute = path.resolve(target), root = path.parse(absolute).root;
    if (/^[\\/]{2}/.test(absolute) || (process.platform === 'win32' && !/^[a-z]:\\$/i.test(root))) throw new Error('Choose an absolute local folder');
    this.requireMetadata();
    let current = root;
    for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      let stat;
      try { stat = await fs.lstat(current); } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw new Error('Local path unavailable');
      }
      const attributes = await this.attributes!(current);
      if (!Number.isSafeInteger(attributes) || attributes < 0) throw new Error('Native cloud-attribute adapter unavailable');
      if (stat.isSymbolicLink() || (attributes & BLOCKED)) throw new Error('Cloud-only or linked path skipped');
    }
  }
  async read(file: string): Promise<string | null> {
    await this.check(file, true);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Configuration is too large or not a file');
      return await fs.readFile(file, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
}
