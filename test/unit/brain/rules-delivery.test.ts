// Hook delivery tests use dummy runtime files and isolated brains; no build, CLI, app or global settings required.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHooks } from '../../../src/main/rules/delivery';
import { productInstructions } from '../../../src/main/rules/instructions';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('does not resolve built assets or mutate a legacy brain plugin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rule-legacy-')); roots.push(root);
  expect(() => installHooks(path.join(root, 'plugin'), root, path.join(root, 'state'))).not.toThrow();
  expect(fs.readdirSync(root)).toEqual([]);
});
it('merges product hooks before personal hooks, with root paths in JSON instead of shell text', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rule-delivery-')); roots.push(base);
  const root = path.join(base, 'brain with spaces'), plugin = path.join(base, 'plugin'), source = path.join(base, 'source');
  fs.mkdirSync(root); fs.mkdirSync(path.join(plugin, 'hooks'), { recursive: true }); fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brain.json'), '{"machinery":"product-v1"}');
  fs.writeFileSync(path.join(plugin, 'hooks/hooks.json'), '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing"}]}]}}');
  fs.writeFileSync(path.join(source, 'runtime.mjs'), '// fixture'); fs.writeFileSync(path.join(source, 'hooks/runner.mjs'), '// fixture');
  installHooks(plugin, root, path.join(base, 'state'), source);
  const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks/hooks.json'), 'utf8')).hooks;
  expect(hooks.Stop[0].hooks[0].command).toContain('${CLAUDE_PLUGIN_ROOT}');
  expect(hooks.Stop[0].hooks[0].command).not.toContain(root);
  expect(hooks.Stop[1].hooks[0].command).toBe('existing');
  expect(JSON.parse(fs.readFileSync(path.join(plugin, 'product-rules/launch.json'), 'utf8')).root).toBe(root);
  expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
});
it('fallback includes bounded topic text and rejects oversized fixed context without truncating safety', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rule-fallback-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md'], turnBudget: 300 } }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Core safety');
  fs.writeFileSync(path.join(root, 'code.md'), '---\nwhen: {"prompt":["code"]}\n---\n' + 'Topic body. '.repeat(100));
  expect(productInstructions(root, true)).toContain('Topic body');
  expect(productInstructions(root, true)).toContain('hooks are not available');
  expect(productInstructions(root, true)!.length).toBeLessThan(500);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(15_001));
  expect(() => productInstructions(root, true)).toThrow('15000');
});
