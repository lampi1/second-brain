// MCP form conversion keeps server constraints, maps explicit user choices to typed values, and fails closed.
import { expect, it } from 'vitest';
import { mcpForm, mcpFormAnswer } from '../../src/shared/mcp-form';

it('maps primitive fields and optional omissions without inventing defaults', () => {
  const form = mcpForm({ type: 'object', properties: { label: { type: 'string', minLength: 2, maxLength: 20 }, confirm: { type: 'boolean', default: true }, count: { type: 'integer', minimum: 1, maximum: 3 }, mode: { type: 'string', enum: ['fast', 'safe'] }, optional: { type: 'string', default: 'unused' } }, required: ['label', 'confirm', 'count', 'mode'] });
  expect(mcpFormAnswer(form, { label: 'Example', confirm: 'No', count: '2', mode: 'safe', optional: 'Non compilare' })).toEqual({ label: 'Example', confirm: false, count: 2, mode: 'safe' });
  expect(() => mcpFormAnswer(form, { label: 'Example', confirm: 'Sì', count: '4', mode: 'safe' })).toThrow('intervallo');
  expect(() => mcpFormAnswer(form, { label: 'Example', count: '2', mode: 'safe' })).toThrow('confirm');
  expect(() => mcpFormAnswer(form, { label: 'Example', confirm: 'Sì', count: '2', mode: 'made-up' })).toThrow('mode');
});

it('rejects unsupported constraints, nested fields, credentials and malformed required lists', () => {
  for (const properties of [{ value: { type: 'object' } }, { password: { type: 'string' } }, { value: { type: 'string', pattern: '^safe$' } }, { value: { type: 'number', maximum: NaN } }, { value: { type: 'number', minimum: 5, maximum: 2 } }, { value: { type: 'string', title: '\u202eUnsafe' } }]) {
    expect(() => mcpForm({ type: 'object', properties })).toThrow();
  }
  expect(() => mcpForm({ type: 'object', properties: {}, required: ['missing'] })).toThrow();
  expect(() => mcpForm({ type: 'object', properties: { value: { type: 'string', description: 'Enter your API key' } } })).toThrow('login');
  expect(() => mcpForm({ type: 'object', properties: { value: { type: 'string' } } }, 'Enter the password for the account')).toThrow('login');
  expect(() => mcpForm({ type: 'object', description: 'Paste your secret', properties: { value: { type: 'string' } } })).toThrow('login');
  expect(mcpForm({ type: 'object', properties: {} }).questions).toEqual([]);
});

it('shows field bounds and preserves valid empty or whitespace-bearing strings', () => {
  const form = mcpForm({ type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 }, value: { type: 'string' } }, required: ['count', 'value'] });
  expect(form.questions[0]!.header).toContain('Minimo: 1');
  expect(form.questions[0]!.header).toContain('Massimo: 3');
  expect(mcpFormAnswer(form, { count: '2', value: '' })).toEqual({ count: 2, value: '' });
  expect(mcpFormAnswer(form, { count: '2', value: '  exact  ' })).toEqual({ count: 2, value: '  exact  ' });
});
