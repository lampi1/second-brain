// Host-side filling of a routine package's secrets (ADR 0176; the owner, 2026-10-27: «mettilo nel pacchetto il token
// devops e tutte le credenziali necessarie io non devo fare nulla»). Every '<set-by-user>' slot the app can answer is
// filled from what the user already saved in the app: the DevOps token of their Azure DevOps connector (Settings →
// Connettori, ADR 0086) or else, for the package's own organization, the PAT in Cursor's MCP config (read only, ADR 0176), the site logins of the routine site vault (ADR 0165), the app's test-only SQL login for a test
// database (never a production-looking one). What stays empty keeps the placeholder and says why. Values never leave
// this module and the package: the outcome rows carry slot names, sources and reasons only. Pure (sources injected);
// used by routines/service.ts on every save, import, migration and terminal export, and unit-tested with fake sources.
import { checkTestDbTarget, SECRET_PLACEHOLDER, type RoutinePackage, type RoutineTestDb } from '../../../packages/routine-runtime/src/index';
import type { McpSecretSlot, McpServerDef } from '../../shared/mcp-servers';

/** A secret a source gave, or why it could not (plain words, never a value). */
export type Found<T> = { value: T } | { reason: string };
export interface Login { user: string; password: string }
export interface SecretSources {
  /** the DevOps token of the user's Azure DevOps connector */
  devopsPat?: () => Found<string>;
  /** the DevOps PAT of Cursor's MCP config for this exact organization (read only, ADR 0176); used when the connector has none */
  cursorDevopsPat?: (organization: string) => Found<string>;
  /** the routine site vault's single login for an exact origin */
  siteLogin?: (origin: string) => Found<Login>;
  /** the app's test-only SQL login, for a target the test DB guard already allowed */
  testDbLogin?: (db: RoutineTestDb) => Found<Login>;
}
export type SecretSourceName = 'Connettore Azure DevOps' | 'Configurazione MCP di Cursor' | 'Password dei siti (routine)' | 'Login DB di test dell’app' | 'Pacchetto';
/** One row of the outcome: which secret, from where, filled or not and why. No value, ever. */
export interface FillRow { secret: string; source: SecretSourceName; filled: boolean; reason: string }
export interface FillOutcome { pkg: RoutinePackage; rows: FillRow[]; changed: boolean }

const isSet = (v: string | undefined): v is string => !!v && v !== SECRET_PLACEHOLDER;
const okValue = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v !== SECRET_PLACEHOLDER && v.length <= max && !/[\0\r\n]/.test(v);
const originOf = (url: string): string => { try { return new URL(url).origin; } catch { return ''; } };
const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };
const NO_SOURCE = 'l’app non ha questa fonte qui';

/**
 * Fills every placeholder the sources answer. `loginOrigins` are sites a routine logs into whose login the package does
 * not carry yet (a migrated legacy routine's browserTargets): a site the vault knows gets an origin-only login; one it
 * does not know is reported, never added as an empty slot (that would block the routine for nothing).
 * Values the package already carries are kept as they are.
 */
