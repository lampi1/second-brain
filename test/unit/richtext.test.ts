// Unit tests of lib/richtext.ts: which code blocks are a formatted text for colleagues (isRich), the clipboard HTML
// without the app-only attributes (forClipboard) and copyRich's two ways to the clipboard (async Clipboard API, then the
// copy event), with the browser globals stubbed (node environment, no DOM). The rendering itself (marked + DOMPurify)
// is pinned by test/e2e/codeblocks.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyRich, forClipboard, isRich } from '../../src/renderer/lib/richtext';

describe('isRich', () => {
  it('formats md, markdown, mail, teams and comment blocks, any case and spaces', () => {
    for (const l of ['md', 'markdown', 'mail', 'email', 'e-mail', 'teams', 'comment', ' MD ', 'Teams']) expect(isRich(l)).toBe(true);
  });
  it('leaves untagged, plain text and code blocks raw', () => {
    for (const l of ['', 'text', 'txt', 'plain', 'powershell', 'bash', 'json', 'sql', 'ts', null, undefined]) expect(isRich(l)).toBe(false);
  });
});

describe('forClipboard', () => {
  it('drops link targets and copy marks, keeps the link and the formatting', () => {
    const html = '<p><strong>Ciao</strong> vedi <a href="https://x.dev/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">qui</a> e <code data-copy="text">abc-123</code></p>\n<ul>\n<li>uno</li>\n</ul>\n';
    expect(forClipboard(html)).toBe('<meta charset="utf-8"><p><strong>Ciao</strong> vedi <a href="https://x.dev/a?b=1&amp;c=2">qui</a> e <code>abc-123</code></p>\n<ul>\n<li>uno</li>\n</ul>\n');
  });
  it('never touches the text: a sentence that reads like an attribute stays as written', () => {
    const html = '<p>imposta target="_blank" e rel="x"</p><code>data-copy="1"</code>';
    expect(forClipboard(html)).toBe(`<meta charset="utf-8">${html}`);
  });
  it('drops remote images (a tracking pixel the app never loaded), keeps inline ones', () => {
    const html = '<p>a<img src="https://evil.example/p?d=x" width="1" height="1">b<img alt="" src="data:image/png;base64,AA"></p>';
    expect(forClipboard(html)).toBe('<meta charset="utf-8"><p>ab<img alt="" src="data:image/png;base64,AA"></p>');
  });
  it('declares UTF-8 so accents survive the paste', () => {
    expect(forClipboard('<p>però è così</p>')).toBe('<meta charset="utf-8"><p>però è così</p>');
  });
});

describe('copyRich', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  class FakeItem { constructor(readonly parts: Record<string, Blob>) {} }

  it('writes HTML and plain text in one clipboard item', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    expect(await copyRich('<p><b>a</b></p>', '**a**')).toBe(true);
    const item = (write.mock.calls[0] as unknown as [FakeItem[]])[0][0]!;
    expect(Object.keys(item.parts).sort()).toEqual(['text/html', 'text/plain']);
    expect(await item.parts['text/html']!.text()).toBe('<p><b>a</b></p>');
    expect(await item.parts['text/plain']!.text()).toBe('**a**');
  });

  it('without the async API, sets both formats on the copy event', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: async () => { throw new Error('denied'); } } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    const data: Record<string, string> = {};
    let listener: ((e: unknown) => void) | null = null;
    const ev = { clipboardData: { setData: (t: string, v: string) => { data[t] = v; } }, preventDefault: vi.fn() };
    vi.stubGlobal('document', {
      addEventListener: (_t: string, l: (e: unknown) => void) => { listener = l; },
      removeEventListener: () => { listener = null; },
      execCommand: () => { listener?.(ev); return true; },
    });
    expect(await copyRich('<p>x</p>', 'x')).toBe(true);
    expect(data).toEqual({ 'text/html': '<p>x</p>', 'text/plain': 'x' });
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(listener).toBeNull(); // the listener never outlives the copy
  });

  it('says false when nothing reached the clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: async () => { throw new Error('denied'); }, writeText: async () => { throw new Error('denied'); } } });
    vi.stubGlobal('ClipboardItem', FakeItem);
    vi.stubGlobal('document', {
      addEventListener: () => {}, removeEventListener: () => {}, execCommand: () => false,
      createElement: () => { throw new Error('no DOM'); },
    });
    expect(await copyRich('<p>x</p>', 'x')).toBe(false);
  });
});
