// Repository consent UI: picker cancellation and draft changes cannot grant autonomy before explicit confirmation.
import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodexAutonomy, proposeAutonomy, type AutonomyPort } from '../../src/renderer/components/CodexAutonomy';
import type { SettingProposal } from '../../src/shared/contract';
const proposal = { id: 'p1', key: 'codexAutonomyRoots', after: ['C:/repo'], status: 'pending' } as SettingProposal;
const fixture = (): AutonomyPort => ({ pick: vi.fn(async () => 'C:/repo'), propose: vi.fn(async () => ({ proposal })), confirm: vi.fn(async () => {}) });
it('requests a protected proposal after picking a folder, never confirms automatically', async () => {
  const port = fixture(); expect(await proposeAutonomy([], null, port)).toBe(proposal);
  expect(port.propose).toHaveBeenCalledWith(['C:/repo']); expect(port.confirm).not.toHaveBeenCalled();
});
it('cancelling or selecting a duplicate does nothing; removing also requires a proposal', async () => {
  const port = fixture(); vi.mocked(port.pick).mockResolvedValueOnce(null);
  expect(await proposeAutonomy([], null, port)).toBeNull();
  expect(await proposeAutonomy(['C:/repo'], null, port)).toBeNull(); expect(port.propose).not.toHaveBeenCalled();
  await proposeAutonomy(['C:/repo', 'C:/other'], 'C:/repo', port);
  expect(port.propose).toHaveBeenCalledWith(['C:/other']); expect(port.confirm).not.toHaveBeenCalled();
});
it('propagates validation failure without confirming and renders named removal controls', async () => {
  const port = fixture(); vi.mocked(port.propose).mockResolvedValue({ error: 'Repository non valido' });
  await expect(proposeAutonomy([], null, port)).rejects.toThrow('Repository non valido');
  expect(port.confirm).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(createElement(CodexAutonomy, { roots: ['C:/repo'], bridge: port }));
  expect(html).toContain('Autonomia Codex nei repository'); expect(html).toContain('Aggiungi cartella');
  expect(html).toContain('aria-label="Rimuovi C:/repo"');
});
