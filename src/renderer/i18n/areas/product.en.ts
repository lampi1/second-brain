// English counterpart of the agent workspace and packaged appearance UI.
import type{productIt}from'./product.it';
export const productEn:typeof productIt={
 'ui.state.waiting':'waiting for you','ui.state.queued':'queued','ui.state.running':'working','ui.state.starting':'starting…','ui.state.error':'error','ui.state.closed':'closed','ui.state.regia':'listening','ui.state.done':'finished',
 'ui.other':'Other…','ui.writeAnswer':'write your answer','ui.mapDetails':'Sources and details',
 'context.handoffBusy':"Preparing the handoff.",
 'context.native':'Codex manages native compaction. Context length alone does not require a new chat.','context.passive':'Context size reported by the engine; continuing in a new chat remains a manual choice.',
 'origin.user':'User','origin.unavailable':'Not available','origin.missingHint':'The source does not record the originating model. The current model is never assigned to historical records.',
 'product.appearance':'Appearance and layout','product.style':'Style','product.standard':'Essential','product.calm':'Calm','product.catalog':'Agent catalog','product.grid':'Cards','product.list':'List','product.preview':'Preview','product.apply':'Apply','product.reset':'Reset appearance',
 'product.research':'Research','product.researchPurpose':'Sources and summaries for your work','product.organization':'Planning','product.organizationPurpose':'Priorities and next steps',
 'product.unassigned':'No profile assigned','product.avatar':p=>`Icon for ${p.name}`,
 'product.expand':'Open work','product.collapse':'Collapse to strip','product.write':'Write','product.details':'Details and collaborators','product.profiles':'Profiles','product.purpose':'Purpose','product.model':'Model',
 'product.workAssigned':'Open assignment','product.workWaiting':'Waiting for mail','product.workCompleted':'Assignment completed','product.workDeclare':'Work status','product.workUnset':'Status not set','product.noTask':'Task not reported',
 'product.teamUnknown':'Subagents: data unavailable','product.teamComplete':p=>`Subagents: ${p.active} active · ${p.total} total`,'product.teamPartial':p=>`Observed: ${p.active} active · ${p.total} total · partial data`,
 'product.observed':'Observed activity','product.replayed':'restored observation','product.parent':'Parent','product.notReported':'Not reported','product.parentMissing':'Not present in observations',
 'product.running':'Working','product.waiting':'Waiting','product.completed':'Completed','product.failed':'Error','product.stopped':'Stopped','product.unknown':'Status not reported',
 'product.teamExplain':'Internal collaborators observed by the engine. Missing data does not mean zero activity.','product.teamEmpty':'No internal activity observed.','product.teamIncomplete':'The engine does not provide a complete list.',
 'product.coordinated':p=>`Agents in the workspace (${p.count})`,'product.backRegia':p=>`Back to ${p.name}`,
 'product.move':p=>`Move ${p.name}. Alt and arrow keys to dock`,'product.moveHint':'Drag to dock · Alt + arrow keys',
 'product.regiaTop':'Regia at the top','product.regiaCorner':'Regia in the corner','product.resizeRegia':'Resize Regia','product.advanced':'Advanced details',
 'product.agents':'Your agents','product.agentsPurpose':'A clear role for each job.','product.newAgent':'Create agent','product.setup':'Set up your work',
};
