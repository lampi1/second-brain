// Unit tests of the one-time migration's reader (src/main/brainmodel/procedure-sources.ts, ADR 0077; formerly the Procedure
// page's scanner): which files were runbook/routine sources (by structure, credentials files never), the sections that
// become skills (leaf headings, numbered-step files, notes left out of rules and playbooks), the masking of every line
// that may hold a credential (src/main/brain/mask.ts) and the demo brain read by the same scanner. Fake secrets are
// built in pieces: no real value, no secret in this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MASK, maskSecrets } from '../../../src/main/brain/mask';
import { procedureSections, linkedFrom, parseSections, plain, purposeOf, sectionText, sourceOf, tagsOf } from '../../../src/main/brainmodel/procedure-sources';
import { touchesBrainModel } from '../../../src/main/brainmodel/model';
import { writeDemoBrain } from '../../../src/main/brainmodel/demo';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-proc-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const PW = ['Pass', 'word'].join('');

describe('sourceOf', () => {
  it('folders and file names by structure, not by a list', () => {
    expect(sourceOf('ops/runbook/deploy.md')).toEqual({ kind: 'strong', label: 'Runbook' });
    expect(sourceOf('docs/how-to/setup.md')).toEqual({ kind: 'strong', label: 'Guida' });
    expect(sourceOf('routines.md')).toEqual({ kind: 'strong', label: 'Routine' });
    expect(sourceOf('rules/qa.md')).toEqual({ kind: 'soft', label: 'Regole' });
    expect(sourceOf('playbooks/x.md')).toEqual({ kind: 'soft', label: 'Playbook' });
    expect(sourceOf('notes/today.md')).toBeNull();
    expect(sourceOf('ops/runbook/index.md')).toBeNull();
    expect(sourceOf('ops/runbook/deploy.txt')).toBeNull();
  });
  it('a file named like credentials, secrets, passwords or tokens is never a source', () => {
    for (const f of ['ops/runbook/db-credentials.md', 'runbook/secrets.md', 'runbook/passwords.md', 'runbook/token-list.md']) expect(sourceOf(f)).toBeNull();
    expect(touchesBrainModel('ops/runbook/deploy.md')).toBe(true);
    expect(touchesBrainModel('ops/runbook')).toBe(true); // a folder moved or deleted
    expect(touchesBrainModel('ops/state/x.json')).toBe(false);
  });
});

describe('maskSecrets', () => {
  it('hides lines with a credential and keeps placeholders and references', () => {
    const lines = [
      `Server=tcp:db.example.test;User ID=x;${PW}=abc123secret;`,
      `${PW.toLowerCase()}: hunter22`,
      `sqlcmd -S db.example.test -U lettore -P s3cr3tvalue`,
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      `https://user:${['p', 'w', 'd', '9', '9'].join('')}@host.example.test/repo`,
      `https://store.example.test/x?sv=1&${'sig'}=AbCdEfGhIjKlMnOpQrStUv%3D`,
      `${'gh'}p_${'a'.repeat(24)}`,
      `  "${PW.toLowerCase()}": "S3cretPass",`, `- **${PW}**: S3cret!`, `**${PW}:** S3cret!`, `"client_${'secret'}": "abcd1234efgh"`,
      `az login --service-principal -u app -p S3cretValue --tenant t`, `az sql db list --${PW.toLowerCase()} S3cretValue`,
      `--client-${'secret'} S3cretValue`, `$cred = ConvertTo-SecureString "S3cretValue" -AsPlainText -Force`,
      `Authorization: Basic ${'dXNlcjpw'}YXNzd29yZA==`, `Ocp-Apim-Subscription-Key: 0123456789abcdef`,
      `${PW}=$ecr3tValue`, `${PW.toLowerCase()}: "%Secret123"`,
    ];
    const keep = [
      'imposta `@searched=\'%testo%\'` e sostituisci `<SM_PASSPHRASE>`',
      `header \`X-API-KEY\` = \`AppSetting:ApiKey\` (in \`$env:DEMO_API_KEY\`)`,
      `${PW}=<la tua>`, `${PW}=$env:DB_PASS`, `token: \${TOKEN}`,
      'Chiedi la password a chi gestisce l’ambiente.',
      'mkdir -p C:/temp/prova', `${PW}: ***`, `${PW}=%DB_PASS%`,
    ];
    const r = maskSecrets([...lines, ...keep].join('\n'));
    expect(r.masked).toBe(lines.length);
    const out = r.text.split('\n');
    expect(out.slice(0, lines.length).every(l => l.trim().replace(/^- /, '') === MASK)).toBe(true); // indent and list marker kept
    expect(out.slice(lines.length)).toEqual(keep);
  });
  it('masks the rows of a table whose column names a credential, placeholders kept', () => {
    const t = ['| Ambiente | Utente | ' + PW + ' |', '|---|---|---|', '| test | sa | S3cretValue |', '| prod | sa | <dal vault> |', '', '| Ambiente | Note |', '|---|---|', '| test | ok |'];
    const r = maskSecrets(t.join('\n'));
    expect(r.masked).toBe(1);
    expect(r.text.split('\n')).toEqual([t[0], t[1], MASK, t[3], '', t[5], t[6], t[7]]);
  });
  it('keeps the list marker of a masked line and hides a whole private key block', () => {
    const r = maskSecrets(['- ' + `${PW}=abcdef12`, `-----BEGIN RSA ${'PRIVATE'} KEY-----`, 'MIIEow', `-----END RSA ${'PRIVATE'} KEY-----`, 'dopo'].join('\n'));
    expect(r.text.split('\n')).toEqual([`- ${MASK}`, MASK, MASK, MASK, 'dopo']);
    expect(r.masked).toBe(4);
  });
});

