// Expected start refusals are actionable routine state, not broken MCP calls. The runtime still refuses the start;
// only the Orchestrator tool translates this typed error into a readable result, without granting or resuming anything.
export class FlowStartBlocked extends Error {
  constructor(readonly code: 'automation-paused' | 'trigger-paused' | 'approval-required', message: string, readonly flowId: string) { super(message); }
  result() {
    return { status: 'blocked', code: this.code, flowId: this.flowId, reason: this.message, started: false,
      nextAction: this.code === 'approval-required' ? 'Ask the user to approve the exact configuration in Routine.'
        : 'Explain the pause in a user question. Resume only if the user explicitly asks; never retry through app_flow_start or another tool.' };
  }
}
