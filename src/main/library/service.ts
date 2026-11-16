// Memoria → Artifact (ADR 0319): one place for every report, analysis, document and image the chats produce, indexed
// where it is (nothing moved, renamed or deleted). Sources:
// - a chat's turn: the artifact files its answer or report links (absolute paths, file: URLs, Markdown links, relative
//   paths in its folder or the brain) — noteTurn, called at every turn's end by index.ts;
// - a look through the folders: the brain's reviews/, tmp/ and evidence/ and each chat's evidence folder
//   (<userData>/evidence/chat-<id>) — scan, at start and when the tab asks with an index older than a minute;
// - once, the past chats' answers (their transcripts) — backfill.
// Files with the same version key (shared/library.ts versionKey) are one artifact with its history; a version's text
// (Markdown, HTML, csv, json, txt up to COPY_BYTES) is copied once to <userData>/library/versions, so an overwritten or deleted report
// still opens as it was. A file that went is kept and shown as missing, never dropped. The index is
// <userData>/library/index.json (local-store.ts writes: atomic, bounded). Used by index.ts and ipc-handlers/library.ts;
// pinned by test/unit/library-service.test.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary } from '../../shared/contract';
import { LIBRARY_MAX, artifactKind, artifactOfPath, baseNameOf, extOf, linkedPaths, pathKey, readsText, secretHead, summaryOf, titleOf, versionKey, type Artifact, type ArtifactKind, type ArtifactList, type ArtifactThumb, type ArtifactVersion } from '../../shared/library';
import { readLocal, writeLocalText } from '../agents/local-store';
import { isInside } from '../ask-image';
import { localFile } from '../file-view';
import { log } from '../log';
import { head, walk, type Found, type WalkRoot } from './walk';

/** A version's text is copied when it is at most this big (an HTML report with its screenshots inside stays whole). */
export const COPY_BYTES = 8_000_000;
/** All copies together stay under this: past it new versions are indexed without a copy. */
export const COPY_TOTAL = 400_000_000;
const VERSIONS_MAX = 30;
const STALE_MS = 60_000;
/** Folders of the brain that are its own memory and machinery (shown elsewhere in Memoria), never artifacts. */
const BRAIN_OWN = /^(journal|memory|ops|harness|playbooks|skills|agents|routines|rules|knowledge|\.[^\\/]+)$/i;

export type LibraryChat = Pick<ChatSummary, 'id' | 'title' | 'cwd' | 'updatedAt' | 'isOrchestrator'> & { run?: { tags?: { app: string | null; repo: string | null } | undefined } | undefined };

export interface LibraryPorts {
  userData: string;
  platform?: NodeJS.Platform;
  brainRoot(): string | null;
  chats(): readonly LibraryChat[];
  /** a chat's answers so far (its live items or its transcript), for the one-time backfill */
  history(chatId: string): readonly ChatItem[];
  /** the project maps' folders (an artifact there belongs to that project) */
  projectRoots?(): readonly string[];
  /** an image file scaled down to a card's picture (a JPEG data URL), or null; index.ts uses Electron's nativeImage */
  thumbnail?(file: string): Promise<string | null>;
  /** open a file with the system's app ('' = opened, else why not); index.ts uses Electron's shell.openPath */
  openPath?(file: string): Promise<string>;
  changed(): void;
  now?(): number;
}

interface Stored { v: 1; backfilled: boolean; scannedAt: number | null; dropped: number; copyBytes: number; artifacts: Omit<Artifact, 'chatTitle'>[] }

/** GIF and SVG pictures a card shows as they are (in an <img>, where an SVG runs no script), up to this size. */
const RAW_PICTURE_BYTES = 1_500_000;
const yieldNow = () => new Promise<void>(r => setImmediate(r));

/** The texts of a turn's (or a past chat's) answers that may link artifacts: assistant text and report tools' input. */
export function answerTexts(items: readonly ChatItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === 'assistant' && it.text) out.push(it.text);
    else if (it.kind === 'tool' && /report|show_ui|present|deliver/i.test(it.name)) out.push(...stringsOf(it.input));
  }
  return out;
}