export function fillPackageSecrets(pkg: RoutinePackage, sources: SecretSources, options: { loginOrigins?: readonly string[] } = {}): FillOutcome {
  const next = JSON.parse(JSON.stringify(pkg)) as RoutinePackage;
  const rows: FillRow[] = [];
  let changed = false;
  const ask = <T>(get: (() => Found<T>) | undefined): Found<T> => { if (!get) return { reason: NO_SOURCE }; try { return get(); } catch { return { reason: 'la fonte non ha risposto' }; } };

  // site logins: each placeholder field from the vault's single login for that origin
  const site: SecretSourceName = 'Password dei siti (routine)';
  for (const c of next.credentials ?? []) {
    const label = `Login ${hostOf(c.loginUrl)}`;
    if (isSet(c.user) && isSet(c.password)) { rows.push({ secret: label, source: 'Pacchetto', filled: true, reason: 'già nel pacchetto' }); continue; }
    const origin = originOf(c.loginUrl);
    const got = origin ? ask(sources.siteLogin && (() => sources.siteLogin!(origin))) : { reason: 'indirizzo di login non valido' };
    if ('reason' in got) { rows.push({ secret: label, source: site, filled: false, reason: got.reason }); continue; }
    if (!okValue(got.value.user, 256) || !okValue(got.value.password, 1024)) { rows.push({ secret: label, source: site, filled: false, reason: 'valore salvato non valido' }); continue; }
    if (isSet(c.user) && c.user !== got.value.user) { rows.push({ secret: label, source: site, filled: false, reason: 'il pacchetto indica un altro utente: inserisci tu la password' }); continue; }
    Object.assign(c, { user: got.value.user, password: got.value.password }); changed = true;
    rows.push({ secret: label, source: site, filled: true, reason: 'dalla password salvata per questo sito' });
  }
  const carried = new Set((next.credentials ?? []).map(c => originOf(c.loginUrl)));
  for (const raw of options.loginOrigins ?? []) {
    const origin = originOf(raw);
    if (!origin || carried.has(origin)) continue;
    carried.add(origin);
    const label = `Login ${hostOf(origin)}`;
    const got = ask(sources.siteLogin && (() => sources.siteLogin!(origin)));
    if ('reason' in got) { rows.push({ secret: label, source: site, filled: false, reason: `${got.reason} (login non aggiunto al pacchetto)` }); continue; }
    if (!okValue(got.value.user, 256) || !okValue(got.value.password, 1024)) { rows.push({ secret: label, source: site, filled: false, reason: 'valore salvato non valido' }); continue; }
    next.credentials = [...(next.credentials ?? []), { loginUrl: `${origin}/`, user: got.value.user, password: got.value.password }];
    changed = true;
    rows.push({ secret: label, source: site, filled: true, reason: 'aggiunto dalla password salvata per questo sito' });
  }

  // DevOps token: the slot when the package has one; added when the routine talks to DevOps and the connector has one
  const devops: SecretSourceName = 'Connettore Azure DevOps';
  const usesDevOps = !!next.routine.trigger || !!next.routine.devops;
  if (isSet(next.secrets?.devopsPat)) rows.push({ secret: 'DevOps PAT', source: 'Pacchetto', filled: true, reason: 'già nel pacchetto' });
  else if (next.secrets?.devopsPat !== undefined || usesDevOps) {
    // the connector wins; Cursor's MCP config only for the package's single organization
    const got = ask(sources.devopsPat);
    const orgs = [...new Set([next.routine.devops?.organization, next.routine.trigger?.organization].filter((o): o is string => !!o).map(o => o.toLowerCase()))];
    const cursor: Found<string> | null = 'value' in got && okValue(got.value, 1024) ? null
      : !sources.cursorDevopsPat ? { reason: '' }
      : orgs.length === 1 ? ask(() => sources.cursorDevopsPat!(orgs[0]!))
      : { reason: orgs.length ? 'il pacchetto usa più organizzazioni DevOps' : 'il pacchetto non indica l’organizzazione DevOps' };
    if (!cursor) {
      next.secrets = { ...next.secrets, devopsPat: (got as { value: string }).value }; changed = true;
      rows.push({ secret: 'DevOps PAT', source: devops, filled: true, reason: 'dal token del connettore' });
    } else if ('value' in cursor && okValue(cursor.value, 1024)) {
      next.secrets = { ...next.secrets, devopsPat: cursor.value }; changed = true;
      rows.push({ secret: 'DevOps PAT', source: 'Configurazione MCP di Cursor', filled: true, reason: `dal server MCP azure-devops di Cursor (${orgs[0]})` });
    } else {
      const first = 'reason' in got ? got.reason : 'valore salvato non valido';
      const second = 'reason' in cursor ? cursor.reason : 'valore salvato non valido';
      const reason = second ? `${first}; Cursor: ${second}` : first;
      rows.push({ secret: 'DevOps PAT', source: devops, filled: false, reason: next.secrets?.devopsPat === undefined ? `${reason} (senza PAT il runtime usa az login)` : reason });
    }
  }

  // test DB logins: only for a target the test DB guard allows (never a production-looking one)
  const tdb: SecretSourceName = 'Login DB di test dell’app';
  for (const db of next.routine.testDbs ?? []) {
    const label = `DB di test ${db.server}/${db.database}`;
    const cur = next.secrets?.testDbs?.[db.id];
    if (cur && isSet(cur.user) && isSet(cur.password)) { rows.push({ secret: label, source: 'Pacchetto', filled: true, reason: 'già nel pacchetto' }); continue; }
    const refused = checkTestDbTarget(db);
    if (refused) { rows.push({ secret: label, source: tdb, filled: false, reason: `non riempito: ${refused}` }); continue; }
    const got = ask(sources.testDbLogin && (() => sources.testDbLogin!(db)));
    if ('reason' in got) { rows.push({ secret: label, source: tdb, filled: false, reason: got.reason }); continue; }
    if (!okValue(got.value.user, 128) || !okValue(got.value.password, 1024)) { rows.push({ secret: label, source: tdb, filled: false, reason: 'valore salvato non valido' }); continue; }
    if (cur && isSet(cur.user) && cur.user !== got.value.user) { rows.push({ secret: label, source: tdb, filled: false, reason: 'il pacchetto indica un altro utente: inserisci tu la password' }); continue; }
    next.secrets = { ...next.secrets, testDbs: { ...(next.secrets?.testDbs ?? {}), [db.id]: { user: got.value.user, password: got.value.password } } };
    changed = true;
    rows.push({ secret: label, source: tdb, filled: true, reason: 'dal login di sola lettura per i DB di test' });
  }
  return { pkg: changed ? next : pkg, rows, changed };
}

