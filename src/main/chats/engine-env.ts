// Environment every chat engine the app spawns gets, and so every build its agents run (manager-sessions.ts).
// Why: `dotnet build` leaves MSBuild worker nodes (`MSBuild.dll /nodemode:1 /nodeReuse:true`) and an MSBuild server
// running after it ends, by design, to reuse them for the next build; started by an agent they outlive its chat and
// the app: 13 of them, ~1.75 GB, parent dead, found on the owner's PC on 2026-11-23 (brain tmp/perf-check/report.md).
// With node reuse and the build server off each build ends with its own processes. A value the user set in the app's
// own environment wins (they may want node reuse back). Pinned by test/unit/chats/engine-env.test.ts.

/** The variables and the value the app gives them. */
export const NO_LINGERING_BUILDS: Readonly<Record<string, string>> = {
  MSBUILDDISABLENODEREUSE: '1',
  DOTNET_CLI_USE_MSBUILD_SERVER: '0',
};

/** The part of NO_LINGERING_BUILDS that `base` (the app's environment) does not set already. */
export function engineEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(NO_LINGERING_BUILDS)) if (base[k] === undefined) out[k] = v;
  return out;
}
