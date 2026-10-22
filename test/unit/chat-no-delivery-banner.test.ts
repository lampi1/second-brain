// No «Consegna in attesa · N» bar above a chat's messages (owner, 2026-10-22): it sat beside the messages in the
// .items-wrap flex row and pushed the Orchestrator's chat to the right. Held results still wait and are delivered
// (pendingResultIds, main/chats/manager.ts); only the result card's own button keeps the label.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

it('the chat log has no delivery-pending bar', () => {
  expect(read('src/renderer/components/ChatItems.tsx')).not.toMatch(/result-delivery-pending/);
  expect(read('src/renderer/styles/app.css')).not.toMatch(/result-delivery-pending/);
});
