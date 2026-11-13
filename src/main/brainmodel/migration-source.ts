// Stable source identities and generated-content receipts for runbook migration. Jobs use these to survive moved
// headings, honor undo and update an unedited generated skill without overwriting a user's later changes.
import { createHash } from 'node:crypto';
import type { ProcedureSection } from './procedure-sources';
import { slugOf } from './procedure-sources';

interface Receipt { source: string; bodyHash: string; generatedHash: string; createdAt: number }
const MARKER = /\n<!-- second-brain-migration: ([A-Za-z0-9+/=]+) -->\n?$/;
export const sourceHash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const sourceId = (section: ProcedureSection): string => `${section.file}#${slugOf([section.group, section.title].filter(Boolean).join(' / '))}`;
export const legacyMarker = (section: ProcedureSection): string => `Spostata qui da \`${section.file}\` (sezione «${section.title}», riga `;
export function migrationReceipt(text: string): Receipt | null {
  const found = MARKER.exec(text);
  if (!found) return null;
  try {
    const r = JSON.parse(Buffer.from(found[1]!, 'base64').toString('utf8')) as Receipt;
    return typeof r.source === 'string' && /^[a-f0-9]{64}$/.test(r.bodyHash) && /^[a-f0-9]{64}$/.test(r.generatedHash)
      && Number.isFinite(r.createdAt) && r.createdAt >= 0 ? r : null;
  } catch { return null; }
}
export const generatedUnchanged = (text: string, receipt: Receipt): boolean => sourceHash(text.replace(MARKER, '')) === receipt.generatedHash;
export function sealMigration(text: string, source: string, body: string, createdAt: number): string {
  const receipt: Receipt = { source, bodyHash: sourceHash(body), generatedHash: sourceHash(text), createdAt };
  return `${text}\n<!-- second-brain-migration: ${Buffer.from(JSON.stringify(receipt)).toString('base64')} -->\n`;
}
