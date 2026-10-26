// English counterpart of the agent workspace and packaged appearance UI.
import type{productIt}from'./product.it';
export const productEn:typeof productIt={
 "viewer.reviewSelection":"Comment on selection",
 "viewer.reviewTitle":"Comment on this part",
 "viewer.reviewRegion":"Selected image region",
 "viewer.reviewComment":"Your comment",
 "viewer.reviewPlaceholder":"What would you like checked or changed?",
 "viewer.reviewDraftHint":"Send your comment or prepare a message to review in the Orchestrator.",
 "viewer.reviewPrepare":"Prepare message",
 "viewer.reviewSend":"Send to Orchestrator",
 "viewer.reviewUnavailable":"Orchestrator unavailable. Your comment is kept here; try again.",

 "viewer.imageBefore":"Before",
 "viewer.imageAfter":"After",
 "report.image.select":"Select area",
 "report.image.hint":"Drag on the image to select an area.",
 "report.image.clear":"Clear selection",
 "report.image.commentRegion":"Comment on area",
 "report.image.commentWhole":"Comment on whole image",

 
 'product.transcriptLoading':'Loading','product.transcriptEmpty':'No messages yet: describe where you would like to start below.',
 
 
 'start.cancel':'Cancel',
 'readiness.unknown':'Engine availability has not been verified.','readiness.disabled':'disabled','readiness.trust':'needs authorization in Settings','readiness.configure':'needs configuration on this computer','readiness.signIn':'sign-in required','readiness.ready':'installed and sign-in verified','readiness.unchecked':'installation or sign-in needs verification','readiness.login':'Sign in',
 'viewer.title':'File','viewer.chooseFile':'Open a file from a conversation or a source link.','viewer.copyPath':'Copy path','viewer.showInFolder':'Show in folder','viewer.folderError':'The folder could not be shown.','viewer.formatted':'Formatted','viewer.source':'Source','viewer.table':'Table','viewer.mode':'View','viewer.readOnly':'Read-only','viewer.jsonlLine':'line',
 
 'viewer.compare':'Compare','viewer.compareHead':'With HEAD','viewer.compareRef':'With a commit or branch','viewer.compareFile':'With another file','viewer.refPlaceholder':'e.g. main, HEAD~1, a1b2c3d','viewer.filePlaceholder':'Path of the other file','viewer.compareRun':'Show differences','viewer.diffWorking':'Computing the differences…','viewer.diffSame':'No differences.','viewer.diffSlow':'Too many differences to compute here.','viewer.diffCut':p=>`Showing the first ${p.n} rows of the comparison.`,'viewer.diffBinary':'One of the two is not a text file.','viewer.diffBig':'One of the two is over the 2 MB comparison limit.','viewer.diffRepo':'The file is not in a git repository.','viewer.diffUntracked':'The file does not exist in that version.','viewer.diffRef':'Commit or branch not found.','viewer.diffGit':'git could not read that version.',
 'viewer.imageRemote':'External image not loaded: the viewer shows only files on this PC.','viewer.imageType':'Image not shown: PNG, JPG or WebP only.','viewer.imageNotShown':(p:{name:string;reason:string})=>`Image not shown (${p.name}): ${p.reason}`,'viewer.imageZoom':'Click to see it large','viewer.report':'Report',
 'chat.items.outputLoading':'Loading full output…','chat.items.outputFailed':'Partial preview: full output could not be loaded. ',
 'viewer.loading':'Opening file…','viewer.outside':'Only files on this computer: network shares and relative paths without a folder are not opened.','viewer.unsupported':'This is not a file (a folder or a device).','viewer.missing':'The file is not available.','viewer.changed':'The file changed while opening. Open it again.','viewer.binary':'This file does not contain readable text.','viewer.image':'The image is unsupported or exceeds the viewer limits.','viewer.page':p=>`Bytes ${p.from}–${p.to} of ${p.total}`,'viewer.lines':p=>`lines ${p.first}–${p.last}`,'viewer.pageFirst':'Start','viewer.pagePrevious':'Previous','viewer.pageNext':'Next','viewer.pageLast':'End','viewer.pdf':'This PDF cannot be shown (damaged, or over 32 MB).','viewer.pdfPage':p=>`Page ${p.n}`,'viewer.lineUnavailable':'The cited line is outside the loaded portion.','viewer.window':p=>`Lines ${p.first}–${p.last} of ${p.total}`,
 'ui.newBrowser':'New browser','ui.browserMine':'Your tab','ui.browserAddress':'Enter an address','ui.browserEditAddress':'Edit address','ui.browserOpenError':p=>`Browser could not open: ${p.error}`,
 'ui.state.waiting':'waiting for you','ui.state.queued':'queued','ui.state.running':'working','ui.state.starting':'starting…','ui.state.error':'error','ui.state.closed':'closed','ui.state.orchestrator':'listening','ui.state.done':'finished','ui.state.children':'waiting on sub-agents',
 
 'ui.close':'Close','ui.other':'Other…','ui.writeAnswer':'write your answer','ui.mapDetails':'Sources and details',
 'context.handoffBusy':"Preparing the handoff.",
 'context.native':'Codex manages native compaction. Context length alone does not require a new chat.','context.passive':'Context size reported by the engine; continuing in a new chat remains a manual choice.',
 'origin.user':'User','origin.unavailable':'Not available','origin.missingHint':'The source does not record the originating model. The current model is never assigned to historical records.',
 'product.appearance':'Appearance and layout','product.style':'Style','product.standard':'Essential','product.calm':'Calm','product.catalog':'Agent catalog','product.grid':'Cards','product.list':'List','product.preview':'Preview','product.apply':'Apply','product.reset':'Reset appearance',
 'product.research':'Research','product.researchPurpose':'Sources and summaries for your work','product.organization':'Planning','product.organizationPurpose':'Priorities and next steps',
 'product.avatar':p=>`Icon for ${p.name}`,
 'product.expand':'Open work','product.waitsYou':'Waiting for you','product.waitsYouOpen':(p:{title:string})=>`Open the decision of ${p.title}`,'product.collapse':'Collapse to strip','product.write':'Write','product.details':'Details and collaborators','product.profiles':'Profiles','product.purpose':'Purpose','product.model':'Model',
 'product.workAssigned':'Open assignment','product.workWaiting':'Waiting for mail','product.workCompleted':'Assignment completed','product.workDeclare':'Work status','product.workUnset':'Status not set','product.noTask':'Task not reported',
 'product.teamUnknown':'Subagents: data unavailable','product.teamComplete':p=>`Subagents: ${p.active} active · ${p.total} total`,'product.teamPartial':p=>`Observed: ${p.active} active · ${p.total} total · partial data`,
 'product.observed':'Observed activity','product.replayed':'restored observation','product.parent':'Parent','product.notReported':'Not reported','product.parentMissing':'Not present in observations',
 'product.running':'Working','product.waiting':'Waiting','product.completed':'Completed','product.failed':'Error','product.stopped':'Stopped','product.unknown':'Status not reported',
 'product.teamExplain':'Internal collaborators observed by the engine. Missing data does not mean zero activity.','product.teamEmpty':'No internal activity observed.','product.teamIncomplete':'The engine does not provide a complete list.',
 'product.child.agent':'subagent','product.childNoAgent':'no agent','product.child.shell':'command','product.child.unknown':'activity','product.childrenOf':p=>`Subagents of ${p.title}`,'product.childStarted':p=>`started at ${p.time}`,'product.childFor':p=>`for ${p.d}`,
 'product.restoreLayout':'Back to the column','product.noArea':'No project',
 'product.advanced':'Advanced details',
 'product.agents':'Your agents','product.agentsPurpose':'A clear role for each job.','product.setup':'Set up your work',
};
