// Brain domains (src/main/brain/domains.ts, ADR 0059): domain.json checks, the backwards-compatible default (no file =
// one this-pc domain, no remote), a this-pc domain never keeping a remote, remotes git could misuse refused, discovery
// (brainRoot first, duplicates out, missing folders skipped), the {brain} / {domain:<name>} placeholders, and config.json
// keeping its `domains` list across a settings save (config.ts).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDomainFile, discoverDomains, domainsOfConfig, readDomain, remoteOk, resolvePlaceholders } from '../../../src/main/brain/domains';
import { ConfigStore } from '../../../src/main/brain/config';
import { tmpDir } from './helpers';

function domainDir(json?: unknown): string {
  const d = tmpDir('sb-domain-');
  if (json !== undefined) fs.writeFileSync(path.join(d, 'domain.json'), typeof json === 'string' ? json : JSON.stringify(json));
  return d;
}

describe('domain.json', () => {
  it('accepts name + scope + optional remote; refuses the rest', () => {
    expect(checkDomainFile({ name: 'Personale', scope: 'everywhere', remote: 'https://example.com/me/brain.git' })).toEqual({ ok: true, name: 'Personale', scope: 'everywhere', remote: 'https://example.com/me/brain.git', denyList: 'deny-work.txt' });
    expect(checkDomainFile({ name: 'Lavoro', scope: 'this-pc' })).toEqual({ ok: true, name: 'Lavoro', scope: 'this-pc', remote: null, denyList: 'deny-work.txt' });
    expect(checkDomainFile({ name: 'P', scope: 'everywhere', denyList: 'deny-personale.txt' })).toMatchObject({ ok: true, denyList: 'deny-personale.txt' });
    for (const bad of ['../deny.txt', 'C:/x/deny.txt', 'sub/deny.txt', 'deny', '.txt', 3]) expect(checkDomainFile({ name: 'P', scope: 'everywhere', denyList: bad }).ok, String(bad)).toBe(false);
    expect(checkDomainFile({ name: '', scope: 'everywhere' }).ok).toBe(false);
    expect(checkDomainFile({ name: 'x', scope: 'cloud' }).ok).toBe(false);
    expect(checkDomainFile([]).ok).toBe(false);
    expect(checkDomainFile({ name: 'x', scope: 'everywhere', remote: '--upload-pack=evil' }).ok).toBe(false);
  });

  it('refuses remotes git could turn into a command or an option', () => {
    for (const bad of ['-oProxyCommand=x', 'ext::sh -c x', 'EXT::x', 'fd::3', 'a b', 'x\ny', ' origin', '']) expect(remoteOk(bad), bad).toBe(false);
    for (const good of ['origin', 'ssh://example.com/me/brain.git', 'https://github.com/me/brain.git', 'C:/temp/remote.git']) expect(remoteOk(good), good).toBe(true);
  });

  it('a folder without domain.json is one this-pc domain with no remote (today\'s brains: nothing changes)', () => {
    const d = domainDir();
    expect(readDomain(d)).toMatchObject({ name: path.basename(d), scope: 'this-pc', remote: null, denyList: 'deny-work.txt', implicit: true, problem: null });
  });

  it('a this-pc domain never keeps a remote; a broken file says why and does not sync', () => {
    expect(readDomain(domainDir({ name: 'Lavoro', scope: 'this-pc', remote: 'origin' }))).toMatchObject({ name: 'Lavoro', remote: null, problem: expect.stringMatching(/solo questo PC/) });
    expect(readDomain(domainDir('{ not json'))).toMatchObject({ scope: 'this-pc', remote: null, implicit: false, problem: expect.stringMatching(/non leggibile/) });
    expect(readDomain(domainDir('\uFEFF{"name":"P","scope":"everywhere","remote":"origin"}'))).toMatchObject({ name: 'P', remote: 'origin', problem: null });
  });
});

describe('discoverDomains', () => {
  it('brainRoot first, then the listed folders; duplicates and missing folders are left out with a reason', () => {
    const work = domainDir({ name: 'Lavoro', scope: 'this-pc' });
    const mine = domainDir({ name: 'Personale', scope: 'everywhere', remote: 'origin' });
    const clash = domainDir({ name: 'personale', scope: 'everywhere' });
    const r = discoverDomains(work, [mine, work, clash, path.join(work, 'missing')]);
    expect(r.domains.map(d => d.name)).toEqual(['Lavoro', 'Personale']);
    expect(r.skipped.map(s => s.why)).toEqual([expect.stringMatching(/già usato/), 'cartella mancante']);
    expect(discoverDomains(null, []).domains).toEqual([]);
  });

  it('config.json `domains`: only absolute paths', () => {
    const abs = path.resolve('x');
    expect(domainsOfConfig({ domains: [abs, 'relative', 3, ''] })).toEqual([abs]);
    expect(domainsOfConfig({ domains: 'x' })).toEqual([]);
    expect(domainsOfConfig(null)).toEqual([]);
  });
});

describe('placeholders', () => {
  const ctx = { brainRoot: 'C:\\brain', domains: [{ name: 'Personale', root: 'D:\\me' }] };
  it('{brain} and {domain:<name>} resolve; unknown ones stay and are listed', () => {
    const r = resolvePlaceholders('a {brain}/x b {domain:personale}/y c {domain:Lavoro}/z {other}', ctx);
    expect(r.text).toBe('a C:\\brain/x b D:\\me/y c {domain:Lavoro}/z {other}');
    expect(r.unknown).toEqual(['{domain:Lavoro}']);
    expect(resolvePlaceholders('{brain}', { brainRoot: null, domains: [] })).toEqual({ text: '{brain}', unknown: ['{brain}'] });
  });
  it('replacement text with $ signs is taken literally', () => {
    expect(resolvePlaceholders('{brain}', { brainRoot: 'C:\\$&x', domains: [] }).text).toBe('C:\\$&x');
  });
});

describe('config.json keeps its domains list', () => {
  it('a settings save writes the list back; SB_DOMAINS overrides it', () => {
    const ud = tmpDir('sb-cfg-');
    const dom = path.resolve(tmpDir('sb-d-'));
    fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ brainRoot: null, domains: [dom] }));
    const c = new ConfigStore(ud, {});
    expect(c.domains()).toEqual([dom]);
    c.set({ theme: 'light' });
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'))).toMatchObject({ theme: 'light', domains: [dom] });
    expect(new ConfigStore(ud, { SB_DOMAINS: `${dom}\nrelative` }).domains()).toEqual([dom]);
    expect(new ConfigStore(ud, { SB_DOMAINS: '' }).domains()).toEqual([]);
  });

  it('a settings save keeps a domains list changed on disk since start (setup-pc, the user)', () => {
    const ud = tmpDir('sb-cfg-');
    const x = path.resolve(tmpDir('sb-d-')), y = path.resolve(tmpDir('sb-d-'));
    const file = path.join(ud, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ brainRoot: null, domains: [x] }));
    const c = new ConfigStore(ud, {});
    fs.writeFileSync(file, JSON.stringify({ brainRoot: null, domains: [x, y] }));
    c.set({ language: 'it' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ language: 'it', domains: [x, y] });
  });
});
