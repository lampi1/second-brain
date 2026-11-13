// The MCP tool set of the browser, checked as data: names, count (Cursor warns above 40), descriptions and JSON
// schemas that every client accepts (arrays with items, no type unions, required keys declared).
import { describe, expect, it } from 'vitest';
import { browserTools } from '../../src/main/browser/tools';
import type { BrowserTabs } from '../../src/main/browser/tabs';
import type { BrowserActions } from '../../src/main/browser/actions';

const tools = browserTools({} as BrowserTabs, {} as BrowserActions, () => ({ group: 'g', owner: null, chatId: null }));

function walk(schema: unknown, at: string, problems: string[]): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.type)) problems.push(`${at}: type union ${JSON.stringify(s.type)}`);
  if (s.type === 'array' && !s.items) problems.push(`${at}: array without items`);
  if (s.type === 'object' && s.properties) {
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in (s.properties as object))) problems.push(`${at}: required "${r}" not in properties`);
    for (const [k, v] of Object.entries(s.properties as object)) walk(v, `${at}.${k}`, problems);
  }
  if (s.items) walk(s.items, `${at}[]`, problems);
}

describe('browser MCP tools', () => {
  it('has unique snake_case names, at most 30 tools, and the Claude-pane style core set', () => {
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeLessThanOrEqual(30);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z_]*$/);
    expect(names).toEqual(expect.arrayContaining([
      'tabs_list', 'tabs_create', 'tabs_select', 'tabs_close', 'navigate', 'screenshot', 'read_page', 'find', 'get_page_text', 'click',
      'hover', 'type', 'key', 'scroll', 'select_option', 'fill_form', 'wait_for', 'handle_dialog', 'network_requests', 'console_messages',
      'javascript', 'handoff_to_user',
    ]));
  });

  it('describes every tool and gives every tool a portable JSON schema', () => {
    const problems: string[] = [];
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type, t.name).toBe('object');
      walk(t.inputSchema, t.name, problems);
    }
    expect(problems).toEqual([]);
  });

  it('marks read-only tools as such', () => {
    const ro = tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name);
    expect(ro).toEqual(expect.arrayContaining(['tabs_list', 'screenshot', 'read_page', 'find', 'get_page_text', 'network_requests', 'console_messages']));
    expect(ro).not.toContain('click');
  });
});

describe('screenshot attachments (issue #83)', () => {
  it('the screenshot tool tells the agent to write the saved path to show it to the user', () => {
    expect(tools.find(t => t.name === 'screenshot')?.description).toMatch(/write that Saved path in your message, question or report/);
  });
});
