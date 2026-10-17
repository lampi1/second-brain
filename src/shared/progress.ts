// Local, verifiable milestones; capability is reported by main and is never inferred by the UI.
export const ACHIEVEMENTS = ['first-agent', 'setup-complete', 'first-result'] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];
export interface ProgressState {
  available: boolean;
  reason?: string;
  version: 1;
  hidden: boolean;
  earned: { id: AchievementId; at: number }[];
  problem?: string;
}
