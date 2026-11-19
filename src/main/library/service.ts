// Memoria → Artifact (ADR 0328): the reports, documents, plans and analyses an agent made because the user asked for
// one. An artifact enters in ONE way: the agent that wrote the file declares it (artifact_save, library/tools.ts →
// `save`). Nothing is looked for in folders, in a chat's answers or in past chats any more (ADR 0319 did, and filled
// the list with screenshots and scratch files: the owner 2026-11-19, «quantità industriale di file inutili»). The file
// stays where the agent wrote it; a copy of each version (up to COPY_BYTES) is kept in <userData>/library/versions, so
// a report rewritten or deleted since still opens as it was. Files with the same version key (shared/library.ts
// versionKey) are one artifact with its history. A file that went is kept and shown as missing until the user removes
// the card (`remove`: the index only, never a file of the user's). The index is <userData>/library/index.json
// (local-store.ts writes: atomic, bounded); an index of ADR 0319 is read once and only what a chat reported as a
// document is kept (`migrate`). Used by index.ts, library/tools.ts and ipc-handlers/library.ts; pinned by
// test/unit/library-service.test.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatSummary } from '../../shared/contract';
import { ARTIFACT_FORMATS, LIBRARY_MAX, artifactKind, artifactOfPath, baseNameOf, extOf, pathKey, readsText, secretHead, summaryOf, titleOf, versionKey, type Artifact, type ArtifactKind, type ArtifactList, type ArtifactThumb, type ArtifactVersion } from '../../shared/library';
import { readLocal, writeLocalText } from '../agents/local-store';
import { isInside } from '../ask-image';
import { localFile } from '../file-view';
import { log } from '../log';

/** A version is copied when it is at most this big (an HTML report with its screenshots inside stays whole). */
export const COPY_BYTES = 8_000_000;
/** All copies together stay under this: past it new versions are indexed without a copy. */
export const COPY_TOTAL = 400_000_000;
const VERSIONS_MAX = 30;
/** A GIF a card shows as it is (nativeImage would keep its first frame only), up to this size. */
const GIF_BYTES = 1_500_000;
/** An HTML card is drawn from this much of the report's head (enough for its title and first lines). */
const HTML_THUMB_BYTES = 64 * 1024;
const TITLE_MAX = 140, SUMMARY_MAX = 220;
const yieldNow = () => new Promise<void>(r => setImmediate(r));
const realNow = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return p; } };
const oneLine = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export type LibraryChat = Pick<ChatSummary, 'id' | 'title' | 'cwd' | 'isOrchestrator'> & { run?: { tags?: { app: string | null; repo: string | null } | undefined } | undefined };

export interface LibraryPorts {
  userData: string;
  platform?: NodeJS.Platform;
  brainRoot(): string | null;
  chats(): readonly LibraryChat[];
  /** the project maps' folders (an artifact there belongs to that project) */
  projectRoots?(): readonly string[];
  /** an image file scaled down to a card's picture (a JPEG data URL), or null; index.ts uses Electron's nativeImage */
  thumbnail?(file: string): Promise<string | null>;
  /** open a file with the system's app ('' = opened, else why not); index.ts uses Electron's shell.openPath */
  openPath?(file: string): Promise<string>;
  changed(): void;
}

/** What the agent said of its artifact (kept across versions: a rewritten file keeps its given title). */
type StoredArtifact = Omit<Artifact, 'chatTitle'> & { given?: { title?: string; summary?: string } };
interface Stored { v: 2; copyBytes: number; artifacts: StoredArtifact[] }
/** An artifact of ADR 0319's index, as far as `migrate` reads it. */
type OldArtifact = StoredArtifact & { origin?: string; pinned?: boolean };

export interface SaveInput { path: string; title?: string; summary?: string }
export interface SaveResult { artifact: Artifact; versions: number; created: boolean }

