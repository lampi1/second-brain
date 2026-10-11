// Typed access to the preload bridge (window.sb).
import type { Bridge } from '@shared/contract';

declare global { interface Window { sb: Bridge } }
export const sb: Bridge = window.sb;
