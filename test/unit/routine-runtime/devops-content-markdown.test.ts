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
  expect(out).toContain('\\[1\\]: https\\://evil.example');
});

it('a bare URL, www host or e-mail never becomes a link, nor swallows the backticks of a code span after it', () => {
  for (const word of ['https://example.com/', 'HTTP://example.com/a', 'ftp://example.com/', 'www.example.com/', 'WWW.example.com', 'a@example.com', 'x.https://e.co', 'example.com/', 'a:']) {
    // html() fails on any <a>, <img> or other active tag
    html(`vedi ${word}\`<img src=x onerror=alert(1)> <a href=/evil>e</a>\` fine`);
    hostile(p => `vedi ${word}\`${p}\` fine`);
  }
  expect(md('https://example.com/`<b>x</b>`')).toBe('https\\://example.com/\\`&lt;b&gt;x&lt;/b&gt;\\`');
  expect(html('mail a@example.com e www.example.com e https://example.com')).toContain('mail a@example.com e www.example.com e https://example.com');
  // a span after a space or after plain punctuation still renders as code
  expect(html('vedi `a` (`b`) **`c`**')).toContain('vedi <code>a</code> (<code>b</code>) <strong><code>c</code></strong>');
});

it('approved links and this run\'s images stay clickable, a URL in their label included', () => {
  const images = [{ id: 'img1', url: 'https://dev.azure.com/xy/_apis/wit/attachments/abc?fileName=a.png', sha256: 'x', name: 'a.png' }];
  const out = marked.parse(renderDevOpsComment('[https://dev.azure.com/xy/p](https://dev.azure.com/xy/p/_workitems/edit/1) `x` ![a@b](attachment:img1)', 'xy', images, 'markdown'), { async: false });
  expect(out).toContain('<a href="https://dev.azure.com/xy/p/_workitems/edit/1">https://dev.azure.com/xy/p</a> <code>x</code>');
  expect(out).toContain('<img src="https://dev.azure.com/xy/_apis/wit/attachments/abc?fileName=a.png" alt="a@b">');
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

/** Each layout with an HTML-only payload must render inert; with link and image syntax it is refused or inert. */
const hostile = (layout: (payload: string) => string) => {
  // html() fails on any tag outside plain formatting (escaped text such as &lt;a href=…&gt; is fine)
  expect(html(layout('<img src=x onerror=alert(1)> <b>x</b> <a href=/evil>e</a>'))).not.toMatch(/<a\s|<img|<b>/i);
  let out: string;
  try { out = html(layout('[click](https://evil.example/x) ![p](https://evil.example/p.png)')); } catch (e) { expect(String(e)).toMatch(/outside the approved|Images must reference/); return; }
  expect(out).not.toMatch(/<a\s|<img/i);
};

it('every line ending a renderer may see splits lines: a lone CR, CRLF, U+2028/2029/0085 never hide plain text in code', () => {
  for (const nl of ['\r', '\r\n', '\n', '\u2028', '\u2029', '\u0085', '\r\r\n', '\n\r']) {
    hostile(p => `a \`b${nl}${nl}${p}${nl}${nl}\` c`);
    hostile(p => `x${nl}\`\`\`${nl}${p}${nl}\`\`\``);
    hostile(p => `\`\`\`${nl}code${nl}\`\`\`${nl}${p}${nl}\`x\``);
  }
  hostile(p => 'a `b\r\n\r' + p + '\n\r` c');
  hostile(p => '```\r\ncode\r```\n' + p);
  // tab, form feed: a tab is plain whitespace, a form feed is refused
  hostile(p => '`a\t' + p + '\tb` c');
  expect(() => md('a `b\f<b>x</b>\f` c')).toThrow(/Invalid comment text/);
});

it('a line only some renderers close a fence on leaves the code, and no later fence is trusted', () => {
  hostile(p => '```\ncode\n```~\n' + p + '\n');
  hostile(p => '~~~\ncode\n~~~`\n' + p + '\n');
  hostile(p => '```\ncode\n```\t\n' + p + '\n');
  hostile(p => '````\ncode\n`````~ \n' + p + '\n');
  // after the ambiguous close a CommonMark renderer is still in the first fence: a later ``` must not reopen raw code
  hostile(p => '```\ncode\n```~\nmore\n```\n' + p + '\n```');
  hostile(p => '```\ncode\n```\t\n\n```\n' + p + '\n```');
  expect(md('```\na\n```~\n```\n<b>x</b>\n```')).toBe('```\na\n```~\n\\`\\`\\`\n&lt;b&gt;x&lt;/b&gt;\n\\`\\`\\`');
  // a clean close keeps the next fence verbatim
  expect(md('```\na\n```\n\n```\n<b>x</b>\n```')).toBe('```\na\n```\n\n```\n<b>x</b>\n```');
});

it('the normal text of a routine still renders well, CRLF included', () => {
  const source = '**Esito**: passato\r\n\r\n## Passi\r\n\r\n1. Login\r\n2. Apri *paziente*\r\n- voce\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n' +
    'Vedi [PR](https://dev.azure.com/xy/p/_git/r/pullrequest/1) e `List<int>`\r\n\r\n```csharp\r\nvar x = new List<int>(); // a\\b (c)\r\n```\r\nfine';
  // a two-letter organization: a neutral example host
  const out = marked.parse(renderDevOpsComment(source, 'xy', [], 'markdown'), { async: false });
  expect(out).toContain('<strong>Esito</strong>: passato');
  expect(out).toContain('<h2>Passi</h2>');
  expect(out).toContain('<li>Apri <em>paziente</em></li>');
  expect(out).toContain('<td>1</td>');
  expect(out).toContain('<code>List&lt;int&gt;</code>');
  expect(out).toContain('<pre><code class="language-csharp">var x = new List&lt;int&gt;(); // a\\b (c)\n</code></pre>');
  expect(out).toContain('<p>fine</p>');
  expect(out).toMatch(/<a href="https:\/\/dev\.azure\.com\/xy\/p\/_git\/r\/pullrequest\/1">PR<\/a>/);
});
