// Bounded, scrubbed Battito evidence. Main supplies named snippets; no chat bodies or arbitrary file reads.
import { createHash } from 'node:crypto';
import { scrub } from '../headline';
import type { PulseRef } from '../../shared/pulse';
export interface DigestEntry { id: string; ref: PulseRef; text: string }
export interface PulseDigest { text: string; hash: string; entries: DigestEntry[] }
export interface DigestMaterial {
  now: string; ideas: string; journal: string; errors: string;
  chats: { id: string; title: string; state: string }[];
  agents: { id: string; text: string }[];
  files: string[];
}
/** Checks source existence, not membership of the truncated outbound digest. */
export function refExists(ref: PulseRef, m: DigestMaterial): boolean {
  if (ref.kind === 'agent') return m.agents.some(a => a.id === ref.ref);
  if (ref.kind === 'chat') return m.chats.some(c => c.id === ref.ref);
  if (ref.kind === 'file') return safeRelative(ref.ref) && m.files.includes(ref.ref);
  if (ref.kind === 'idea') return m.ideas.split(/(?=^##\s)/m).some(b => `idea-${createHash('sha1').update(b).digest('hex').slice(0, 10)}` === ref.ref);
  const source = ref.kind === 'now' ? m.now : ref.kind === 'journal' ? m.journal : m.errors;
  return source.split(/\r?\n/).some(l => `${ref.kind}-${createHash('sha1').update(l).digest('hex').slice(0, 10)}` === ref.ref);
}
export const safeRelative = (s: string): boolean => !!s && s.length <= 240 && !s.includes('\\')
  && !s.startsWith('/') && !s.includes(':') && !s.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'));
export function buildDigest(m: DigestMaterial, at = Date.now()): PulseDigest {
  const entries: DigestEntry[] = [];
  let text = '';
  const add = (kind: PulseRef['kind'], ref: string, raw: string) => {
    const clean = scrub(raw).replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!clean) return;
    const id = `d${entries.length + 1}`;
    const line = `[${id}] ${clean}\n`;
    if (text.length + line.length > 6000) return;
    text += line; entries.push({ id, ref: { kind, ref }, text: clean });
  };
  const lines = (raw: string, kind: PulseRef['kind'], max: number) => {
    for (const l of raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).slice(-max)) {
      const id = `${kind}-${createHash('sha1').update(l).digest('hex').slice(0, 10)}`;
      add(kind, id, l);
    }
  };
  lines(m.now, 'now', 12);
  const blocks = m.ideas.split(/(?=^##\s)/m).filter(b => /^##\s/.test(b));
  const due = blocks.filter(b => {
    const date = /Riprendere[^\d]*(\d{4}-\d{2}-\d{2})/i.exec(b)?.[1];
    return !!date && new Date(`${date}T00:00:00`).getTime() <= at + 7 * 86400_000;
  }).slice(0, 8);
  for (const b of [...new Set([...due, ...blocks.slice(-5)])]) {
    const title = b.split(/\r?\n/)[0]!.replace(/^##\s*/, '');
    add('idea', `idea-${createHash('sha1').update(b).digest('hex').slice(0, 10)}`, title);
  }
  lines(m.journal, 'journal', 10); lines(m.errors, 'ai-error', 8);
  m.agents.slice(0, 10).forEach(a => add('agent', a.id, a.text));
  m.chats.slice(-15).forEach(c => add('chat', c.id, `${c.title} · ${c.state}`));
  m.files.filter(safeRelative).slice(-20).forEach(f => add('file', f, f));
  return { text, entries, hash: createHash('sha256').update(text).digest('hex') };
}
