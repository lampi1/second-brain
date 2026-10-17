// First-run creation trusts only a complete release template, reserves a new local folder and never enables hooks.
// The injected installer writes only fixtures: no app, model, global configuration or real installer is executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrainCreator, publishNewBrain } from '../../../src/main/brain/create';
import type { RunResult, runNode } from '../../../src/main/brain/node';
// @ts-expect-error build helper is intentionally plain JS
import { templateManifest } from '../../../scripts/template-manifest.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-create-')));
  roots.push(base);
  const app = path.join(base, 'release-a');
  const template = path.join(app, 'brain-template');
  for (const file of ['install.mjs', 'AGENTS.md', 'me.template.md', 'ops/tools/mem.mjs', 'ops/tools/ctx.mjs', 'ops/tools/chat-prompt.mjs', 'ops/tools/brain-site.mjs']) {
    fs.mkdirSync(path.dirname(path.join(template, file)), { recursive: true });
    fs.writeFileSync(path.join(template, file), '// fixture\n');
  }
  const seal = () => {
    const bytes = JSON.stringify(templateManifest(template));
    fs.writeFileSync(path.join(app, 'brain-template.manifest.json'), bytes);
    fs.writeFileSync(path.join(app, 'release.json'), JSON.stringify({ id: 'release-a', templateManifestSha256: createHash('sha256').update(bytes).digest('hex') }));
  };
  seal();
  const run = vi.fn<typeof runNode>(async (_node, _script, args): Promise<RunResult> => {
    const destination = args[args.indexOf('--output-dir') + 1]!;
    fs.mkdirSync(path.join(destination, 'ops/tools'), { recursive: true });
    for (const file of ['AGENTS.md', 'me.md', 'ops/tools/brain-site.mjs']) fs.writeFileSync(path.join(destination, file), 'fixture');
    return { code: 0, stdout: '', stderr: '' };
  });
  const creator = new BrainCreator({ appPath: app, node: { exe: 'bundled-electron.exe', env: { FIXTURE: 'yes' } }, run });
  const fields = { name: 'Mario Rossi', role: 'consultant', language: 'it' as const, harness: 'codex' };
  return { base, app, template, seal, run, creator, fields, destination: path.join(base, 'Personal brain') };
}

