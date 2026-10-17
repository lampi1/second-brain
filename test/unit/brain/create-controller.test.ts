import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { BrainCreationController } from '../../../src/main/brain/create-controller';
import type { CreateBrainRequest } from '../../../src/shared/brain-create';

const fields: CreateBrainRequest = { name: 'Test user', role: 'Consultant', language: 'it', harness: 'claude', folderName: 'Personal memory' };
function fixture() {
  let root: string | null = null;
  let revision = 0;
  const parent = path.resolve('fixture-parent');
  const create = vi.fn(async (destination: string) => ({ root: destination }));
  const connect = vi.fn(async (next: string) => { root = next; });
  const chooseParent = vi.fn(async (): Promise<string | null> => parent);
  const controller = new BrainCreationController({ creator: { capability: () => ({ available: true }), create }, connect, chooseParent, currentRoot: () => root, selectionRevision: () => revision, engineKnown: id => id === 'claude' });
  return { controller, parent, create, connect, chooseParent, select: (next: string) => { root = next; revision++; } };
}
describe('main brain creation controller', () => {
  it('takes the parent only from the picker and forwards only supported fields', async () => {
    const f = fixture();
    expect(await f.controller.create({ ...fields, destination: '/injected', userConfig: true } as CreateBrainRequest)).toEqual({ root: path.join(f.parent, fields.folderName), connected: true });
    expect(f.create.mock.calls).toEqual([[path.join(f.parent, fields.folderName), { name: fields.name, role: fields.role, language: 'it', harness: 'claude' }]]);
    expect(f.connect).toHaveBeenCalledTimes(1);
  });
  it('rejects traversal, reserved paths, unknown engines and concurrent calls before another picker', async () => {
    const f = fixture();
    for (const folderName of ['..', 'A/B', 'C:drive', 'CON', 'nul.txt', 'trailing.', ' leading']) await expect(f.controller.create({ ...fields, folderName })).rejects.toThrow(/Controlla/);
    await expect(f.controller.create({ ...fields, harness: 'missing' })).rejects.toThrow(/Controlla/);
    expect(f.chooseParent).not.toHaveBeenCalled();
    let release!: (parent: string | null) => void;
    f.chooseParent.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = f.controller.create(fields);
    await expect(f.controller.create(fields)).rejects.toThrow(/già in preparazione/);
    release(null); expect(await first).toBeNull(); expect(f.create).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it('does not overwrite a later brain choice while the template installer is running', async () => {
    const f = fixture(); let finish!: (value: { root: string }) => void;
    f.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.controller.create(fields);
    await vi.waitFor(() => expect(f.create).toHaveBeenCalled());
    f.select('/later-user-choice'); finish({ root: '/created-memory' });
    expect(await pending).toEqual({ root: '/created-memory', connected: false }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('keeps a later choice even when the user returns to the original brain during creation', async () => {
    const f = fixture(); f.select('/original'); let finish!: (value: { root: string }) => void;
    f.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.controller.create(fields); await vi.waitFor(() => expect(f.create).toHaveBeenCalled());
    f.select('/other'); f.select('/original'); finish({ root: '/created-memory' });
    expect(await pending).toEqual({ root: '/created-memory', connected: false }); expect(f.connect).not.toHaveBeenCalled();
  });
});
