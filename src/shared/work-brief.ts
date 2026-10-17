// Ordinary-work contexts for NewChatDialog. Pure: no repository, integration or engine is required by a brief.
// Both routing and chat creation use the same user request; the added instructions never decide the routing kind.
export const WORK_PATHS = ['general', 'organize', 'write', 'analyze', 'client', 'develop'] as const;
export type WorkPath = typeof WORK_PATHS[number];
export interface WorkBrief { path: WorkPath; request: string; context: string; outcome: string }

const instructions: Record<WorkPath, string> = {
  general: 'Help with the requested everyday task. Choose a useful approach from the supplied context.',
  organize: 'Organize the work into priorities, next actions and dependencies. Do not invent deadlines or commitments.',
  write: 'Prepare a draft for the intended audience. Keep facts separate from assumptions and leave missing details visible.',
  analyze: 'Compare or summarize the supplied information. State sources, assumptions and missing evidence; do not invent data.',
  client: 'Prepare the requested client deliverable or follow-up. Separate agreed commitments from proposed next steps.',
  develop: 'Work on the requested software task. Read the project instructions before changing code and use its relevant checks.',
};

export function workBrief(b: WorkBrief): string {
  if (![b.request, b.context, b.outcome].some(s => s.trim())) return '';
  return [
    b.request.trim() || 'Help me with the context and requested deliverable below.',
    '',
    'Work approach:', instructions[b.path],
    ...(b.context.trim() ? ['', 'Context supplied by the user:', b.context.trim()] : []),
    ...(b.outcome.trim() ? ['', 'Requested deliverable:', b.outcome.trim()] : []),
    '',
    'Use the information and capabilities already available. Ask only for missing details that block the task.',
    'For everyday work, provide a useful deliverable without requiring a repository, terminal or external integration.',
    'Drafts and plans do not authorize sending messages, publishing, payments or changing shared systems.',
  ].join('\n');
}
