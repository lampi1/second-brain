// The Orchestrator's order of the agents (lib/agent-order.ts) and the options a custom Select reads from its
// children (components/Select.tsx optionsOf): pure, no DOM.
import { describe, expect, it } from 'vitest';
import { createElement, Fragment } from 'react';
import { agentGroups, agentOrder, areaOf } from '../../src/renderer/lib/agent-order';
import { optionsOf } from '../../src/renderer/components/Select';

const chats = {
  a: { cwd: 'C:\\repos\\portal' },
  b: { cwd: 'C:/repos/brain/' },
  c: { cwd: 'C:\\repos\\portal\\' },
  d: { cwd: '' },
  e: { cwd: 'C:/repos/brain' },
};

describe('the Orchestrator order', () => {
  it('the area is the last folder of the working directory, whatever the slashes', () => {
    expect(areaOf({ cwd: 'C:\\repos\\portal' })).toBe('portal');
    expect(areaOf({ cwd: 'C:/repos/brain/' })).toBe('brain');
    expect(areaOf({ cwd: '' })).toBe('');
  });
  it('groups by area in the order of each group\'s first agent, start order inside, unknown ids dropped', () => {
    expect(agentGroups(['a', 'b', 'x', 'c', 'd', 'e'], chats)).toEqual([
      { area: 'portal', ids: ['a', 'c'] },
      { area: 'brain', ids: ['b', 'e'] },
      { area: '', ids: ['d'] },
    ]);
    expect(agentOrder(['a', 'b', 'x', 'c', 'd', 'e'], chats)).toEqual(['a', 'c', 'b', 'e', 'd']);
  });
  it('a state change never moves a row: the order depends only on start order and folders', () => {
    const before = agentOrder(['a', 'b', 'c'], chats);
    expect(agentOrder(['a', 'b', 'c'], { ...chats, a: { ...chats.a, state: 'waiting' } as never })).toEqual(before);
  });
});

describe('Select options', () => {
  it('reads <option>s through fragments and <optgroup>s, value defaulting to the text', () => {
    const children = [
      createElement('option', { key: 1, value: '' }, 'Scegli'),
      createElement(Fragment, { key: 2 }, createElement('option', { value: 'claude' }, 'Claude'), createElement('option', { disabled: true }, 'Cursor')),
      createElement('optgroup', { key: 3, label: 'Altri' }, createElement('option', { value: 7 }, 'Sette')),
      'testo',
    ];
    expect(optionsOf(children).map(({ value, text, disabled, group }) => ({ value, text, disabled, group }))).toEqual([
      { value: '', text: 'Scegli', disabled: false, group: undefined },
      { value: 'claude', text: 'Claude', disabled: false, group: undefined },
      { value: 'Cursor', text: 'Cursor', disabled: true, group: undefined },
      { value: '7', text: 'Sette', disabled: false, group: 'Altri' },
    ]);
  });
});
