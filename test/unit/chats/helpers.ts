// Shared helpers for the chats tests: the fake CLI path, a recording SessionSink, a recording emitter, waitFor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, EventChannel, EventMap, PendingRequest } from '../../../src/shared/contract';
import type { SessionPatch, SessionSink } from '../../../src/main/chats/session';

export const FAKE = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-claude.mjs');
/** The only Cursor engine tests may run (the real one is refused under tests). */
export const FAKE_CURSOR = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-cursor-acp.mjs');

export interface CursorLog { pid: number; argv?: string[]; method?: string; params?: Record<string, unknown>; answer?: { outcome?: Record<string, unknown> } | null; exit?: string }
/** A real 1x1 PNG (base64), for pasted-image tests. */
export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function cursorLog(file: string): CursorLog[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as CursorLog) : [];
}

export function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sb-${prefix}-`));
}

export async function waitFor<T>(fn: () => T | undefined | null | false, what: string, ms = 10000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

/** Whether a process id is still alive. */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Lines the fake CLI wrote to $FAKE_CLAUDE_LOG: starts ({argv}), control requests ({control, request}), user lines ({user, blocks}). */
export interface FakeLog { pid: number; at?: number; argv?: string[]; cwd?: string; stateEventsEnv?: string | null; control?: string; request?: Record<string, unknown>; user?: string; blocks?: string[]; grandchild?: number; orphan?: number }
export function fakeLog(file: string): FakeLog[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as FakeLog) : [];
}

export interface RecSink extends SessionSink {
  items: Map<string, ChatItem>;
  /** states and results in arrival order: "state:running", "result", "state:idle"… */
  trace: string[];
  events: { item: ChatItem; replace: boolean }[];
  pendings: Omit<PendingRequest, 'chatId'>[];
  resolvedIds: string[];
  patch: SessionPatch;
  patches: SessionPatch[];
  exited: { code: number | null; error: string | null } | null;
  /** the model lists the CLI offered (sink.models) */
  modelLists: { id: string; name: string }[][];
  last<K extends ChatItem['kind']>(kind: K): Extract<ChatItem, { kind: K }> | undefined;
}

export function recSink(): RecSink {
  const sink: RecSink = {
    items: new Map(), trace: [], events: [], pendings: [], resolvedIds: [], patch: {}, patches: [], exited: null, modelLists: [],
    models(list) { sink.modelLists.push(list); },
    item(item, replace) { sink.events.push({ item, replace }); sink.items.set(item.id, item); if (item.kind === 'result') sink.trace.push('result'); },
    pending(req) { sink.pendings.push(req); },
    resolved(id) { sink.resolvedIds.push(id); },
    changed(p) { sink.patches.push(p); Object.assign(sink.patch, p); if (p.state) sink.trace.push(`state:${p.state}`); },
    exit(info) { sink.exited = info; },
    last(kind) { return [...sink.items.values()].filter(i => i.kind === kind).at(-1) as never; },
  };
  return sink;
}

export interface RecEmitter {
  emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void;
  events: { channel: EventChannel; payload: unknown }[];
  of<K extends EventChannel>(channel: K): EventMap[K][];
}

export function recEmitter(): RecEmitter {
  const e: RecEmitter = {
    events: [],
    emit(channel, payload) { e.events.push({ channel, payload }); },
    of(channel) { return e.events.filter(x => x.channel === channel).map(x => x.payload) as never; },
  };
  return e;
}