/** An Azure DevOps connector: its name, command, arguments or address say so. */
const DEVOPS = /azure[-_ ]?devops|dev\.azure\.com|visualstudio\.com/i;
/** A token slot (env or header) by its name: a PAT or a token, not a header that wraps it in Basic. */
const TOKEN_SLOT = /(pat|token)/i;

/**
 * The DevOps token among the user's connectors: the single value of the token slots of the connectors that point at
 * Azure DevOps. None, or two different ones, is a reason (never a guess).
 */
export function devopsPatFromConnectors(servers: readonly McpServerDef[], secret: (id: string, slot: McpSecretSlot) => string | null): Found<string> {
  const devops = servers.filter(s => DEVOPS.test([s.id, s.label, s.command ?? '', ...(s.args ?? []), s.url ?? ''].join(' ')));
  if (!devops.length) return { reason: 'nessun connettore Azure DevOps in Impostazioni → Connettori' };
  const values = new Set<string>();
  for (const s of devops) for (const slot of s.secrets) {
    if (!TOKEN_SLOT.test(slot.name) || /basic/i.test(slot.prefix ?? '')) continue;
    const v = secret(s.id, slot);
    if (v) values.add(v);
  }
  if (!values.size) return { reason: 'il connettore Azure DevOps non ha un token salvato' };
  if (values.size > 1) return { reason: 'più token DevOps diversi nei connettori: inseriscilo tu' };
  return { value: [...values][0]! };
}

/** The env variable the Azure DevOps MCP server reads its PAT from (`-a envvar`). */
const CURSOR_PAT_ENV = 'ADO_MCP_AUTH_TOKEN';

/**
 * The DevOps PAT in Cursor's MCP config (`~/.cursor/mcp.json`, given as text; read only, the owner's request, ADR 0176):
 * the `ADO_MCP_AUTH_TOKEN` of the Azure DevOps servers whose arguments name exactly this organization. No file, no
 * such server, another organization or two different tokens are reasons, never a guess; a reason never quotes the file.
 */
export function devopsPatFromCursorConfig(text: string | null, organization: string): Found<string> {
  if (text === null) return { reason: 'configurazione MCP di Cursor non trovata' };
  let servers: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as { mcpServers?: unknown };
    servers = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers as Record<string, unknown> : {};
  } catch { return { reason: 'configurazione MCP di Cursor non leggibile' }; }
  const org = organization.toLowerCase();
  const values = new Set<string>();
  let devopsWithToken = 0;
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== 'object') continue;
    const def = raw as { args?: unknown; env?: unknown };
    const args = Array.isArray(def.args) ? def.args.filter((a): a is string => typeof a === 'string') : [];
    if (!DEVOPS.test([name, ...args].join(' '))) continue;
    const token = def.env && typeof def.env === 'object' ? (def.env as Record<string, unknown>)[CURSOR_PAT_ENV] : undefined;
    if (typeof token !== 'string' || !token.trim()) continue;
    devopsWithToken++;
    if (args.some(a => a.toLowerCase() === org)) values.add(token.trim());
  }
  if (!devopsWithToken) return { reason: `nessun server Azure DevOps con ${CURSOR_PAT_ENV} nella configurazione MCP di Cursor` };
  if (!values.size) return { reason: `il server Azure DevOps di Cursor è per un’altra organizzazione (non ${organization})` };
  if (values.size > 1) return { reason: 'più token DevOps diversi nella configurazione MCP di Cursor' };
  return { value: [...values][0]! };
}