/** The text values inside a tool's input (its report, its links), as written: a JSON dump would escape every newline
 *  and backslash. At most 200, nested at most 6 deep. */
function stringsOf(value: unknown, out: string[] = [], depth = 0): string[] {
  if (out.length >= 200 || depth > 6) return out;
  if (typeof value === 'string') { if (value) out.push(value); }
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out, depth + 1);
  return out;
}

export class LibraryService {
  private readonly file: string;
  private readonly copies: string;
  private readonly thumbs: string;
  private readonly platform: NodeJS.Platform;
  private data: Stored;
  private byKey = new Map<string, Omit<Artifact, 'chatTitle'>>();
  private scanning: Promise<void> | null = null;
  private backfilling: Promise<void> | null = null;
  private thumbCache = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  /** One picture decoded at a time (a gallery scrolled fast asks for many). */
  private pictures: Promise<unknown> = Promise.resolve();
  /** With a full index, the mtime of the oldest kept: an older file is not added (it would go again at once). */
  private floor = -Infinity;

  constructor(private readonly p: LibraryPorts) {
    const dir = path.join(p.userData, 'library');
    this.file = path.join(dir, 'index.json');
    this.copies = path.join(dir, 'versions');
    this.thumbs = path.join(dir, 'thumbs');
    this.platform = p.platform ?? process.platform;
    this.data = this.load();
    for (const a of this.data.artifacts) this.byKey.set(this.keyOf(a.path, a.kind), a);
    this.setFloor();
  }

  private setFloor(): void {
    this.floor = this.data.artifacts.length >= LIBRARY_MAX ? Math.min(...this.data.artifacts.map(a => a.at)) : -Infinity;
  }

  private now(): number { return this.p.now?.() ?? Date.now(); }

  /** A folder as the disk names it (a brain behind a junction or a link, macOS /var → /private/var): the walk and a
   *  chat's links (localFile) give real paths, so every folder they are compared with is real too. */
  private real(dir: string): string { try { return fs.realpathSync.native(dir); } catch { return dir; } }
  private brain(): string | null { const b = this.p.brainRoot(); return b ? this.real(b) : null; }
  private keyOf(p: string, kind: ArtifactKind): string { return versionKey(p, kind, this.platform); }
  private same(a: string, b: string): boolean { return pathKey(a, this.platform) === pathKey(b, this.platform); }

