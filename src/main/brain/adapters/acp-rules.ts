// ACP fallback: bounded topic text at launch, without global config writes or unsupported native hook claims.
// Only product brains (ADR 0062) get it; a legacy brain, even one with an unreadable brain.json, gets nothing (isProduct
// never throws). Used by engines/sessions.ts for every ACP engine.
import { launchRules } from './domains';
import { productInstructions } from '../../rules/instructions';
import { assets } from '../../rules/delivery';
import { memoryInstructions } from '../../rules/new-brain';
import { isProduct, toolsRef } from '../../rules/tools';

export function acpRules(readOnly = false): string | null {
  const parts = launchRules().domains.filter(d => isProduct(d.root)).map(d => {
    if (readOnly) return productInstructions(d.root, true);
    const tools = toolsRef(d.root);
    return `${productInstructions(d.root, true, tools)}\n\n${memoryInstructions(assets(), d.root, tools)}`;
  });
  return parts.filter(Boolean).join('\n\n') || null;
}
