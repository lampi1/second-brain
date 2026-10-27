// Which SQL Server targets a routine package may read (ADR 0175 item 10): test databases only, never production. Checked
// when a package is loaded (format.ts: only what is never allowed), by preflight and again before every step that uses
// one (runtime.ts), with the host's list of recognised test targets when it has one (the app's test DB configuration). Pure: no network, no secrets.

export interface TestDbTargetFacts { id: string; server: string; port?: number; database: string; confirmedTestDatabase?: true }
/** A host-recognised test target (the app's readTestDbTargets entries). */
export interface RecognisedTestDb { server: string; port: number; database: string }

const SYSTEM = ['master', 'model', 'msdb', 'tempdb', 'resource'];
/** Production-looking names: always refused, whatever else the package says. */
const PROD = /(^|[^a-z])(prod|prd|production|live)([^a-z]|$)/i;
/** Without a host list, the server or the database name must say it is a test system. */
const TEST = /(^|[^a-z])(test|tst|dev|qa|uat|stag|staging|demo|sandbox|local|localhost)([^a-z]|\d|$)/i;

/** What no host may ever read (invalid names, system or production-looking databases); null otherwise. The package
 *  format applies only this: whether a name is a test system needs the host's list, so preflight and the step check
 *  apply checkTestDbTarget (a host-recognised target may have any non-production name). */
export function refuseNeverAllowed(target: TestDbTargetFacts): string | null {
  const server = target.server.trim(), database = target.database.trim(), port = target.port ?? 1433;
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(server)) return 'invalid server name';
  if (!/^[A-Za-z0-9_]{1,128}$/.test(database)) return 'invalid database name';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'invalid port';
  if (SYSTEM.includes(database.toLowerCase())) return 'system databases are never read';
  if (PROD.test(server) || PROD.test(database)) return 'looks like a production database: never allowed';
  return null;
}

/** Null when the target may be read; otherwise why it is refused (plain words, no secret). */
export function checkTestDbTarget(target: TestDbTargetFacts, recognised?: readonly RecognisedTestDb[]): string | null {
  const never = refuseNeverAllowed(target);
  if (never) return never;
  const server = target.server.trim(), database = target.database.trim(), port = target.port ?? 1433;
  if (recognised) {
    const known = recognised.some(r => r.server.toLowerCase() === server.toLowerCase() && r.database.toLowerCase() === database.toLowerCase() && r.port === port);
    return known ? null : 'not one of the host\'s recognised test databases';
  }
  if (TEST.test(server) || TEST.test(database)) return null;
  return 'not recognisable as a test database (name it as test/dev/qa or use a host-recognised target)';
}
