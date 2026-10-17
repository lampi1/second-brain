import { agents } from '../../renderer/store/agents';
import { ui } from '../../renderer/store/ui';
import { guideHasCenter } from './presentation';

export function useGuideCenter(hasRegia: boolean): boolean {
  const setup = agents.use(s => s.setup);
  const workspace = ui.use(s => !s.page && !s.map);
  return workspace && guideHasCenter(setup, hasRegia);
}
