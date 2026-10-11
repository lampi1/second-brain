// Typed access to the preload bridge (window.sb): the renderer's only way to main (invoke) and its events (on).
// Used by store/store.ts, lib/viewports.ts and App.tsx.
import type { Bridge } from '@shared/contract';

declare global { interface Window { sb: Bridge } }
export const sb: Bridge = window.sb;
