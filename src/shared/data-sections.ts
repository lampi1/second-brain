// Typed data-section operations. IDs and revisions are data; registry paths and confirmation authority stay in main.
import type { SectionManifest } from './extension-section';
export interface SectionSnapshot { revision: number; sections: SectionManifest[] }
export interface ContextFactInput { id: string; key: string; value: string; category: 'constraint' | 'profile' | 'activity' }
export interface ContextArchive { version: 1; revision: number; facts: (ContextFactInput & { confirmation: 'confirmed'; confirmedAt: string })[]; provenance: null | { source: 'explicit-user-confirmation'; at: string } }
export interface SectionContextPacket {
  text: string; bytes: number;
  estimatedTokens: { value: number; method: 'ceil-utf8-bytes-div-4'; approximate: true };
  status: 'empty' | 'ready' | 'degraded';
  included: string[]; omitted: string[]; conflicts: string[]; pending: string[]; unavailable: string[];
}
export const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export const validSectionId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
