// Drag filtering admits supported archives/directories without swallowing unrelated avatar or text drops.
import { describe, expect, it } from 'vitest';
import { acceptsPackDrop } from '../../src/renderer/lib/agent-pack-ui';
import { agentPackIt } from '../../src/renderer/i18n/areas/agent-pack.it';
import { agentPackEn } from '../../src/renderer/i18n/areas/agent-pack.en';
describe('agent pack UI boundaries', () => {
  it('accepts only portable archives or actual directories', () => {
    for (const name of ['review.sbagent', 'review.ZIP']) expect(acceptsPackDrop(name, false)).toBe(true);
    for (const name of ['avatar.png', 'secret.txt', 'agent.exe', 'archive.zip.exe']) expect(acceptsPackDrop(name, false)).toBe(false);
    expect(acceptsPackDrop('plugin', true)).toBe(true);
  });
  it('supplies every pack label in both languages', () => {
    expect(Object.keys(agentPackEn).sort()).toEqual(Object.keys(agentPackIt).sort());
    expect(Object.values(agentPackEn).every(text => text.trim())).toBe(true);
  });
});
