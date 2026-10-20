// The user's own picture for a role: English labels; parity checked against agent-image.it.ts.
import type { agentImageIt } from './agent-image.it';
export const agentImageEn: typeof agentImageIt = {
  'agentImage.change': 'Change picture',
  'agentImage.reset': 'Default picture',
  'agentImage.hint': 'PNG, JPG or WebP: the centre square is used.',
  'agentImage.err.format': 'Use a PNG, JPG or WebP picture.',
  'agentImage.err.size': 'Picture too large: at most 15 MB and 8192 pixels a side.',
  'agentImage.err.save': 'Could not save the picture. Try again.',
};
