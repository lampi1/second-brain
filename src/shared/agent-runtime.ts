// Identity and outcomes for the app-owned execution transport. Main and the utility host use these data-only types;
// they grant no renderer/MCP capability and never represent user authorization or provider acknowledgement.
export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export interface RuntimeIdentity {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  hostEpoch: string;
  chatId: string;
  sessionGeneration: number;
}

export type RuntimeOutcome = 'not-dispatched' | 'uncertain' | 'rejected';

export type RuntimeEnvelope<T> = RuntimeIdentity & {
  operationId: string;
  sequence: number;
  payload: T;
};

/** Validate identity before touching any pending operation; malformed/stale data carries no authority. */
export function sameRuntimeIdentity(value: unknown, expected: RuntimeIdentity): value is RuntimeIdentity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RuntimeIdentity>;
  return v.protocolVersion === RUNTIME_PROTOCOL_VERSION && v.protocolVersion === expected.protocolVersion
    && v.hostEpoch === expected.hostEpoch && v.chatId === expected.chatId
    && Number.isSafeInteger(v.sessionGeneration) && v.sessionGeneration === expected.sessionGeneration;
}
