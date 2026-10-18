// Review test (PR #29, code half A): explainer detection is too broad. isExplainer matches any id/name/role containing
// "explain" or a word starting with "spiega", and main's catalog fills a profile's role with its purpose when the user
// leaves it empty (src/main/agents/catalog.ts validate: role = purpose). So an ordinary agent whose purpose/role merely
// uses the verb ("spiega", "explain") is taken as the explainer and «Discutine» opens a chat with it (catalog order: the
// first match wins, ahead of a real "Explainer" saved later). Fails today.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isExplainer } from '@shared/concept-guide';

const root = path.resolve(import.meta.dirname, '../../../..');

describe('PR #29 isExplainer', () => {
  it('main defaults an empty role to the purpose (precondition)', () => {
    const catalog = fs.readFileSync(path.join(root, 'src/main/agents/catalog.ts'), 'utf8');
    expect(catalog).toContain("role: p.role === undefined || p.role === '' ? purpose");
  });
  it('does not take a development agent whose role says it explains its changes for the explainer', () => {
    expect(isExplainer({ id: 'agent-1', name: 'Sviluppo backend', role: 'Scrive il codice e spiega le modifiche nelle PR' })).toBe(false);
  });
  it('does not take a support agent whose role says "explain" for the explainer', () => {
    expect(isExplainer({ id: 'agent-2', name: 'Support', role: 'Answer customer tickets and explain refunds' })).toBe(false);
  });
});
