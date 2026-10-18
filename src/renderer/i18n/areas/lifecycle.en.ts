// English counterpart of the agent lifecycle panel labels (lifecycle.it.ts).
import type{lifecycleIt}from'./lifecycle.it';
export const lifecycleEn:typeof lifecycleIt={
 'lifecycle.kind.update':'Update','lifecycle.kind.create':'New agent','lifecycle.kind.merge':'Merge of roles','lifecycle.kind.model-trial':'Model trial',
 'lifecycle.kind.split':'Split of a role','lifecycle.kind.keep':'Keep version','lifecycle.kind.revert':'Restore version','lifecycle.kind.retire':'Retire agent',
 'lifecycle.metricMissing':'Data not available','lifecycle.coverageMissing':'not available',
 'lifecycle.metric':(p:{value:string;n:number;coverage:string})=>`${p.value} · n=${p.n} · coverage ${p.coverage}`,
 'lifecycle.compare':'Run comparison','lifecycle.metricCol':'Metric','lifecycle.baseline':'Baseline','lifecycle.evaluated':'Evaluated group',
 'lifecycle.success':'Success','lifecycle.corrections':'Corrections per run','lifecycle.cost':'Median cost ($)','lifecycle.time':'Median time (ms)','lifecycle.questions':'Questions per run',
 'lifecycle.aria':'Agent lifecycle','lifecycle.title':'To approve',
 'lifecycle.intro':'Proposals do not change agents. Look at the data and open the editor to prepare a change.',
 'lifecycle.empty':'No pending proposals.','lifecycle.agents':(p:{ids:string})=>`Agents: ${p.ids}`,
 'lifecycle.evidence':(p:{n:number})=>`Evidence (${p.n})`,'lifecycle.evidenceNone':'Comparison computed on the definitions or on the reported metrics.',
 'lifecycle.review':'Review proposal','lifecycle.evaluations':'Version evaluations',
 'lifecycle.cohorts':(p:{comparable:number;other:number;unknown:number})=>`Comparable requests: ${p.comparable} · other: ${p.other} · unknown classification: ${p.unknown}`,
 'lifecycle.otherRuns':'Other requests (excluded from the decision)',
 'lifecycle.feedback':(p:{n:number})=>`Feedback (${p.n})`,
 'lifecycle.basisReviewed':'The Orchestrator’s assessment with a verified review, not a confirmation by the user.',
 'lifecycle.basisOpinion':'The Orchestrator’s assessment, not a confirmation by the user.',
 'lifecycle.worked':(p:{text:string})=>`Worked: ${p.text}`,'lifecycle.failed':(p:{text:string})=>`To improve: ${p.text}`,'lifecycle.notGiven':'Not given',
 'lifecycle.gap':(p:{key:string})=>`Gap: ${p.key}`,
 'lifecycle.unavailable':'Agent lifecycle not available.','lifecycle.loading':'Loading proposals…','lifecycle.reload':'Reload proposals',
};
