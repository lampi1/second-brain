// Archived transcript rendering keeps code and evidence visible without exposing command execution or send marks.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../../src/renderer/lib/runs', () => ({ useBlockRun: () => null }));
vi.mock('../../../src/renderer/lib/marks', () => ({ useMark: () => null }));
import { ItemList } from '../../../src/renderer/components/ChatItems';
import type { ChatItem } from '../../../src/shared/contract';
it('preserves a shell block but removes its mutating controls from an archive', () => {
  const items: ChatItem[] = [{ kind: 'assistant', id: 'answer', at: 1, text: '```powershell\nWrite-Output evidence\n```' }];
  const html = renderToStaticMarkup(createElement(ItemList, { chatId: 'archived', items, readOnly: true }));
  expect(html).toContain('Write-Output evidence');
  expect(html).toContain('cb-copy');
  expect(html).not.toContain('cb-exec');
  expect(html).not.toContain('cb-mandato');
  const writable = renderToStaticMarkup(createElement(ItemList, { chatId: 'ordinary', items }));
  expect(writable).toContain('cb-exec');
});
