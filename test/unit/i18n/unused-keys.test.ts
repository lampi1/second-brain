// No dead UI texts: every key of the Italian dictionary (the source, ADR 0057) is named somewhere in src outside i18n/,
// in full or through a prefix the code completes (`area.${x}`, 'area.' + x). A key no code reads any more goes, in all
// three languages, with the code that used it (374 had piled up by 2026-10-22).
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { it as italian } from '../../../src/renderer/i18n/it';

const SRC = path.resolve(import.meta.dirname, '../../../src');
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : files(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('every Italian UI text is still used by the code', () => {
  const code = files(SRC).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // prefixes the code completes at run time: 'area.' + x, `area.${x}` (one scan, not one regex per key)
  const prefixes = new Set([...code.matchAll(/[`'"]([\w.-]+\.)(?:\$\{|[`'"]\s*\+)/g)].map(m => m[1]));
  const dynamic = (key: string) => {
    const parts = key.split('.');
    for (let i = parts.length - 1; i > 0; i--) if (prefixes.has(`${parts.slice(0, i).join('.')}.`)) return true;
    return false;
  };
  const unused = Object.keys(italian).filter(k => k.includes('.') && !k.startsWith('sys.') && !code.includes(k) && !dynamic(k));
  expect(unused).toEqual([]);
});
