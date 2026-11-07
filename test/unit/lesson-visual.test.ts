// Impara's visuals (ADR 0205, src/shared/lesson-visual.ts): what the model declares is checked and capped (the right
// mermaid header, no directive, link or styling, sizes), a mermaid visual grows one part per beat and still draws when
// cut inside a block, a beat may point only at a known line, symbol or label; parseStep keeps the visual and the role.
// The compare (ADR 0219): two diagrams of the same kind, «Dopo» from the second half of the beats, each side with its
// own SVG id prefix.
import { describe, expect, it } from 'vitest';
import { beatMark, compareAfterShown, compareIds, parseVisual, revealAt, revealMermaid, revealSteps, visualParts, type LessonVisual } from '../../src/shared/lesson-visual';
import { parseStep } from '../../src/shared/lesson';

const SEQ = 'sequenceDiagram\n  participant A as Motore\n  participant B as Store\n  A->>B: pezzo\n  loop ogni fotogramma\n    B->>B: held\n    B-->>A: ok\n  end\n  B->>A: fine';

describe('parseVisual', () => {
  it('keeps each kind well formed', () => {
    expect(parseVisual({ type: 'flow' })).toEqual({ kind: 'flow' });
    expect(parseVisual({ type: 'sequence', mermaid: SEQ })).toEqual({ kind: 'sequence', src: SEQ });
    expect(parseVisual({ type: 'mindmap', mermaid: 'mindmap\n  root((A))\n    B\n    C' })?.kind).toBe('mindmap');
    expect(parseVisual({ type: 'timeline', mermaid: 'timeline\n  title T\n  2019 : a\n  2020 : b' })?.kind).toBe('timeline');
    expect(parseVisual({ type: 'state', mermaid: 'stateDiagram-v2\n  [*] --> A\n  A --> B\n  B --> [*]' })?.kind).toBe('state');
    expect(parseVisual({ type: 'code', file: 'a.ts', code: 'const a = 1;\nconst b = 2;\n' })).toEqual({ kind: 'code', file: 'a.ts', code: 'const a = 1;\nconst b = 2;' });
    expect(parseVisual({ type: 'formula', tex: 'a^2+b^2=c^2', where: [{ sym: 'c', meaning: 'ipotenusa' }, { sym: '', meaning: 'x' }] }))
      .toEqual({ kind: 'formula', tex: 'a^2+b^2=c^2', where: [{ sym: 'c', meaning: 'ipotenusa' }] });
    const chart = parseVisual({ type: 'chart', chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] } });
    expect(chart).toMatchObject({ kind: 'chart', labels: ['a', 'b'] });
    expect(JSON.parse((chart as Extract<LessonVisual, { kind: 'chart' }>).chart)).toMatchObject({ type: 'bar', series: [{ name: 's', data: [1, 2] }] });
  });

  it('refuses a wrong header, directives, links, styling, oversize and bad data', () => {
    expect(parseVisual({ type: 'sequence', mermaid: 'flowchart LR\n a --> b' })).toBeNull();
    expect(parseVisual({ type: 'mindmap', mermaid: 'mindmap\n%%{init: {"theme":"dark"}}%%\n  root((A))\n    B' })).toBeNull();
    expect(parseVisual({ type: 'state', mermaid: 'stateDiagram-v2\n  A --> B\n  click A "https://x"' })).toBeNull();
    expect(parseVisual({ type: 'mindmap', mermaid: 'mindmap\n  root((A))\n    B\n  classDef x fill:#f00' })).toBeNull();
    expect(parseVisual({ type: 'mindmap', mermaid: `mindmap\n  root((A))\n${Array.from({ length: 20 }, (_, i) => `    n${i}`).join('\n')}` })).toBeNull();
    expect(parseVisual({ type: 'code', code: Array.from({ length: 31 }, () => 'x').join('\n') })).toBeNull();
    expect(parseVisual({ type: 'formula', tex: '\\href{https://x}{a}' })).toBeNull();
    expect(parseVisual({ type: 'chart', chart: { labels: ['a'], series: [{ data: [1] }] } })).toBeNull();
    expect(parseVisual({ type: 'chart', chart: { labels: ['a', 'b'], series: [{ data: [1, 'x'] }] } })).toBeNull();
    expect(parseVisual({ type: 'video' })).toBeNull();
    expect(parseVisual('flow')).toBeNull();
  });

  it('counts the parts the checklist caps at 12', () => {
    expect(visualParts({ kind: 'sequence', src: SEQ })).toBe(4);
    expect(visualParts({ kind: 'mindmap', src: 'mindmap\n  root((A))\n    B\n    C' })).toBe(3);
    expect(visualParts({ kind: 'timeline', src: 'timeline\n  title T\n  2019 : a' })).toBe(1);
    expect(visualParts({ kind: 'chart', chart: '{}', labels: ['a', 'b', 'c'] })).toBe(3);
  });
});

