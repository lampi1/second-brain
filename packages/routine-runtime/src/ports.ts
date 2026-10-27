// The ports of the shared routine runtime (ADR 0175): everything the runtime needs from its host, so the Electron app
// and a terminal run the same code. A step is a plain Claude Code session (`claude -p --output-format stream-json
// --permission-mode auto`): no roles, no app tools, no approval layer. The app adapts the ports in
// src/main/flows/routine-host.ts; a terminal host uses the defaults in this package (claude.ts, token.ts). No port may
// import Electron or src/main.
import type { LoginPageDriver } from './login-form';

/** One step attempt as the engine runs it: the prompt, where it works, where it must write step-result.json. */
export interface EngineStepRequest {
  runId: string; stepId: string; attempt: number;
  prompt: string;
  /** the session's working directory (the run's workspace) */
  cwd: string;
  /** the step folder: the session writes step-result.json here */
  stepDir: string;
  model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** --allowedTools as the package declares them */
  allowedTools?: string[];
  /** a --mcp-config file the runtime wrote for this step (package-declared servers, the test DB server) */
  mcpConfig?: string;
  /** extra environment for the session (never secrets: those stay in the runtime or in the MCP config it wrote) */
  env?: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  /** each stream-json line of the session as it arrives; the runtime masks it before writing the transcript */
  onLine(line: string): void;
}

export interface EngineStepOutcome { exitCode: number | null; sessionId?: string; error?: string }

/** The agent engine (Claude only): run one plain session to its end. Completion is decided by the runtime from the
 *  step folder's step-result.json, never by the exit code alone. */
export interface EngineRunner {
  run(request: EngineStepRequest): Promise<EngineStepOutcome>;
}

/** One site login a routine may perform (the app export's PortableCredential shape, plus the package's success rule). */
export interface RoutineCredential { loginUrl: string; user: string; password: string }

/** Site login credentials: the app's encrypted routine vault, or the package's embedded logins (ADR 0176). */
export interface CredentialStore {
  forLogin(loginUrl: string): RoutineCredential | null | Promise<RoutineCredential | null>;
  /** Every secret value it may hand out, for the run's masker. */
  secrets(): string[];
}

/** One page the runtime may drive for a host-side login: the app's Electron tab or a Playwright page. */
export type BrowserDriver = LoginPageDriver;

/** DevOps authentication: the full Authorization header value (`Bearer <az token>` or `Basic <base64(:PAT)>`). */
export interface TokenProvider {
  authorization(signal?: AbortSignal): Promise<string>;
}

export interface RuntimeLog {
  info(scope: string, msg: string, extra?: { data?: unknown; cause?: string; hint?: string }): void;
  warn(scope: string, msg: string, extra?: { data?: unknown; cause?: string; hint?: string }): void;
}

export interface Clock { now(): number }

/** Where runs live: `<runsRoot>/<runId>/` (run folder) and the workspace a run's sessions work in. */
export interface Paths {
  runsRoot: string;
  workspace(runId: string): string;
}