describe.skipIf(process.platform !== 'win32')('verified first-run brain creation', () => {
  it('uses the supplied bundled runtime and argument vector without global settings', async () => {
    const f = fixture();
    expect(f.creator.capability()).toEqual({ available: true });
    await expect(f.creator.create(f.destination, f.fields)).resolves.toEqual({ root: f.destination });
    const [node, script, args, cwd, timeout] = f.run.mock.calls[0]!;
    expect(node).toEqual({ exe: 'bundled-electron.exe', env: { FIXTURE: 'yes', ELECTRON_RUN_AS_NODE: '1' } });
    expect(script).toBe(path.join(f.template, 'install.mjs'));
    expect(cwd).toBe(f.template);
    expect(timeout).toBe(60000);
    const stage = args[args.indexOf('--output-dir') + 1]!;
    expect(path.dirname(stage)).toBe(f.base);
    expect(path.basename(stage)).toMatch(/^\.second-brain-create-/);
    expect(args).toEqual(['--yes', '--name', 'Mario Rossi', '--dir', f.destination, '--output-dir', stage, '--repos', f.base, '--role', 'consultant', '--lang', 'italiano', '--harness', 'codex']);
    expect(args).not.toContain('--user-config');
  });

  it.each(['missing', 'changed', 'extra', 'manifest', 'checkout'])('disables incomplete or untrusted templates: %s', kind => {
    const f = fixture();
    if (kind === 'missing') { fs.unlinkSync(path.join(f.template, 'ops/tools/ctx.mjs')); f.seal(); }
    if (kind === 'changed') fs.appendFileSync(path.join(f.template, 'install.mjs'), 'tamper');
    if (kind === 'extra') fs.writeFileSync(path.join(f.template, 'extra.mjs'), 'tamper');
    if (kind === 'manifest') fs.appendFileSync(path.join(f.app, 'brain-template.manifest.json'), ' ');
    if (kind === 'checkout') fs.mkdirSync(path.join(f.app, '.git'));
    expect(f.creator.capability().available).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
  });

  it('rejects an existing folder, a network path, relative paths and injected flags before running', async () => {
    const f = fixture();
    fs.mkdirSync(f.destination); fs.writeFileSync(path.join(f.destination, 'keep.txt'), 'keep');
    for (const destination of [f.destination, 'relative/brain', '//server/share/brain', '\\\\server\\share\\brain']) await expect(f.creator.create(destination, f.fields)).rejects.toThrow();
    await expect(f.creator.create(path.join(f.base, 'fresh'), { ...f.fields, name: '--user-config' })).rejects.toThrow();
    await expect(f.creator.create(path.join(f.base, 'fresh'), { ...f.fields, role: '--user-config' })).rejects.toThrow();
    expect(fs.readFileSync(path.join(f.destination, 'keep.txt'), 'utf8')).toBe('keep');
    expect(f.run).not.toHaveBeenCalled();
  });

  it('rejects a junction in the destination parent and in the template', async () => {
    const f = fixture();
    const alias = path.join(f.base, 'alias');
    fs.symlinkSync(f.base, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.creator.create(path.join(alias, 'brain'), f.fields)).rejects.toThrow();
    const linked = path.join(f.template, 'linked');
    fs.symlinkSync(f.base, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(f.creator.capability().available).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
  });

  it('removes only its still-empty reservation on failure; retains partial user data', async () => {
    const f = fixture();
    f.run.mockImplementationOnce(async () => ({ code: 1, stdout: '', stderr: '' }));
    await expect(f.creator.create(f.destination, f.fields)).rejects.toThrow();
    expect(fs.existsSync(f.destination)).toBe(false);
    f.run.mockImplementationOnce(async (_node, _script, args) => {
      fs.writeFileSync(path.join(args[args.indexOf('--output-dir') + 1]!, 'partial.txt'), 'keep');
      return { code: 1, stdout: '', stderr: '' };
    });
    await expect(f.creator.create(f.destination, f.fields)).rejects.toThrow();
    const secondArgs = f.run.mock.calls[1]![2];
    const partial = secondArgs[secondArgs.indexOf('--output-dir') + 1]!;
    expect(fs.readFileSync(path.join(partial, 'partial.txt'), 'utf8')).toBe('keep');
    expect(fs.existsSync(f.destination)).toBe(false);
  });

  it('does not report success after template mutation during installation', async () => {
    const f = fixture();
    const normalRun = f.run.getMockImplementation()!;
    f.run.mockImplementationOnce(async (...args) => {
      const result = await normalRun(...args);
      fs.appendFileSync(path.join(f.template, 'install.mjs'), 'changed');
      return result;
    });
    await expect(f.creator.create(f.destination, f.fields)).rejects.toThrow();
    const args = f.run.mock.calls[0]![2];
    expect(fs.existsSync(path.join(args[args.indexOf('--output-dir') + 1]!, 'me.md'))).toBe(true);
    expect(fs.existsSync(f.destination)).toBe(false);
  });

  it('never writes through a selected destination replaced with a junction during installation', async () => {
    const f = fixture();
    const elsewhere = path.join(f.base, 'elsewhere'); fs.mkdirSync(elsewhere);
    const normalRun = f.run.getMockImplementation()!;
    f.run.mockImplementationOnce(async (...args) => {
      fs.symlinkSync(elsewhere, f.destination, 'junction');
      return normalRun(...args);
    });
    await expect(f.creator.create(f.destination, f.fields)).rejects.toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(fs.lstatSync(f.destination).isSymbolicLink()).toBe(true);
  });

  it.each(['file', 'directory', 'junction'])('native publication never replaces an existing %s', async kind => {
    const f = fixture();
    const source = path.join(f.base, 'prepared'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'prepared.txt'), 'prepared');
    if (kind === 'file') fs.writeFileSync(f.destination, 'keep');
    if (kind === 'directory') fs.mkdirSync(f.destination);
    if (kind === 'junction') fs.symlinkSync(f.template, f.destination, 'junction');
    await expect(publishNewBrain(source, f.destination)).rejects.toThrow();
    expect(fs.readFileSync(path.join(source, 'prepared.txt'), 'utf8')).toBe('prepared');
    if (kind === 'file') expect(fs.readFileSync(f.destination, 'utf8')).toBe('keep');
    if (kind === 'directory') expect(fs.readdirSync(f.destination)).toEqual([]);
    if (kind === 'junction') expect(fs.lstatSync(f.destination).isSymbolicLink()).toBe(true);
  });

  it('creates from the complete shipped template using the actual child protocol in an isolated home', async () => {
    const f = fixture();
    fs.cpSync(path.resolve(import.meta.dirname, '../../../brain-template'), f.template, { recursive: true });
    f.seal();
    const home = path.join(f.base, 'home'); fs.mkdirSync(home);
    const creator = new BrainCreator({ appPath: f.app, node: { exe: process.execPath, env: { ...process.env, PATH: '', HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local') } } });
    await expect(creator.create(f.destination, f.fields)).resolves.toEqual({ root: f.destination });
    expect(fs.readFileSync(path.join(f.destination, 'me.md'), 'utf8')).toContain('Mario Rossi');
    expect(fs.readFileSync(path.join(f.destination, 'map.md'), 'utf8')).toContain(f.destination.replaceAll('\\', '/'));
    expect(fs.readdirSync(home)).toEqual([]);
  });
});
