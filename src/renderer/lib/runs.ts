// The runs of "Esegui" as the renderer knows them: every run:updated event from main, kept by id, readable by the code
// block that started it (same chat, message and code). Subscribed once when the bundle loads, so no update is lost.
// One command, one panel (ADR 0299): a block whose command another block already left waiting for Esegui, or runs now,
// is a reference to that one (originalOf); the reference is remembered for the window's life, so it keeps showing the
// original's state («in attesa», «in corso», «finito, exit N») after the request left or the run ended.
// Used by components/CodeBlock.tsx, components/AutoCloser.tsx and components/SidebarTree.tsx.
import { useSyncExternalStore } from 'react';
import type { PendingRequest, RunInfo } from '@shared/contract';
import { commandRefOf, type CommandOriginal, type CommandRef } from '@shared/command-dupes';
export type { CommandRef };
import { sb } from '../sb';

const runs = new Map<string, RunInfo>();
const listeners = new Set<() => void>();
let version = 0;

export function putRun(r: RunInfo): void {
  runs.set(r.id, r);
  version++;
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined' && window.sb && location.hash !== '#overlay') sb.on('run:updated', putRun);

/** Whether one of the chat's runs is still going (the auto-close waits for it: components/AutoCloser.tsx). */
export function hasRunningRun(chatId: string): boolean {
  for (const r of runs.values()) if (r.chatId === chatId && r.state === 'running') return true;
  return false;
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Live: whether one of the chat's Esegui runs is still going (the sidebar tree's dot: components/SidebarTree.tsx). */
export function useRunningRun(chatId: string): boolean {
  return useSyncExternalStore(subscribe, () => hasRunningRun(chatId));
}

/** The newest run of this exact block (chat, message, code), or null. */
export function lastRunOf(chatId: string, itemId: string, code: string): RunInfo | null {
  let best: RunInfo | null = null;
  for (const r of runs.values()) if (r.chatId === chatId && r.itemId === itemId && r.code === code.replace(/\r\n/g, '\n').trimEnd() && (!best || r.startedAt >= best.startedAt)) best = r;
  return best;
}

export function useBlockRun(chatId: string | null, itemId: string, code: string): RunInfo | null {
  useSyncExternalStore(subscribe, () => version);
  return chatId ? lastRunOf(chatId, itemId, code) : null;
}

/** chatId|itemId|command → the block it repeats, kept once seen (ADR 0299) */
const refs = new Map<string, CommandOriginal>();

export function useCommandRef(chatId: string | null, itemId: string, code: string, pending: readonly PendingRequest[], skip: boolean): CommandRef | null {
  useSyncExternalStore(subscribe, () => version);
  return !chatId || skip ? null : commandRefOf(chatId, itemId, code, pending, [...runs.values()], refs);
}

/** Live: one run by id (the guard's «Già in corso» shows its output as it grows), or null. */
export function useRunById(id: string | null): RunInfo | null {
  useSyncExternalStore(subscribe, () => version);
  return id ? runs.get(id) ?? null : null;
}
