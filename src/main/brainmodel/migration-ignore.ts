// Persist an explicit skill-forget decision per source file/heading, independently of the bounded change history.
// The marker participates in the original removal's Undo. Manual deletion of that marker also permits re-import.
// Older approved removals are repaired only during requested migration; edited or ambiguous restorations are preserved.
import fs from 'node:fs';
import path from 'node:path';
import { brainPath } from '../agents/pack/flows';
import type { ChangeLog } from './changes';
import { readSmall } from './model';
import { generatedUnchanged, legacyMarker, migrationReceipt, sourceHash, sourceId } from './migration-source';
import type { ProcedureSection } from './procedure-sources';
export const ignoreFile = (root: string, source: string): string => brainPath(root, `ops/state/migration-ignored/${sourceHash(source)}.json`);
export function sourceOfSkill(text: string, sections: ProcedureSection[]): string | null {
  const receipt = migrationReceipt(text); if (receipt) return receipt.source;
  const matches = sections.filter(s => text.includes(legacyMarker(s)));
  return matches.length === 1 ? sourceId(matches[0]!) : null;
}
export function ignoreWrite(root: string, source: string, skill: string, at: number): { file: string; text: string } {
  return { file: ignoreFile(root, source), text: `${JSON.stringify({ source, skill, at }, null, 2)}\n` };
}
export function migrationIgnored(root: string, source: string): boolean {
  const file = ignoreFile(root, source);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).source === source; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new Error('Unreadable migration decision; existing skills are unchanged'); }
}
export function backfillForgotten(root: string, sections: ProcedureSection[], log: ChangeLog): void {
  const base = fs.realpathSync(root), seen = new Set<string>();
  for (const c of log.all().reverse()) {
    if (c.kind !== 'skill' || c.action !== 'remove' || !['user', 'research'].includes(c.job)) continue;
    for (const f of c.files) {
      const rel = path.relative(base, f.file).split(path.sep).join('/');
      if (!/^\.(claude|agents)\/skills\/[^/]+\/SKILL\.md$/.test(rel) || !f.before || f.after !== null) continue;
      const source = sourceOfSkill(f.before, sections); if (!source || seen.has(source)) continue;
      seen.add(source); if (c.rolledBackAt || c.migrationIgnored) continue;
      const writes: { file: string; text: string | null }[] = [ignoreWrite(base, source, c.target, c.at)];
      // Only the original destination, only a proven generated re-creation, and no additional personal files.
      const current = readSmall(f.file), receipt = current ? migrationReceipt(current) : null;
      if (current && receipt?.source === source && receipt.createdAt > c.at && generatedUnchanged(current, receipt)
        && fs.readdirSync(path.dirname(f.file)).every(name => name === 'SKILL.md')) {
        brainPath(base, rel); writes.push({ file: f.file, text: null });
      }
      log.rememberMigrationRemoval(c.id, writes);
    }
  }
}
