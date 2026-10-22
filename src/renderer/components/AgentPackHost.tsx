// Empty on purpose: the agent pack import/export and its window-wide drop overlay are gone (ADR 0125: the roles are
// fixed, the owner, 2026-10-22). App.tsx still mounts <AgentPackHost />; the worker that owns App.tsx removes that
// import and the mount, then this file.
export function AgentPackHost(): null { return null; }
