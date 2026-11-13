// Where the brain tools find the brain's own rules, memory map and behaviour tests (ADR 0277): at the root in an
// older brain, inside the `brain-rules` skill in a clean one. A new chat is never told to read a file that is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs template tool, no types
import { brainDoc, brainDocRel } from '../../../brain-template/ops/tools/brain-doc.mjs';
// @ts-expect-error plain .mjs template tool, no types
import { READ, readList } from '../../../brain-template/ops/tools/chat-prompt.mjs';

const dirs: string[] = [];
const brain = (files: string[]) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-doc-'));
  dirs.push(root);
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), 'x'); }
  return root;
};
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('brain-doc', () => {
  it('finds the documents at the root of an older brain', () => {
    const root = brain(['map.md', 'brain-rules.md', 'tests/behavior.md']);
    expect(brainDocRel(root, 'map.md')).toBe('map.md');
    expect(brainDocRel(root, 'brain-rules.md')).toBe('brain-rules.md');
    expect(brainDoc(root, 'tests/behavior.md')).toBe(path.join(root, 'tests/behavior.md'));
  });
  it('finds them inside the brain-rules skill of a clean brain', () => {
    const root = brain(['.agents/skills/brain-rules/SKILL.md', '.agents/skills/brain-rules/references/memory-map.md', '.agents/skills/brain-rules/references/behavior-tests.md']);
    expect(brainDocRel(root, 'map.md')).toBe('.agents/skills/brain-rules/references/memory-map.md');
    expect(brainDocRel(root, 'brain-rules.md')).toBe('.agents/skills/brain-rules/SKILL.md');
    expect(brainDocRel(root, 'tests\\behavior.md')).toBe('.agents/skills/brain-rules/references/behavior-tests.md');
  });
  it('prefers the root file while both exist, and answers null when the document is nowhere', () => {
    const root = brain(['map.md', '.agents/skills/brain-rules/references/memory-map.md']);
    expect(brainDocRel(root, 'map.md')).toBe('map.md');
    expect(brainDoc(root, 'brain-rules.md')).toBeNull();
    expect(brainDocRel(root, 'code.md')).toBeNull();
  });
});

describe('chat-prompt read list', () => {
  it('names only files the brain has, from where it keeps them', () => {
    const root = brain(['.agents/skills/brain-rules/SKILL.md', '.agents/skills/brain-rules/references/memory-map.md']);
    expect(readList('os', root)).toEqual(['.agents\\skills\\brain-rules\\references\\memory-map.md', '.agents\\skills\\brain-rules\\SKILL.md']);
    expect(readList('code', root)).toEqual([]);
  });
  it('keeps the names when the brain folder is not on disk', () => {
    expect(readList('qa', path.join(os.tmpdir(), 'sb-doc-missing'))).toEqual(READ.qa);
  });
});