/** The first `bytes` of a file as UTF-8 (the head a title and a summary come from); '' when unreadable. */
export async function head(file: string, bytes = 64 * 1024): Promise<string> {
  let fd: fs.promises.FileHandle | undefined;
  try {
    fd = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch { return ''; } finally { await fd?.close().catch(() => undefined); }
}

/** What an index of ADR 0319 keeps under ADR 0328: what the user starred, and the documents a chat reported (an HTML
 *  report, a PDF, an Office file). Screenshots, scratch tables, notes and everything a folder scan found go (the files
 *  stay on disk). */
export function migrate(old: readonly OldArtifact[]): StoredArtifact[] {
  return old.filter(a => artifactKind(a.path) === a.kind && (a.pinned === true || (a.origin === 'chat' && (a.kind === 'html' || a.kind === 'pdf' || /\.(docx|xlsx|pptx)$/i.test(a.path)))))
    .map(({ origin: _origin, pinned: _pinned, ...a }) => a);
}

export class LibraryService {
  private readonly file: string;
  private readonly copies: string;
  private readonly thumbs: string;
  private readonly platform: NodeJS.Platform;
  private data: Stored;
  private byKey = new Map<string, StoredArtifact>();
  private checking: Promise<void> | null = null;
  /** copies and card pictures no artifact uses any more are deleted once, after an old index was migrated */
  private sweepDue = false;
  private thumbCache = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  /** One picture decoded at a time (a list scrolled fast asks for many). */
  private pictures: Promise<unknown> = Promise.resolve();
  /** Folders' real paths, asked again at each check (a file's area compares it with every chat's folder). */
  private reals = new Map<string, string>();

  constructor(private readonly p: LibraryPorts) {
    const dir = path.join(p.userData, 'library');
    this.file = path.join(dir, 'index.json');
    this.copies = path.join(dir, 'versions');
    this.thumbs = path.join(dir, 'thumbs');
    this.platform = p.platform ?? process.platform;
    this.data = this.load();
    for (const a of this.data.artifacts) this.byKey.set(this.keyOf(a.path, a.kind), a);
    if (this.sweepDue) this.persist();
  }

  /** A folder as the disk names it (a brain behind a junction or a link, macOS /var → /private/var): a saved path is
   *  real (localFile), so every folder it is compared with is real too. */
  private real(dir: string): string {
    const hit = this.reals.get(dir);
    if (hit !== undefined) return hit;
    const out = realNow(dir);
    if (this.reals.size > 2000) this.reals.clear();
    this.reals.set(dir, out);
    return out;
  }
  private brain(): string | null { const b = this.p.brainRoot(); return b ? this.real(b) : null; }
  private keyOf(p: string, kind: ArtifactKind): string { return versionKey(p, kind, this.platform); }
  private same(a: string, b: string): boolean { return pathKey(a, this.platform) === pathKey(b, this.platform); }

  private load(): Stored {
    const empty: Stored = { v: 2, copyBytes: 0, artifacts: [] };
    try {
      const raw = readLocal(this.file) as { v?: number; artifacts?: OldArtifact[] } | undefined;
      if (!raw || (raw.v !== 1 && raw.v !== 2) || !Array.isArray(raw.artifacts)) return empty;
      const version = (v: unknown): v is ArtifactVersion => !!v && typeof (v as ArtifactVersion).path === 'string' && typeof (v as ArtifactVersion).at === 'number' && typeof (v as ArtifactVersion).size === 'number'
        && ((v as ArtifactVersion).copy === undefined || typeof (v as ArtifactVersion).copy === 'string');
      const valid = raw.artifacts.filter(a => a && typeof a.id === 'string' && typeof a.path === 'string' && typeof a.at === 'number' && Array.isArray(a.versions) && a.versions.length > 0 && a.versions.every(version) && artifactKind(a.path) === a.kind);
      const artifacts = (raw.v === 1 ? migrate(valid) : valid).slice(0, LIBRARY_MAX);
      if (raw.v === 1) {
        this.sweepDue = true;
        log.info('library', 'artifact index of ADR 0319 migrated', { data: { before: raw.artifacts.length, kept: artifacts.length } });
      }
      // the copies' budget is what the kept copies weigh now (one file per content, shared by equal versions)
      const copies = new Map<string, number>();
      for (const a of artifacts) for (const v of a.versions) if (v.copy) copies.set(v.copy, v.size);
      return { v: 2, artifacts, copyBytes: [...copies.values()].reduce((n, x) => n + x, 0) };
    } catch (e) {
      log.warn('library', 'artifact index unreadable: starting a new one', { cause: String(e), hint: 'the old file is kept as it is; agents add artifacts again as they make them' });
      try { fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`); } catch { /* nothing to keep */ }
      return empty;
    }
  }

  private persist(): void {
    try { writeLocalText(this.file, JSON.stringify(this.data)); } catch (e) { log.warn('library', 'artifact index not saved', { cause: String(e), hint: 'the next change saves it again' }); }
  }

  /** Runs `fn` after every earlier change (a save while a check is going): one writer at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The index as it is; `check` (the tab opening) also looks at every known file again: gone, back, rewritten. */
  list(o: { check?: boolean } = {}): ArtifactList {
    if (o.check && !this.checking) void this.refresh();
    return this.view();
  }

  /** Every known file looked at again (and, once after a migration, the copies nobody uses deleted). */
  refresh(): Promise<void> {
    if (this.checking) return this.checking;
    this.reals.clear();
    const run = this.serial(async () => {
      const changed = await this.check();
      if (this.sweepDue) { this.sweepDue = false; await this.sweep(); }
      if (changed) { this.persist(); this.p.changed(); }
    });
    this.checking = run.catch(e => log.warn('library', 'artifacts not checked', { cause: String(e), hint: 'the list stays as it was; opening the tab again tries again' })).finally(() => { this.checking = null; });
    return this.checking;
  }

  private shown(a: StoredArtifact, titles: ReadonlyMap<string, string>): Artifact {
    const { given: _given, ...rest } = a;
    const chatTitle = a.chatId ? titles.get(a.chatId) : undefined;
    return chatTitle ? { ...rest, chatTitle } : rest;
  }

  private view(): ArtifactList {
    const titles = new Map(this.p.chats().map(c => [c.id, c.title] as const));
    return { artifacts: [...this.data.artifacts].sort((a, b) => b.at - a.at).map(a => this.shown(a, titles)) };
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
    // a report a chat wrote in the brain is about that chat's project
    if (chat?.cwd && !chat.isOrchestrator && !inBrain(chat.cwd)) return baseNameOf(chat.cwd);
    return inBrain(file) || chat ? 'Brain' : baseNameOf(path.dirname(file));
  }

  // ── adding and updating ──
  /** A copy of a version, so it opens as it was once its file changes or goes. */
  private async copyOf(file: string, size: number): Promise<string | undefined> {
    if (size > COPY_BYTES || this.data.copyBytes + size > COPY_TOTAL) return undefined;
    try {
      const body = await fs.promises.readFile(file);
      if (body.length > COPY_BYTES) return undefined;
      const sha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
      // the copy keeps the original's extension so the viewer renders it the same way
      const named = path.join(this.copies, `${sha}.${extOf(file)}`);
      await fs.promises.mkdir(this.copies, { recursive: true });
      try { await fs.promises.writeFile(named, body, { flag: 'wx', mode: 0o600 }); this.data.copyBytes += body.length; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      return named;
    } catch (e) { log.warn('library', 'version copy not kept', { cause: String(e), hint: 'the artifact is indexed; only this version cannot be reopened once the file changes' }); return undefined; }
  }

  /** One file declared (or seen changed by a check): a new artifact, a new version of one, or nothing new. */
  private async upsert(f: { path: string; kind: ArtifactKind; mtimeMs: number; size: number }, chat: string | undefined, given?: StoredArtifact['given']): Promise<{ a: StoredArtifact; changed: boolean; created: boolean }> {
    const key = this.keyOf(f.path, f.kind);
    const known = this.byKey.get(key);
    const at = Math.round(f.mtimeMs);
    const say = (a: StoredArtifact): boolean => {
      if (!given?.title && !given?.summary) return false;
      const next = { ...a.given, ...given };
      if (next.title === a.given?.title && next.summary === a.given?.summary) return false;
      a.given = next;
      return true;
    };
    if (known) {
      const same = known.versions.find(v => this.same(v.path, f.path) && !v.missing);
      if (same && same.at === at && same.size === f.size) {
        // saved again as it is: only what the agent says of it, or who made it, may be new
        let changed = say(known);
        if (chat && same.chatId !== chat) { same.chatId = chat; changed = true; }
        if (changed) await this.describe(known, chat);
        return { a: known, changed, created: false };
      }
      // the same file rewritten: its older content stays as a past version when a copy of it was kept
      if (same) { if (same.copy) same.missing = true; else known.versions.splice(known.versions.indexOf(same), 1); }
      const copy = await this.copyOf(f.path, f.size);
      known.versions.push({ path: f.path, at, size: f.size, ...(chat ? { chatId: chat } : {}), ...(copy ? { copy } : {}) });
      known.versions.sort((a, b) => b.at - a.at);
      await this.release(known.versions.splice(VERSIONS_MAX));
      say(known);
      await this.describe(known, chat);
      return { a: known, changed: true, created: false };
    }
    const copy = await this.copyOf(f.path, f.size);
    const a: StoredArtifact = {
      id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 16), title: '', kind: f.kind, area: '', summary: '',
      path: f.path, at, size: f.size, missing: false,
      versions: [{ path: f.path, at, size: f.size, ...(chat ? { chatId: chat } : {}), ...(copy ? { copy } : {}) }],
      ...(chat ? { chatId: chat } : {}),
    };
    say(a);
    this.byKey.set(key, a);
    this.data.artifacts.push(a);
    await this.describe(a, chat);
    await this.trim();
    return { a, changed: true, created: true };
  }

  /** Title, summary, area and the newest version's fields: what the agent said, else from the newest version's head. */
  private async describe(a: StoredArtifact, chat?: string): Promise<void> {
    const newest = a.versions.find(v => !v.missing) ?? a.versions[0]!;
    a.path = newest.path; a.at = newest.at; a.size = newest.size; a.missing = !!newest.missing;
    if (newest.chatId ?? chat) a.chatId = newest.chatId ?? chat;
    const text = !a.missing && readsText(newest.path) ? await head(newest.path) : '';
    a.title = a.given?.title || titleOf(a.kind, text, newest.path);
    a.summary = a.given?.summary || (secretHead(text) ? '' : summaryOf(a.kind, text, newest.path));
    a.area = this.areaOf(newest.path, a.chatId);
  }

  /** Over LIBRARY_MAX: the oldest go, with their kept copies (their files stay where they are). */
  private async trim(): Promise<void> {
    if (this.data.artifacts.length <= LIBRARY_MAX) return;
    this.data.artifacts.sort((x, y) => y.at - x.at);
    const gone = this.data.artifacts.splice(LIBRARY_MAX);
    for (const a of gone) this.byKey.delete(this.keyOf(a.path, a.kind));
    log.info('library', 'oldest artifacts left the index', { data: { gone: gone.length, max: LIBRARY_MAX } });
    await this.release(gone.flatMap(a => a.versions));
  }

  /** Deletes the kept copies of versions no longer in the index (unless another version shares the same content). */
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

  /** After a migration: the copies no kept artifact uses and every old card picture are deleted (the app's own files
   *  in <userData>/library, never a file of the user's). */
  private async sweep(): Promise<void> {
    const used = new Set<string>();
    for (const a of this.data.artifacts) for (const v of a.versions) if (v.copy) used.add(pathKey(v.copy, this.platform));
    let deleted = 0;
    try {
      for (const name of await fs.promises.readdir(this.copies)) {
        const file = path.join(this.copies, name);
        if (used.has(pathKey(file, this.platform))) continue;
        try { if ((await fs.promises.lstat(file)).isFile()) { await fs.promises.unlink(file); deleted++; } } catch { /* already gone */ }
      }
    } catch { /* no copies folder */ }
    try { await fs.promises.rm(this.thumbs, { recursive: true, force: true }); this.thumbCache.clear(); } catch { /* made again when asked */ }
    if (deleted) log.info('library', 'copies of artifacts no longer listed deleted', { data: { deleted } });
  }

  /** Every known version checked again: a file that went is marked missing (never removed), one back is unmarked, one
   *  rewritten since becomes a new version. */
  private async check(): Promise<boolean> {
    let changed = false, n = 0;
    for (const a of [...this.data.artifacts]) {
      for (const v of [...a.versions]) {
        if (++n % 200 === 0) await yieldNow();
        // a past version of a rewritten file stays missing: its content is the copy
        if (a.versions.some(o => o !== v && o.at > v.at && this.same(o.path, v.path))) continue;
        let st: fs.Stats | null = null;
        try { st = await fs.promises.stat(v.path); } catch { /* gone */ }
        const gone = !st?.isFile();
        if (!gone && st && (Math.round(st.mtimeMs) !== v.at || st.size !== v.size) && !v.missing) {
          if (st.size > 0 && (await this.upsert({ path: v.path, kind: a.kind, mtimeMs: st.mtimeMs, size: st.size }, v.chatId)).changed) changed = true;
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

  /**
   * An agent declares the file it wrote because the user asked for a report, a document, a plan (artifact_save). The
   * path is resolved in the chat's folder, then in the brain; it must be a file of a format the viewer opens, not
   * empty, without a credential in its head. Throws with a text the agent can act on.
   */
  save(chatId: string | undefined, input: SaveInput): Promise<SaveResult> {
    return this.serial(async () => {
      const raw = typeof input?.path === 'string' ? input.path.trim() : '';
      if (!raw) throw new Error('path: required, the file you wrote (absolute, or relative to your folder)');
      if (!artifactKind(raw)) throw new Error(`path: an artifact is one of ${ARTIFACT_FORMATS} (the formats the app opens); write the report as HTML or Markdown unless the user asked for another format`);
      const chat = chatId ? this.p.chats().find(c => c.id === chatId) : undefined;
      const brain = this.brain();
      const bases = [chat?.cwd, brain].filter((d): d is string => !!d && path.isAbsolute(d));
      let local: ReturnType<typeof localFile> | null = null;
      for (const base of bases.length ? bases : [undefined]) { local = localFile(raw, base); if (!('kind' in local)) break; }
      if (!local || 'kind' in local) throw new Error(`path: no file at ${raw}; write the file first, then pass its absolute path`);
      const kind = artifactKind(local.real);
      if (!kind) throw new Error(`path: an artifact is one of ${ARTIFACT_FORMATS}`);
      if (local.stats.size === 0) throw new Error('path: the file is empty');
      if (readsText(local.real) && secretHead(await head(local.real))) throw new Error('path: the file holds a credential (a token, a password, a key): never an artifact');
      const title = oneLine(input.title, TITLE_MAX), summary = oneLine(input.summary, SUMMARY_MAX);
      const { a, changed, created } = await this.upsert({ path: local.real, kind, mtimeMs: local.stats.mtimeMs, size: local.stats.size }, chatId, { ...(title ? { title } : {}), ...(summary ? { summary } : {}) });
      if (changed) { this.persist(); this.p.changed(); }
      const titles = new Map(this.p.chats().map(c => [c.id, c.title] as const));
      return { artifact: this.shown(a, titles), versions: a.versions.length, created };
    });
  }

  /** The user takes a card off the list: the index entry and the app's copies go, the file stays where it is. */
  remove(id: string): Promise<ArtifactList> {
    return this.serial(async () => {
      const i = this.data.artifacts.findIndex(x => x.id === id);
      if (i >= 0) {
        const [a] = this.data.artifacts.splice(i, 1);
        for (const [k, v] of this.byKey) if (v === a) this.byKey.delete(k);
        await this.release(a!.versions);
        this.persist();
        this.p.changed();
      }
      return this.view();
    });
  }

  // ── a card's picture ──
  async thumb(id: string): Promise<ArtifactThumb | null> {
    const a = this.data.artifacts.find(x => x.id === id);
    if (!a) return null;
    // a gone file: its kept copy, never the gone path
    const file = a.missing ? a.versions.find(v => v.copy)?.copy : a.path;
    if (!file) return null;
    if (a.kind === 'html') { const text = await head(file, HTML_THUMB_BYTES); return secretHead(text) ? null : { kind: 'html', text, path: file }; }
    if (extOf(a.path) === 'gif') return this.gif(file);
    // a Markdown card is drawn from its title and summary; a text holding a credential shows none of it
    if (a.kind !== 'markdown' && readsText(a.path)) { const text = await head(file, 6 * 1024); return text.trim() && !secretHead(text) ? { kind: 'text', text } : null; }
    if (a.kind !== 'image' || !this.p.thumbnail) return null;
    const name = crypto.createHash('sha1').update(`${pathKey(file, this.platform)}|${a.at}|${a.size}`).digest('hex').slice(0, 24);
    const hit = this.thumbCache.get(name);
    if (hit) return { kind: 'image', dataUrl: hit };
    const cached = path.join(this.thumbs, `${name}.jpg`);
    let dataUrl: string | null = null;
    try { dataUrl = `data:image/jpeg;base64,${(await fs.promises.readFile(cached)).toString('base64')}`; } catch {
      const make = this.p.thumbnail;
      const next = this.pictures.then(() => make(file)).catch(() => null);
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

  /** A GIF as it is, when it is one. */
  private async gif(file: string): Promise<ArtifactThumb | null> {
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile() || st.size > GIF_BYTES) return null;
      const body = await fs.promises.readFile(file);
      return /^GIF8[79]a/.test(body.toString('latin1', 0, 6)) ? { kind: 'image', dataUrl: `data:image/gif;base64,${body.toString('base64')}` } : null;
    } catch { return null; }
  }

  // ── opening with the system's app ──
  /** Opens an artifact's file (or, when it went, the copy kept of that version) with the system's app: the original
   *  layout of a Word, Excel or PowerPoint file, which the viewer shows as text. Only a file the index holds: the
   *  viewer's bar asks with the path it shows. */
  async open(file: string): Promise<{ ok: boolean; error?: string }> {
    let hit = artifactOfPath(this.data.artifacts as Artifact[], file, this.platform);
    if (!hit) {
      // the path as the disk names it; a gone file by its real folder
      let real = realNow(file);
      if (real === file) real = path.join(realNow(path.dirname(file)), path.basename(file));
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
