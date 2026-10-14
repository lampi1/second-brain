// The runs of "Esegui" as the renderer knows them: every run:updated event from main, kept by id, readable by the code
// block that started it (same chat, message and code). Subscribed once when the bundle loads, so no update is lost.
// Used by components/CodeBlock.tsx and components/AutoCloser.tsx.
import { useSyncExternalStore } from 'react';
import type { RunInfo } from '@shared/contract';
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
