// The personal browser's address bar and user agent (personal/address.ts, ADR 0133).
import { describe, expect, it } from 'vitest';
import { SEARCH_URL, cleanUserAgent, resolveInput } from '../../src/main/personal/address';
import { detectScript, fillScript, readScript } from '../../src/main/personal/page';

describe('resolveInput', () => {
  it('opens addresses, adds the scheme to bare hosts, searches the rest', () => {
    expect(resolveInput('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(resolveInput('example.com')).toBe('https://example.com');
    expect(resolveInput('mail.google.com/mail/u/0')).toBe('https://mail.google.com/mail/u/0');
    expect(resolveInput('localhost:5173')).toBe('http://localhost:5173');
    expect(resolveInput('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
    expect(resolveInput('203.0.113.10')).toBe('https://203.0.113.10');
    expect(resolveInput('meteo milano')).toBe(`${SEARCH_URL}meteo%20milano`);
    expect(resolveInput('')).toBe('about:blank');
  });

  it('never opens other schemes from the bar', () => {
    for (const s of ['javascript:alert(1)', 'file:///C:/Windows', 'chrome://settings', 'data:text/html,<b>x']) expect(resolveInput(s).startsWith(SEARCH_URL)).toBe(true);
  });
});

describe('cleanUserAgent', () => {
  it('drops the Electron and app tokens', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) second-brain/0.1.0 Chrome/140.0.0.0 Electron/44.4.5 Safari/537.36';
    expect(cleanUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    expect(cleanUserAgent(ua.replace('second-brain', 'second-brain-dev'), 'second-brain-dev')).not.toContain('second-brain');
  });
});

describe('page scripts', () => {
  it('parse, and a value never escapes its string literal', () => {
    for (const code of [detectScript(), readScript(), fillScript('me', 'pw')]) expect(() => new Function(`return ${code}`)).not.toThrow();
    const evil = fillScript('"); alert(1); ("', '`${alert(2)}`\\\n</script>');
    expect(() => new Function(`return ${evil}`)).not.toThrow();
    expect(evil).toContain(JSON.stringify('"); alert(1); ("'));
    expect(evil).not.toMatch(/[^\\]"\); alert\(1\)/);
  });
});
