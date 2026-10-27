// User-managed encrypted site credentials for explicitly approved routine origins. No brain files or agent secret reads.
import { LoginVault } from '../personal/vault';
import type { SecretCipher } from '../engines/secrets';
import { browserOrigins } from '../../shared/flow-browser';
import type { SiteCredentialInput, SiteCredentials } from '../../shared/contract';
const exactOrigin = (url: unknown): string | null => {
  try { const u = new URL(String(url)); if (u.username || u.password) return null; return browserOrigins([u.origin])[0]!; } catch { return null; }
};
export class SiteVault {
  private readonly vault: LoginVault;
  constructor(file: string, cipher: SecretCipher, private readonly approved: () => string[]) { this.vault = new LoginVault(file, cipher, Date.now, exactOrigin); }
  list(): SiteCredentials { return { entries: this.vault.list(), origins: [...new Set(this.approved())].sort(), unavailable: this.vault.unavailable() }; }
  save(input: SiteCredentialInput): void {
    const origin = browserOrigins([input.origin])[0]!;
    if (!this.approved().includes(origin)) throw new Error('Approve a routine with this exact browserTargets origin before saving a credential');
    if (typeof input.user !== 'string' || typeof input.password !== 'string') throw new Error('User and password required');
    if (input.id) this.vault.update(input.id, origin, input.user, input.password); else this.vault.save(origin, input.user, input.password);
  }
  remove(id: string): void { this.vault.remove(id); }
  /** Host-only, exact scheme/host/port; ambiguous accounts require the user's handoff. */
  forLogin(origin: string): { user: string; password: string } | null {
    if (this.vault.unavailable() || !this.approved().includes(origin)) return null;
    const matches = this.vault.forUrl(origin);
    return matches.length === 1 ? this.vault.passwordFor(matches[0]!.id, origin) : null;
  }
  /** Host-only, to fill a routine package's login for this exact origin (routines/secret-fill.ts). Every entry was saved
   *  by the user for an approved origin, so no current approval is needed; one account only, else the user chooses. */
  forPackage(origin: string): { value: { user: string; password: string } } | { reason: string } {
    const exact = exactOrigin(origin);
    if (!exact) return { reason: 'indirizzo di login non valido' };
    const why = this.vault.unavailable();
    if (why) return { reason: `password dei siti non leggibili: ${why}` };
    const matches = this.vault.forUrl(exact);
    if (!matches.length) return { reason: 'nessuna password salvata per questo sito' };
    if (matches.length > 1) return { reason: 'più account salvati per questo sito: inseriscilo tu' };
    const login = this.vault.passwordFor(matches[0]!.id, exact);
    return login ? { value: login } : { reason: 'password salvata non decifrabile' };
  }
}
