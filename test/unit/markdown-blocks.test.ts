// splitBlocks (src/renderer/lib/markdown.ts): a streaming answer is cut into top-level blocks so that only the last one
// is re-parsed each frame. The cuts must never break a code fence or a list item's continuation, and the blocks must
// give back the text.
import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../../src/renderer/lib/markdown';

describe('splitBlocks', () => {
  it('cuts at blank lines and gives back the text', () => {
    const t = 'Primo paragrafo\nsegue.\n\nSecondo.\n\n- uno\n- due';
    const b = splitBlocks(t);
    expect(b).toEqual(['Primo paragrafo\nsegue.', 'Secondo.', '- uno\n- due']);
    expect(b.join('\n\n')).toBe(t);
  });

  it('never cuts inside a code fence', () => {
    const t = 'Prima\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nDopo';
    expect(splitBlocks(t)).toEqual(['Prima', '```ts\nconst a = 1;\n\nconst b = 2;\n```', 'Dopo']);
  });

  it('keeps an open fence (still streaming) in the tail', () => {
    expect(splitBlocks('Testo\n\n```\ncodice\n\naltro')).toEqual(['Testo', '```\ncodice\n\naltro']);
  });

  it('a fence closes only with its own character, at least as long, and nothing after it', () => {
    const t = 'Ecco:\n\n```bash\ncat <<EOF\n~~~\n\n```js\n\necho ok\n```\n\nPoi spiego.';
    expect(splitBlocks(t)).toEqual(['Ecco:', '```bash\ncat <<EOF\n~~~\n\n```js\n\necho ok\n```', 'Poi spiego.']);
    expect(splitBlocks('````\na\n```\n\nb\n````\n\nc')).toEqual(['````\na\n```\n\nb\n````', 'c']);
  });

  it('never cuts before an indented continuation of a list item', () => {
    const t = '1. punto\n\n   continua il punto\n2. altro';
    expect(splitBlocks(t)).toEqual([t]);
  });

  it('a trailing blank line stays in the tail (the next block has not started yet)', () => {
    expect(splitBlocks('Fatto.\n\n')).toEqual(['Fatto.\n\n']);
    expect(splitBlocks('')).toEqual(['']);
  });
});