describe('revealMermaid', () => {
  it('grows a sequence message by message, keeping who takes part and closing a block it cut open', () => {
    expect(revealSteps('sequence', SEQ)).toBe(5);
    const one = revealMermaid('sequence', SEQ, 1);
    expect(one).toBe('sequenceDiagram\n  participant A as Motore\n  participant B as Store\n  A->>B: pezzo');
    const three = revealMermaid('sequence', SEQ, 3);
    expect(three).toContain('loop ogni fotogramma\n    B->>B: held');
    expect(three.trimEnd().endsWith('end')).toBe(true);
    expect(revealMermaid('sequence', SEQ, 99)).toBe(SEQ);
  });
  it('keeps a timeline\'s title and a mind map\'s root; closes a state\'s composite', () => {
    expect(revealMermaid('timeline', 'timeline\n  title T\n  2019 : a\n  2020 : b', 1)).toBe('timeline\n  title T\n  2019 : a');
    expect(revealMermaid('mindmap', 'mindmap\n  root((A))\n    B\n    C', 2)).toBe('mindmap\n  root((A))\n    B');
    expect(revealMermaid('state', 'stateDiagram-v2\n  state Busy {\n    A --> B\n    B --> C\n  }\n  Busy --> Idle', 2)).toBe('stateDiagram-v2\n  state Busy {\n    A --> B\n  }');
  });
  it('spreads the parts over the beats, all of them at the last', () => {
    expect([0, 1, 2].map(i => revealAt(5, i, 3))).toEqual([2, 4, 5]);
    expect(revealAt(5, 0, 1)).toBe(5);
    expect(revealAt(1, 0, 4)).toBe(1);
  });
});

describe('beat marks and parseStep', () => {
  const code: LessonVisual = { kind: 'code', file: 'a.ts', code: 'a\nb\nc' };
  it('a beat points only at a known line, symbol or label', () => {
    expect(beatMark(code, { lines: [2, 9] })).toEqual({ lines: [2, 3] });
    expect(beatMark(code, { lines: 3 })).toEqual({ lines: [3, 3] });
    expect(beatMark(code, { lines: [4, 5] })).toEqual({});
    expect(beatMark(code, { lines: [2, 1] })).toEqual({});
    expect(beatMark({ kind: 'formula', tex: 'x', where: [{ sym: 'x', meaning: 'm' }] }, { mark: 'x' })).toEqual({ mark: 'x' });
    expect(beatMark({ kind: 'formula', tex: 'x', where: [] }, { mark: 'y' })).toEqual({});
    expect(beatMark({ kind: 'chart', chart: '{}', labels: ['a'] }, { mark: 'a' })).toEqual({ mark: 'a' });
  });
  it('keeps a piece\'s visual and role; its beats name lines, never flowchart nodes', () => {
    const s = parseStep({ title: 'T', role: 'worked', visual: { type: 'code', file: 'a.ts', code: 'a\nb\nc' }, beats: [{ say: 'Uno.', focus: ['x'], lines: [1, 2] }, { say: 'Due.', flow: { from: 'x', to: 'y' } }], text: 't' }, ['x', 'y'], 'p1');
    expect(s.role).toBe('worked');
    expect(s.visual).toEqual({ kind: 'code', file: 'a.ts', code: 'a\nb\nc' });
    expect(s.beats).toEqual([{ say: 'Uno.', focus: [], lines: [1, 2] }, { say: 'Due.', focus: [] }]);
    // a flow visual is the lesson's flowchart: nothing to keep; an unknown role is dropped; a bad visual falls back
    const f = parseStep({ title: 'T', role: 'lecture', visual: { type: 'flow' }, say: 'S.', focus: ['x'] }, ['x'], 'p2');
    expect(f.visual).toBeUndefined();
    expect(f.role).toBeUndefined();
    expect(parseStep({ title: 'T', visual: { type: 'sequence', mermaid: 'nope' }, say: 'S.', focus: ['x'] }, ['x'], 'p3').visual).toBeUndefined();
  });
});

