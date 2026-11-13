// lib/viz/mermaid-contrast.ts (ADR 0275): a box the model coloured gets a text colour that reads on it; its own colour stays.
import { describe, expect, it } from 'vitest';
import { luminance, readableMermaid } from '../../src/renderer/lib/viz/mermaid-contrast';

describe('readableMermaid', () => {
  it('reads #rgb, #rrggbb and rgb()', () => {
    expect(luminance('#fff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('rgb(255, 255, 255)')).toBeCloseTo(1);
    expect(luminance('lightgreen')).toBeNull();
  });
  it('dark text on a light fill, light text on a dark one', () => {
    const code = ['flowchart TD', '  A[Server] --> B[Fetta]', '  classDef done fill:#c8e6c9,stroke:#2e7d32', '  classDef todo fill:#fff9c4;', '  style B fill:#263238,stroke:#000'].join('\n');
    expect(readableMermaid(code).split('\n')).toEqual(['flowchart TD', '  A[Server] --> B[Fetta]', '  classDef done fill:#c8e6c9,stroke:#2e7d32,color:#16181d', '  classDef todo fill:#fff9c4,color:#16181d;', '  style B fill:#263238,stroke:#000,color:#f5f6f8']);
  });
  it('keeps a colour the model chose, and lines without a fill', () => {
    const code = 'classDef a fill:#eee,color:#333\nclassDef b stroke:#f00\nA --> B';
    expect(readableMermaid(code)).toBe(code);
  });
});
