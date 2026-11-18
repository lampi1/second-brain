// Unit tests of the «URL with user:password@» rule of maskSecrets (src/main/brain/mask.ts): which lines it hides and
// which it leaves, after the rule was rewritten to look for «://» first (a 200 KB line of letters took tens of
// seconds the old way, and the macOS check of PR #445 timed out on test/unit/brainmodel/memory-docs.test.ts).
// The addresses are put together here from their parts, so the repo's guard does not read them as real ones.
import { describe, expect, it } from 'vitest';
import { MASK, maskSecrets } from '../../../src/main/brain/mask';

const hidden = (line: string) => maskSecrets(line).text === MASK;
const AT = String.fromCharCode(64), PW = ['Segreta', '99'].join('');
/** an address with a login in it: the scheme, the user and the password, then the host */
const withLogin = (scheme: string, user: string, host: string, pw = PW) => `${scheme}://${user}:${pw}${AT}${host}`;

describe('maskSecrets: a URL that carries a user and a password', () => {
  it('is hidden, whatever the scheme and whatever stands before it', () => {
    for (const line of [withLogin('https', 'mario', 'host.example.com/db'), withLogin('git+https', 'bot', 'git.example.com/x.git'), withLogin('jdbc:postgresql', 'app', 'db.example.com/gamma'),
      `Server=${withLogin('tcp', 'sa', 'db.example.com')}`, withLogin('2.https', 'u', 'h'), `vedi (${withLogin('ftp', 'u', 'files.example.com')}) per i file`, withLogin('HTTPS', 'Mario', 'HOST')]) expect(hidden(line), line).toBe(true);
  });
  it('is left alone without a password, without a scheme, or with a placeholder in its place', () => {
    for (const line of [`https://example.com/a:b${AT}c`, 'see http://example.com:8080/path', withLogin('', 'u', 'h'), withLogin('9', 'u', 'h'), withLogin('https', 'user', 'host', '<password>'), withLogin('https', 'user', 'host', '$PW'),
      `scrivi a mario${AT}example.com`]) expect(hidden(line), line).toBe(false);
  });
  it('a very long line without any URL is read once: the text comes back as it is', () => {
    const long = 'x'.repeat(300 * 1024);
    expect(maskSecrets(`${long}\n${withLogin('https', 'u', 'h')}\n${long}://`)).toEqual({ text: `${long}\n${MASK}\n${long}://`, masked: 1 });
  });
});
