// The one outgoing filter of the phone bridge, adversarially: code fences (``` and ~~~, unclosed, with a language),
// inline code, command lines, tables, query rows, secrets (token, password, bearer, connection string, bot token),
// links (markdown title dropped, domain only), local paths, license codes, emails, codici fiscali, IBANs, GUIDs, Db_
// names, zero-width and full-width tricks; plus the condenser (sentence cut, "Continua sul PC", never inside a
// placeholder) and idempotency.
import { describe, expect, it } from 'vitest';
import { condense, CONDENSE_MAX, MORE } from '../../../src/main/phone/condense';
import { CODE_PLACEHOLDER, filterOutgoing, ROWS_PLACEHOLDER, TABLE_PLACEHOLDER } from '../../../src/main/phone/filter';
import { FX, TOKEN } from './fakes';

const f = filterOutgoing;

describe('filterOutgoing', () => {
  it('replaces fenced code blocks, also unclosed, ~~~ and with a language', () => {
    expect(f('Esegui:\n```powershell\nRemove-Item -Recurse C:\\x\n```\nfatto')).toBe(`Esegui:\n${CODE_PLACEHOLDER}\nfatto`);
    expect(f('a\n~~~sql\nSELECT * FROM Db_Rossi\n~~~\nb')).toBe(`a\n${CODE_PLACEHOLDER}\nb`);
    expect(f('a\n```\nsecret stuff\nmore')).toBe(`a\n${CODE_PLACEHOLDER}`);
    expect(f('a\n````\n```\ninside\n```\n````\nb')).toBe(`a\n${CODE_PLACEHOLDER}\nb`);
  });

  it('replaces inline code and lone backticks', () => {
    expect(f('lancia `git push --force` ora')).toBe(`lancia ${CODE_PLACEHOLDER} ora`);
    expect(f('lancia ``a `b` c`` ora')).not.toContain('`');
    expect(f('un ` solo')).toBe('un  solo');
  });

  it('replaces command lines', () => {
    expect(f('Poi:\ngit reset --hard HEAD~1\nok')).toBe(`Poi:\n${CODE_PLACEHOLDER}\nok`);
    expect(f('PS C:\\> Remove-Item -Recurse x')).toBe(CODE_PLACEHOLDER);
    expect(f('$ sqlcmd -S prod -Q "select 1"')).toBe(CODE_PLACEHOLDER);
    expect(f('Invoke-Sqlcmd -Query "x"')).toBe(CODE_PLACEHOLDER);
  });

  it('drops markdown tables and query-result rows', () => {
    expect(f('Ecco:\n| Cliente | Codice |\n|---|---|\n| Rossi | 12 |\nfine')).toBe(`Ecco:\n${TABLE_PLACEHOLDER}\nfine`);
    expect(f('Id\tNome\tCodice\n1\tMario\tX')).toBe(ROWS_PLACEHOLDER);
    expect(f('Id   Nome     Citta\n---- -------- -----\n1    Mario    Roma\n(1 rows affected)')).toBe(ROWS_PLACEHOLDER);
  });

  it('masks credentials and the bot token', () => {
    expect(f(FX.pw('Sup3rS3cret!'))).not.toContain('Sup3rS3cret');
    expect(f('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(f(FX.connString)).not.toContain('Hunter22');
    expect(f(`il token è ${TOKEN}`)).not.toContain(TOKEN.split(':')[1]);
    expect(f('chiave sk-abcdefghijklmnopqrstuvwx')).not.toContain('sk-abcdefghijklmnop');
  });

  it('reduces links to their domain: titles, paths and queries never pass', () => {
    expect(f(`vedi [Bug fatture Rossi](https://${FX.devops}/org/proj/_workitems/edit/123)`)).toBe(`vedi ${FX.devops}/...`);
    expect(f('https://portal.azure.com/#resource/subscriptions/abc')).toBe('portal.azure.com/...');
    expect(f('apri www.studio-rossi.it/pazienti?id=4')).toBe('apri www.studio-rossi.it/...');
    expect(f('https://example.com')).toBe('example.com');
    expect(f(FX.userPass)).not.toContain('pw@');
  });

  it('masks local paths', () => {
    expect(f(`il file ${FX.winUserPath}`)).toBe('il file [percorso]');
    expect(f('in \\\\srv01\\share\\Rossi')).toBe('in [percorso]');
    expect(f(`in ${FX.macHomePath} e ~/x`)).toBe('in [percorso] e [percorso]');
  });

  it('masks customer and personal data', () => {
    expect(f('licenza ODENTAIRC00123 e PDENTAIR9')).toBe('licenza [codice] e [codice]');
    expect(f('licenza odentairc00123')).toBe('licenza [codice]');
    expect(f('chiave AB12-CD34-EF56-GH78')).toBe('chiave [codice]');
    expect(f(`scrivi a ${FX.mail2}`)).toBe('scrivi a [email]');
    expect(f('CF RSSMRA80A01H501U')).toBe('CF [codice fiscale]');
    expect(f('CF rssmra80a01h501u')).toBe('CF [codice fiscale]');
    expect(f('IBAN IT60X0542811101000000123456')).toBe('IBAN [iban]');
    expect(f('IBAN IT60 X054 2811 1010 0000 0123 456')).toBe('IBAN [iban]');
    expect(f(`id ${FX.guid}`)).toBe('id [guid]');
    expect(f('db Db_Studio_Rossi_01 fermo')).toBe('db [db] fermo');
    expect(f('partita iva 01234567890')).toBe('partita iva [numero]');
  });

  it('defeats zero-width and full-width tricks', () => {
    expect(f('ODENTAIR\u200BC00123')).toBe('[codice]');
    expect(f('ｍａｒｉｏ＠ｓｔｕｄｉｏ．ｉｔ')).toBe('[email]');
    expect(f('`\u200Bgit push`')).toBe(CODE_PLACEHOLDER);
    expect(f('a\u202Eb\u0007c')).toBe('abc');
    expect(f('\u26A0\uFE0F ok')).toBe('\u26A0\uFE0F ok');
    expect(f('ODENTAIR\uFE0FC00123')).toBe('[codice]');
  });

  it('keeps plain prose and is idempotent', () => {
    const prose = 'Fix pronta, PR aperta, QA in attesa. Prossimo: niente da te.';
    expect(f(prose)).toBe(prose);
    const messy = `vedi [x](https://${FX.devops}/a/b) e \`git push\`, mail ${FX.mailShort}, ODENTAIRC1\n| a | b |\n|---|---|`;
    expect(f(f(messy))).toBe(f(messy));
  });

  it('masks forward-slash Windows paths and relative file paths (review S1)', () => {
    const home = ['Us', 'ers'].join('') + '/someone'; // built at run time: no user path in the source
    expect(f(`apri C:/${home}/Documents/fattura.pdf ora`)).toBe('apri [percorso] ora');
    expect(f(`in /c/${home}/x`)).toBe('in [percorso]');
    expect(f('vedi clienti/rossi/fattura-2026.pdf')).toBe('vedi [percorso]');
    expect(f('cambiato src/main/phone/filter.ts.')).toBe('cambiato [percorso].');
    expect(f('e/o, 3/4 delle volte, 07/11/2026')).toBe('e/o, 3/4 delle volte, 07/11/2026');
  });

  it('reduces a scheme-less host with a path to its domain (review S2)', () => {
    expect(f('apri portal.azure.com/subscriptions/0e50/resourceGroups/rossi')).toBe('apri portal.azure.com/...');
    expect(f(`vedi ${FX.devops}/org/proj/_workitems/edit/123`)).toBe(`vedi ${FX.devops}/...`);
    expect(f('dominio portal.azure.com e basta')).toBe('dominio portal.azure.com e basta');
  });

  it('masks bot tokens of 5 to 16 digits (review S3)', () => {
    const secret = TOKEN.split(':')[1]!;
    for (const id of ['12345', '1234567890123456']) expect(f(`token ${id}:${secret}`)).toBe('token [redacted]');
  });

  it('defeats tag characters and Cyrillic/Greek look-alikes (review S4)', () => {
    expect(f('ODENTAIR\u{E0041}C00123')).toBe('[codice]');
    expect(f('ok\u{E0001}\u{E007F}')).toBe('ok');
    expect(f('licenza \u041EDENTAIRC00123')).toBe('licenza [codice]');            // Cyrillic О
    expect(f('db \u0405\u0435rv Db_\u0430')).not.toMatch(/Db_/i);
    expect(f('Привет, мир')).toBe('Привет, мир');                                   // one script: kept
  });

  it('masks codes glued to a word, GUIDs without dashes, spaced codici fiscali, Db _X and SAS signatures (review S4)', () => {
    expect(f('licenzaODENTAIRC00123')).toBe('licenza[codice]');
    expect(f('nome myDb_Rossi')).toBe('nome my[db]');
    expect(f('db Db _Studio_Rossi fermo')).toBe('db [db] fermo');
    expect(f('id 3f2504e04f8911d39a0c0305e82c3301')).toBe('id [guid]');
    expect(f('CF RSS MRA 80A01 H501U')).toBe('CF [codice fiscale]');
    expect(f('CF RSSMRA 80A01 H501U')).toBe('CF [codice fiscale]');
    expect(f('firma sig=abc%2Bdef%3D&se=2026')).toBe('firma sig=[redacted]&se=2026');
    const prose = 'Per far partire la build devi solo aspettare che i test siano verdi, poi ci pensa la pipeline.';
    expect(f(prose)).toBe(prose);
  });

  it('caps a huge input', () => {
    expect(f('a'.repeat(100_000)).length).toBeLessThanOrEqual(20_000);
  });
});

describe('condense', () => {
  it('leaves short text alone (filtered)', () => {
    expect(condense('ok `rm -rf /`')).toBe(`ok ${CODE_PLACEHOLDER}`);
  });

  it('cuts at a sentence boundary and says to continue on the PC', () => {
    const text = `${'Questa è una frase lunga. '.repeat(40)}`;
    const out = condense(text);
    expect(out.length).toBeLessThanOrEqual(CONDENSE_MAX + MORE.length + 1);
    expect(out.endsWith(MORE)).toBe(true);
    expect(out.split('\n')[0]!.endsWith('.')).toBe(true);
  });

  it('never cuts inside a placeholder', () => {
    const text = `${'x'.repeat(590)} \`cmd\` ${'y '.repeat(200)}`;
    const out = condense(text);
    expect(out).not.toMatch(/\[[^\]]*\n/);
    expect(out.endsWith(MORE)).toBe(true);
  });

  it('filters before cutting: a secret past the cut never shows, one before it is masked', () => {
    const out = condense(`${FX.pw('Abcd1234!')} ${'z. '.repeat(400)}`);
    expect(out).not.toContain('Abcd1234');
  });
});