describe('parsing', () => {
  const RUN = [
    '# Clienti e licenze', '', 'Intro del file.', '',
    '### Trovare un cliente', '- **Standard:** procedura `lookup` (`EXEC lookup \'%testo%\'`).', '',
    '## Attivazioni', '', '### Attivare una licenza', '1. `sm/lookup/license-features.sql` → cosa c\'è già.', '2. Parte 1 dello script.', '',
    '### Attivare una licenza', 'Un\'altra variante, in produzione: `node tools/x.mjs`.', '',
    '```sql', '### non è un titolo', 'SELECT 1', '```',
  ].join('\n');

  it('leaf sections become skills-to-be with area, group, line, purpose, tags and unique ids', () => {
    const ps = parseSections('ops/runbook/clienti.md', RUN, { kind: 'strong', label: 'Runbook' });
    expect(ps.map(p => [p.title, p.group, p.line])).toEqual([['Trovare un cliente', null, 5], ['Attivare una licenza', 'Attivazioni', 10], ['Attivare una licenza', 'Attivazioni', 14]]);
    expect(ps.map(p => p.id)).toEqual(['ops/runbook/clienti.md#trovare-un-cliente', 'ops/runbook/clienti.md#attivare-una-licenza', 'ops/runbook/clienti.md#attivare-una-licenza-2']);
    expect(ps[0]).toMatchObject({ area: 'Clienti e licenze', source: 'Runbook', purpose: "Standard: procedura lookup (EXEC lookup '%testo%').", tags: ['query'] });
    expect(ps[1]!.tags).toEqual(['passi', 'query']);
    expect(ps[2]!.tags).toEqual(['query', 'comandi', 'produzione']);
  });
  it('ids stay unique when a suffix meets a real title; a section ends at a following H1', () => {
    const t = ['# R', '## Deploy', 'Primo modo di farlo.', '## Deploy', 'Secondo modo di farlo.', '## Deploy 2', 'Terzo modo di farlo.', '# Altro', 'az webapp restart in produzione'].join('\n');
    const ps = parseSections('r.md', t, { kind: 'strong', label: 'Runbook' });
    expect(ps.map(p => p.id)).toEqual(['r.md#deploy', 'r.md#deploy-3', 'r.md#deploy-2']);
    expect(ps[2]!.tags).not.toContain('produzione');
  });
  it('a file of numbered sections is one section', () => {
    const t = ['# Hotfix di una regressione', 'Il flusso.', '## 1. Trova l\'eccezione', 'Leggi i log del nodo.', '## 2. Trova il commit', '`git log`', '## 3. Rilascia', 'Su un anello.'].join('\n');
    const ps = parseSections('flusso.md', t, { kind: 'strong', label: 'Runbook' });
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ title: 'Hotfix di una regressione', line: 1, purpose: 'Il flusso.', id: 'flusso.md#hotfix-di-una-regressione' });
  });
  it('rules and playbooks: only sections with real steps; empty notebook sections never', () => {
    const t = ['# Regole', '## Provare un test case', '1. Prendi l\'ambiente.', '2. Segui i passi.', '## Tono', 'Commenti brevi e gentili, in inglese semplice, sempre.', '## Punti', '(nessuno)'].join('\n');
    expect(parseSections('rules/qa.md', t, { kind: 'soft', label: 'Regole' }).map(p => p.title)).toEqual(['Provare un test case']);
    expect(parseSections('routines.md', t, { kind: 'strong', label: 'Routine' }).map(p => p.title)).toEqual(['Provare un test case', 'Tono']);
  });
  it('helpers: plain text, purpose, tags, index links', () => {
    expect(plain('**Dove:** API `POST /x` e [doc](a.md)')).toBe('Dove: API POST /x e doc');
    expect(purposeOf('```\ncodice\n```\n| a |\n\n- primo passo')).toBe('primo passo');
    expect(tagsOf('niente di speciale')).toEqual([]);
    expect(linkedFrom('ops/runbook/index.md', '| `deploy.md` | x |\nVedi `../hotfix-flow.md` e [y](../../fuori/../z.md) e `../../../esce.md`'))
      .toEqual(['ops/runbook/deploy.md', 'ops/hotfix-flow.md', 'z.md']);
  });
});

