// Unit tests of renderer/lib/leave-ghost.ts visibleClone: the fading copy of a strip the app closed copies what shows and
// leaves out the content of a folded work area (a collapsed strip's whole transcript and input), with a tiny fake DOM.
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeEl {
  childNodes: FakeEl[] = [];
  constructor(public cls: string[] = [], kids: FakeEl[] = []) { this.childNodes = kids; }
  matches(sel: string): boolean { return sel === '.chat-work:not(.expanded)' && this.cls.includes('chat-work') && !this.cls.includes('expanded'); }
  querySelector(sel: string): FakeEl | null {
    for (const k of this.childNodes) { if (k.matches(sel)) return k; const f = k.querySelector(sel); if (f) return f; }
    return null;
  }
  cloneNode(deep: boolean): FakeEl { return new FakeEl([...this.cls, 'copy'], deep ? this.childNodes.map(k => k.cloneNode(true)) : []); }
  appendChild(k: FakeEl): void { this.childNodes.push(k); }
  count(): number { return 1 + this.childNodes.reduce((n, k) => n + k.count(), 0); }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('visibleClone', () => {
  it('copies an expanded strip whole and a folded one without its work area\'s content', async () => {
    vi.stubGlobal('Element', FakeEl);
    const { visibleClone } = await import('../../src/renderer/lib/leave-ghost');
    const transcript = () => new FakeEl(['chat-work-inner'], Array.from({ length: 50 }, () => new FakeEl(['msg'])));
    const strip = (expanded: boolean) => new FakeEl(['row'], [new FakeEl(['tile-head'], [new FakeEl(['title'])]), new FakeEl(['chat-work', ...(expanded ? ['expanded'] : [])], [transcript()])]);
    const open = strip(true);
    expect((visibleClone(open as unknown as Element) as unknown as FakeEl).count()).toBe(open.count());
    const folded = visibleClone(strip(false) as unknown as Element) as unknown as FakeEl;
    expect(folded.count()).toBe(4); // the row, its head and title, the empty work area (same box: max-height 0)
    expect(folded.childNodes[1]!.cls).toContain('chat-work');
    expect(folded.childNodes[1]!.childNodes).toHaveLength(0);
  });
});
