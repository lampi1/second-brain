// Product memory and diagnostics CLI, bundled next to hooks so agents never depend on a user's ops/tools checkout.
import { configOf } from './storage';
import { writeAgentMemory, writeError, writeNow } from './memory';
import { lease, lint } from './maintenance';
import { readCost, readSession } from './readers';
import fs from 'node:fs';
import { migrate, planMigration, recoverMigration, rollback, type MigrationEdit, type MigrationReceipt } from './migration';

export function command(args: string[]): unknown {
  const [operation, root, ...rest] = args;
  if (!root) throw new Error('Usage: brain-rules <now|error|agent|lint|lease|session|cost|plan|migrate|recover|rollback> <brain-or-transcript> [arguments]');
  if (operation === 'migrate') {
    if (!rest[0]) throw new Error('Supply a reviewed migration plan JSON file; stop all brain chats first.');
    return migrate(root, JSON.parse(fs.readFileSync(rest[0], 'utf8')) as MigrationEdit[]);
  }
  if (operation === 'plan') {
    const plan = planMigration(root, { withHooks: rest.includes('--with-hooks') });
    const out = rest.find(a => !a.startsWith('--'));
    if (out) { fs.writeFileSync(out, JSON.stringify(plan, null, 2), { flag: 'wx' }); return { plan: out, edits: plan.length }; }
    return plan;
  }
  if (operation === 'recover') return recoverMigration(root);
  if (operation === 'rollback') return { retained: rollback(JSON.parse(fs.readFileSync(root, 'utf8')) as MigrationReceipt) };
  if (operation === 'session') return readSession(root, rest.join(' '));
  if (operation === 'cost') return readCost(root);
  const config = configOf(root);
  switch (operation) {
    case 'now': writeNow(root, rest[0] ?? '', rest[1] ?? '', config.nowLineLimit); return { written: 'now.md' };
    case 'error': writeError(root, rest[1] ?? '', rest[0] ?? ''); return { written: 'ai-errors.md' };
    case 'agent': return { written: writeAgentMemory(root, rest[0] ?? '', rest.slice(1).join(' ')) };
    case 'lint': return lint({ root, state: root, config });
    case 'lease': return { token: lease(root, rest[0] ?? '', rest[1] ?? '', rest[2]) };
    default: throw new Error('Unknown product memory command.');
  }
}
