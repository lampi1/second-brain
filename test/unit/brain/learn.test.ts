// The Miglioramento page's clicks (src/main/brain/learn.ts): only apply/reject of a well-formed proposal id and rollback
// of a well-formed policy reach the brain's improve.mjs (a fake one here, recording its arguments), one at a time; its
// JSON answer becomes the page's message, its {ok:false} error the page's error; no brain or no ops/improve said plainly.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BY, Learn, learnArgs, learnMessage } from '../../../src/main/brain/learn';
import { plainNode, tmpDir } from './helpers';

const brain = (): string => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'ops', 'improve'), { recursive: true });
  // a fake improve.mjs: logs its args; "reject x-9" fails like the real one (exit 1, {ok:false,error})
  fs.writeFileSync(path.join(d, 'ops', 'improve', 'improve.mjs'), [
    "import fs from 'node:fs';",
    'const a = process.argv.slice(2);',
    "fs.appendFileSync(new URL('./args.txt', import.meta.url), JSON.stringify(a) + '\\n');",
    "if (a[1] === 'x-9') { console.log(JSON.stringify({ ok: false, error: 'proposta x-9 non aperta' })); process.exit(1); }",
    "if (a[0] === 'apply') console.log(JSON.stringify({ ok: true, proposal: { id: a[1], domain: 'estimates', status: 'applicata', version: 3 } }));",
    "else if (a[0] === 'reject') console.log(JSON.stringify({ ok: true, proposal: { id: a[1], status: 'rifiutata' } }));",
    "else console.log(JSON.stringify({ ok: true, version: 1, from: 2 }));",
  ].join('\n'));
  return d;
};
const args = (d: string) => fs.readFileSync(path.join(d, 'ops', 'improve', 'args.txt'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[]);

describe('learn clicks', () => {
  it('lets through only the three actions with well-formed names', () => {
    expect(learnArgs({ action: 'apply', id: 'estimates-3' })).toEqual({ ok: true, args: ['apply', 'estimates-3', '--by', BY, '--json'] });
    expect(learnArgs({ action: 'rollback', domain: 'routing' })).toEqual({ ok: true, args: ['rollback', '--domain', 'routing', '--by', BY, '--json'] });
    for (const bad of [{ action: 'apply', id: '--state=x' }, { action: 'apply', id: 'estimates' }, { action: 'reject' }, { action: 'rollback', domain: '../x' }, { action: 'propose' }, null, 'apply'])
      expect(learnArgs(bad).ok).toBe(false);
  });

  it('turns the CLI answer into the page message', () => {
    expect(learnMessage(['apply'], { proposal: { domain: 'estimates', version: 3 } })).toBe('Applicata: estimates ora è alla v3');
    expect(learnMessage(['reject'], {})).toBe('Proposta scartata');
    expect(learnMessage(['rollback'], { version: 1, from: 2 })).toBe('Ripristinata la v1 (era v2)');
  });

  it("runs the brain's improve.mjs, one click at a time, and reports its errors", async () => {
    const d = brain();
    const l = new Learn(() => d, plainNode);
    const [a, b, c] = await Promise.all([l.act({ action: 'apply', id: 'estimates-3' }), l.act({ action: 'rollback', domain: 'estimates' }), l.act({ action: 'reject', id: 'x-9' })]);
    expect(a).toEqual({ ok: true, message: 'Applicata: estimates ora è alla v3' });
    expect(b).toEqual({ ok: true, message: 'Ripristinata la v1 (era v2)' });
    expect(c).toEqual({ ok: false, error: 'non fatto: proposta x-9 non aperta' });
    expect(args(d).map(x => x[0])).toEqual(['apply', 'rollback', 'reject']); // in click order
    expect(await l.act({ action: 'apply', id: '../../x' })).toEqual({ ok: false, error: 'proposta non valida' });
    expect(args(d)).toHaveLength(3); // a bad id never runs anything
  }, 60e3); // three node children in a row: slow under a full parallel run

  it('says when there is no brain or no loop in it', async () => {
    expect(await new Learn(() => null, plainNode).act({ action: 'apply', id: 'estimates-1' })).toEqual({ ok: false, error: 'nessuna cartella del cervello scelta' });
    expect((await new Learn(() => tmpDir(), plainNode).act({ action: 'apply', id: 'estimates-1' })).ok).toBe(false);
  });
});
