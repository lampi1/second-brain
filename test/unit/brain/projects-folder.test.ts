// The projects folder found by itself (src/main/brain/projects-folder.ts): CLI slugs resolved to real folders, the
// usual places with git repos, the home and the brain never proposed, nothing when there is no evidence. Fixture homes only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { detectProjectsFolder, resolveSlug, slugOf } from '../../../src/main/brain/projects-folder';

const roots: string[] = [];
const temp = () => { const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-projects-'))); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const repo = (dir: string) => fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

it('turns a folder name into the CLI slug', () => {
  expect(slugOf('/home/u/my_app.v2')).toBe('-home-u-my-app-v2');
});

it('resolves a Claude slug back to the real folder, longest name first', () => {
  const home = temp();
  fs.mkdirSync(path.join(home, 'work', 'my'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work', 'my-app'), { recursive: true });
  expect(resolveSlug(slugOf(path.join(home, 'work', 'my-app')), 'linux')).toBe(path.join(home, 'work', 'my-app'));
  expect(resolveSlug(slugOf(path.join(home, 'work', 'missing')), 'linux')).toBeNull();
});

it('prefers the parent of the repos the CLIs already worked in', () => {
  const home = temp(), code = path.join(home, 'clienti', 'acme');
  for (const name of ['shop', 'api']) { repo(path.join(code, name)); fs.mkdirSync(path.join(home, '.claude', 'projects', slugOf(path.join(code, name))), { recursive: true }); }
  repo(path.join(home, 'Projects', 'toy'));
  expect(detectProjectsFolder({ home, platform: 'linux' })).toEqual({ path: code, repos: 2, source: 'cli' });
});

it('finds a usual place with git repos and never proposes home or the brain', () => {
  const home = temp(), brain = path.join(home, 'source', 'repos', 'memory');
  repo(path.join(home, 'source', 'repos', 'app'));
  fs.mkdirSync(brain, { recursive: true });
  repo(path.join(home, 'dotfiles')); // a repo right under home: its parent (home) is never the answer
  fs.mkdirSync(path.join(home, '.claude', 'projects', slugOf(path.join(home, 'dotfiles'))), { recursive: true });
  expect(detectProjectsFolder({ home, platform: 'linux' })).toEqual({ path: path.join(home, 'source', 'repos'), repos: 1, source: 'common' });
  expect(detectProjectsFolder({ home, platform: 'linux', exclude: [path.join(home, 'source')] })).toBeNull();
});

it('says nothing without evidence (the setup then asks)', () => {
  const home = temp();
  fs.mkdirSync(path.join(home, 'Projects', 'not-a-repo'), { recursive: true });
  expect(detectProjectsFolder({ home, platform: 'linux' })).toBeNull();
});

it('the projects folder setting: absolute paths only, empty by default', async () => {
  const { validate, defaults } = await import('../../../src/main/brain/settings-schema');
  expect(defaults().projectsRoot).toBeNull();
  expect(validate('projectsRoot', 'relative/dir').ok).toBe(false);
  expect(validate('projectsRoot', path.join(os.tmpdir(), 'repos'))).toMatchObject({ ok: true, key: 'projectsRoot' });
  expect(validate('projectsRoot', null).ok).toBe(true);
});
