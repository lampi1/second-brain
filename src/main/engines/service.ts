// The engines' side of the app (ADR 0046) in one place: the brain's engine entries (brain/engines.ts), which definition
// of each engine the user turned on (trust.ts), the user's API keys (secrets.ts), this month's API spend (spend.ts) and
// the text-only calls on the user's Anthropic API key (text.ts, ADR 0052). The renderer reaches it only through the
// secrets:*, engines:trust and engines:spend channels (index.ts), which only the app's own page can call; no MCP tool
// reaches the keys (the text endpoint, text-mcp.ts, gets only answers). keyFor is for main alone: the chat manager hands
// a key to its own engine's process or request. One key is not an engine's: the Cursor Cloud Agents key (ADR 0080,
// CLOUD_KEYS), bound to Cursor's API host and given only to cloud/cursor.ts. Used by wiring.ts and demo-wiring.ts.
import path from 'node:path';
import type { ApiSpendInfo, Harness, SecretsStatus, SettingChange, Settings, SettingsPatch } from '../../shared/contract';
import { BrainEngines } from '../brain/engines';
import type { Emitter } from '../ipc';
import { engineInfos, engineOf, fingerprint, onEnginesChanged } from './registry';
import { SecretStore, type SecretCipher } from './secrets';
import { ApiSpend } from './spend';
import { TextModel } from './text';
import { EngineTrust } from './trust';

/** Keys that belong to a vendor's cloud API, not to an engine's start (ADR 0080): id → what the key is bound to. */
export const CLOUD_KEYS: Readonly<Record<string, string>> = { 'cursor-cloud': 'cloud:https://api.cursor.com/v1' };
const cloudBound = (id: Harness): string | undefined => (Object.hasOwn(CLOUD_KEYS, id) ? CLOUD_KEYS[id] : undefined);

export interface EnginesApi {
  secretsStatus(): SecretsStatus;
  setSecret(id: Harness, key: unknown): SecretsStatus;
  deleteSecret(id: Harness): SecretsStatus;
  /** the user's "Riaccendi": trust the engine's definition of now and turn it on */
  trust(id: Harness): Promise<void>;
  /** main only: the user's key for this engine's own process or request, or null */
  keyFor(id: Harness): string | null;
  /** is a key saved and usable for this engine (nothing decrypted) */
  hasKey(id: Harness): boolean;
  /** this month's API spend, and one more request or chat turn on an API engine (usd null = no price) */
  apiSpend(): ApiSpendInfo;
  addSpend(id: Harness, usd: number | null): void;
  /** text-only calls on the user's Anthropic API key (text.ts) */
  text: TextModel;
  stop(): void;
}

export interface EnginesDeps {
  userData: string;
  emitter: Emitter;
  cipher: SecretCipher;
  brainRoot: () => string | null;
  settings: { settings(): Settings; setSettings(patch: SettingsPatch): Promise<Settings>; onSettingChange(fn: (c: SettingChange, now: Settings) => void): () => void };
  /** how often the brain's models.json is looked at (ms) */
  everyMs?: number;
}

export function createEngines(d: EnginesDeps): EnginesApi {
  const trust = new EngineTrust(d.userData);
  const secrets = new SecretStore(d.userData, d.cipher);
  const brain = new BrainEngines(d.brainRoot);
  const spend = new ApiSpend(path.join(d.userData, 'api-spend.json'));
  const offEngines = onEnginesChanged(() => d.emitter.emit('engines:changed', engineInfos()));
  const offSettings = d.settings.onSettingChange(c => trust.onSetting(c));
  brain.start(d.everyMs);
  const boundOf = (id: Harness): string | null => { const c = cloudBound(id); if (c) return c; const e = engineOf(id); return e ? fingerprint(e) : null; };
  const takesKey = (id: Harness) => {
    const e = engineOf(id);
    if (!e) throw new Error(`Motore sconosciuto: ${id}`);
    if (e.key === 'none') throw new Error(`${e.label} non usa una chiave API: accede con il suo login.`);
    return e;
  };
  function keyFor(id: Harness): string | null {
    const c = cloudBound(id); if (c) return secrets.get(id, c);
    const e = engineOf(id);
    return e && e.key !== 'none' ? secrets.get(id, fingerprint(e)) : null;
  }
  return {
    secretsStatus: () => secrets.status(boundOf),
    setSecret: (id, key) => { secrets.set(id, key, cloudBound(id) ?? fingerprint(takesKey(id))); return secrets.status(boundOf); },
    deleteSecret: id => { secrets.delete(id); return secrets.status(boundOf); },
    trust: async id => {
      if (!engineOf(id)) throw new Error(`Motore sconosciuto: ${id}`);
      trust.record(id);
      await d.settings.setSettings({ engineOn: { [id]: true } });
    },
    keyFor,
    hasKey: id => { const k = secrets.status(boundOf).keys[id]; return !!k && !k.stale; },
    apiSpend: () => spend.info(),
    addSpend: (id, usd) => spend.add(id, usd),
    text: new TextModel({ settings: () => d.settings.settings(), keyFor, spend }),
    stop: () => { brain.stop(); offEngines(); offSettings(); },
  };
}
