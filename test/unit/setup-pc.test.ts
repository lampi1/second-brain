// scripts/setup-pc.mjs (ADR 0059): the pure parts of the new-PC setup. Arguments (URLs git could misuse refused), the
// config.json merge (existing keys kept, domains de-duplicated, brainRoot never listed twice), and the remote commands it
// only prints (gh repo create --private; nothing run). Also a --dry-run of the script itself on temp folders: it
// writes nothing, clones nothing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { mergeConfig, parseArgs, readConfig, remoteCommands, urlOk } from '../../scripts/setup-pc.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'setup-pc.mjs');

describe('setup-pc', () => {
  it('parses the plan; refuses option-like or ext:: URLs', () => {
    const p = parseArgs(['--app', 'https://github.com/me/app.git', '--app-dir', 'C:/x/app', '--domain', 'ssh://example.com/me/brain.git=C:/x/personale', '--dry-run'], { APPDATA: 'C:/AD' });
    expect(p).toMatchObject({ app: 'https://github.com/me/app.git', dryRun: true, setup: true, domains: [{ url: 'ssh://example.com/me/brain.git', dir: path.resolve('C:/x/personale') }] });
    expect(p.userData).toBe(path.join('C:/AD', 'second-brain'));
    expect(() => parseArgs(['--domain', '-uevil=C:/x'])).toThrow(/non valido/);
    expect(() => parseArgs(['--domain', 'ext::sh=C:/x'])).toThrow(/non valido/);
    expect(() => parseArgs(['--domain', 'nodir'])).toThrow(/<url>=<cartella>/);
    expect(() => parseArgs(['--app', 'https://x/y.git'])).toThrow(/--app-dir/);
    expect(() => parseArgs(['--push'])).toThrow(/sconosciuta/);
    expect(urlOk('C:/temp/r.git')).toBe(true);
  });

  it('merges config.json: keys kept, brainRoot set or kept, domains de-duplicated', () => {
    const a = path.resolve('C:/b/lavoro'), b = path.resolve('C:/b/personale'), c = path.resolve('C:/b/altro');
    expect(mergeConfig({ view: 'corsie', brainRoot: a, domains: [b] }, { brain: null, domainDirs: [b, c, a] }, 'win32'))
      .toEqual({ view: 'corsie', brainRoot: a, domains: [b, c] });
    expect(mergeConfig({}, { brain: null, domainDirs: [b] }, 'win32')).toEqual({ brainRoot: b });
    expect(mergeConfig(null, { brain: a, domainDirs: [b.toUpperCase()] }, 'win32')).toEqual({ brainRoot: a, domains: [b.toUpperCase()] });
  });

  it('remote commands are printed text for the user: a private repo, PowerShell quoting', () => {
    const cmds = remoteCommands("C:/b/it's", 'Personale Mio');
    expect(cmds[0]).toBe("gh repo create personale-mio --private --source 'C:/b/it''s' --remote origin");
    expect(cmds.join('\n')).not.toMatch(/--public/);
    // no push printed: the first push is the app's, which runs the publish guard on the whole history
    expect(cmds.filter((c: string) => !c.startsWith('#')).join('\n')).not.toMatch(/\bpush\b/);
    expect(cmds.join('\n')).toMatch(/il primo invio lo fa l'app/);
  });

  it('a config.json that is not a JSON object is reported, never overwritten; none = {}', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-'));
    const file = path.join(base, 'config.json');
    expect(readConfig(file)).toEqual({ ok: true, cfg: {} });
    fs.writeFileSync(file, '{"view":"corsie"}');
    expect(readConfig(file)).toEqual({ ok: true, cfg: { view: 'corsie' } });
    for (const bad of ['{"view":', '[1]', 'null']) {
      fs.writeFileSync(file, bad);
      expect(readConfig(file).ok).toBe(false);
    }
    // the script stops before cloning anything and leaves the file as it was
    fs.writeFileSync(file, '{"view":');
    const r = spawnSync(process.execPath, [SCRIPT, '--domain', `${path.join(base, 'remote.git')}=${path.join(base, 'personale')}`, '--user-data', base, '--no-setup'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/non è JSON valido/);
    expect(r.stdout).not.toContain('git clone');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"view":');
    expect(fs.existsSync(path.join(base, 'personale'))).toBe(false);
  });

  it('--dry-run clones nothing and writes nothing', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-'));
    const ud = path.join(base, 'ud');
    const r = spawnSync(process.execPath, [SCRIPT, '--domain', `${path.join(base, 'remote.git')}=${path.join(base, 'personale')}`, '--user-data', ud, '--dry-run', '--no-setup'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('git clone');
    expect(r.stdout).toContain('Nessun repository creato, nessun push');
    expect(fs.existsSync(ud)).toBe(false);
    expect(fs.existsSync(path.join(base, 'personale'))).toBe(false);
  });
});
