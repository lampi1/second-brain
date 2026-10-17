// English counterpart of the bounded data-section workflow.
import type { sectionsIt } from './sections.it';
export const sectionsEn: typeof sectionsIt = {
 'sections.draftContext':'Context attached to this draft','sections.removeContext':'Remove context','sections.exactPayload':'Exact text for the agent',
 'sections.actions':'Actions','sections.removeRow':'Remove row',
 'sections.memory':'Shared memory','sections.memoryHint':'Write useful details without credentials. After confirmation they enter future AI turns; existing conversation history is not erased.',
 'sections.memory.work':'Your work','sections.memory.goals':'Goals','sections.memory.style':'How you prefer to work','sections.memory.constraints':'Boundaries to respect',
 'sections.memorySave':'Review and confirm','sections.memoryClear':'Clear memory','sections.memorySaved':'Memory updated. It applies to future turns.','sections.contextDraft':'Prepare for Regia',
 'sections.title':'My tables','sections.intro':'Organize cases, deadlines and lists. Data stays in this app.',
 'sections.new':'New table','sections.name':'Table name','sections.preview':'Preview','sections.save':'Save table','sections.cancel':'Cancel',
 'sections.empty':'No tables yet. Create your first table or import a template.','sections.loading':'Loading tables…',
 'sections.import':'Import JSON template','sections.importHint':'Data only: text, dates and statuses. No code is executed.',
 'sections.remove':'Remove table','sections.restore':'Undo last change','sections.reload':'Reload',
 'sections.failure':'The operation did not finish. Reload before retrying; your draft stays open.',
 'sections.item':'Task','sections.due':'Due date','sections.status':'Status','sections.open':'Open','sections.done':'Completed','sections.blocked':'Blocked',
 'sections.addRow':'Add row','sections.noRows':'No items. Add your first row.',
 'sections.invalid':'Invalid or oversized data. Use a valid template within 256 KB.',
 'sections.context':'Available context','sections.reviewContext':'Review personal details','sections.contextHint':'Only confirmed personal details enter the context. Imported rows remain unconfirmed.',
 'sections.contextEmpty':'No confirmed details available. Complete setup and review your personal details.',
 'sections.contextPending':'Items awaiting confirmation','sections.contextOmitted':'Excluded items','sections.contextSource':'Unavailable sources',
 'sections.select':'Choose a table','sections.edit':'Edit data','sections.details':'Details',
};
