// Public surface of the shared routine runtime (ADR 0175): what the Electron app and a terminal host import. Hosts
// import from here only; the modules behind it may move.
//
// Package format (documented, stable for later tasks): ROUTINE_FORMAT, ROUTINE_FILE, parseRoutinePackage,
// loadRoutinePackage, writeRoutinePackage, packageSecrets, convertFlowToPackage, and the RoutinePackage /
// RoutineDefinition / RoutineStep / RoutineTrigger / RoutineDevOps / RoutineEscalation / RoutineTestDb types.
// Preflight (before a run and when authoring): preflightRoutinePackage, formatPreflight.
// Run folder (documented reader): readRun, listRuns, stepFolderName, RunRecord / RunFolder.
// Terminal runs directory: defaultRunsDir (per OS, ROUTINE_RUNS_DIR overrides), routinePaths.
// Live progress: EVENTS_FILE, RunEvent, parseEvents, progressFrom (one status for the terminal and the app).
// MCP servers (stdio, started per step): testdb-mcp.ts `main`, devops-mcp.ts `devopsMain`, browser-mcp.ts
// `browserMain`; mcp-main.ts dispatches.
// The `routine` command (not exported here): cli.ts `main` (run / resume / watch), bin.ts, terminal.ts (progress
// renderer over progressFrom), zip.ts (the app's .zip export).
export * from './format';
export * from './events';
export * from './migrate';
export * from './preflight';
export { DEVOPS_SERVER_NAME, handleDevOpsMessage, serveDevOps } from './devops-mcp';
export type { DevOpsServerConfig } from './devops-mcp';
export { BROWSER_SERVER_NAME, BROWSER_TOOLS, createBrowserSession, allowedOrigin, loginFor } from './browser-mcp';
export type { BrowserServerConfig, BrowserLogin } from './browser-mcp';
export * from './ports';
export * from './mask';
export * from './token';
export * from './step-result';
export * from './report';
export * from './escalation';
export * from './claude';
export * from './testdb';
export * from './testdb-guard';
export * from './trigger';
export * from './runtime';
export * from './paths';
export * from './locks';
export * from './cli-command';
export { createRunStore, readRun, listRuns, stepFolderName, StaleAttempt } from './run-store';
export type { RunRecord, RunStatus, RunStepRecord, StepStatus, RunEscalation, RunFolder, RunStepFolder, RunStore, TriggerState, LedgerEntry } from './run-store';
export { createDevOpsClient, executeWrites, verifyWrite, refusedWrite, runMarker, DevOpsCallError } from './devops';
export type { DevOpsClient, DevOpsComment, DevOpsWorkItem, WriteContext, WritesOutcome } from './devops';
export { executeExtended, ledgerResources, runResources, needsHumanComment } from './devops-ops';
export type { Deployments, ExtendedContext, ExtendedOutcome } from './devops-ops';
export { readConfigOnce } from './fs-util';
export { createDevOpsDetector } from './devops-detector';
export { driveLogin, inspectLoginForm, classifyLoginForm, loginSucceeded } from './login-form';
export type { LoginSuccessRule, LoginPageDriver } from './login-form';
export { useRuntimeLog } from './log';
