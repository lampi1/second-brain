// Issue #472: command-line examples at the common delegated gate, without running commands or contacting any service.
import { describe, expect, it } from 'vitest';
import { heldForUser, type HoldKind } from '../../../src/main/chats/delegated-holds';

const files: Record<string, string> = {
  'build.sh': 'npm run build\n', 'list.sh': 'az webapp list\n', 'read.sql': 'SELECT id FROM dbo.Items;',
  'custom.sh': 'az extension frobnicate -n demo\n', 'query.sh': 'sqlcmd -S db.test -Q "$1"\n',
  'mixed.sql': 'SELECT id FROM dbo.Items; VACUUM;', 'release.sh': 'gh release frobnicate v1\n',
  'db.mjs': 'import sql from "mssql"; sql.query(process.argv[2]);',
  'read.mjs': 'import sql from "mssql"; sql.query("SELECT 1");',
  'unknown.ps1': 'param($Action)\naz group frobnicate --name demo',
  'storage.mjs': 'import { BlobServiceClient } from "@azure/storage-blob"; containerClient.listBlobsFlat();',
};
const ctx = { cwd: '/repo', readFile: (abs: string) => files[abs.split(/[\\/]/).pop()!] ?? null };

const ordinary = [
  'npm test', 'npm run build', 'npm ci', 'git status --short', 'git push origin feature/work',
  'pnpm lint', 'npx vitest run test/example.test.ts', 'dotnet build', 'cargo test', 'bash build.sh',
  'node scripts/compile.mjs', './tool.exe --output report.json', 'rg "az group delete" docs',
  'curl -X POST http://localhost:3000/api/check', 'sqlcmd -S localhost -Q "CREATE TABLE T(i int)"',
  'az pipelines run --name ci', 'echo "gh release show"',
];
const reads = [
  'az account list', 'az account show', 'az group list', 'az group show -n demo', 'az vm list -d',
  'az vm show -g demo -n vm', 'az webapp list -o table', 'az webapp show -g demo -n app', 'az group list-frobnicate', 'az webapp show-anything',
  'az webapp log tail -g demo -n app', 'az containerapp logs show -g demo -n app',
  'az monitor activity-log list', 'az monitor log-analytics workspace list',
  'az monitor log-analytics query -w workspace --analytics-query "Heartbeat | take 5"',
  'az graph query -q "Resources | take 5"', 'az storage account list', 'az extension list',
  'az cloud show -n AzureCloud', 'az aks list', 'az network vnet show -g demo -n vnet',
  'Get-AzWebApp -Name demo', 'Get-AzResourceGroup', 'az rest --method get --url https://management.azure.com/subscriptions',
  'curl -I https://management.azure.com/subscriptions', 'curl https://management.azure.com/subscriptions',
  'sqlcmd -S db.test -Q "SELECT TOP 5 id FROM dbo.Items"', 'sqlcmd -S db.test -i read.sql',
  'psql -h db.test -c "SELECT 1; SELECT 2"', 'psql -h db.test -c "WITH c AS (SELECT 1 AS x) SELECT x FROM c"',
  'mysql -h db.test -e "SHOW TABLES"', 'redis-cli -h cache.test GET demo', 'mongosh --eval "db.items.find({})"',
  'bash query.sh "SELECT 1"', 'bash list.sh', 'node read.mjs',
  'gh release list', 'gh release view v1', 'gh release download v1', 'az pipelines release list',
  'node storage.mjs', 'dotnet ef migrations list', 'flyway info', 'liquibase status', 'redis-cli -h cache.test SLOWLOG GET 5',
];
const held: [HoldKind, string][] = [
  ['cloud-write', 'az webapp restart -g demo -n app'], ['cloud-write', 'az group frobnicate -n demo'],
  ['cloud-write', 'az group read-frobnicate'], ['cloud-write', 'az webapp read-zap'],
  ['cloud-write', 'az vm read-nope'], ['cloud-write', 'az storage read-bogus'],
  ['cloud-write', 'az network read-invented'], ['cloud-write', 'az monitor read-phantom'],
  ['cloud-write', 'az extension frobnicate -n demo'], ['cloud-write', 'az cloud frobnicate -n demo'],
  ['cloud-write', 'az bicep frobnicate'], ['cloud-write', 'az extension add -n demo'],
  ['cloud-write', 'az rest --method OPTIONS --url https://management.azure.com/subscriptions'],
  ['cloud-write', 'curl -X OPTIONS https://management.azure.com/subscriptions'],
  ['cloud-write', 'curl --request=OPTIONS https://management.azure.com/subscriptions'],
  ['cloud-write', 'curl -X POST https://management.azure.com/custom/query'],
  ['cloud-write', 'Invoke-AzRestMethod -Method OPTIONS -Path /subscriptions'],
  ['cloud-write', 'Frobnicate-AzWebApp -Name demo'], ['cloud-write', 'azcopy frobnicate'],
  ['cloud-write', 'sh -c "az extension frobnicate -n demo"'], ['cloud-write', 'bash custom.sh'],
  ['cloud-write', 'pwsh unknown.ps1 status'], ['cloud-write', 'az'],
  ['cloud-write', 'az rest -m OPTIONS -u https://management.azure.com/subscriptions'],
  ['cloud-write', 'az webapp $ACTION list'], ['cloud-write', 'func azure functionapp frobnicate app'],
  ['cloud-write', 'node -e "const az = require(\'@azure/storage-blob\'); containerClient.frobnicate();"'],
  ['db-write', 'sqlcmd -S db.test -Q "UPDATE dbo.Items SET x=1"'],
  ['db-write', 'psql -h db.test -c "VACUUM"'], ['db-write', 'psql -h db.test -c "SELECT 1; VACUUM"'],
  ['db-write', 'psql -h db.test -c "ANALYZE items" -c "SELECT 1"'],
  ['db-write', 'sqlcmd -S db.test -Q "SELECT 1" -i missing.sql'], ['db-write', 'sqlcmd -S db.test -i mixed.sql'],
  ['db-write', 'echo "SELECT 1; VACUUM" | psql -h db.test'], ['db-write', 'bash query.sh "SELECT 1; VACUUM"'],
  ['db-write', 'node db.mjs'], ['db-write', 'redis-cli -h cache.test FROBNICATE'],
  ['db-write', 'redis-cli -h cache.test SLOWLOG RESET'], ['db-write', 'redis-cli -h cache.test MEMORY PURGE'],
  ['db-write', 'dotnet ef migrations frobnicate'], ['db-write', 'flyway frobnicate'],
  ['db-write', 'node -e "const sql = require(\'mssql\'); sql.frobnicate();"'],
  ['prod-release', 'gh release create v1'], ['prod-release', 'gh release frobnicate v1'],
  ['prod-release', 'az pipelines release frobnicate'], ['prod-release', './deploy.sh --env production --name list'],
  ['prod-release', 'bash release.sh'], ['prod-release', 'sh -c "gh release frobnicate v1"'],
  ['prod-release', 'timeout 5 gh release frobnicate v1'],
];

const verdict = (command: string) => heldForUser({ type: 'permission', tool: 'Bash', input: { command } }, ctx)?.kind ?? null;
describe('ordinary and opaque work', () => { it.each(ordinary)('%s is free', command => expect(verdict(command)).toBeNull()); });
describe('recognised reads', () => { it.each(reads)('%s is free', command => expect(verdict(command)).toBeNull()); });
describe('a visible family without a recognised read', () => { it.each(held)('%s: %s', (kind, command) => expect(verdict(command)).toBe(kind)); });