describe('procedureSections', () => {
  it('scans a brain: runbook files, files linked from the index, routines; never credentials files, agents or skipped folders', () => {
    const root = tmp();
    put(root, 'ops/runbook/index.md', '# Runbook (index)\n| `sql.md` | q |\nRegressione: `../hotfix-flow.md`, credenziali `../db-credentials.md`.');
    put(root, 'ops/runbook/sql.md', `# Query su produzione\n### Query in sola lettura\nUna query di controllo, solo letture.\n\`\`\`text\nServer=db;${PW}=topsecret1\n\`\`\`\n`);
    put(root, 'ops/hotfix-flow.md', '# Hotfix\n## 1. Trova\nI log.\n## 2. Correggi\nLa PR con il test.');
    put(root, 'ops/db-credentials.md', `# Credenziali\n### Accesso\n${PW}: x`);
    put(root, 'routines.md', '# Routine\n## Brief mattutino\n1. `node tools/brief.mjs`\n2. Leggi il file.');
    put(root, 'ops/state/runbook/x.md', '# No\n### Nascosta\nNon deve comparire mai qui.');
    put(root, 'agents/a/runbook/x.md', '# No\n### Di un agente\nNon deve comparire mai qui.');
    put(root, '.claude/skills/runbook/y.md', '# No\n### Una skill\nNon deve comparire mai qui.');
    put(root, 'notes.md', '# Note\n## Non è una sezione\nTesto libero qualsiasi qui dentro.');
    const l = procedureSections(root);
    expect(l.map(x => `${x.file} · ${x.title}`)).toEqual([
      'ops/hotfix-flow.md · Hotfix', 'ops/runbook/sql.md · Query in sola lettura', 'routines.md · Brief mattutino',
    ]);
    const one = sectionText(root, l.find(x => x.title === 'Query in sola lettura')!)!;
    expect(one.masked).toBe(1);
    expect(one.text).toContain(MASK);
    expect(one.text).not.toContain('topsecret1');
    expect(fs.readFileSync(path.join(root, 'ops/runbook/sql.md'), 'utf8')).toContain('topsecret1'); // the original is never changed
  });
  it('an empty brain has nothing to migrate', () => {
    expect(procedureSections(tmp())).toEqual([]);
  });
  it('the demo brain: every former kind, its fake credential masked, the credentials file left out', () => {
    const root = writeDemoBrain(path.join(tmp(), 'demo'), Date.parse('2026-10-13T08:00:00Z'));
    const l = procedureSections(root);
    expect(l.map(x => x.title)).toEqual(expect.arrayContaining(['Pubblicare una versione in test', 'Cercare un cliente con lookup', 'Attivare una funzionalità su una licenza', 'Hotfix di una regressione', 'Brief mattutino', 'Provare un test case']));
    expect(l.some(x => /credenziali|Tono|Punti/i.test(x.title + x.file))).toBe(false);
    const q = sectionText(root, l.find(x => x.title === 'Query in sola lettura su produzione')!)!;
    expect(q.masked).toBe(1);
    expect(q.text).not.toMatch(/demo-non-reale/);
  });
});
