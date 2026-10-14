// The engines' side of the app (ADR 0046) in one place: the brain's engine entries (brain/engines.ts), which definition
// of each engine the user turned on (trust.ts) and the user's API keys (secrets.ts). The renderer reaches it only
// through the secrets:* and engines:trust channels (index.ts), which only the app's own page can call; no MCP tool
// reaches it. keyFor is for main alone: the chat manager hands a key to its own engine's process or request. Used by
// wiring.ts and demo-wiring.ts.
import type { Harness, SecretsStatus, SettingChange, Settings, SettingsPatch } from '../../shared/contract';
import { BrainEngines } from '../brain/engines';
import type { Emitter } from '../ipc';
import { engineInfos, engineOf, fingerprint, onEnginesChanged } from './registry';
import { SecretStore, type SecretCipher } from './secrets';
import { EngineTrust } from './trust';

export interface EnginesApi {
  secretsStatus(): SecretsStatus;
  setSecret(id: Harness, key: unknown): SecretsStatus;
  deleteSecret(id: Harness): SecretsStatus;
  /** the user's "Riaccendi": trust the engine's definition of now and turn it on */
  trust(id: Harness): Promise<void>;
  /** main only: the user's key for this engine's own process or request, or null */
  keyFor(id: Harness): string | null;
  stop(): void;
}

export interface EnginesDeps {
  userData: string;
  emitter: Emitter;
  cipher: SecretCipher;
  brainRoot: () => string | null;
  settings: { setSettings(patch: SettingsPatch): Promise<Settings>; onSettingChange(fn: (c: SettingChange, now: Settings) => void): () => void };
  /** how often the brain's models.json is looked at (ms) */
  everyMs?: number;
}

export function createEngines(d: EnginesDeps): EnginesApi {
  const trust = new EngineTrust(d.userData);
  const secrets = new SecretStore(d.userData, d.cipher);
  const brain = new BrainEngines(d.brainRoot);
  const offEngines = onEnginesChanged(() => d.emitter.emit('engines:changed', engineInfos()));
  const offSettings = d.settings.onSettingChange(c => trust.onSetting(c));
  brain.start(d.everyMs);
  const boundOf = (id: Harness): string | null => { const e = engineOf(id); return e ? fingerprint(e) : null; };
  const takesKey = (id: Harness) => {
    const e = engineOf(id);
    if (!e) throw new Error(`Motore sconosciuto: ${id}`);
    if (e.key === 'none') throw new Error(`${e.label} non usa una chiave API: accede con il suo login.`);
    return e;
  };
  return {
    secretsStatus: () => secrets.status(boundOf),
    setSecret: (id, key) => { const e = takesKey(id); secrets.set(id, key, fingerprint(e)); return secrets.status(boundOf); },
    deleteSecret: id => { secrets.delete(id); return secrets.status(boundOf); },
    trust: async id => {
      if (!engineOf(id)) throw new Error(`Motore sconosciuto: ${id}`);
      trust.record(id);
      await d.settings.setSettings({ engineOn: { [id]: true } });
    },
    keyFor: id => {
      const e = engineOf(id);
      return e && e.key !== 'none' ? secrets.get(id, fingerprint(e)) : null;
    },
    stop: () => { brain.stop(); offEngines(); offSettings(); },
  };
}
