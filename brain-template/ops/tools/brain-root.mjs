// brain-root: the brain a tool serves. A copy inside the brain (or a worktree of it) serves its own checkout; the
// app-owned copy of a product brain (ADR 0062: the app renders these tools per brain under its userData, the brain
// holds no code) names its brain in .sb-tools.json at the copy's root. Used by the tools that find the brain from
// their own location (brain-lint, cost/prices, day, feedback-stats, flow-signals, mem, the Cursor adapters, hooks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `fromUrl` = the caller's import.meta.url; `up` = how many folders above it the copy's root is (ops/tools → 2). */
export function brainRoot(fromUrl, up = 2) {
  const own = path.resolve(path.dirname(fileURLToPath(fromUrl)), ...Array(up).fill('..'));
  try {
    const { root } = JSON.parse(fs.readFileSync(path.join(own, '.sb-tools.json'), 'utf8'));
    return typeof root === 'string' && path.isAbsolute(root) ? root : own;
  } catch { return own; }
}
