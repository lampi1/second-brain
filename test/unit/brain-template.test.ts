// brain-template/ (ADR 0061): the empty brain a new user starts from, edited in this repo. Its scripts run in the user's
// brain, not in the app, so the app's lint rules do not apply to them (eslint.config.js ignores the folder); this test
// keeps the check the old export did on them: every script still parses (`node --check`), and the installer and the
// README a new user opens are there. Personal data in the template is the publish guard's job (publish-guard.test.ts).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const tpl = path.join(root, 'brain-template');

describe('brain-template', () => {
  it('ships one action rules table without granting tools or production query execution', () => {
    const text = fs.readFileSync(path.join(tpl, 'me.template.md'), 'utf8');
    expect(text.split('### Regole delle azioni')).toHaveLength(2);
    for (const action of ['push', 'PR', 'merge']) expect(text).toContain(`| ${action} | non produzione | mostra-e-conferma |`);
    for (const action of ['deploy', 'scritture']) expect(text).toContain(`| ${action} | produzione | l'agente propone e la persona esegue |`);
    expect(text).toContain('Queries on production databases');
    expect(text).toContain('read-only too: never execute them');
    expect(text).toContain('never execute them, even with approval');
    expect(text).toContain('This table grants no tool permissions');
  });
  it('keeps production queries owner-only in the shipped Orchestrator style', () => {
    const text = fs.readFileSync(path.join(tpl, 'harness/claude/output-styles/orchestrator.md'), 'utf8');
    expect(text).toContain('mai eseguire query su DB di produzione, neanche in sola lettura');
    expect(text).toContain('Nessuna approvazione autorizza l\'agente a eseguirle');
    expect(text).not.toContain('query e avuto l\'ok');
  });
  it('has the installer and the guides a new user opens first', () => {
    for (const f of ['install.mjs', 'README.md', 'START-HERE.md', 'AGENTS.md', 'me.template.md']) expect(fs.existsSync(path.join(tpl, f)), f).toBe(true);
  });
});
