// Renderer-only AI setup port. Production uses existing typed IPC; fixtures never start a real engine.
import type { SetupGuide } from '../../shared/agents';
import type { CliStatus } from '../../shared/contract';
import type { SetupEngine } from './model';
export interface EngineOption { id: SetupEngine; label: string; status: CliStatus | null; trusted: boolean; runs: string }
export interface AiSetupPort {
  bootstrap(): Promise<{ root: string | null; engines: EngineOption[] }>;
  login(engine: SetupEngine): Promise<void>;
  start(engine: SetupEngine, root: string): Promise<string>;
  prove(chatId: string, signal: AbortSignal): Promise<string>;
  cancel(chatId: string): Promise<void>;
  persist(guide: SetupGuide): Promise<void>;
  open(chatId: string): void;
}
