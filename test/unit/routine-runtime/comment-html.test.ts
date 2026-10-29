// Work item comments are HTML (DevOps stores them as format 1): the small Markdown agents write (bold, `- ` lists, `#`
// headings, links) must reach DevOps rendered, never as raw ** and [label](url). Escaping and the organization rule hold.
import { describe, expect, it } from 'vitest';
import { createDevOpsClient, createMasker, createRunStore, executeWrites, type RunRecord } from '../../../packages/routine-runtime/src/index';
import { renderDevOpsComment } from '../../../packages/routine-runtime/src/devops-host/devops-content';
import { escalationHtml } from '../../../packages/routine-runtime/src/escalation';
import { fakeDevOps, tempDir } from './fakes';

const LINK = 'https://dev.azure.com/xy/Planning/_workitems/edit/42';

describe('renderDevOpsComment html', () => {
  it('renders bold, lists, headings and organization links as HTML', () => {
    const out = renderDevOpsComment(`# Esito\nIl fix è **pronto**:\n- primo punto\n- [bug](${LINK})\nFine`, 'xy', [], 'html');
    expect(out).toBe(`<h3>Esito</h3>Il fix è <strong>pronto</strong>:<ul><li>primo punto</li><li><a href="${LINK}" rel="noopener noreferrer">bug</a></li></ul>Fine`);
  });

  it('keeps HTML escaped and leaves a link outside the organization as text, without throwing', () => {
    const out = renderDevOpsComment('<script>alert(1)</script> **[x](https://evil.example/p)**\n[y](javascript:alert(1))', 'xy', [], 'html');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).toContain('<strong>[x](https://evil.example/p)</strong>');
    expect(out).toContain('<br/>[y](javascript:alert(1))');
    expect(out).not.toContain('<a ');
  });

  it('keeps plain line breaks and does not touch a lone # or *', () => {
    expect(renderDevOpsComment('a\n\nb #12 * c\n#tag', 'xy', [], 'html')).toBe('a<br/><br/>b #12 * c<br/>#tag');
  });
});

describe('executeWrites comment', () => {
  it('the fake DevOps receives rendered HTML, with mentions, line breaks and the marker untouched', async () => {
    const root = tempDir(), devops = fakeDevOps(), masker = createMasker();
    devops.addItem({ id: 9, fields: { 'System.State': 'New' } });
    const store = createRunStore(root, masker), now = Date.now();
    const run: RunRecord = { schema: 1, runId: 'run-1', routineId: 'demo', routineTitle: 'Demo', status: 'running', attempt: 0, inputs: {}, workItem: 9, createdAt: now, updatedAt: now, steps: [] };
    store.create(run); store.claim('run-1');
    const client = createDevOpsClient({ authorization: devops.authorization, request: devops.request });
    const grant = { organization: 'xy', projects: ['Proj'], ops: ['comment' as const], fields: [] as string[] };
    const out = await executeWrites({ runId: 'run-1', attempt: 1, stepId: 'report', workItem: 9, grant, client, store, masker },
      [{ op: 'comment', text: `**Fatto**: vedi [il bug](${LINK})\n- uno\n<b>no</b> un'altra` }]);
    expect(out.failed).toEqual([]);
    const text = devops.comments.get(9)![0]!.text;
    expect(text).toContain('<strong>Fatto</strong>');
    expect(text).toContain(`<a href="${LINK}"`);
    expect(text).toContain('<ul><li>uno</li></ul>&lt;b&gt;no&lt;/b&gt; un\'altra');
    expect(text).toMatch(/<br\/><small>routine run run-1 · /);
    expect(text).not.toContain('**');
    expect(text).not.toContain('](');
  });
});

describe('escalationHtml', () => {
  it('renders the question Markdown after the mention', () => {
    const out = escalationHtml({ contact: 'c-1', contactName: 'Ada' } as never, 'Serve **una scelta**', 'AI', 'xy');
    expect(out).toBe('AI<br/><a href="#" data-vss-mention="version:2.0,c-1">@Ada</a> Serve <strong>una scelta</strong>');
  });
});
