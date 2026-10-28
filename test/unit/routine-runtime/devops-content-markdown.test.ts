// A PR comment keeps its Markdown (bold, lists, code); only what could build a link, an image or HTML is escaped.
// Code spans and fenced blocks stay verbatim; marked (a CommonMark/GFM renderer) proves nothing else can turn active.
import { expect, it } from 'vitest';
import { marked } from 'marked';
import { renderDevOpsComment } from '../../../packages/routine-runtime/src/devops-host/devops-content';

const md = (source: string) => renderDevOpsComment(source, 'contoso', [], 'markdown');
const ALLOWED = new Set(['p', 'code', 'pre', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'del']);
/** Rendered HTML of the comment; fails when anything but plain formatting tags appears (links, images, raw HTML). */
const html = (source: string): string => {
  const out = marked.parse(md(source), { async: false });
  const tags = [...out.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1]!.toLowerCase());
  expect(tags.filter(t => !ALLOWED.has(t)), out).toEqual([]);
  return out;
};

it('a PR comment keeps its Markdown formatting; only link, image and HTML syntax is escaped', () => {
  const out = md('**Commit colpevole:** `abc1234`\n- _TC01_ # | ok\n[x][1] <b>\n\n[1]: https://evil.example');
  expect(out).toContain('**Commit colpevole:** `abc1234`\n- _TC01_ # | ok');
  expect(out).toContain('\\[x\\]\\[1\\] &lt;b&gt;');
  expect(out).toContain('\\[1\\]: https://evil.example');
});

it('code spans keep their content verbatim: no escapes or entities shown in the code', () => {
  expect(md('Firma: `List<int> Get(int[] a)` e `a[0] > 1`.')).toBe('Firma: `List<int> Get(int[] a)` e `a[0] > 1`.');
  const out = html('Firma: `List<int> Get(int[] a)` e `a[0] > 1`.');
  expect(out).toContain('<code>List&lt;int&gt; Get(int[] a)</code>');
  expect(out).toContain('<code>a[0] &gt; 1</code>');
  expect(html('`` a ` [x](https://evil.example) <b> ``')).toContain('<code>a ` [x](https://evil.example) &lt;b&gt;</code>');
});

it('a fenced code block stays verbatim, link, image and HTML syntax included, and stays inert', () => {
  const block = '```csharp\nList<int> Get(int[] a) => a[0] > 1 ? [] : new();\n[x](javascript:alert(1)) ![i](https://evil.example/i.png) <img src=x onerror=alert(1)>\n```';
  expect(md(`Il fix:\n${block}\nfine \\(ok\\)`)).toBe(`Il fix:\n${block}\nfine \\\\\\(ok\\\\\\)`);
  const out = html(`Il fix:\n${block}\n\n~~~\n<b>x</b>\n~~~`);
  expect(out).toContain('List&lt;int&gt; Get(int[] a) =&gt; a[0] &gt; 1');
  expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
  // an unclosed fence runs to the end, as in CommonMark
  expect(md('```\n[x](javascript:alert(1))')).toBe('```\n[x](javascript:alert(1))');
});

it('an unclosed backtick is escaped: no code span forms and the text after it stays escaped', () => {
  expect(md('costo `a[0] > 1 e <b>x</b>')).toBe('costo \\`a\\[0\\] &gt; 1 e &lt;b&gt;x&lt;/b&gt;');
  expect(html('costo `a[0] > 1 e <b>x</b>')).not.toContain('<code>');
  expect(() => md('costo `a [x](javascript:alert(1))')).toThrow(/Invalid DevOps link|outside/);
});

it('no link, image or HTML can be injected around code, whatever the backtick and fence layout', () => {
  const tricks = [
    // a backtick left open on the line before must not steal the delimiters of a later span
    'a `` b\n`` [x](https://evil.example) <b>x</b> `y` ``',
    // a GFM table splits cells on | even inside code: a span holding | stays plain
    '| h | k |\n|---|---|\n| `a|b` `[x](https://evil.example)` | <b>x</b> |',
    // a fence indented by 1-3 spaces is not recognized: its backticks are escaped, so its closer opens a real fence
    ' ```\nhello\n```\n<b>x</b> [x](https://evil.example)\n```',
    // a fence right after a table row may belong to the table in some renderers: it stays plain
    '| h |\n|---|\nfoo\n```\n<b>x</b> ![i](https://evil.example/i.png)\n```',
    // fence-like tildes that are not a fence are escaped
    '  ~~~\n<b>x</b>\n~~~ weird info\n<i>y</i>',
    // fenced and inline code mixed with a list and an indented code block
    '- item\n  ```\n  `[x](https://evil.example)`\n```\n<b>x</b>\n```\n    <b>indented</b>',
    '``` `x` [x](https://evil.example)\n<b>x</b>',
    'text\n```js\n<script>alert(1)</script>\n```\n<b>x</b> `<img src=x onerror=1>`',
  ];
  for (const source of tricks) {
    let out: string;
    try { out = html(source); } catch (e) { expect(String(e)).toMatch(/Invalid DevOps link|outside the approved|Images must reference/); continue; }
    expect(out, source).not.toMatch(/<a\s|<img|<script|<b>|<i>|href=/i);
  }
});
