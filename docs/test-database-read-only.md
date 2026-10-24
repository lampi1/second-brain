<!-- Host configuration and DBA review guide for maintainers/users enabling explicit test SQL reads; never an app-executed setup. -->
# Read-only test database targets

Production database access is forbidden, including SELECT. A test and production database may share one SQL Server, so authorization uses each exact database name, not the hostname or a “test” substring. No targets are enabled by default.

The user creates `test-db-targets.json` in the app's userData directory, outside the brain and repository. The host rereads it for every query. There is no agent/renderer API for changing it. Restrict file access to the intended OS account. Begin with:

```json
{ "schema": 1, "targets": [], "deniedDatabases": [], "mandatoryDenyDatabases": [] }
```

After the user/DBA verifies a specific test database and provisions its dedicated reader, one synthetic example is:

```json
{
  "schema": 1,
  "targets": [
    {
      "id": "sample-test",
      "server": "sql.example.invalid",
      "port": 1433,
      "database": "ExplicitSandbox"
    }
  ]
}
```

Replace every example value locally with independently verified values. The database comparison is exact, including case, even when the SQL Server collation is case-insensitive. The configured database must match `DB_NAME()` exactly. Names must match `^[A-Za-z0-9_]+$`, so hyphenated names (including `-prod`) cannot be configured. `master`, `model`, `msdb`, `tempdb` and `resource` are always blocked. Populate `mandatoryDenyDatabases` with the private production/system names that must never be queried; these entries cannot be overridden. `deniedDatabases` holds any broader/historical deny list. An overlap with that second list is rejected unless the user independently verifies it is a test database and sets `confirmedTestDatabase: true` on that exact target. No production database may be reclassified merely because its name contains a test-looking substring.

A target ID's meaning is part of its flow approval: when changing server/database/login, revoke existing grants first and use a new ID. Do not repoint an approved ID to another database.

Set only `SQLCMD_TEST_RO_USER` and `SQLCMD_TEST_RO_PASSWORD` in the host process's launch environment. The host captures and removes both before launching agent processes. There is no integrated/AAD authentication or other credential fallback. Store no password in JSON, source control, brain files, prompts, CLI arguments or logs. Neither these environment values nor copies of them may be forwarded to agent subprocesses. Do not repurpose an existing broad service login. The host requires a valid SQL Server TLS certificate trusted by the OS/Node trust store; there is no `trustServerCertificate` escape hatch.

An approved flow requests `{ "targetId": "sample-test", "query": "SELECT TOP (10) id FROM dbo.ReviewedTable", "maxRows": 10 }`. A flow must separately grant this exact target ID to its bound running step. Revocation is checked again immediately before user SQL dispatch and after reading results. Changing a JSON file is not a substitute for revoking a grant or cancelling a running query.

Queries support one SELECT with ordinary joins/filtering/grouping/order and a fixed set of scalar/aggregate functions. CTEs, subqueries, comments, hints, explicit system-schema references, temporary tables, user-defined functions and cross-database references are rejected. Result limits: 500 requested rows maximum (100 default), 128 columns, about 1 MiB total row payload and 4096 characters per cell. `truncated` covers discarded rows/cells/output. Large XML and CLR UDT result columns are rejected. Long text types also have a server-side text size limit. Binary values are base64 strings; large integers are strings. No live database integration test is implied by mocked verification.

## User/DBA provisioning review

For Azure SQL Database, adapt the checks to its supported catalog scope and connect separately to each exact database; SQL Server `USE`, `sys.configurations` and login catalog checks are not portable to Azure SQL Database.

The [reviewable SQL template](examples/test-db-reader.sql) is **not executed by the application**. Prepare a separate reviewed copy per exact approved test database. Create the dedicated SQL login yourself through a secure administration tool; never paste its password into the template. Set its default database to the approved test database, give it no privileged server role/permission, and do not map it to any production database. The generic SQL Server template creates only its database user and grants SELECT on one explicitly chosen local table.

Before enabling a target, the DBA must verify effective permissions using that login:

- Only the listed test database and required SQL Server system connectivity are reachable. No other application database grants access through a user mapping, guest, public, certificate, impersonation, ownership or server-level permission such as CONNECT ANY DATABASE/SELECT ALL USER SECURABLES.
- The login is not sysadmin/db_owner, owns no database/schema, has no server/linked-server mapping, and cannot impersonate another principal. Audit public/inherited roles; a narrow direct grant cannot neutralize a privileged login.
- Cross-database ownership chaining and TRUSTWORTHY are disabled for the approved test database; server-wide cross-database chaining must also be off. Do not change production databases through this application or this template.
- Prefer individual reviewed local base tables. If the user explicitly authorizes `db_datareader`, audit every readable object and dependency in each approved database first; that role is broader than the generic template. Review computed columns, CLR types, external tables, synonyms, views and dependencies before granting anything additional; deny executable modules. An apparently local SELECT can hide a remote or production dependency otherwise.
- Read of one approved table succeeds; writes, EXEC, production access and unrelated test databases fail under the dedicated login. The DBA performs these checks outside this app, with production access checks limited to their own approved administration process.

The driver uses a 30-second connection timeout, 60-second wall-clock query deadline and 95-second total deadline, including setup (plus up to two seconds for rollback). Reads use READ UNCOMMITTED and XACT_ABORT ON; results may therefore include uncommitted or inconsistent data.

`ApplicationIntent=ReadOnly` and rollback are defense in depth; neither replaces SQL permissions. On timeout/cancellation the transport closes its dedicated session, so SQL Server rolls back any open transaction. If the network is unavailable, server cleanup follows its disconnect detection. The app never commits, pools the connection or reports partial results after an error.

A shell-capable agent running under the same OS user is not isolated from that user's files/process state. The config's “host-only” status means the application does not expose it through a tool or renderer; it is not an OS security boundary. Use restricted database principals as the independent control, and stronger OS isolation if the threat model includes a hostile same-user process.

References: [Microsoft database users and guest access](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/create-a-database-user), [Tedious connection options](https://tediousjs.github.io/tedious/api-connection.html), [ADR 0146](adr/0146-test-database-read-adapter.md).
