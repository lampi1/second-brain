// Brain themes labels (regression of PR #18): accented stop words in themes.ts STOP ("perché") match after fold()
// strips the accents, so "perche" never ends up in a theme's label.
import { describe, expect, it } from 'vitest';
import { themesOf } from '../../../src/main/search/hybrid/themes';

const DIM = 8;
const unit = (axis: number) => { const v = new Float32Array(DIM); v[axis] = 1; return v; };

describe('themesOf label', () => {
  it('drops the stop word "perché" from labels', async () => {
    const line = (n: number, said: string) => ({ id: n, doc: 'brain:ai-errors.md', line: n * 2, at: 0, v: unit(0),
      text: `- 2026-10-1${n} 10:00 · claude · costi · stale · detto: ${said} perché sì · vero: no` });
    const t = await themesOf('errors', [line(1, 'totali'), line(2, 'stimati'), line(3, 'mensili')], '2026-10-17');
    expect(t.themes).toHaveLength(1);
    expect(t.themes[0]!.label.split(' · '), `label "${t.themes[0]!.label}" holds a stop word`).not.toContain('perche');
  });
});
