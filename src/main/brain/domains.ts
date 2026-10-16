// Brain domains (ADR 0059): a brain is a list of domains, each its own folder and git repo with a `domain.json`
// ({ name, scope: "everywhere" | "this-pc", remote?, denyList? }). This file reads and checks domain.json, finds the domains of a
// brain (the brain folder from config.json `brainRoot` first, then the folders listed in config.json `domains`) and
// resolves the `{brain}` / `{domain:<name>}` placeholders that brain files use instead of absolute paths. Backwards
// compatible: a folder without domain.json is one "this-pc" domain with no remote, so nothing syncs and nothing changes
// for a brain of today. Only an "everywhere" domain may sync: a "this-pc" domain (the employer's data) never gets a
// remote from the app, even if its file names one. `denyList` names the deny file the publish guard uses before that
// domain's push, a bare file name in the guard's folder (default deny-work.txt: the work-only list, so the owner's own name
// may live in a private domain; the public product sync keeps deny.txt). Plain Node, no Electron. Used by brain/sync.ts and brain/index.ts;
// scripts/setup-pc.mjs writes the same config.json shape.
import fs from 'node:fs';
import path from 'node:path';
import type { DomainScope } from '../../shared/contract';

export const DOMAIN_FILE = 'domain.json';
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
/** The deny list a domain's push is checked against when domain.json names none (owner, 2026-10-16). */
export const DEFAULT_DENY_LIST = 'deny-work.txt';
/** A bare .txt file name in the guard's folder: never a path, so domain.json cannot point the guard elsewhere. */
const DENY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.txt$/;

/** A domain as the app uses it: where it lives and whether (and where) it syncs. */
export interface Domain {
  name: string;
  root: string;
  scope: DomainScope;
  /** the remote the app syncs with (a git remote name or URL); null = never synced. Only "everywhere" domains have one. */
  remote: string | null;
  /** the deny file (in the publish guard's folder) checked before this domain's push */
  denyList: string;
  /** no domain.json: the folder is one "this-pc" domain, as before ADR 0059 */
  implicit: boolean;
  /** domain.json exists but is wrong, or names a remote the app refuses (Italian, shown in the sync status) */
  problem: string | null;
}

/** A remote the app may hand to git: a remote name or a URL/path, never an option (leading "-"), never a transport that
 *  runs commands (ext::, fd::), no spaces or control characters. */
export function remoteOk(r: unknown): r is string {
  if (typeof r !== 'string') return false;
  const s = r.trim();
  return s.length > 0 && s.length <= 500 && s === r && !s.startsWith('-') && !/[\s\0-\x1f\x7f]/.test(s) && !/^(ext|fd)::/i.test(s);
}

export type DomainFile = { ok: true; name: string; scope: DomainScope; remote: string | null; denyList: string } | { ok: false; error: string };

/** Checks a parsed domain.json. */
export function checkDomainFile(raw: unknown): DomainFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'domain.json non è un oggetto' };
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !NAME.test(o.name)) return { ok: false, error: 'domain.json: "name" mancante o non valido (lettere, cifre, spazio, _ . -; massimo 40)' };
  if (o.scope !== 'everywhere' && o.scope !== 'this-pc') return { ok: false, error: 'domain.json: "scope" deve essere "everywhere" o "this-pc"' };
  if (o.remote !== undefined && o.remote !== null && !remoteOk(o.remote)) return { ok: false, error: 'domain.json: "remote" non valido (un nome di remote git o un URL)' };
  if (o.denyList !== undefined && o.denyList !== null && (typeof o.denyList !== 'string' || !DENY_NAME.test(o.denyList) || o.denyList.includes('..'))) return { ok: false, error: 'domain.json: "denyList" non valido (un nome di file .txt nella cartella del controllo, senza percorso)' };
  return { ok: true, name: o.name, scope: o.scope, remote: typeof o.remote === 'string' ? o.remote : null, denyList: typeof o.denyList === 'string' ? o.denyList : DEFAULT_DENY_LIST };
}

/** Reads one folder as a domain (never throws). */
export function readDomain(dir: string): Domain {
  const root = path.resolve(dir);
  const fallback = (problem: string | null, implicit: boolean): Domain => ({ name: path.basename(root) || 'brain', root, scope: 'this-pc', remote: null, denyList: DEFAULT_DENY_LIST, implicit, problem });
  const file = path.join(root, DOMAIN_FILE);
  if (!fs.existsSync(file)) return fallback(null, true);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
    return fallback(`domain.json non leggibile: ${e instanceof Error ? e.message : String(e)}`, false);
  }
  const c = checkDomainFile(raw);
  if (!c.ok) return fallback(c.error, false);
  // ADR 0059: a this-pc domain never syncs, whatever its file says
  if (c.scope === 'this-pc' && c.remote) return { name: c.name, root, scope: c.scope, remote: null, denyList: c.denyList, implicit: false, problem: 'dominio "solo questo PC" con un remote: ignorato, non si sincronizza mai' };
  return { name: c.name, root, scope: c.scope, remote: c.remote, denyList: c.denyList, implicit: false, problem: null };
}

/** The domains listed in a saved config.json (`domains`: folder paths); anything else is dropped. */
export function domainsOfConfig(raw: unknown): string[] {
  const d = raw && typeof raw === 'object' ? (raw as { domains?: unknown }).domains : undefined;
  return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string' && x.trim() !== '' && path.isAbsolute(x)).slice(0, 20) : [];
}

const key = (p: string) => path.resolve(p).toLowerCase();

/** The brain's domains: brainRoot first, then the listed folders; duplicates (same folder, or a name already taken) are
 *  left out with a problem logged by the caller. Missing folders are skipped (a domain not cloned on this PC). */
export function discoverDomains(brainRoot: string | null, listed: string[]): { domains: Domain[]; skipped: { dir: string; why: string }[] } {
  const domains: Domain[] = [];
  const skipped: { dir: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const dir of [...(brainRoot ? [brainRoot] : []), ...listed]) {
    if (seen.has(key(dir))) continue;
    seen.add(key(dir));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { skipped.push({ dir, why: 'cartella mancante' }); continue; }
    const d = readDomain(dir);
    if (domains.some(x => x.name.toLowerCase() === d.name.toLowerCase())) { skipped.push({ dir, why: `nome "${d.name}" già usato da un altro dominio` }); continue; }
    domains.push(d);
  }
  return { domains, skipped };
}

/** `{brain}` → the brain folder, `{domain:<name>}` → that domain's folder (case-insensitive name). Unknown ones stay as
 *  they are and are returned in `unknown`, so a reader can say which file names a domain this PC does not have. */
export function resolvePlaceholders(text: string, ctx: { brainRoot: string | null; domains: Pick<Domain, 'name' | 'root'>[] }): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(/\{(brain|domain:([^{}\r\n]{1,40}))\}/g, (m, all: string, name: string | undefined) => {
    if (all === 'brain') { if (ctx.brainRoot) return ctx.brainRoot; unknown.push(m); return m; }
    const d = ctx.domains.find(x => x.name.toLowerCase() === name!.trim().toLowerCase());
    if (d) return d.root;
    unknown.push(m);
    return m;
  });
  return { text: out, unknown: [...new Set(unknown)] };
}

/** Reads a brain file with its placeholders resolved (utf8). */
export function readBrainText(file: string, ctx: { brainRoot: string | null; domains: Pick<Domain, 'name' | 'root'>[] }): { text: string; unknown: string[] } {
  return resolvePlaceholders(fs.readFileSync(file, 'utf8'), ctx);
}
