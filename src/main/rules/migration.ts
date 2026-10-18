// Explicit offline migration transaction for a standalone local brain. Preserves a git tag and the entire old tree.
// The owner runs this with all chats stopped; no personal brain is migrated at startup or by an agent automatically.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { confined, atomicWrite, configOf } from './storage';
import { isTemplateCode, templateRoot } from './tools';
import { MACHINERY_FILES, toolReferences } from './new-brain';

export interface MigrationEdit { file: string; beforeSha256: string | null; after: string | null }
export interface MigrationReceipt { root: string; backup: string; tag: string }
/** Written next to the brain before the two renames and removed after them: a crash in between leaves it for recover. */
interface Journal extends MigrationReceipt { stage: string }
export const journalOf = (root: string): string => `${path.resolve(root)}.product-migration.json`;
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function git(root: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000, env });
  if (result.status !== 0) throw new Error('Migration git check failed; use a clean standalone local brain repository.');
  return result.stdout.trim();
}
function regularTree(root: string): void {
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) throw new Error('Migration refuses links and special files.');
    if (item.isDirectory()) regularTree(file);
  }
}
export function migrate(root: string, edits: readonly MigrationEdit[]): MigrationReceipt {
  root = path.resolve(root);
  if (fs.existsSync(journalOf(root))) throw new Error(`A previous migration did not finish; run recover on ${root} first.`);
  if (fs.realpathSync(root).toLowerCase() !== root.toLowerCase() || !fs.lstatSync(path.join(root, '.git')).isDirectory()) throw new Error('Migration requires a standalone brain, not a link or worktree.');
  if (path.resolve(git(root, 'rev-parse', '--show-toplevel')).toLowerCase() !== root.toLowerCase() || git(root, 'remote') || git(root, 'status', '--porcelain')) throw new Error('Migration requires a clean local brain without remotes.');
  regularTree(root);
  if (!edits.length || !edits.some(e => e.file === 'brain.json' && e.after && JSON.parse(e.after).machinery === 'product-v1')) throw new Error('A complete migration must activate product-v1 in brain.json.');
  const names = new Set<string>();
  for (const edit of edits) {
    if (edit.file.split(/[\\/]/).some(p => p.toLowerCase() === '.git') || names.has(edit.file.toLowerCase())) throw new Error('Duplicate or git-internal migration path.');
    names.add(edit.file.toLowerCase());
    const file = confined(root, edit.file);
    if ((fs.existsSync(file) ? hash(file) : null) !== edit.beforeSha256) throw new Error('Migration preimage changed; regenerate and review the plan.');
  }
  const id = randomUUID(), tag = `brain-before-product-${id}`;
  const backup = `${root}.before-product-${id}`;
  const stage = fs.mkdtempSync(path.join(path.dirname(root), '.brain-product-'));
  git(root, 'tag', tag);
  // No recursive deletes: on failure the stage and tag remain inspectable; the source remains recoverable.
  try {
    fs.cpSync(root, stage, { recursive: true, errorOnExist: true, force: false });
    for (const edit of edits) {
      const file = confined(stage, edit.file);
      if (edit.after === null) fs.unlinkSync(file);
      else { fs.mkdirSync(path.dirname(file), { recursive: true }); atomicWrite(stage, edit.file, edit.after); }
    }
    if (git(root, 'status', '--porcelain')) throw new Error('Brain changed while staging the migration.');
    const journal = journalOf(root);
    fs.writeFileSync(journal, JSON.stringify({ root, backup, tag, stage } satisfies Journal), { flag: 'wx' });
    fs.renameSync(root, backup);
    try { fs.renameSync(stage, root); }
    catch (error) { fs.renameSync(backup, root); fs.unlinkSync(journal); throw error; }
    fs.unlinkSync(journal);
    return { root, backup, tag };
  } catch { throw new Error(`Migration failed; preserved stage ${stage}. Backup tag: ${tag}. Original brain was retained or restored.`); }
}
export function rollback(receipt: MigrationReceipt): string {
  const { root, backup, tag } = receipt;
  if (!path.isAbsolute(root) || !/^brain-before-product-[a-f0-9-]+$/.test(tag) || backup !== `${root}.before-product-${tag.slice('brain-before-product-'.length)}`) throw new Error('Invalid migration receipt.');
  if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(backup).isSymbolicLink()) throw new Error('Rollback refuses links.');
  git(backup, 'rev-parse', '--verify', `refs/tags/${tag}`);
  const retained = `${root}.after-product-${randomUUID()}`;
  fs.renameSync(root, retained);
  try { fs.renameSync(backup, root); }
  catch (error) { fs.renameSync(retained, root); throw error; }
  return retained; // new content is never discarded when rolling back
}

