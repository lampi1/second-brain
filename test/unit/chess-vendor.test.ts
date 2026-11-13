// The vendored chess engine (ADR 0304, vendor/stockfish): the two files are exactly the ones of the npm package
// stockfish@19.0.1 (their hashes, written in vendor/stockfish/README.md), their licence travels with them, the folder
// is CommonJS for Node, the build copies it and the app's engine names the same files.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_JS, ENGINE_WASM } from '../../src/main/chess/engine';

const dir = path.resolve(__dirname, '../../vendor/stockfish');
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');

describe('vendor/stockfish', () => {
  it('holds the unmodified engine files', () => {
    expect(sha(ENGINE_JS)).toBe('ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a');
    expect(sha(ENGINE_WASM)).toBe('ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de');
  });
  it('carries its licence, its source and the hashes next to the files', () => {
    expect(fs.readFileSync(path.join(dir, 'COPYING.txt'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    for (const f of [ENGINE_JS, ENGINE_WASM]) expect(readme).toContain(sha(f));
    expect(readme).toContain('https://github.com/nmrugg/stockfish.js');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).type).toBe('commonjs');
  });
  it('is copied by the build and named in the NOTICE', () => {
    expect(fs.readFileSync(path.resolve(dir, '../../scripts/build.mjs'), 'utf8')).toContain("'vendor', 'stockfish'");
    expect(fs.readFileSync(path.resolve(dir, '../../NOTICE'), 'utf8')).toContain('Stockfish');
  });
});
