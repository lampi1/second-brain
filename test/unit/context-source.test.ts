// Synthetic private-directory tests for explicit user context persistence and its ExtensionService adapter.
// Never reads real userData, brain notes or credentials and never starts an app or model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmedContextSource } from '../../src/main/extensions/context-source';
import { loadUserContext } from '../../src/main/brain/user-context';

const at = '2026-10-17T08:00:00.000Z';
const fact = { id: 'language', key: 'language', value: 'Italian', category: 'profile' as const };
let root: string;
let directory: string;
let file: string;
let source: ConfirmedContextSource;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirmed-context-test-'));
  directory = path.join(root, 'private');
  file = path.join(directory, 'confirmed-user-context.json');
  source = new ConfirmedContextSource(directory, () => new Date(at));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('confirmed canonical context', () => {
  it('returns empty on first use without creating directories or files', () => {
    expect(source.load()).toEqual({ version: 1, revision: 0, facts: [], provenance: null });
    expect(source.getConfirmedEssential()).toBeNull();
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('persists only explicit saves, with injected confirmation time and verified provenance', () => {
    const saved = source.save([fact], 0);
    expect(saved).toEqual({ version: 1, revision: 1, facts: [{ ...fact, confirmation: 'confirmed', confirmedAt: at }], provenance: { source: 'explicit-user-confirmation', at } });
    expect(new ConfirmedContextSource(directory).load()).toEqual(saved);
    expect(fs.readdirSync(directory)).toEqual(['confirmed-user-context.json']);
  });

  it('returns fresh copies and permits explicit clearing with a new revision', () => {
    const saved = source.save([fact], 0);
    saved.facts[0]!.value = 'mutated';
    expect(source.load().facts[0]!.value).toBe('Italian');
    expect(source.save([], 1)).toMatchObject({ revision: 2, facts: [] });
    expect(source.getConfirmedEssential()).toBeNull();
  });

  it('rejects stale writers without changing the archive', () => {
    source.save([fact], 0);
    const original = fs.readFileSync(file, 'utf8');
    expect(() => new ConfirmedContextSource(directory).save([], 0)).toThrow('reload');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it('preserves a corrupt file rather than resetting or overwriting it', () => {
    fs.mkdirSync(directory);
    fs.writeFileSync(file, '{corrupt');
    expect(() => source.load()).toThrow('Invalid confirmed context');
    expect(() => source.save([fact], 0)).toThrow('Invalid confirmed context');
    expect(fs.readFileSync(file, 'utf8')).toBe('{corrupt');
    expect(fs.readdirSync(directory)).toEqual(['confirmed-user-context.json']);
  });

  it('does not break another writer lock', () => {
    fs.mkdirSync(directory);
    fs.writeFileSync(`${file}.lock`, 'occupied');
    expect(() => source.save([fact], 0)).toThrow('busy');
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe('occupied');
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each([
    [{ ...fact, confirmation: 'confirmed', confirmedAt: at }],
    [{ ...fact, path: '/synthetic/note' }],
    [{ ...fact, category: 'invented' }],
    [{ ...fact, id: '../note' }],
    [{ ...fact, key: 'Language' }],
    [{ ...fact, value: ' ' }],
    [{ ...fact, value: 'a'.repeat(2001) }],
    [fact, fact],
    Array.from({ length: 65 }, (_, i) => ({ ...fact, id: `fact-${i}` })),
  ])('rejects malformed or unconfirmed-input metadata %#', (...inputs) => {
    expect(() => source.save(inputs, 0)).toThrow();
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each(['password', 'api-key', 'access-token', 'credentials', 'private-key', 'connection-string'])('rejects sensitive field name %s even with an opaque value', key => {
    expect(() => source.save([{ ...fact, key, value: 'synthetic' }], 0)).toThrow('Credentials');
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each([
    ['password', 'synthetic-value'].join('='),
    'Bearer syntheticcredential0123456789',
    ['https://', 'synthetic', ':', 'synthetic', '@example.com'].join(''),
    ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
  ])('rejects credential content without echoing it %#', value => {
    let message = '';
    try { source.save([{ ...fact, value }], 0); } catch (error) { message = (error as Error).message; }
    expect(message).toBe('Credentials cannot be saved as context');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('enforces the UTF-8 archive byte bound on writes and reads', () => {
    const large = Array.from({ length: 30 }, (_, i) => ({ ...fact, id: `fact-${i}`, value: '界'.repeat(1000) }));
    expect(() => source.save(large, 0)).toThrow('budget');
    fs.mkdirSync(directory);
    fs.writeFileSync(file, ' '.repeat(64 * 1024 + 1));
    expect(() => source.load()).toThrow('Invalid');
  });

  it.each([
    { provenance: null },
    { provenance: { source: 'imported-note', at } },
    { provenance: { source: 'explicit-user-confirmation', at: 'yesterday' } },
    { provenance: { source: 'explicit-user-confirmation', at, note: 'imported' } },
    { revision: 0 },
    { unexpected: true },
    { facts: [{ ...fact, confirmation: 'pending', confirmedAt: null }] },
    { facts: [{ ...fact, confirmation: 'confirmed', confirmedAt: '2026-10-16T08:00:00.000Z' }] },
    { facts: [{ ...fact, key: 'password', confirmation: 'confirmed', confirmedAt: at }] },
  ])('rejects malformed persisted provenance/metadata %#', mutation => {
    const archive = source.save([fact], 0);
    const text = JSON.stringify({ ...archive, ...mutation });
    fs.writeFileSync(file, text);
    expect(() => source.load()).toThrow();
    expect(() => source.save([], 1)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
  });

  it('provides a bound essential adapter usable directly by the context assembler', () => {
    source.save([fact], 0);
    const callback = source.getConfirmedEssential;
    expect(callback()).toMatchObject({ schemaVersion: 1, id: 'essential', label: 'User-confirmed information' });
    const packet = loadUserContext(callback(), [], source.readRequestedSource);
    expect(packet.status).toBe('ready');
    expect(packet.included).toEqual(['essential/language']);
  });

  it.each(['essential', 'notes', '../notes', '/synthetic/note', 'https://example.invalid', ''])('denies every requested source ID %#', id => {
    expect(() => source.readRequestedSource(id)).toThrow('unavailable');
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('refuses a linked private directory', () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, directory, 'junction');
    expect(() => source.load()).toThrow('real directory');
    expect(() => source.save([fact], 0)).toThrow('real directory');
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('refuses a linked archive without replacing its target', () => {
    fs.mkdirSync(directory);
    const target = path.join(root, 'target');
    fs.writeFileSync(target, 'untouched');
    // File symlinks may need Windows Developer Mode; a junction is also a link and must be rejected.
    fs.symlinkSync(target, file, process.platform === 'win32' ? 'junction' : 'file');
    expect(() => source.load()).toThrow();
    expect(() => source.save([fact], 0)).toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
  });
});
