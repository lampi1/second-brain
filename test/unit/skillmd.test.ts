// Unit tests of src/shared/skillmd.ts: the frontmatter of skills and agents is read (quoted, folded, lists), checked
// (name, description, structure) and edited by the form without touching what it does not own; generated copies are
// recognised as read-only.
import { describe, expect, it } from 'vitest';
import { checkMd, field, generatedBy, newMd, parseMd, setBody, setFields, yamlValue } from '../../src/shared/skillmd';

const OK = '---\nname: rivedi-pr\ndescription: Rivede una PR. Usala per "rivedi la PR".\n---\n\n# Rivedi\n\n1. Leggi.\n';
const errors = (kind: 'skill' | 'agent', t: string) => checkMd(kind, t).filter(i => i.level === 'error').map(i => i.text);

describe('parseMd', () => {
  it('reads plain, quoted, folded and list values', () => {
    const p = parseMd('---\nname: a\ndescription: "Dice \\"ciao\\": sempre"\nnote: \'l\'\'altro\'\nlong: >\n  riga uno\n  riga due\ntools:\n  - Bash\n  - Read\n# a comment\n---\nBody');
    expect(field(p, 'description')).toBe('Dice "ciao": sempre');
    expect(field(p, 'note')).toBe("l'altro");
    expect(field(p, 'long')).toBe('riga uno riga due');
    expect(field(p, 'tools')).toBe('Bash, Read');
    expect(p.body).toBe('Body');
    expect(p.issues).toEqual([]);
  });
  it('flags a missing or unclosed frontmatter, bad lines and duplicate keys', () => {
    expect(errors('skill', '# no frontmatter')[0]).toMatch(/Manca l’intestazione/);
    expect(errors('skill', '---\nname: a\n')[0]).toMatch(/non è chiusa/);
    expect(errors('skill', '---\nname: a\njust words\ndescription: d\n---\nx')[0]).toMatch(/non è "chiave: valore"/);
    expect(errors('skill', '---\nname: a\nname: b\ndescription: d\n---\nx')[0]).toMatch(/due volte/);
    expect(errors('skill', '---\nname: a\ndescription: "open\n---\nx').join()).toMatch(/virgolette/);
  });
  it('keeps CRLF files CRLF, the body from a textarea too, and a BOM', () => {
    const t = OK.replace(/\n/g, '\r\n');
    expect(setFields(t, { name: 'altro' })).toContain('name: altro\r\ndescription');
    expect(setBody(t, 'riga 1\nriga 2\n')).toBe('---\r\nname: rivedi-pr\r\ndescription: Rivede una PR. Usala per "rivedi la PR".\r\n---\r\n\r\nriga 1\r\nriga 2\r\n');
    expect(setFields(`﻿${OK}`, { name: 'x' }).startsWith('﻿---\nname: x\n')).toBe(true);
    expect(setBody(`﻿${OK}`, 'b').startsWith('﻿---')).toBe(true);
  });
  it('reads a compact list and a quoted value with a comment', () => {
    const p = parseMd('---\nname: a\ndescription: "d: x" # nota\ntools:\n- Read\n- Grep\nmodel: sonnet\n---\nB');
    expect(p.issues).toEqual([]);
    expect(field(p, 'description')).toBe('d: x');
    expect(field(p, 'tools')).toBe('Read, Grep');
    expect(field(p, 'model')).toBe('sonnet');
  });
  it('keeps blank lines between keys when the form edits one', () => {
    expect(setFields('---\nname: a\n\ndescription: d\n---\nB', { name: 'b' })).toBe('---\nname: b\n\ndescription: d\n---\nB');
  });
});

describe('checkMd', () => {
  it('passes a good skill', () => { expect(checkMd('skill', OK)).toEqual([]); });
  it('needs a valid name and a description', () => {
    expect(errors('skill', OK.replace('name: rivedi-pr', 'name: Rivedi PR'))[0]).toMatch(/minuscole/);
    expect(errors('agent', OK.replace('name: rivedi-pr\n', ''))[0]).toMatch(/Manca il nome/);
    expect(errors('skill', OK.replace(/description:.*\n/, ''))[0]).toMatch(/Manca la descrizione/);
    expect(errors('skill', OK.replace(/description:.*\n/, `description: ${'x'.repeat(1025)}\n`))[0]).toMatch(/1024/);
    expect(errors('skill', OK.replace('rivedi-pr', 'x'.repeat(65)))[0]).toMatch(/64/);
  });
  it('warns on an empty body, an unquoted ": " and tags in the description', () => {
    const w = checkMd('skill', '---\nname: a\ndescription: Usala quando: sempre <b>\n---\n').filter(i => i.level === 'warn').map(i => i.field);
    expect(w).toEqual(['description', 'description', 'body']);
  });
});

describe('editing', () => {
  it('sets fields in place, keeps other keys and comments, adds missing ones before trailing comments', () => {
    const t = '---\nname: a\n# keep me\ndescription: >\n  old\n  text\nmodel: opus\n---\nBody\n';
    const out = setFields(t, { description: 'Nuova: con due punti', tools: 'Bash, Read' });
    expect(out).toBe('---\nname: a\n# keep me\ndescription: "Nuova: con due punti"\nmodel: opus\ntools: Bash, Read\n---\nBody\n');
    expect(field(parseMd(out), 'description')).toBe('Nuova: con due punti');
    expect(setFields(out, {}, ['model'])).not.toContain('model:');
  });
  it('replaces the body only', () => {
    expect(setBody(OK, 'Nuovo corpo\n')).toBe('---\nname: rivedi-pr\ndescription: Rivede una PR. Usala per "rivedi la PR".\n---\n\nNuovo corpo\n');
    expect(setFields(OK, { name: 'x' })).toBe(OK.replace('rivedi-pr', 'x')); // the body untouched, blank line included
  });
  it('quotes only what YAML would misread', () => {
    expect(yamlValue('semplice testo')).toBe('semplice testo');
    for (const v of ['a: b', '"x"', '- lista', 'true', '12', 'fine #commento', '', 'riga\nnuova']) expect(yamlValue(v).startsWith('"')).toBe(true);
  });
  it('builds a new valid file from the form', () => {
    const t = newMd('agent', { name: 'tester', description: 'Prova: un caso', body: 'Fai così.', tools: 'Bash', model: 'sonnet' });
    expect(checkMd('agent', t)).toEqual([]);
    expect(t).toContain('tools: Bash\nmodel: sonnet\n---\n\nFai così.\n');
  });
});

describe('generatedBy', () => {
  it('recognises a generated copy and names its source', () => {
    expect(generatedBy('---\nname: r\n---\n\n<!-- Generated by copy-tool.mjs (oris) from .claude/agents/review.md, do not edit: change that file. -->\n'))
      .toBe('Copia generata da copy-tool.mjs da .claude/agents/review.md: modifica il file sorgente, questo viene riscritto.');
    expect(generatedBy(OK)).toBeNull();
    expect(generatedBy('<!-- Generated with love -->')).toBeNull();
  });
});
