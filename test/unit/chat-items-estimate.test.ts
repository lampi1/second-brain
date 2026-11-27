// The user's bubble in the transcript (ChatItems.tsx, ADR 0367): his words only; the app's routing estimate, kept as
// the item's metadata (or still as a line in an older or engine-echoed item), is a small closed chip under it; a
// credentials card item draws the card, a result item one thin row.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';

const state = { chats: {}, items: {}, pending: [] };
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(() => Promise.resolve(null)) } }));
vi.mock('../../src/renderer/store/store', async orig => ({ ...(await orig<object>()), useApp: (sel: (s: typeof state) => unknown) => sel(state) }));
vi.mock('../../src/renderer/actions', () => ({ openChatRef: vi.fn() }));
vi.mock('../../src/renderer/components/AgentAvatar', () => ({ AgentAvatar: () => null }));
import { Item } from '../../src/renderer/components/ChatItems';
import { estimateLine } from '../../src/shared/task-estimate';
import { credentialCardItem } from '../../src/main/appctl/credential-card-tool';

const render = (item: ChatItem) => renderToStaticMarkup(createElement(Item, { item }));

describe('the user bubble and the estimate', () => {
  it('shows the words and a closed chip for the metadata', () => {
    const out = render({ kind: 'user', id: 'u1', at: 1, text: 'parlami di dentia', estimate: { path: 'self', why: '1 lettura, ~10 s' } });
    expect(out).toContain('>parlami di dentia</div>');
    expect(out).toContain('data-testid="msg-estimate"');
    expect(out).toContain('stima · risponde lui');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('1 lettura');
  });
  it('takes an old line out of the words', () => {
    const out = render({ kind: 'user', id: 'u2', at: 1, text: `ciao\n\n${estimateLine({ path: 'tree', why: 'due parti' })}` });
    expect(out).toContain('>ciao</div>');
    expect(out).not.toContain('[app estimate');
    expect(out).toContain('stima · più parti');
  });
  it('a message without an estimate has no chip', () => {
    expect(render({ kind: 'user', id: 'u3', at: 1, text: 'ok vai' })).not.toContain('msg-estimate');
  });
  it('draws the credentials card and the thin result row', () => {
    expect(render(credentialCardItem('e1', 'Air · test3', Date.now()))).toContain('data-testid="credential-card"');
    const res = render({ kind: 'system', id: 'r', at: 1, level: 'info', code: 'resultReady', text: '', params: { role: 'Scout', title: 'Log', summary: 'Tre errori 500. Altro.', chatId: 'x' } });
    expect(res).toContain('class="oc-evt"');
    expect(res).toContain('Tre errori 500');
  });
});
