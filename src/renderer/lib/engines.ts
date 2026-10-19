// The engines the app knows (AppInfo.engines, from main/engines/registry.ts, ADR 0046), for the UI: their names and
// what each can do. Components ask an engine's caps, never its id. Until app:info arrives, a chat's own engine id is
// shown as its name and nothing is offered. Used by the new-chat dialog, the chat menu, the command palette, the top
// bar, the Orchestrator's tile and dialogs, the request panel and store/source.ts.
import type { EngineCaps, EngineInfo, EngineKind, Harness } from '@shared/contract';
import { app, useApp } from '../store/store';

const NONE: EngineInfo[] = [];

/** Every engine, in display order (empty until app:info arrives). */
export const useEngines = (): EngineInfo[] => useApp(s => s.info?.engines ?? NONE);

const find = (h: Harness): EngineInfo | undefined => app.get().info?.engines.find(e => e.id === h);

/** The engine with this id (undefined while unknown). */
export const engineOf = find;

/** "Claude Code", "Cursor": the engine's full name. */
export const engineName = (h: Harness): string => find(h)?.name ?? h;

/** "Claude", "Cursor": the engine's short name. */
export const engineLabel = (h: Harness): string => find(h)?.label ?? h;

/** Whether the engine can do this (false while unknown). */
export const engineCan = (h: Harness, cap: keyof EngineCaps): boolean => !!find(h)?.caps[cap];

/** The engine's protocol (undefined while unknown). */
export const engineKind = (h: Harness): EngineKind | undefined => find(h)?.kind;

/** The first engine in the list other than h (the Orchestrator's "Cambia motore"); undefined while unknown or if none. */
export const otherEngine = (h: Harness): Harness | undefined => app.get().info?.engines.find(e => e.id !== h)?.id;
