// Product rule inputs and persistent configuration; shared by launch adapters and the standalone hook runner.
/** Integrator: re-export this brain.json schema through contract.ts; no IPC is introduced by this module. */
export interface BrainRulesConfig {
  fixedFiles: string[];
  fixedBudget: number;
  topicFiles: string[];
  turnBudget: number;
  nowLineLimit: number;
  autoCommit: boolean;
  /** Product brains get the per-launch Claude plugin even with the app-wide launch-rules switch off (no ~/.claude wiring
   * duplicates it: BrainCreator never edits global settings). false = the owner opted this brain out. */
  claudeLaunch: boolean;
  /** true = a fresh brain (BrainCreator, the automatic memory): the app supplies the boot instructions, the topic rules,
   * the agents and skills from its own copy (rules/tools.ts), the brain holds only what the owner wrote. false = a
   * migrated legacy brain, whose own AGENTS.md and topic files are its rules. */
  appRules: boolean;
}

export interface HookInput {
  hook_event_name: 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';
  session_id: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; content?: string; old_string?: string; new_string?: string; replace_all?: boolean; command?: string; edits?: HookInput['tool_input'][] };
}
/** tools = the app-owned utility folder of this brain (rules/tools.ts); `{tools}` in brain text expands to it. */
export interface RuleContext { root: string; state: string; config: BrainRulesConfig; tools?: string }
/** Per-launch facts written by the app into the plugin's launch.json. correctionHook = the template's correction-catch
 * hook runs too (praise log, recall), so the runtime's own correction reminder is not repeated. */
export interface LaunchFacts { tools?: string; correctionHook?: boolean }
export interface HookResult { deny?: string; context?: string }
