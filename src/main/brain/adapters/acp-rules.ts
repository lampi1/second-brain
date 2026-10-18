// ACP fallback: bounded topic text at launch, without global config writes or unsupported native hook claims.
import { launchRules } from './domains';
import { productInstructions } from '../../rules/instructions';
import { assets, enabled } from '../../rules/delivery';
import { memoryInstructions } from '../../rules/new-brain';
import { toolsRef } from '../../rules/tools';

export function acpRules(readOnly = false): string | null {
  const parts = launchRules().domains.filter(d => enabled(d.root)).map(d => {
    if (readOnly) return productInstructions(d.root, true);
    const tools = toolsRef(d.root);
    return `${productInstructions(d.root, true, tools)}\n\n${memoryInstructions(assets(), d.root, tools)}`;
  });
  return parts.filter(Boolean).join('\n\n') || null;
}
