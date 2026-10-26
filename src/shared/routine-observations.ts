// Portable, inert observations for the workbench export. Explicit projection excludes inputs, prompts and run contents.
import type { RoutineWorkbenchResult } from './routine-workbench';
export function routineObservations(data: RoutineWorkbenchResult, exportedAt = new Date().toISOString()) {
  const c = data.comparison, e = data.evaluation;
  return { schema: 1, exportedAt,
    comparison: c ? { flowId: c.flowId, comparableSubjects: c.comparableSubjects, caveats: [...c.caveats], versions: c.versions.map(v => ({
      version: v.version, digest: v.digest, runs: v.runs, completed: v.completed, blocked: v.blocked, cancelled: v.cancelled, skipped: v.skipped, needsHuman: v.needsHuman,
      retries: v.retries, observedDecisions: v.observedDecisions, terminalElapsedMs: v.terminalElapsedMs, completeEvidence: v.completeEvidence,
    })) } : null,
    evaluation: e ? { flowVersion: e.flowVersion, definitionDigest: e.definitionDigest, suiteDigest: e.suiteDigest, coverage: [...e.coverage],
      splits: (['tuning', 'holdout'] as const).map(split => ({ split, pass: e.cases.filter(c => c.split === split && c.state === 'pass').length,
        fail: e.cases.filter(c => c.split === split && c.state === 'fail').length, unknown: e.cases.filter(c => c.split === split && c.state === 'unknown').length })) } : null,
  };
}
const escape = (s: unknown): string => String(s ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** No script, images, remote assets, controls, navigation or embedded raw JSON. Can be opened without this app. */
export function routineObservationsHtml(data: RoutineWorkbenchResult, exportedAt?: string): string {
  const value = routineObservations(data, exportedAt), c = value.comparison, e = value.evaluation;
  const cell = (s: unknown) => `<td>${escape(s)}</td>`;
  const rows = c?.versions.map(v => `<tr>${[v.version, v.runs, v.completed, v.blocked, v.cancelled, v.skipped, v.needsHuman, v.retries, v.completeEvidence, v.observedDecisions].map(cell).join('')}</tr>`).join('') ?? '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Routine observations · ${escape(c?.flowId)}</title><style>
body{margin:0;background:#101723;color:#e6edf6;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:clamp(26px,5vw,44px);line-height:1.15}h2{margin-top:36px}p,li{max-width:80ch;color:#b7c5d9}.tag{color:#9cdbc9;letter-spacing:.12em;font-size:12px;text-transform:uppercase}.scroll{overflow:auto;border:1px solid #344258;border-radius:12px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:right;padding:12px;border-bottom:1px solid #344258;white-space:nowrap}th{color:#9cdbc9;font-size:13px}th:first-child,td:first-child{text-align:left}footer{margin-top:40px;border-top:1px solid #344258;padding-top:16px;color:#b7c5d9}code{overflow-wrap:anywhere}details{margin:16px 0}
</style></head><body><main><div class="tag">second-brain · offline snapshot</div><h1>${escape(c?.flowId ?? 'Routine observations')}</h1>
<p>Exported ${escape(value.exportedAt)}. Read-only observations, not execution authorization or a quality score. This file contains no prompts, run inputs, transcripts or credentials.</p>
<h2>Recorded versions</h2><div class="scroll"><table><thead><tr>${['Version', 'Runs', 'Completed', 'Blocked', 'Cancelled', 'Skipped', 'Needs human', 'Extra attempts', 'Evidence complete', 'Decisions'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<p>${escape(c?.comparableSubjects ?? 0)} subjects share recorded inputs across versions. Environment and code changes remain uncontrolled.</p>
${e ? `<h2>Retrospective evaluation · v${escape(e.flowVersion)}</h2><div class="scroll"><table><thead><tr><th>Split</th><th>Pass</th><th>Fail</th><th>Unknown</th></tr></thead><tbody>${e.splits.map(s => `<tr>${[s.split, s.pass, s.fail, s.unknown].map(cell).join('')}</tr>`).join('')}</tbody></table></div><details><summary>Reproducibility identities</summary><p>Suite: <code>${escape(e.suiteDigest)}</code><br>Definition: <code>${escape(e.definitionDigest)}</code></p></details>` : '<p>No evaluation selected. Missing evidence is not treated as success.</p>'}
<h2>Limits of the evidence</h2><ul>${[...(c?.caveats ?? []), ...(e?.coverage ?? [])].map(s => `<li>${escape(s)}</li>`).join('')}</ul><footer>No connection to the app. Re-export to see newer observations. A completed run does not prove product correctness.</footer></main></body></html>`;
}
