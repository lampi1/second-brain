// The Memoria page's view helper (src/renderer/lib/memory-view.ts): brain file paths under the brain root, with the
// root's own separator.
import { describe, expect, it } from 'vitest';
import { brainFile } from '../../../src/renderer/lib/memory-view';

describe('brainFile', () => {
  it('joins a brain-relative path to the root with its separator', () => {
    expect(brainFile('C:\\brain', 'agents/scout/memory.md')).toBe('C:\\brain\\agents\\scout\\memory.md');
    expect(brainFile('/home/u/brain/', 'ai-errors.md')).toBe('/home/u/brain/ai-errors.md');
    expect(brainFile(null, 'now.md')).toBe('now.md');
  });
});
