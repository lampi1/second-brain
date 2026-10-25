// Explicit routine output projection. A declared note is append-only and idempotent; it never edits rules or skills.
// Host runtime supplies the approved declaration and run id; callers cannot choose arbitrary brain paths.
import fs from 'node:fs';
import path from 'node:path';
import type { FlowRun } from '../../shared/flows';
export function projectRunOutput(root: string, runId: string, output: NonNullable<FlowRun['outputs']>[number]): void {
  if (!output.brainPath || !/^routine-outputs\/[a-z0-9][a-z0-9_-]{0,60}\.md$/.test(output.brainPath)) throw new Error('No approved brain output destination');
  const canonical = fs.realpathSync(root), dir = path.join(canonical, 'routine-outputs');
  fs.mkdirSync(dir, { recursive: true }); if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== dir) throw new Error('Output directory cannot be a link');
  const file = path.join(canonical, output.brainPath), marker = `<!-- routine-output:${runId}:${output.id}:${output.sha256} -->`;
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Output file cannot be a link');
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Output note is not a bounded regular file');
    const prior = fs.readFileSync(fd, 'utf8'); if (prior.includes(marker)) return;
    const content = `\n\n${marker}\n## Routine ${runId} · ${output.id}\n\n${output.content}\n`;
    fs.writeSync(fd, Buffer.from(content), 0, Buffer.byteLength(content), stat.size); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
