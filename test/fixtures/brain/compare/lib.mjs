// Fake of the brain's harness/compare/lib.mjs, only what the app's src/main/brain/compare.ts reads: the rounds under
// <root>/reviews/compare/<round>/ (capture.json, cursor.json, claude.json) and the state folder. Used by
// test/unit/brain/compare.test.ts, copied into a temporary brain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const OUT = path.join(ROOT, 'reviews', 'compare');
export const STATE = path.join(ROOT, 'ops', 'state', 'compare');
export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const captures = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT) : []).filter(n => fs.existsSync(path.join(OUT, n, 'capture.json'))).sort();
