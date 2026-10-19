// Unit tests of src/shared/explain.ts: the plain Italian line over every tool call (Claude by tool name, Cursor by ACP
// kind and title, MCP tools by server and action) and the raw command kept for the folded part.
import { describe, expect, it } from 'vitest';
import { actionWords, baseName, explainTool, serverName } from '../../src/shared/explain';

describe('explainTool', () => {
  it('names that are Object.prototype keys never break it', () => {
    expect(explainTool('mcp__sb-browser__constructor', { url: 'https://x.test' }).line).toMatch(/^Browser/);
    expect(explainTool('mcp__x__toString', {}).line).toContain('toString');
  });

  it('Bash and PowerShell: the description the model wrote, the command folded', () => {
    expect(explainTool('Bash', { command: 'npm run test:e2e', description: 'lancia la suite end-to-end' })).toEqual({ line: 'Lancia la suite end-to-end', raw: 'npm run test:e2e' });
    expect(explainTool('PowerShell', { command: 'Get-ChildItem' })).toEqual({ line: 'Esegue Get-ChildItem', raw: 'Get-ChildItem' });
    expect(explainTool('Bash', { command: 'git commit -am "fix(x): y"' }).line).toBe('Esegue git commit');
    expect(explainTool('Bash', { command: '"$(pwd)" | x' }).line).toBe('Esegue un comando nel terminale');
  });

  it('files: a sentence from the parameters', () => {
    expect(explainTool('Read', { file_path: 'C:\\Users\\x\\my-brain\\now.md' })).toEqual({ line: 'Legge now.md', raw: 'C:\\Users\\x\\my-brain\\now.md' });
    expect(explainTool('Edit', { file_path: 'src/a/b.ts', old_string: 'x', new_string: 'y' }).line).toBe('Modifica b.ts');
    expect(explainTool('Write', { file_path: '/tmp/out.json' }).line).toBe('Scrive out.json');
    expect(explainTool('Grep', { pattern: 'TODO', path: 'src/main' }).line).toBe('Cerca «TODO» in main');
    expect(explainTool('Glob', { pattern: '**/*.tsx' }).line).toBe('Cerca i file **/*.tsx');
    expect(explainTool('WebFetch', { url: 'https://example.com/a?b=1' }).line).toBe('Apre example.com');
    expect(explainTool('Agent', { description: 'review the diff', prompt: 'long' }).line).toBe('Affida a un agente: review the diff');
  });

  it('Cursor kinds: the title when the input says little, the command from rawInput', () => {
    expect(explainTool('Shell', { command: 'npm test' }, '`npm test`')).toEqual({ line: 'Esegue npm test', raw: 'npm test' });
    expect(explainTool('Shell', {}, 'Run tests for orders')).toEqual({ line: 'Run tests for orders', raw: 'Run tests for orders' });
    expect(explainTool('Read', { path: 'src/app.ts' }, 'Read app.ts').line).toBe('Legge app.ts');
    expect(explainTool('Edit', {}, 'Edit src/app.ts').line).toBe('Edit src/app.ts');
    expect(explainTool('Search', { query: 'Recalculate' }).line).toBe('Cerca «Recalculate»');
    expect(explainTool('Tool', {}, 'qualcosa di nuovo').line).toBe('Qualcosa di nuovo');
  });

  it('MCP tools: a readable server and action', () => {
    expect(explainTool('mcp__my-devops__wit_get_work_item', { id: 1 }).line).toBe('Azure DevOps: legge work item');
    expect(explainTool('mcp__my-devops__repo_get_pull_request_by_id', {}).line).toBe('Azure DevOps: legge pull request');
    expect(explainTool('mcp__second-brain__navigate', { url: 'https://test.example.com/x' }).line).toBe('Browser dell’app: apre test.example.com');
    expect(explainTool('mcp__second-brain__screenshot', {}).line).toBe('Browser dell’app: fa uno screenshot');
    // the delegation tools say who gets the work and what comes back, never "Browser" (ADR 0083)
    expect(explainTool('mcp__second-brain__agent_delegate', { tasks: [{ role: 'scout', title: 'Log errori' }, { role: 'sentinel', title: 'Test' }] }).line).toBe('Delega «Log errori» (Scout), «Test» (Sentinel)');
    expect(explainTool('mcp__second-brain__agent_report', { summary: 'Trovati 3 errori' }).line).toBe('Consegna il risultato: Trovati 3 errori');
    expect(explainTool('mcp__second-brain__agent_children', {}).line).toBe('Controlla le chat delegate');
    expect(explainTool('mcp__claude_ai_Gmail__search_threads', { query: 'fattura' })).toEqual({ line: 'Gmail: cerca threads', raw: 'search_threads · fattura' });
    expect(explainTool('mcp__sb-browser__browser_click', {}).line).toBe('Browser dell’app: clicca nella pagina');
  });

  it('helpers', () => {
    expect(baseName('C:\\a\\b\\')).toBe('b');
    expect(serverName('claude_ai_Google_Drive')).toBe('Google Drive');
    expect(actionWords('wit_my_work_items')).toBe('legge i tuoi work items');
    expect(actionWords('strange')).toBe('strange');
  });
});
