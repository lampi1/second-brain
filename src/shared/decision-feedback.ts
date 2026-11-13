// Validate optional user corrections at decision boundaries; free text never grants approval.
// Shared by workflow and learned-rule host services before either persists a decision.
export function decisionFeedback(value: unknown, approve: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (approve || typeof value !== 'string' || !value.trim() || value.length > 2000 || value.includes('\0')) {
    throw new Error('La risposta libera deve contenere 1–2000 caratteri e non vale come approvazione.');
  }
  return value.trim();
}
