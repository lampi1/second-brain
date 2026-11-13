// Diagnostic-only timing vocabulary for the runtime migration baseline. Used by the main-process recorder and
// the controlled replay driver; correlation is never an authorization, delivery receipt or provider acknowledgement.
export interface RuntimeDiagnostic {
  operationId: string;
  /** Renderer performance.timeOrigin + performance.now(), in milliseconds. */
  sentAt: number;
}

export type RuntimeTimingStage = 'main' | 'runtime' | 'providerWrite' | 'firstText' | 'firstTextIpc' | 'result';
export interface RuntimeTimingRow {
  operationId: string;
  chatId: string;
  uiAt: number;
  engine?: string;
  temperature?: 'cold' | 'warm';
  sessionCreatedAt?: number;
  marks: Partial<Record<RuntimeTimingStage, number>>;
  invalid?: 'overlap' | 'failed' | 'incomplete';
}
export interface RuntimePercentiles { n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null }
