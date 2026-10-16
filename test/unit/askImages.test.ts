// Unit tests of renderer lib/askImages.ts: which images a question names, with their captions.
import { describe, expect, it } from 'vitest';
import { imagesIn, withoutImages } from '../../src/renderer/lib/askImages';

const r = String.raw;

describe('imagesIn', () => {
  it('markdown images, file:/// URLs and bare paths, in order, without repeats', () => {
    expect(imagesIn([
      { text: r`Prima: ![oggi](C:\ev\0-prima.png) e dopo C:\ev\1-dopo.jpg, poi file:///C:/ev/con%20spazio.webp` },
      { text: r`di nuovo C:\ev\0-prima.png e ![](<C:\ev\cartella con spazi\x.png>)` },
    ])).toEqual([
      { path: r`C:\ev\0-prima.png`, caption: 'oggi' },
      { path: r`C:\ev\con spazio.webp`, caption: 'con spazio.webp' },
      { path: r`C:\ev\1-dopo.jpg`, caption: '1-dopo.jpg' },
      { path: r`C:\ev\cartella con spazi\x.png`, caption: 'x.png' },
    ]);
  });
  it('an option\'s image is captioned with the option; other files, URLs and relative paths are not images', () => {
    expect(imagesIn([{ text: 'Anteprima C:/ev/b.png', caption: 'Variante B' }])).toEqual([{ path: r`C:\ev\b.png`, caption: 'Variante B' }]);
    expect(imagesIn([{ text: r`C:\ev\a.pdf https://x.example.com/a.png shots/a.png \\host\s\a.png` }])).toEqual([]);
  });
  it('macOS and Linux paths under a usual root: markdown, file:/// and bare; never a URL path or an API route', () => {
    expect(imagesIn([{ text: '![prima](/Users/u/ev/a.png) poi /home/u/ev/b.jpg e file:///tmp/con%20spazio.webp' }])).toEqual([
      { path: '/Users/u/ev/a.png', caption: 'prima' },
      { path: '/tmp/con spazio.webp', caption: 'con spazio.webp' },
      { path: '/home/u/ev/b.jpg', caption: 'b.jpg' },
    ]);
    expect(imagesIn([{ text: 'https://x.example.com/Users/a.png /api/v1/a.png src//home/a.png' }])).toEqual([]);
  });
  it('at most eight', () => {
    expect(imagesIn([{ text: Array.from({ length: 12 }, (_, i) => `C:\\ev\\${i}.png`).join(' ') }])).toHaveLength(8);
  });
});

describe('withoutImages', () => {
  it('drops the markdown images from a plain text', () => {
    expect(withoutImages(r`Ti piace? ![a](C:\ev\a.png) ![b](C:\ev\b.png)`)).toBe('Ti piace?');
    expect(withoutImages('Nessuna immagine')).toBe('Nessuna immagine');
  });
});
