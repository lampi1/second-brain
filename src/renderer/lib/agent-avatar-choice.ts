// Editor identity choices: reserve unused tones in the category and warn without blocking intentional duplicates.
import { AGENT_TONES, type AgentAvatar, type AgentCategory, type AgentProfile, type AgentTone } from '@shared/agents';
export function unusedAgentTone(profiles: AgentProfile[], category: AgentCategory = 'other', exceptId?: string): AgentTone {
  const used = new Set(profiles.filter(p => p.id !== exceptId && p.category === category && p.avatar.kind === 'symbol').map(p => p.avatar.kind === 'symbol' ? p.avatar.tone ?? 'blue' : 'blue'));
  return AGENT_TONES.find(tone => !used.has(tone)) ?? 'blue';
}
export function duplicateAgentAvatars(avatar: AgentAvatar, profiles: AgentProfile[], exceptId?: string): AgentProfile[] {
  return avatar.kind !== 'symbol' ? [] : profiles.filter(p => p.id !== exceptId && p.avatar.kind === 'symbol' && p.avatar.value === avatar.value && (p.avatar.tone ?? 'blue') === (avatar.tone ?? 'blue'));
}
