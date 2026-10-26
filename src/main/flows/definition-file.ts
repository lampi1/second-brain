// Bounded JSON transport for large routine proposals from the selected brain. Used only by the Orchestrator tool.
// Loading grants nothing: the unchanged FlowService proposal path validates and snapshots the complete definition.
import fs from 'node:fs';
import path from 'node:path';
import type { FlowDefinition, FlowPropose } from '../../shared/flows';
import type { FlowService } from './service';
import { digest, integer, object, text } from './schema';
import { flowBrainContextKey } from './context';

export const FLOW_DEFINITION_FILE_MAX_BYTES = 1024 * 1024;
export const FLOW_DEFINITION_READ_ATTEMPTS = 5;
class DefinitionFileError extends Error {}
class DirectoryMetadataChanged extends DefinitionFileError {}
function fail(message: string): never { throw new DefinitionFileError(message); }
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
type DirectoryIdentity = { file: string; stat: fs.BigIntStats };
/** A parent can be swapped and restored between pathname checks. Pin its change metadata, not just the leaf inode. */
function directoryIdentities(root: string, file: string): DirectoryIdentity[] {
  // Include ancestors above the brain too: replacing one could redirect every apparently unchanged child.
  const volume = path.parse(root).root, names = [volume]; let current = volume;
  for (const part of path.relative(volume, path.dirname(file)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); names.push(current);
  }
  return names.map(file => {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Routine definition path cannot contain symbolic links or junctions');
    return { file, stat };
  });
}
function checkDirectories(directories: DirectoryIdentity[]): void {
  for (const { file, stat } of directories) {
    const now = fs.lstatSync(file, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || stat.dev !== now.dev || stat.ino !== now.ino) fail('Routine definition directory identity changed while reading; retry the proposal');
    if (stat.ctimeNs !== now.ctimeNs || stat.mtimeNs !== now.mtimeNs || stat.size !== now.size || stat.nlink !== now.nlink) throw new DirectoryMetadataChanged('Routine definition directory changed while reading; retry the proposal');
  }
}
/** Reject links in every component, including Windows junctions. The user-selected root itself may be canonicalized. */
function checkPath(root: string, file: string): fs.Stats {
  let current = root;
  for (const part of path.relative(root, file).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('Routine definition path cannot contain symbolic links or junctions');
  }
  if (!samePath(fs.realpathSync(file), file)) fail('Routine definition path changed or resolves outside the selected brain');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) fail('Routine definition must be a regular, single-link JSON file');
  if (stat.size > FLOW_DEFINITION_FILE_MAX_BYTES) fail('Routine definition file exceeds 1 MiB');
  return stat;
}
const unchanged = (a: fs.Stats, b: fs.Stats): boolean => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.nlink === 1 && b.isFile();
function readDefinitionFileOnce(brainRoot: string | null | undefined, value: unknown, expectedContextKey: string): FlowDefinition {
  const requested = text(value, 'definitionPath', 4096);
  if (!brainRoot) fail('Connect a brain before proposing a routine from a file');
  if (path.extname(requested).toLowerCase() !== '.json' || requested.split(/[\\/]/).includes('..')) fail('definitionPath must name a JSON file inside the selected brain, without traversal');
  let bytes: Buffer;
  try {
    const configured = path.resolve(brainRoot), root = fs.realpathSync(configured), candidate = path.resolve(configured, requested);
    if (flowBrainContextKey(root) !== expectedContextKey) fail('Brain context changed; reread app_flow_list before loading a definition file');
    // Accept both the configured root and its canonical spelling (e.g. macOS /tmp), never another root.
    const base = inside(configured, candidate) ? configured : root;
    if (!inside(base, candidate)) fail('Routine definition file must be inside the selected brain');
    const relative = path.relative(base, candidate);
    if (relative.split(/[\\/]/).some(part => part.includes(':'))) fail('Routine definition path cannot contain alternate streams or drive references');
    const file = path.join(root, relative), directories = directoryIdentities(root, file), before = checkPath(root, file);
    checkDirectories(directories);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const opened = fs.fstatSync(fd);
      if (!unchanged(before, opened) || !unchanged(opened, checkPath(root, file))) fail('Routine definition file changed while opening; retry the proposal');
      checkDirectories(directories);
      // Never read an unbounded growing file. The extra byte detects growth without allocating more than the cap.
      const buffer = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length !== opened.size || !unchanged(opened, fs.fstatSync(fd)) || !unchanged(opened, checkPath(root, file))) fail('Routine definition file changed while reading; retry the proposal');
      checkDirectories(directories);
      bytes = buffer.subarray(0, length);
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error instanceof DefinitionFileError) throw error;
    // Filesystem and JSON errors must not echo source content or private absolute paths into tool logs.
    throw new Error('Cannot read routine definition JSON from the selected brain; check that the file exists and is readable');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Routine definition file must contain valid UTF-8 JSON (a plain definition object)'); }
  return object(parsed, 'definition file') as unknown as FlowDefinition;
}
/** Unrelated siblings may change ancestor metadata. Discard that read and retry all checks with the SAME context.
 * Identity changes, links, file mutation, parsing and validation errors are never retried or treated as success. */
export function readDefinitionFile(brainRoot: string | null | undefined, value: unknown, expectedContextKey: string): FlowDefinition {
  for (let attempt = 1; ; attempt++) {
    try { return readDefinitionFileOnce(brainRoot, value, expectedContextKey); }
    catch (error) { if (!(error instanceof DirectoryMetadataChanged) || attempt >= FLOW_DEFINITION_READ_ATTEMPTS) throw error; }
  }
}
/** Preserve the inline result; a file proposal returns a small receipt instead of echoing the large source to the AI. */
export function proposeFlow(service: FlowService, args: Record<string, unknown>, brainRoot?: () => string | null) {
  const inline = Object.hasOwn(args, 'definition'), file = Object.hasOwn(args, 'definitionPath');
  if (inline === file) throw new Error('Supply exactly one of definition or definitionPath');
  if (inline) { const draft = service.propose(args as unknown as FlowPropose); return { ...draft, preflight: service.preflight(draft.definition) }; }
  const expectedRevision = integer(args.expectedRevision, 'expectedRevision');
  const definition = readDefinitionFile(brainRoot?.(), args.definitionPath, service.snapshot().contextKey);
  const draft = service.propose({ definition, expectedRevision });
  return { flowId: draft.definition.id, title: draft.definition.title, revision: draft.revision, status: draft.status, updatedAt: draft.updatedAt, digest: digest(draft.definition), stepCount: draft.definition.steps.length, preflight: { executable: service.preflight(draft.definition).executable, tool: 'app_flow_preflight', flowId: draft.definition.id } };
}
