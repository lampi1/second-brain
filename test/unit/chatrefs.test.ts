// Unit tests of shared/newchat.ts (the "Nuova chat" line: added, recognized, removed) and lib/chatrefs.ts (the chats
// an Orchestrator's app_create_chat / app_send_to_chat rows and messages point to; ADR 0034).
import { describe, expect, it } from 'vitest';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { NEW_CHAT_LINE, NEW_CHAT_TAG, splitNewChat, withNewChat } from '../../src/shared/newchat';
import { chatRefsOf, textChatRefs, titleIndex, titlesKey, toolChatRef } from '../../src/renderer/lib/chatrefs';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
const tool = (id: string, name: string, input: unknown, output?: string, status: Tool['status'] = 'ok', summary = ''): Tool => ({ kind: 'tool', id, at: 1, name, summary, input, status, output });
const asst = (id: string, text: string, streaming?: boolean): ChatItem => ({ kind: 'assistant', id, at: 1, text, ...(streaming ? { streaming } : {}) });
const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, at: 1, text });
const chat = (id: string, title: string, more: Partial<ChatSummary> = {}): ChatSummary => ({ id, title, isRegia: false, ...more } as ChatSummary);

describe('newchat line', () => {
  it('goes first, says its meaning, and comes off again', () => {
    const t = withNewChat('  Controlla i log  ');
    expect(t.startsWith(`${NEW_CHAT_TAG} `)).toBe(true);
    expect(t).toContain('app_create_chat');
    expect(t).toBe(`${NEW_CHAT_LINE}\n\nControlla i log`);
    expect(splitNewChat(t)).toEqual({ newChat: true, text: 'Controlla i log' });
  });
  it('leaves any other message as it is', () => {
    expect(splitNewChat('ciao [nuova chat]')).toEqual({ newChat: false, text: 'ciao [nuova chat]' });
    expect(splitNewChat('[nuova chat]')).toEqual({ newChat: true, text: '' });
  });
});

describe('toolChatRef', () => {
  it('reads the chat an app_create_chat opened from its JSON result', () => {
    const out = JSON.stringify({ chatId: 'c7', title: 'Ordini · Log', harness: 'claude' }, null, 1);
    expect(toolChatRef(tool('t1', 'mcp__app__app_create_chat', { title: 'x' }, out))).toEqual({ chatId: 'c7', title: 'Ordini · Log', how: 'created' });
  });
  it('reads a cut result too, and Cursor\'s generic name with the tool in its summary', () => {
    const cut = '{\n "chatId": "c9",\n "title": "QA · Report",\n "cwd": "C:\\\\x';
    expect(toolChatRef(tool('t1', 'MCP', {}, cut, 'ok', 'MCP: app_create_chat'))).toEqual({ chatId: 'c9', title: 'QA · Report', how: 'created' });
  });
  it('reads the chat app_send_to_chat wrote to from its input', () => {
    expect(toolChatRef(tool('t1', 'mcp__app__app_send_to_chat', { chatId: 'c3', text: 'vai' }, 'sent'))).toEqual({ chatId: 'c3', how: 'sent' });
  });
  it('ignores failed or running calls and other tools', () => {
    expect(toolChatRef(tool('t1', 'mcp__app__app_create_chat', {}, 'il motore è spento', 'error'))).toBeNull();
    expect(toolChatRef(tool('t1', 'mcp__app__app_send_to_chat', { chatId: 'c3' }, undefined, 'running'))).toBeNull();
    expect(toolChatRef(tool('t1', 'mcp__app__app_chats', {}, '[]'))).toBeNull();
    expect(toolChatRef(tool('t1', 'mcp__app__app_create_chat', {}, 'no json'))).toBeNull();
  });
});

describe('textChatRefs', () => {
  const chats = { r: chat('r', 'Regia', { isRegia: true }), a: chat('a', 'Ordini · Fix totale'), b: chat('b', 'Note'), c: chat('c', 'QA · Report') };
  const index = titleIndex(titlesKey(chats));
  it('finds «titles» and bare "Area · cosa" titles, in order of appearance, never the Regia', () => {
    expect(textChatRefs('Ho scritto a QA · Report e a «Note»; poi **Ordini · Fix totale**. La Regia resta.', index)).toEqual(['c', 'b', 'a']);
  });
  it('does not take a short bare word, a longer title or an excluded chat', () => {
    expect(textChatRefs('Note sparse. Ordini · Fix totale2 no.', index)).toEqual([]);
    expect(textChatRefs('«QA · Report»', index, ['c'])).toEqual([]);
  });
  it('gives no chip for a title two chats share', () => {
    const twice = titleIndex(titlesKey({ a: chat('a', 'QA · Report'), b: chat('b', 'QA · Report') }));
    expect(textChatRefs('«QA · Report»', twice)).toEqual([]);
  });
});

describe('chatRefsOf', () => {
  const key = titlesKey({ a: chat('a', 'Ordini · Fix totale'), c: chat('c', 'QA · Report') });
  it('skips the chats the same turn\'s rows already show, and streaming messages', () => {
    const items: ChatItem[] = [
      user('u1', 'apri una chat'),
      tool('t1', 'mcp__app__app_create_chat', {}, JSON.stringify({ chatId: 'a', title: 'Ordini · Fix totale' })),
      asst('a1', 'Aperta «Ordini · Fix totale»; intanto QA · Report aspetta.'),
      user('u2', 'e adesso?'),
      asst('a2', 'Riguarda «Ordini · Fix totale».'),
      asst('a3', 'QA · Report', true),
    ];
    const refs = chatRefsOf(items, key);
    expect(refs.get('a1')).toEqual(['c']);
    expect(refs.get('a2')).toEqual(['a']);
    expect(refs.has('a3')).toBe(false);
    expect(chatRefsOf(items, key).get('a2')).toBe(refs.get('a2')); // same array: the row does not re-render
  });
  it('is empty outside a Regia (no key)', () => {
    expect(chatRefsOf([asst('a1', '«QA · Report»')], '').size).toBe(0);
  });
});