  private load(): Stored {
    const empty: Stored = { v: 1, backfilled: false, scannedAt: null, dropped: 0, copyBytes: 0, artifacts: [] };
    try {
      const raw = readLocal(this.file) as Partial<Stored> | undefined;
      if (!raw || raw.v !== 1 || !Array.isArray(raw.artifacts)) return empty;
      const version = (v: unknown): v is ArtifactVersion => !!v && typeof (v as ArtifactVersion).path === 'string' && typeof (v as ArtifactVersion).at === 'number' && typeof (v as ArtifactVersion).size === 'number'
        && ((v as ArtifactVersion).copy === undefined || typeof (v as ArtifactVersion).copy === 'string');
      const artifacts = raw.artifacts.filter(a => a && typeof a.id === 'string' && typeof a.path === 'string' && typeof a.at === 'number' && Array.isArray(a.versions) && a.versions.length > 0 && a.versions.every(version) && artifactKind(a.path) === a.kind)
        .slice(0, LIBRARY_MAX);
      // the copies' budget is what the kept copies weigh now (one file per text, shared by equal versions)
      const copies = new Map<string, number>();
      for (const a of artifacts) for (const v of a.versions) if (v.copy) copies.set(v.copy, v.size);
      const copyBytes = [...copies.values()].reduce((n, x) => n + x, 0);
      return { ...empty, ...raw, artifacts, copyBytes, dropped: typeof raw.dropped === 'number' ? raw.dropped : 0, backfilled: raw.backfilled === true, scannedAt: typeof raw.scannedAt === 'number' ? raw.scannedAt : null };
    } catch (e) {
      log.warn('library', 'artifact index unreadable: starting a new one', { cause: String(e), hint: 'the old file is kept as it is; a scan rebuilds the index' });
      try { fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`); } catch { /* nothing to keep */ }
      return empty;
    }
  }

  private save(): void {
    // compact: 4000 artifacts with their versions stay well under the local store's size cap
    try { writeLocalText(this.file, JSON.stringify(this.data)); } catch (e) { log.warn('library', 'artifact index not saved', { cause: String(e), hint: 'the next change saves it again' }); }
  }

  /** Runs `fn` after every earlier change (a turn's links while a scan is going): one writer at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The index as it is; `scan` (the tab opening) also starts a look through the folders when the last one is older
   *  than a minute. Without it nothing starts: the viewer's bar and every reload after a change only read. */
  list(o: { scan?: boolean } = {}): ArtifactList {
    const fresh = this.data.scannedAt !== null && this.now() - this.data.scannedAt < STALE_MS;
    if (o.scan && !fresh && !this.scanning) void this.scan();
    return this.view();
  }

  async refresh(): Promise<ArtifactList> { await this.scan(); return this.view(); }

  private view(): ArtifactList {
    const titles = new Map(this.p.chats().map(c => [c.id, c.title] as const));
    const artifacts = [...this.data.artifacts].sort((a, b) => b.at - a.at).map(a => {
      const chatTitle = a.chatId ? titles.get(a.chatId) : undefined;
      return chatTitle ? { ...a, chatTitle } : { ...a };
    });
    return { artifacts, scanning: !!this.scanning || !!this.backfilling, scannedAt: this.data.scannedAt, backfilled: this.data.backfilled, dropped: this.data.dropped };
  }

  // ── where artifacts are looked for ──
  private roots(): WalkRoot[] {
    // the real folders: a brain behind a junction or a link is walked by the same paths a chat's link resolves to
    const brain = this.brain();
    const out: WalkRoot[] = [];
    if (brain) out.push({ dir: path.join(brain, 'reviews'), depth: 5 }, { dir: path.join(brain, 'tmp'), depth: 3 }, { dir: path.join(brain, 'evidence'), depth: 5 });
    out.push({ dir: this.real(path.join(this.p.userData, 'evidence')), depth: 6 });
    return out;
  }

  /** The chat whose evidence folder holds `file` (<userData>/evidence/chat-<id>/…). */
  private evidenceChat(file: string): string | undefined {
    const ev = this.real(path.join(this.p.userData, 'evidence'));
    if (!isInside(file, ev, this.platform)) return undefined;
    const first = path.relative(ev, file).split(/[\\/]/)[0] ?? '';
    return first.match(/^chat-(.+)$/)?.[1] || undefined;
  }

  /** Inside the brain, only its work folders hold artifacts (journal, memory, skills… are shown in their own tabs). */
  private allowed(file: string): boolean {
    const brain = this.brain();
    if (!brain || !isInside(file, brain, this.platform)) return true;
    const segs = path.relative(brain, file).split(/[\\/]/);
    return segs.length > 1 && !BRAIN_OWN.test(segs[0] ?? '');
  }

  /** The project or area of a file: its chat's app or repo, the brain's projects/<x>, the project folder it is in, its
   *  chat's folder, «Brain». */
  areaOf(file: string, chatId?: string): string {
    const chats = this.p.chats();
    const chat = chatId ? chats.find(c => c.id === chatId) : undefined;
    const tags = chat?.run?.tags;
    if (tags?.app) return tags.app;
    if (tags?.repo) return tags.repo;
    const brain = this.brain();
    const inBrain = (p: string) => !!brain && isInside(p, brain, this.platform);
    if (inBrain(file)) {
      const segs = path.relative(brain!, file).split(/[\\/]/);
      if (segs[0]?.toLowerCase() === 'projects' && segs.length > 2) return segs[1]!;
    }
    const projects = [...(this.p.projectRoots?.() ?? []), ...chats.filter(c => !c.isOrchestrator).map(c => c.cwd)]
      .filter(r => r && path.isAbsolute(r)).map(r => this.real(r))
      .filter(r => !inBrain(r) && isInside(file, r, this.platform))
      .sort((a, b) => b.length - a.length);
    if (projects[0]) return baseNameOf(projects[0]);
    // a report a chat wrote in the brain (reviews/, tmp/) is about that chat's project
    if (chat?.cwd && !inBrain(chat.cwd)) return baseNameOf(chat.cwd);
    return inBrain(file) || chat ? 'Brain' : baseNameOf(path.dirname(file));
  }

  // ── adding and updating ──
  /** A copy of a text version: always for a report (HTML, Markdown), for a table or a text file only when a chat linked
   *  it (a scratch file in tmp/ would spend the budget); never for a text that holds a credential. */
  private async copyOf(file: string, size: number, kind: ArtifactKind, chat: string | undefined): Promise<string | undefined> {
    if (kind !== 'html' && kind !== 'markdown' && !chat) return undefined;
    if (!readsText(file) || size > COPY_BYTES || this.data.copyBytes + size > COPY_TOTAL) return undefined;
    try {
      const body = await fs.promises.readFile(file);
      if (body.length > COPY_BYTES || secretHead(body.toString('utf8', 0, 64 * 1024))) return undefined;
      const sha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
      // the copy keeps the original's extension so the viewer renders it the same way
      const named = path.join(this.copies, `${sha}.${extOf(file)}`);
      await fs.promises.mkdir(this.copies, { recursive: true });
      try { await fs.promises.writeFile(named, body, { flag: 'wx', mode: 0o600 }); this.data.copyBytes += body.length; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      return named;
    } catch (e) { log.warn('library', 'version copy not kept', { cause: String(e), hint: 'the artifact is indexed; only this version cannot be reopened once the file changes' }); return undefined; }
  }

  /** One file seen (by a scan or a chat's link): a new artifact, a new version of one, or nothing new. True = changed. */
  private async upsert(f: Found, chatId: string | undefined, origin: Artifact['origin']): Promise<boolean> {
    if (!this.allowed(f.path)) return false;
    const key = this.keyOf(f.path, f.kind);
    const chat = chatId ?? this.evidenceChat(f.path);
    const known = this.byKey.get(key);
    const at = Math.round(f.mtimeMs);
    if (known) {
      const same = known.versions.find(v => this.same(v.path, f.path) && !v.missing);
      if (same && same.at === at && same.size === f.size) {
        // seen again: a chat that links it now becomes its producer when none was known
        let changed = false;
        if (chat && !same.chatId) {
          same.chatId = chat; changed = true;
          // a chat's output now: its text is worth a copy even when the scan found it first
          if (!same.copy) { const copy = await this.copyOf(f.path, f.size, f.kind, chat); if (copy) same.copy = copy; }
        }
        if (chat && !known.chatId) { known.chatId = chat; known.origin = 'chat'; changed = true; }
        if (changed) known.area = this.areaOf(known.path, known.chatId);
        return changed;
      }
      // the same file rewritten: its older text stays as a past version when a copy of it was kept
      if (same) { if (same.copy) same.missing = true; else known.versions.splice(known.versions.indexOf(same), 1); }
      const copy = await this.copyOf(f.path, f.size, f.kind, chat);
      known.versions.push({ path: f.path, at, size: f.size, ...(chat ? { chatId: chat } : {}), ...(copy ? { copy } : {}) });
      known.versions.sort((a, b) => b.at - a.at);
      await this.release(known.versions.splice(VERSIONS_MAX));
      await this.describe(known, chat);
      return true;
    }
    // a full index takes no file older than the oldest it keeps (it would be dropped again at every scan)
    if (this.data.artifacts.length >= LIBRARY_MAX && at <= this.floor) return false;
    const copy = await this.copyOf(f.path, f.size, f.kind, chat);
    const a: Omit<Artifact, 'chatTitle'> = {
      id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 16), title: '', kind: f.kind, area: '', summary: '',
      origin: chat ? 'chat' : origin, path: f.path, at, size: f.size, missing: false,
      versions: [{ path: f.path, at, size: f.size, ...(chat ? { chatId: chat } : {}), ...(copy ? { copy } : {}) }],
      ...(chat ? { chatId: chat } : {}),
    };
    this.byKey.set(key, a);
    this.data.artifacts.push(a);
    await this.describe(a, chat);
    await this.trim();
    return true;
  }

  /** Title, summary, area and the newest version's fields, from the newest version's head. */
  private async describe(a: Omit<Artifact, 'chatTitle'>, chat?: string): Promise<void> {
    const newest = a.versions.find(v => !v.missing) ?? a.versions[0]!;
    a.path = newest.path; a.at = newest.at; a.size = newest.size; a.missing = !!newest.missing;
    if (newest.chatId ?? chat) a.chatId = newest.chatId ?? chat;
    const text = readsText(newest.path) ? await head(newest.path) : '';
    a.title = titleOf(a.kind, text, newest.path);
    a.summary = secretHead(text) ? '' : summaryOf(a.kind, text, newest.path);
    a.area = this.areaOf(newest.path, a.chatId);
  }

  /** Over LIBRARY_MAX: the oldest go (counted as dropped), with their kept copies. */
  private async trim(): Promise<void> {
    if (this.data.artifacts.length <= LIBRARY_MAX) { this.setFloor(); return; }
    this.data.artifacts.sort((x, y) => y.at - x.at);
    const gone = this.data.artifacts.splice(LIBRARY_MAX);
    for (const a of gone) this.byKey.delete(this.keyOf(a.path, a.kind));
    this.data.dropped += gone.length;
    this.setFloor();
    await this.release(gone.flatMap(a => a.versions));
  }

  /** Deletes the kept copies of versions no longer in the index (unless another version shares the same text). */
  private async release(versions: readonly ArtifactVersion[]): Promise<void> {
    const copies = versions.filter(v => v.copy);
    if (!copies.length) return;
    const used = new Set<string>();
    for (const a of this.data.artifacts) for (const v of a.versions) if (v.copy) used.add(v.copy);
    for (const v of copies) {
      if (used.has(v.copy!) || !isInside(v.copy!, this.copies, this.platform)) continue;
      used.add(v.copy!);
      try { await fs.promises.unlink(v.copy!); this.data.copyBytes = Math.max(0, this.data.copyBytes - v.size); } catch { /* already gone */ }
    }
  }

  /** Every known version checked again: a file that went is marked missing (never removed), one back is unmarked, one
   *  rewritten since (a chat's file outside the scanned folders) becomes a new version. */
  private async check(): Promise<boolean> {
    let changed = false, n = 0;
    for (const a of [...this.data.artifacts]) {
      for (const v of [...a.versions]) {
        if (++n % 200 === 0) await yieldNow();
        // a past version of a rewritten file stays missing: its text is the copy
        if (a.versions.some(o => o !== v && o.at > v.at && this.same(o.path, v.path))) continue;
        let st: fs.Stats | null = null;
        try { st = await fs.promises.stat(v.path); } catch { /* gone */ }
        const gone = !st?.isFile();
        if (!gone && st && (Math.round(st.mtimeMs) !== v.at || st.size !== v.size) && !v.missing) {
          if (await this.upsert({ path: v.path, kind: a.kind, mtimeMs: st.mtimeMs, size: st.size }, undefined, a.origin)) changed = true;
          continue;
        }
        if (gone !== !!v.missing) { if (gone) v.missing = true; else delete v.missing; changed = true; }
      }
      const newest = a.versions.find(v => !v.missing) ?? a.versions[0]!;
      const missing = !a.versions.some(v => !v.missing);
      if (a.missing !== missing || a.path !== newest.path) { a.missing = missing; a.path = newest.path; a.at = newest.at; a.size = newest.size; changed = true; }
    }
    return changed;
  }

  /** Looks through the folders (and checks every known file); the one-time backfill follows the first scan. */
  scan(): Promise<void> {
    if (this.scanning) return this.scanning;
    const run = this.serial(async () => {
      let changed = false;
      const found = await walk(this.roots());
      for (let i = 0; i < found.length; i++) {
        if (i % 100 === 99) await yieldNow();
        if (await this.upsert(found[i]!, undefined, 'scan')) changed = true;
      }
      if (await this.check()) changed = true;
      this.save();
      if (changed) this.p.changed();
    });
    // a failed scan counts as done too: the next one waits a minute like after a good one
    this.scanning = run.catch(e => log.warn('library', 'artifact scan failed', { cause: String(e), hint: 'the index stays as it was; «Aggiorna» tries again' }))
      .finally(() => { this.data.scannedAt = this.now(); this.scanning = null; this.p.changed(); });
    void this.scanning.then(() => { if (!this.data.backfilled) void this.backfill(); });
    return this.scanning;
  }

  /** The artifact files `texts` link, resolved against the chat's folder and the brain; each one indexed for the chat. */
  /** `since`: a relative link outside the brain counts only for a file written from then on (a coding chat names
   *  index.html, docs/*.md and fixtures all the time: those are the project's files, not its outputs); without it
   *  (the backfill, the demo) only relative links into the brain count. */
  private async linked(chatId: string, texts: readonly string[], since?: number): Promise<boolean> {
    const chat = this.p.chats().find(c => c.id === chatId);
    const brain = this.brain();
    const bases = [chat?.cwd, brain].filter((d): d is string => !!d && path.isAbsolute(d));
    let changed = false;
    const done = new Set<string>();
    for (const text of texts) {
      const { absolute, relative } = linkedPaths(text);
      const tries: [string, string | undefined][] = [...absolute.map(a => [a, undefined] as [string, undefined]), ...relative.flatMap(r => bases.map(b => [r, b] as [string, string]))];
      for (const [raw, base] of tries) {
        if (done.has(raw)) continue;
        const local = localFile(raw, base);
        if ('kind' in local) continue;
        const kind = artifactKind(local.real);
        if (!kind || local.stats.size === 0) continue;
        if (base && !(brain && isInside(local.real, brain, this.platform)) && (since === undefined || local.stats.mtimeMs < since)) continue;
        done.add(raw);
        if (await this.upsert({ path: local.real, kind, mtimeMs: local.stats.mtimeMs, size: local.stats.size }, chatId, 'chat')) changed = true;
      }
    }
    return changed;
  }

  /** Texts a chat wrote (the demo's seeded links, a test): their artifact links indexed for that chat. */
  linkFromChat(chatId: string, texts: readonly string[]): Promise<void> {
    return this.serial(async () => { if (await this.linked(chatId, texts)) { this.save(); this.p.changed(); } });
  }

  /** A chat's turn ended: what its answer and report link is indexed now (a new report shows up with no step of the user). */
  noteTurn(chatId: string, items: readonly ChatItem[]): Promise<void> {
    // only this turn's part: from the last message of the user on
    let from = items.length;
    while (from > 0 && items[from - 1]!.kind !== 'user') from--;
    const texts = answerTexts(items.slice(from));
    if (!texts.length) return Promise.resolve();
    // files this turn wrote: from a minute before the user's message on (a clock a little off still counts)
    const asked = items[from - 1]?.at;
    const since = typeof asked === 'number' && asked > 0 ? asked - 60_000 : undefined;
    return this.serial(async () => {
      if (await this.linked(chatId, texts, since)) { this.save(); this.p.changed(); }
    }).catch(e => log.warn('library', 'turn links not indexed', { cause: String(e), hint: 'the next scan or turn tries again' }));
  }

  /** Once: what the past chats linked (newest first, at most 400 chats), so today's existing reports are all there. */
  backfill(): Promise<void> {
    if (this.data.backfilled) return Promise.resolve();
    if (this.backfilling) return this.backfilling;
    const run = this.serial(async () => {
      const chats = [...this.p.chats()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 400);
      let changed = false;
      for (const c of chats) {
        await yieldNow();
        let items: readonly ChatItem[] = [];
        try { items = this.p.history(c.id); } catch { continue; }
        if (await this.linked(c.id, answerTexts(items))) changed = true;
      }
      this.data.backfilled = true;
      this.save();
      if (changed) this.p.changed();
      log.info('library', 'past chats looked through', { data: { chats: chats.length, artifacts: this.data.artifacts.length } });
    });
    this.backfilling = run.catch(e => log.warn('library', 'past chats not looked through', { cause: String(e), hint: 'tried again at the next start' })).finally(() => { this.backfilling = null; this.p.changed(); });
    return this.backfilling;
  }

  // ── a card's picture ──
  async thumb(id: string): Promise<ArtifactThumb | null> {
    const a = this.data.artifacts.find(x => x.id === id);
    if (!a) return null;
    // a gone file: its kept copy (text kinds only), never the gone path
    const file = a.missing ? a.versions.find(v => v.copy)?.copy : a.path;
    if (!file) return null;
    if (a.kind === 'html') { const text = await head(file, 160 * 1024); return secretHead(text) ? null : { kind: 'html', text, path: file }; }
    // a Markdown card is drawn from its title and summary; a text holding a credential shows none of it
    if (a.kind !== 'markdown' && readsText(a.path)) { const text = await head(file, 6 * 1024); return text.trim() && !secretHead(text) ? { kind: 'text', text } : null; }
    if (a.kind !== 'image' || a.missing) return null;
    const ext = extOf(a.path);
    if (ext === 'gif' || ext === 'svg') return this.rawPicture(a.path, ext);
    if (!this.p.thumbnail) return null;
    const name = crypto.createHash('sha1').update(`${pathKey(a.path, this.platform)}|${a.at}|${a.size}`).digest('hex').slice(0, 24);
    const hit = this.thumbCache.get(name);
    if (hit) return { kind: 'image', dataUrl: hit };
    const cached = path.join(this.thumbs, `${name}.jpg`);
    let dataUrl: string | null = null;
    try { dataUrl = `data:image/jpeg;base64,${(await fs.promises.readFile(cached)).toString('base64')}`; } catch {
      const make = this.p.thumbnail;
      const next = this.pictures.then(() => make(a.path)).catch(() => null);
      this.pictures = next;
      dataUrl = await next;
      if (dataUrl?.startsWith('data:image/jpeg;base64,')) {
        try { await fs.promises.mkdir(this.thumbs, { recursive: true }); await fs.promises.writeFile(cached, Buffer.from(dataUrl.slice(23), 'base64')); } catch { /* shown, not kept */ }
      }
    }
    if (!dataUrl) return null;
    if (this.thumbCache.size > 300) this.thumbCache.delete(this.thumbCache.keys().next().value!);
    this.thumbCache.set(name, dataUrl);
    return { kind: 'image', dataUrl };
  }

  /** A small GIF or SVG as it is, when it is what its name says (GIF header; an <svg> element near the top). */
  private async rawPicture(file: string, ext: 'gif' | 'svg'): Promise<ArtifactThumb | null> {
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile() || st.size > RAW_PICTURE_BYTES) return null;
      const body = await fs.promises.readFile(file);
      const ok = ext === 'gif' ? /^GIF8[79]a/.test(body.toString('latin1', 0, 6)) : /<svg[\s>]/i.test(body.toString('utf8', 0, 4096));
      return ok ? { kind: 'image', dataUrl: `data:image/${ext === 'svg' ? 'svg+xml' : 'gif'};base64,${body.toString('base64')}` } : null;
    } catch { return null; }
  }

  // ── opening with the system's app ──
  /** Opens an artifact's file (or, when it went, the copy kept of that version) with the system's app. Only a file the
   *  index holds: the viewer's bar asks with the path it shows. */
  async open(file: string): Promise<{ ok: boolean; error?: string }> {
    let hit = artifactOfPath(this.data.artifacts as Artifact[], file, this.platform);
    if (!hit) {
      // the path as the disk names it; a gone file by its real folder
      let real = this.real(file);
      if (real === file) real = path.join(this.real(path.dirname(file)), path.basename(file));
      if (real !== file) { hit = artifactOfPath(this.data.artifacts as Artifact[], real, this.platform); file = real; }
    }
    if (!hit || !this.p.openPath) return { ok: false, error: 'not an artifact' };
    const v = hit.artifact.versions[hit.version]!;
    const target = pathKey(file, this.platform) === pathKey(v.path, this.platform) && !v.missing ? v.path : v.copy;
    if (!target || !artifactKind(target)) return { ok: false, error: 'missing' };
    const error = await this.p.openPath(target).catch(e => String(e));
    return error ? { ok: false, error } : { ok: true };
  }
}

export type { ArtifactVersion };