describe('compare (ADR 0219)', () => {
  const BEFORE = 'flowchart LR
  a["Motore"] -->|"100 ms"| b["Store"]
  b --> c["Schermo"]';
  const AFTER = 'flowchart LR
  a["Motore"] -->|"16 ms"| b["Store"]
  b --> c["Schermo"]';
  it('keeps two diagrams of the same kind that differ', () => {
    expect(parseVisual({ type: 'compare', before: BEFORE, after: AFTER })).toEqual({ kind: 'compare', before: BEFORE, after: AFTER });
    expect(visualParts({ kind: 'compare', before: BEFORE, after: AFTER })).toBe(2);
    const seq = 'sequenceDiagram
  A->>B: x';
    expect(parseVisual({ kind: 'compare', before: seq, after: 'sequenceDiagram
  A->>B: y' })?.kind).toBe('compare');
  });
  it('refuses two different kinds, the same picture twice, a missing side, a directive or a link', () => {
    expect(parseVisual({ type: 'compare', before: BEFORE, after: 'sequenceDiagram
  A->>B: x' })).toBeNull();
    expect(parseVisual({ type: 'compare', before: BEFORE, after: BEFORE })).toBeNull();
    expect(parseVisual({ type: 'compare', before: BEFORE })).toBeNull();
    expect(parseVisual({ type: 'compare', before: BEFORE, after: `${AFTER}
  click a "https://x.dev"` })).toBeNull();
    expect(parseVisual({ type: 'compare', before: '%%{init: {}}%%
flowchart LR
 a --> b', after: AFTER })).toBeNull();
    expect(parseVisual({ type: 'compare', before: 'mindmap
  root((A))
    b', after: 'mindmap
  root((A))
    c' })).toBeNull();
  });
  it('«Dopo» joins in the second half of the beats; with one beat or the whole picture both at once', () => {
    expect([0, 1, 2, 3].map(i => compareAfterShown(i, 4))).toEqual([false, false, true, true]);
    expect([0, 1, 2].map(i => compareAfterShown(i, 3))).toEqual([false, false, true]);
    expect(compareAfterShown(0, 1)).toBe(true);
    expect(compareAfterShown(0, 4, true)).toBe(true);
  });
  it('each side has its own SVG id prefix, unique per piece, only safe characters', () => {
    const a = compareIds('p3'), b = compareIds('p4');
    expect(a).toEqual({ before: 'sb-cmp-p3-before', after: 'sb-cmp-p3-after' });
    expect(a.before).not.toBe(a.after);
    expect(new Set([a.before, a.after, b.before, b.after]).size).toBe(4);
    expect(compareIds('x"><script>')).toEqual({ before: 'sb-cmp-xscript-before', after: 'sb-cmp-xscript-after' });
    expect(compareIds('').before).toBe('sb-cmp-x-before');
  });
  it('parseStep keeps a compare', () => {
    const st = parseStep({ title: 'T', say: 'S.', visual: { type: 'compare', before: BEFORE, after: AFTER }, beats: [{ say: 'prima' }, { say: 'dopo' }] }, ['x'], 'p5');
    expect(st.visual?.kind).toBe('compare');
  });
});
