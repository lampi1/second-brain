// The write barrier of a turn (ADR 0228): the message goes to the engine at once while the turn's checkpoint
// (checkpoints.ts, ADR 0103) is still being recorded, and the first tool call that may change a file waits here until
// that snapshot settled (taken, failed or given up). Reads pass at once; a tool not known to only read counts as
// writing (MCP tools, sub-agent tools, a tool the CLI adds tomorrow), so «Annulla l'ultimo turno» never puts back a
// tree that already holds the turn's own edits. Engine-neutral: a session that can stop a tool before it runs (Claude's
// in-process PreToolUse hook, chats/claude.ts) owns one and asks pass() for each call; ChatManager arms it with hold()
// before send (manager.ts deliverNow). Pinned by test/unit/chats/write-barrier.test.ts.

/** Claude Code's built-in tools that never change a file of the chat's folder: they pass without waiting. Everything
 *  else waits for the snapshot (an edit, a shell, an MCP tool, a sub-agent's own tools are hooked one by one). */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch', 'AskUserQuestion',
  'ExitPlanMode', 'EnterPlanMode', 'BashOutput', 'TaskOutput', 'TaskList', 'TaskGet', 'TaskCreate', 'TaskUpdate', 'Skill',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

/** True when a call of `tool` must wait for the turn's snapshot. Unknown or empty names count as writing. */
export function mayWrite(tool: string): boolean {
  return !READ_ONLY_TOOLS.has(tool);
}

export class WriteBarrier {
  private gate: Promise<void> | null = null;

  /** The turn's snapshot started: writing calls wait for `until` (its outcome does not matter: a failed snapshot means
   *  a turn that cannot be undone, as before ADR 0228, never a write before it settled). A newer hold replaces an
   *  older one (the manager chains snapshots, so the newer one settles last). */
  hold(until: Promise<unknown>): void {
    const gate: Promise<void> = until.then(() => {}, () => {}).finally(() => { if (this.gate === gate) this.gate = null; });
    this.gate = gate;
  }

  /** null = the call runs now; a promise = the call waits for it (it never rejects). */
  pass(tool: string): Promise<void> | null {
    return this.gate && mayWrite(tool) ? this.gate : null;
  }

  /** a snapshot is still being recorded */
  get held(): boolean { return this.gate !== null; }
}