export interface Recovery { state: 'not-applied' | 'restored' | 'applied'; root: string; stage?: string; receipt?: MigrationReceipt }
/** After a crash during migrate: before the first rename nothing changed (the stage is kept for inspection); between
 * the renames the original brain is moved back; after both the migration stands and its receipt is returned. Never
 * deletes a tree. Refuses any journal whose paths are not the ones migrate derives for this brain. */
export function recoverMigration(root: string): Recovery {
  root = path.resolve(root);
  const file = journalOf(root);
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  const id = j.tag?.slice('brain-before-product-'.length);
  if (j.root !== root || !/^brain-before-product-[a-f0-9-]+$/.test(j.tag ?? '') || j.backup !== `${root}.before-product-${id}` ||
      path.dirname(j.stage ?? '') !== path.dirname(root) || !path.basename(j.stage).startsWith('.brain-product-')) throw new Error('Invalid migration journal; inspect it by hand.');
  const has = (p: string) => { try { return !fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
  const receipt = { root, backup: j.backup, tag: j.tag };
  let out: Recovery;
  if (has(root) && has(j.backup)) out = { state: 'applied', root, receipt };
  else if (has(root)) out = { state: 'not-applied', root, stage: j.stage };
  else if (has(j.backup)) { fs.renameSync(j.backup, root); out = { state: 'restored', root, stage: j.stage }; }
  else throw new Error(`Neither ${root} nor its backup exists; the staged tree is ${j.stage}.`);
  fs.unlinkSync(file);
  return out;
}

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === '.git' || e.name === 'node_modules') return [];
    const file = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(file, base) : e.isFile() ? [path.relative(base, file).replace(/\\/g, '/')] : [];
  });
}
/** A reviewable plan that turns a legacy brain into product-v1: topic frontmatter from the release template, template
 * code references as {tools}/…, template code removed and brain.json activated. Personal scripts and every other
 * personal file stay. withHooks=false keeps .claude/hooks and harness/cursor: global CLI settings may still run them,
 * so the owner removes that wiring first. Read-only: it only reads the brain and the template. */
export function planMigration(root: string, opts: { withHooks?: boolean; template?: string } = {}): MigrationEdit[] {
  root = path.resolve(root);
  const source = opts.template ?? templateRoot();
  const own = listFiles(root);
  const shipped = new Set(listFiles(source));
  const edits: MigrationEdit[] = [];
  const before = (rel: string) => sha(fs.readFileSync(confined(root, rel)));
  const topicFiles: string[] = [];
  for (const rel of own) {
    const keepHook = !opts.withHooks && /^(?:\.claude\/hooks|harness\/cursor)\//.test(rel);
    if ((isTemplateCode(rel) && shipped.has(rel) && !keepHook) || (MACHINERY_FILES.includes(rel) && opts.withHooks)) { edits.push({ file: rel, beforeSha256: before(rel), after: null }); continue; }
    if (!rel.endsWith('.md')) continue;
    const text = fs.readFileSync(confined(root, rel), 'utf8');
    let next = toolReferences(text, root);
    if (!next.startsWith('---\nwhen: ') && shipped.has(rel)) {
      const head = /^---\nwhen: \{[^\n]+\}\n---\n/.exec(fs.readFileSync(path.join(source, rel), 'utf8').replace(/\r\n/g, '\n'));
      if (head) next = head[0] + next;
    }
    if (next.replace(/\r\n/g, '\n').startsWith('---\nwhen: ')) topicFiles.push(rel);
    if (next !== text) edits.push({ file: rel, beforeSha256: before(rel), after: next });
  }
  const json = own.includes('brain.json') ? JSON.parse(fs.readFileSync(confined(root, 'brain.json'), 'utf8')) as Record<string, unknown> : {};
  if (json.machinery) throw new Error('This brain already has a machinery owner.');
  const rules = { ...configOf(root), topicFiles: topicFiles.sort() };
  edits.push({ file: 'brain.json', beforeSha256: own.includes('brain.json') ? before('brain.json') : null, after: JSON.stringify({ ...json, machinery: 'product-v1', rules }, null, 2) + '\n' });
  return edits;
}
