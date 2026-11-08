// The engines the app knows (AppInfo.engines, from main/engines/registry.ts, ADR 0046), for the UI: their names and
// what each can do. Components ask an engine's caps, never its id. Until app:info arrives, a chat's own engine id is
// shown as its name and nothing is offered. Used by the new-chat dialog, the chat menu, the command palette, the top
// bar, the Orchestrator's tile and dialogs, the request panel and store/source.ts; Settings reads every engine (useAllEngines).
import type { EngineCaps, EngineInfo, Harness } from '@shared/contract';
import { app, useApp } from '../store/store';

const NONE: EngineInfo[] = [];

/** An ACP catalog entry (ADR 0221) the user has not turned on is only a proposal: Settings shows it, nothing else offers it. */
export const offered = (e: EngineInfo): boolean => !e.catalog || e.trusted;
const usable = (list: EngineInfo[] | undefined): EngineInfo[] => (list ?? NONE).filter(offered);
let lastAll: EngineInfo[] | undefined, lastUsable: EngineInfo[] = NONE;
/** the offered engines of app:info, the same array while app:info's list is the same (a zustand selector must be stable) */
const offeredOf = (list: EngineInfo[] | undefined): EngineInfo[] => {
  if (list !== lastAll) { lastAll = list; lastUsable = usable(list); }
  return lastUsable;
};

/** Every engine the app offers, in display order (empty until app:info arrives). */
export const useEngines = (): EngineInfo[] => useApp(s => offeredOf(s.info?.engines));

/** Every engine, the ACP catalog's proposals too: Settings → Account e strumenti only. */
export const useAllEngines = (): EngineInfo[] => useApp(s => s.info?.engines ?? NONE);

const find = (h: Harness): EngineInfo | undefined => app.get().info?.engines.find(e => e.id === h);

/** The engine with this id (undefined while unknown). */
export const engineOf = find;

/** "Claude Code", "Cursor": the engine's full name. */
export const engineName = (h: Harness): string => find(h)?.name ?? h;

/** "Claude", "Cursor": the engine's short name. */
export const engineLabel = (h: Harness): string => find(h)?.label ?? h;

/** Whether the engine can do this (false while unknown). */
export const engineCan = (h: Harness, cap: keyof EngineCaps): boolean => !!find(h)?.caps[cap];

/** The first engine in the list other than h (the Orchestrator's "Cambia motore"); undefined while unknown or if none. */
export const otherEngine = (h: Harness): Harness | undefined => app.get().info?.engines.find(e => e.id !== h && offered(e))?.id;
