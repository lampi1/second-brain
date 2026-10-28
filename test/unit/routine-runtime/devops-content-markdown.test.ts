// A PR comment keeps its Markdown (bold, lists, code); only what could build a link, an image or HTML is escaped.
import { expect, it } from 'vitest';
import { renderDevOpsComment } from '../../../packages/routine-runtime/src/devops-host/devops-content';

it('a PR comment keeps its Markdown formatting; only link, image and HTML syntax is escaped', () => {
  const md = renderDevOpsComment('**Commit colpevole:** `abc1234`\n- _TC01_ # | ok\n[x][1] <b>\n\n[1]: https://evil.example', 'contoso', [], 'markdown');
  expect(md).toContain('**Commit colpevole:** `abc1234`\n- _TC01_ # | ok');
  expect(md).toContain('\\[x\\]\\[1\\] &lt;b&gt;');
  expect(md).toContain('\\[1\\]: https://evil.example');
});
