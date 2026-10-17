// Offline fixture replay exercises malformed model outputs and real registry/scaffold filesystem boundaries.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseSection } from '../../src/shared/extension-section';
import { SectionStore } from '../../src/main/extensions/section-store';
import { ExtensionSection } from '../../src/renderer/extensions/ExtensionSection';
import fixture from '../fixtures/extensions/pratiche.json';

describe('data-only sections', () => {
  it('runs scaffold as a real CLI, registers its output, renders it, and preserves existing output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-section-boundary-'));
    const spec = fileURLToPath(new URL('../fixtures/extensions/pratiche.json', import.meta.url));
    const cli = fileURLToPath(new URL('../../scripts/scaffold-section.mjs', import.meta.url));
    try {
      execFileSync(process.execPath, ['--experimental-strip-types', cli, spec, root], { stdio: 'pipe' });
      const file = path.join(root, 'pratiche.section.json');
      const bytes = fs.readFileSync(file, 'utf8');
      const manifest = JSON.parse(bytes);
      const registered = new SectionStore(path.join(root, 'registry')).register(manifest, 0);
      const html = renderToStaticMarkup(createElement(ExtensionSection, { manifest: registered.sections[0] }));
      expect(html).toContain('Pratiche e scadenze');
      expect(html).toContain('dateTime="2026-11-15"');
      expect(html).toContain('Completata');
      expect(() => execFileSync(process.execPath, ['--experimental-strip-types', cli, spec, root], { stdio: 'pipe' })).toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
      const hostile = { ...manifest, title: '<script>window.bad()</script>' };
      expect(renderToStaticMarkup(createElement(ExtensionSection, { manifest: hostile }))).toContain('&lt;script&gt;');
      expect(renderToStaticMarkup(createElement(ExtensionSection, { manifest: {} }))).toContain('role="alert"');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('accepts the reproducible practices fixture and rejects common malformed generations', () => {
    expect(parseSection(fixture).rows).toHaveLength(2);
    for (const bad of [
      { ...fixture, id: '../outside' }, { ...fixture, schemaVersion: 2 }, { ...fixture, script: 'execute()' },
      { ...fixture, columns: [...fixture.columns, fixture.columns[0]] },
      { ...fixture, rows: [{ id: 'x', cells: ['Pratica', '2026-02-30', 'open'] }] },
      { ...fixture, rows: [{ id: 'x', cells: ['Pratica', '2026-11-15', 'unknown'] }] },
      { ...fixture, rows: [{ id: 'x', cells: ['short'] }] },
      { ...fixture, rows: [fixture.rows[0], fixture.rows[0]] },
      { ...fixture, columns: [{ id: 'date', label: 'Date', kind: ['date'] }], rows: [{ id: 'x', cells: ['not-a-date'] }] },
    ]) expect(() => parseSection(bad)).toThrow();
  });
  it('registers, rejects stale writers, reloads and rolls back as a new revision', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sections-'));
    try {
      const store = new SectionStore(root);
      expect(store.list()).toEqual({ revision: 0, sections: [] });
      expect(store.register(fixture, 0).revision).toBe(1);
      expect(() => store.remove('pratiche', 0)).toThrow('changed');
      expect(new SectionStore(root).list().sections[0]!.id).toBe('pratiche');
      store.remove('pratiche', 1);
      expect(store.rollback(1, 2)).toEqual({ revision: 3, sections: [fixture] });
      expect(() => store.rollback(99, 3)).toThrow('unavailable');
      expect(store.list().revision).toBe(3);
      expect(fs.existsSync(path.join(root, 'sections.json.lock'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('fails closed for corrupt files and overlapping writer locks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sections-'));
    try {
      const store = new SectionStore(root);
      fs.writeFileSync(path.join(root, 'sections.json'), '{');
      expect(() => store.register(fixture, 0)).toThrow();
      expect(fs.readFileSync(path.join(root, 'sections.json'), 'utf8')).toBe('{');
      fs.writeFileSync(path.join(root, 'sections.json.lock'), 'other writer');
      expect(() => store.register(fixture, 0)).toThrow();
      expect(fs.readFileSync(path.join(root, 'sections.json.lock'), 'utf8')).toBe('other writer');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
