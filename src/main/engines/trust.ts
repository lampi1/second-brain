// Which start definition of each engine the user turned on (ADR 0046): <userData>/engine-trust.json, { <id>:
// <fingerprint> } (registry.ts fingerprint). Why: the owner, 14/10: no new engine starts unless they turned it
// on. An engine that is not built in starts only while its definition is the one that was on when the user
// turned it on; if the brain's models.json changes it (an agent can write there), it counts as off until the user turns
// it on again, and Settings says why. Recorded when «X acceso» becomes true by the user's hand (their click, or their
// confirm of an agent's proposal), and by `engines:trust` (the user's "Riaccendi" on a changed engine). Used by
// wiring.ts and demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Harness, SettingChange } from '../../shared/contract';
import { log } from '../log';
import { ENGINE_ID, engineOf, fingerprint, setTrust } from './registry';

const KEY = /^engineOn\.(.+)$/;

export class EngineTrust {
  private readonly file: string;
  private saved: Record<string, string> = {};

  constructor(userData: string) {
    this.file = path.join(userData, 'engine-trust.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      for (const [id, fp] of Object.entries(raw)) if (ENGINE_ID.test(id) && typeof fp === 'string' && /^[0-9a-f]{16}$/.test(fp)) this.saved[id] = fp;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('engines', 'engine-trust.json unreadable: engines that are not built in stay off', { cause: (e as Error).message, hint: 'turn them on again in Impostazioni → Motori' });
    }
    setTrust(this.saved);
  }

  /** The user turned this engine on: its definition of now is the one that may start. */
  record(id: Harness): void {
    const e = engineOf(id);
    if (!e) return;
    const fp = fingerprint(e);
    if (this.saved[id] === fp) return;
    const next = { ...this.saved, [id]: fp };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.file);
    this.saved = next;
    setTrust(next);
    log.info('engines', 'engine turned on by the user: its definition is trusted', { data: { engine: id, runs: e.runs } });
  }

  /** A settings change: «X acceso» turned on by the user records X's definition. */
  onSetting(c: Pick<SettingChange, 'key' | 'after' | 'by'>): void {
    const id = KEY.exec(c.key)?.[1];
    if (id && c.after === true && c.by === 'user') this.record(id);
  }
}
