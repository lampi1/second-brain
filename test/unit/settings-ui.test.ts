// The Settings page's pure parts: the model choices of "Chat aperte dall'Orchestrator" (lib/models.ts), the spending
// limit amounts and the MCP port (lib/settings-page.ts) and the Ctrl+, shortcut that opens the page (lib/keys.ts).
import { describe, expect, it } from 'vitest';
import { resolveShortcut } from '../../src/renderer/lib/keys';
import { MODELS, modelOptions } from '../../src/renderer/lib/models';
import { matchesSettingsSearch, parseUsd, portOf } from '../../src/renderer/lib/settings-page';

describe('model choices (lib/models.ts)', () => {
  const seen = { cursor: { at: 1, ids: [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: '' }] } };
  it('Cursor: the list its CLI offered when there is one, else the built-in list; always the CLI default first', () => {
    expect(modelOptions('cursor', seen).map(m => m.id)).toEqual(['', 'grok-4.7', 'gpt-5']);
    expect(modelOptions('cursor', seen)[2]!.label).toBe('gpt-5');
    expect(modelOptions('cursor', null)).toEqual(MODELS.cursor);
    expect(modelOptions('claude', seen)).toEqual(MODELS.claude);
  });
  it('keeps an id already chosen even when the list does not have it', () => {
    expect(modelOptions('cursor', seen, 'grok-4.7-fast').at(-1)).toEqual({ id: 'grok-4.7-fast', label: 'grok-4.7-fast' });
    expect(modelOptions('cursor', seen, 'grok-4.7')).toHaveLength(3);
  });
});

describe('spending limit amounts and the MCP port (lib/settings-page.ts)', () => {
  it('reads $ amounts like the main process checks them; thousands separators are refused, never read as 1 $', () => {
    expect(parseUsd('')).toBeNull();
    expect(parseUsd(' 50 ')).toBe(50);
    expect(parseUsd('12,5')).toBe(12.5);
    expect(parseUsd('12.34')).toBe(12.34);
    expect(parseUsd('1000000')).toBe(1e6);
    for (const t of ['1.000', '1.000,50', '12,341', '0', '0,00', '-3', '2000000', 'abc', '1e3']) expect(parseUsd(t), t).toBe('bad');
  });
  it('shows the port the MCP server listens on, from its url', () => {
    expect(portOf('http://127.0.0.1:52011/mcp')).toBe('52011');
    expect(portOf(undefined)).toBeNull();
    expect(portOf('nonsense')).toBeNull();
  });
});

describe('Ctrl+, opens the settings', () => {
  const key = (o: Partial<{ key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }>) =>
    ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  it('maps Ctrl+Comma, not a plain comma', () => {
    expect(resolveShortcut(key({ key: ',', code: 'Comma', ctrlKey: true }))).toEqual({ type: 'settings' });
    expect(resolveShortcut(key({ key: ',', code: 'Comma' }))).toBeNull();
  });
});

describe('settings search', () => {
  const section = 'Aspetto Densità Compatta mostra più righe nello stesso spazio.';
  it('finds labels, descriptions and section names without accents or case', () => {
    for (const query of ['DENSITA', 'piu righe', 'aspetto', '  ASPETTO   densita  '])
      expect(matchesSettingsSearch(query, section), query).toBe(true);
    expect(matchesSettingsSearch('densità notifiche', section)).toBe(false);
    expect(matchesSettingsSearch('assente', section)).toBe(false);
  });
  it('restores every section for an empty or whitespace-only query and treats punctuation literally', () => {
    expect(matchesSettingsSearch('', section)).toBe(true);
    expect(matchesSettingsSearch('  ', section)).toBe(true);
    expect(matchesSettingsSearch('[.*', section)).toBe(false);
  });
});
