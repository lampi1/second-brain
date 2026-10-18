// Real shipped scanner coverage for pack staging: fail closed and return locations/rules without private values.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { scanTree } from '../../src/main/brain/guard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-guard-')); roots.push(root);
  const staging = path.join(root, 'staging'); fs.mkdirSync(staging);
  const deny = path.join(root, 'deny.txt'); fs.writeFileSync(deny, 'private-customer-fixture\n');
  return { staging, guard: { scan: path.resolve('tools/guard/scan.mjs'), deny }, node: { exe: process.execPath, env: process.env } };
}
it('blocks private IP/email and does not expose their values', async () => {
  const { staging, guard, node } = fixture();
  const privateIp = [10, 20, 30, 40].join('.'), email = ['person', 'internal-customer.test'].join('@');
  fs.writeFileSync(path.join(staging, 'knowledge.md'), `${privateIp}\n${email}\n`);
  const result = await scanTree(staging, [guard], node);
  expect(result.ok).toBe(false);
  expect(result).toHaveProperty('findings');
  expect(JSON.stringify(result)).not.toContain(privateIp); expect(JSON.stringify(result)).not.toContain(email);
});
it('allows example mail and refuses missing scanners, deny lists, or domain guards', async () => {
  const { staging, guard, node } = fixture(); fs.writeFileSync(path.join(staging, 'knowledge.md'), 'person@example.com\n');
  expect(await scanTree(staging, [guard], node)).toEqual({ ok: true });
  expect((await scanTree(staging, [], node)).ok).toBe(false);
  expect((await scanTree(staging, [null], node)).ok).toBe(false);
  expect((await scanTree(staging, [{ ...guard, deny: guard.deny + '-missing' }], node)).ok).toBe(false);
});
it('checks every domain deny list and never trusts a staged allow file', async () => {
  const { staging, guard, node } = fixture();
  const second = path.join(path.dirname(staging), 'second.txt'); fs.writeFileSync(second, 'another-private-fixture\n');
  fs.writeFileSync(path.join(staging, 'knowledge.md'), 'another-private-fixture\n');
  fs.writeFileSync(path.join(staging, '.guardallow'), '*\n');
  expect((await scanTree(staging, [guard, { ...guard, deny: second }], node)).ok).toBe(false);
});
