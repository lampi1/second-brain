// Real IPC wrapper with inert Electron endpoints: a browser frame cannot mutate the private section registry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, arg: unknown) => Promise<unknown>>());
vi.mock('electron', () => ({ ipcMain: { removeHandler: (name: string) => calls.delete(name), handle: (name: string, handler: (event: IpcMainInvokeEvent, arg: unknown) => Promise<unknown>) => calls.set(name, handler) } }));
import { registerHandlers, setAppPage, type Handlers } from '../../src/main/ipc';
import { INVOKE_CHANNELS } from '../../src/shared/contract';
import { updateActivity } from '../../src/main/update/activity';
import { SectionController } from '../../src/main/extensions/controller';
import fixture from '../fixtures/extensions/pratiche.json';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); calls.clear(); });
it('requires the exact app top-frame and honors the update freeze for mutations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sections-ipc-')); roots.push(root);
  const file = path.join(root, 'index.html'); fs.writeFileSync(file, '<!doctype html>');
  const frame = { url: pathToFileURL(file).href }, contents = { mainFrame: frame } as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  setAppPage(frame.url);
  const controller = new SectionController(path.join(root, 'private'), async () => false);
  const handlers = {} as Handlers;
  for (const channel of INVOKE_CHANNELS) handlers[channel] = () => { throw new Error('Unexpected channel in focused IPC fixture'); };
  handlers['sections:register'] = arg => controller.register(arg);
  handlers['sections:list'] = () => controller.list();
  registerHandlers(handlers, () => contents);
  const register = calls.get('sections:register')!, list = calls.get('sections:list')!;
  const mutation = { manifest: fixture, expectedRevision: 0 };
  await expect(register({ ...event, senderFrame: { url: frame.url } } as unknown as IpcMainInvokeEvent, mutation)).rejects.toThrow('forbidden sender');
  await expect(register({ ...event, sender: { mainFrame: frame } } as unknown as IpcMainInvokeEvent, mutation)).rejects.toThrow('forbidden sender');
  const release = updateActivity.acquire();
  try { await expect(register(event, mutation)).rejects.toThrow(); expect(await list(event, undefined)).toEqual({ revision: 0, sections: [] }); }
  finally { release(); }
  expect(await register(event, mutation)).toMatchObject({ revision: 1, sections: [fixture] });
});
