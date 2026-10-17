// Main adapter contract with a real private registry and explicit fake canonical providers; no IPC/model process.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtensionService } from '../../src/main/extensions/service';
import { SectionStore } from '../../src/main/extensions/section-store';
import section from '../fixtures/extensions/pratiche.json';
import canonical from '../fixtures/extensions/context-selection.json';

it('composes the existing store and loader without inventing first-use profile facts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-extension-service-'));
  try {
    let profile: unknown = null;
    const reads: string[] = [];
    const service = new ExtensionService(new SectionStore(root), { getConfirmedEssential: () => profile, readRequestedSource: id => { reads.push(id); throw new Error('Missing'); } });
    expect(service.context().text).toBe('');
    expect(reads).toEqual([]);
    expect(service.register(section, 0).revision).toBe(1);
    expect(service.list().sections[0]!.id).toBe('pratiche');
    profile = canonical;
    expect(service.context(['requested']).unavailable).toEqual(['requested']);
    expect(reads).toEqual(['requested']);
    expect(service.context().included).toContain('essential/z-constraint');
    expect(service.remove('pratiche', 1).revision).toBe(2);
    expect(service.rollback(1, 2).sections).toEqual([section]);
    const broken = new ExtensionService(new SectionStore(root), { getConfirmedEssential: () => { throw new Error('Unavailable'); }, readRequestedSource: () => null });
    expect(broken.context().unavailable).toEqual(['essential']);
    expect(broken.context().text).toBe('');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
