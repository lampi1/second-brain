// Unit tests of the block copy of the brain's markdown (components/Markdown.tsx) as the file viewer uses it
// (copyBlocks): a Copia button per code block in the UI language, inline code left alone, and the copied text is the
// block exactly (indentation, inner blank lines and a 300-character line kept; only marked's final line end dropped).
import { afterEach, describe, expect, it } from 'vitest';
import { blockText, withCopy } from '../../../src/renderer/brain/components/Markdown';
import { setLang } from '../../../src/renderer/i18n';

const LONG = 'x'.repeat(290) + ' END-OF-LINE';
const html = `<p>Lancia <code>node a.mjs</code>.</p><pre><code class="language-sh">${LONG}\n</code></pre>`;

afterEach(() => setLang('it'));

describe('withCopy for the file viewer (blocks only)', () => {
  it('one Copia button per block, inline code is not made clickable', () => {
    const out = withCopy(html, false);
    expect(out).toContain('<button type="button" class="bx-btn s bx-pre-copy" data-copy="block" title="Copia il blocco negli appunti" aria-live="polite">Copia</button>');
    expect(out).toContain('<code>node a.mjs</code>');
    expect(out.match(/data-copy=/g)).toHaveLength(1);
  });
  it('the label follows the UI language', () => {
    setLang('en');
    expect(withCopy(html, false)).toContain('title="Copy the block to the clipboard" aria-live="polite">Copy</button>');
  });
});

describe('blockText', () => {
  it('is the block exactly, without the final line end marked adds', () => {
    expect(blockText(`${LONG}\n`)).toBe(LONG);
    expect(LONG).toHaveLength(302);
  });
  it('keeps indentation, inner blank lines and trailing spaces', () => {
    const code = 'if x:\n    y = 1  \n\n\tz()';
    expect(blockText(`${code}\n`)).toBe(code);
  });
  it('drops only one line end', () => {
    expect(blockText('a\n\n')).toBe('a\n');
    expect(blockText('a')).toBe('a');
  });
});
