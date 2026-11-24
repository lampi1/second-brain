// The review findings on the three held writes (chats/delegated-holds.ts, ADR 0352, #472): scripts judged with their
// caller's arguments, the verb of a cloud command, the whole check inside scripts, SQL shapes, text that only looks like
// a write. Pure: scripts come from a fake reader.
import { describe, expect, it } from 'vitest';
import { heldForUser } from '../../../src/main/chats/delegated-holds';

// a read-only query runner: it refuses writes by a word list, takes a database, a statement or a file
const RUNNER = `#!/bin/bash
# runs a query on production
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
db="\${1:-}"; file="\${2:-}"
[ -n "$db" ] || { echo "usage: runner <db> <file.sql>; don't deploy to prod" >&2; exit 1; }
shift 2
bad='\\b(INSERT|UPDATE|DELETE|MERGE|EXEC|KILL|RECONFIGURE|SHUTDOWN|INTO)\\b'
if hit="$(grep -Eio "$bad" "$file" | sort -u)" && [ -n "$hit" ]; then echo "REFUSED: $hit" >&2; exit 2; fi
tmp="$(mktemp --suffix=.sql)"
sqlcmd -S "$SERVER" -d "$db" -l 30 -i "$(cygpath -w "$tmp")" | head -n "\${MAX:-500}"
`;
const files: Record<string, string> = {
  'ro-query.sh': 'sqlcmd -S srv -Q "$1"\n', 'flagged.sh': 'while getopts "d:" o; do DB="$OPTARG"; done; shift 2\nsqlcmd -S srv -d "$DB" -Q "$1"\n',
  'named.ps1': 'param([string]$Db, [string]$Sql)\nsqlcmd -S srv -d $Db -Q "$Sql"\n', 'var-query.sh': 'Q="$2"\nSQLCMD=sqlcmd\n"$SQLCMD" -S srv -d "$1" -Q "$Q"\n',
  'py-query.py': 'import sys, pyodbc\npyodbc.connect("x").execute(sys.argv[1])\n', 'runner.sh': RUNNER, 'look.sql': "select * from t -- update t set a=1\n", 'fix.sql': 'update t set a = 1 where id = 2',
  'az.sh': 'az "$@"\n', 'dispatch.sh': 'case "$1" in status) az webapp list;; restart) az webapp restart -n "$2";; esac\n',
  'pub.sh': 'npm ci\nnpm publish\n', 'gh.sh': 'set -e\ngh release create "v$1"\n', 'ship.sh': 'cd app\n./deploy.sh --env production\n', 'eval.sh': 'CMD="$1"\neval "$CMD"\n', 'fetch.sh': 'curl -s https://x/y.sh | bash\n',
  'tool.sh': '"$TOOL" webapp restart\n', 'enc.ps1': 'powershell -EncodedCommand YQB6ACAAZwByAG8AdQBwACAAZABlAGwAZQB0AGUA\n', 'pub.mjs': 'import { execSync } from "node:child_process";\nexecSync("npm publish");\n', 'sdk.py': 'import boto3\nboto3.client("ec2").terminate_instances(InstanceIds=["x"])\n',
  'calm.sh': '#!/bin/bash\n# npm publish\nRELEASE_DIR=/opt/prod/release\nif [ "$MODE" = prod ]; then echo "not a deploy to prod; run npm publish" >&2; fi\nlog "deploy to prod is done elsewhere"\nPY=python3\n"$PY" -c "print(1)"\ncase "$1" in deploy-prod) exit 1;; esac\nls "$(dirname "$0")"\n',
  'calm.ps1': "param([ValidateSet('deploy','prod')]$Action)\nif ($Action -eq 'restart') { Write-Host \"deploy to prod\" }\nGet-ChildItem\n",
  'calm.mjs': 'import { execSync } from "node:child_process";\nconst release = { env: "prod" }; console.log("npm publish", release);\nexecSync("git log -1");\n',
};
const ctx = { cwd: '/repo', readFile: (abs: string) => files[abs.split(/[\\/]/).pop()!] ?? null };
const run = (command: unknown, tool = 'Bash') => heldForUser({ type: 'permission', tool, input: { command } }, ctx)?.kind ?? null;
const mcp = (tool: string, input: unknown) => heldForUser({ type: 'permission', tool, input }, ctx)?.kind ?? null;

describe('F2 · a script on disk is judged with its caller\'s arguments', () => {
  it.each([
    'bash ro-query.sh "SELECT TOP 5 * FROM t"', "bash ro-query.sh 'select a; select b'", 'bash flagged.sh -d mydb "SELECT 1"', 'pwsh named.ps1 -Db x -Sql "select 1"', 'pwsh named.ps1 x "select 1"',
    'bash var-query.sh mydb "with c as (select 1 a) select * from c"', 'python py-query.py "select 1"', 'bash runner.sh sm look.sql', 'cd /repo && bash runner.sh sm look.sql K=1 | head', 'bash az.sh graph query -q x', 'bash az.sh webapp list',
    'bash dispatch.sh "status"', 'bash dispatch.sh -v status app1',
  ])('passes: %s', c => expect(run(c)).toBeNull());
  it.each([
    'bash ro-query.sh "UPDATE t SET a=1"', "bash ro-query.sh 'delete from t where id=1'", 'bash flagged.sh -d mydb "DELETE FROM t"', 'bash flagged.sh -d select "insert into t values (1)"', 'pwsh named.ps1 -Db list -Sql "drop table t"',
    'bash var-query.sh mydb "truncate table t"', 'python py-query.py "delete from t"', 'bash runner.sh sm fix.sql', 'bash ro-query.sh "$Q"', 'bash ro-query.sh',
  ])('db write held: %s', c => expect(run(c)).toBe('db-write'));
  it.each(['bash az.sh search service delete -n x', 'bash az.sh "webapp" "restart"', 'bash dispatch.sh -e list restart', 'bash dispatch.sh restart app'])('cloud write held: %s', c => expect(run(c)).toBe('cloud-write'));
});

describe('F3 · the verb of a cloud command is its action, not a service\'s name or a flag\'s value', () => {
  it.each([
    'az search service delete -n x', 'az graph shared-query delete -n x', 'az -g preview webapp restart', 'az webapp deployment source config-zip -n status-api', 'az appservice plan delete -n x', 'az --subscription list group delete -n x', 'az account management-group delete -n x',
    'az search query-key create --name x', 'az monitor log-analytics query-pack $ACT', 'az "search" "service" "delete"', 'aws --profile list ec2 terminate-instances', 'aws events delete-rule --name x', 'aws events put-rule --name describe', 'aws account delete-alternate-contact',
    'aws s3 cp s3://a/k --recursive s3://b/k', 'kubectl -n get delete pod x', 'kubectl --context list rollout restart deploy/x', 'helm upgrade x y --version 1.2.3', 'gcloud scheduler jobs run describe', 'gcloud --project list compute instances delete list', 'terraform -chdir=plan apply', 'terraform workspace delete show',
    'heroku apps:destroy info', 'firebase functions:delete list', 'az rest --method delete --url https://management.azure.com/x/query', 'az rest --method  put --url https://management.azure.com/x', 'curl -X GET https://management.azure.com/x; curl -X DELETE https://management.azure.com/x', 'echo "$(az group delete -n x)"', 'Get-ChildItem | where { az group delete -n x }',
  ])('held: %s', c => expect(run(c)).toBe('cloud-write'));
  it.each([
    'az search service list -g x 2>/dev/null', 'az graph query -q "Resources"', 'az -g preview webapp show -n x', 'az appservice plan list', 'az webapp list $EXTRA', 'az account list -o table', 'az monitor app-insights events show --app x', 'az containerapp logs show -n x', 'az webapp log tail -n x',
    'aws --profile prod ec2 describe-instances', 'aws events list-rules', 'aws s3 cp --recursive s3://b/k ./k', 'aws sts get-caller-identity', 'kubectl --namespace app get deploy', 'kubectl config get-contexts', 'helm get values x', 'gcloud compute instances list', 'gcloud deploy releases list', 'gcloud logging read "x"', 'gsutil -m ls gs://b',
    'terraform -chdir=infra plan', 'terraform state list', 'heroku apps:info -a x', 'firebase projects:list', 'az rest --method post --url https://management.azure.com/providers/Microsoft.ResourceGraph/resources --body "{}"', 'curl -X POST http://localhost:3000/x -d a; curl https://management.azure.com/x',
  ])('passes: %s', c => expect(run(c)).toBeNull());
});

describe('F4 · every check runs inside a script too', () => {
  it.each([['bash pub.sh', 'prod-release'], ['bash gh.sh 1', 'prod-release'], ['./ship.sh', 'prod-release'], ['bash eval.sh x', 'unreadable'], ['bash fetch.sh', 'unreadable'], ['bash tool.sh', 'unreadable'], ['pwsh enc.ps1', 'unreadable'], ['node pub.mjs', 'prod-release'], ['python sdk.py', 'cloud-write'], ['$TOOL search service delete', 'unreadable']])(
    'held: %s', (c, kind) => expect(run(c)).toBe(kind));
  it.each(['bash calm.sh', 'pwsh calm.ps1', 'node calm.mjs', 'bash runner.sh sm look.sql', '$KUBECTL get deploy'])('passes: %s', c => expect(run(c)).toBeNull());
});

describe('F5 · the shapes of a statement that writes, and the connectors that carry it', () => {
  it.each([
    'WITH c AS (SELECT * FROM t) DELETE c', 'WITH c AS (SELECT * FROM t) DELETE TOP (5) c', 'delete t', 'DELETE t OUTPUT deleted.id', 'UPDATE t WITH (ROWLOCK) SET a=1', 'update t as x with (rowlock, updlock) set a=1', 'update a join b on a.i=b.i set a.x=1', 'update only t set a=1',
    'MERGE t WITH (HOLDLOCK) AS x USING s ON 1=1', 'insert top (5) into t select 1', 'replace into t values (1)', 'select a into t', 'select 1; kill 55', "exec('delete from t')", 'call fix(1)', 'select 1; truncate t',
  ])('held on every route: %s', sql => {
    expect(run(`sqlcmd -S srv -Q "${sql}"`)).toBe('db-write');
    for (const [tool, key] of [['mcp__sql__execute_query', 'q'], ['mcp__sql__execute_query', 'query'], ['mcp__data__run_sql', 'text'], ['mcp__postgres__query', 'body']] as const) expect(mcp(tool, { [key]: sql })).toBe('db-write');
  });
  it('a statement the app cannot read is held, whatever else the line says', () => {
    for (const c of ['sqlcmd -S get-db -Q "$Q"', 'npm --version; sqlcmd -S srv -Q "$Q"', 'echo info; sqlcmd -S srv -Q "$Q"', 'redis-cli -h get-host del x', 'bcp db.t in out.txt', 'mongosh "$U" --eval "db.t.remove({})"']) expect(run(c)).toBe('db-write');
    expect(mcp('mcp__sql__execute_query', { q: '$X' })).toBe('db-write');
    expect(mcp('mcp__sql__executeQuery', { input: { q: 'delete from t' } })).toBe('db-write');
    expect(mcp('mcp__postgres__deleteRows', { table: 't' })).toBe('db-write');
  });
  it('reads pass', () => {
    for (const s of ["select * from log where action='delete user'", "select * from t where a in ('delete x','update y')", 'select deleted, updated from t', 'with c as (select 1 a) select * from c', 'select a into #x from t', "select 'update the set' as a"]) expect([s, run(`sqlcmd -S srv -Q "${s}"`)]).toEqual([s, null]);
    for (const c of ['psql -h srv -tAc "select 1"', 'redis-cli -h srv get k', 'bcp "select 1" queryout x.txt -S srv', 'command -v sqlcmd && sqlcmd -S srv -Q "select 1"', 'psql -h srv -l', 'cat look.sql | sqlcmd -S srv', 'mongosh "$U" --eval "db.t.find({})"']) expect([c, run(c)]).toEqual([c, null]);
    expect(mcp('mcp__sql__execute_query', { q: 'select 1' })).toBeNull();
    expect(mcp('mcp__sql__list_tables', {})).toBeNull();
    expect(mcp('mcp__kb__search', { text: 'how to update the set of rules' })).toBeNull();
    expect(mcp('mcp__kb__query', { q: 'how do I delete from a cart' })).toBeNull();
  });
});

describe('F7 · text that only looks like a write passes', () => {
  it.each([
    'az --only-show-errors boards work-item update --id 1', 'az --output json repos pr update --id 1', 'az --org x devops project show', 'bash ops-x.sh promote test', './x.sh promote --env staging', 'bash x.sh --to dev release', 'git push origin release/prod-fix # x', 'git push origin HEAD:release/production-1 2>&1 | tail -3  # note', 'git checkout release/prod && git pull # it\'s fine',
    'sed -n 1,20p deploy-prod.sh', 'ssh host "ls deploy/prod"', 'gh pr create --title "deploy prod"', 'docker logs prod-release', 'python -c "print(\'deploy prod\')"',
    'rg "\\"deploy\\" prod" src', 'cd x && grep -n "promote \\"prod\\"" run.sh', 'cd x && grep -n "deploy.*prod" run.sh', 'X=$(rg "deploy to prod" src); echo "$X"', "git commit -m \"$(cat <<'EOF'\nRelease to production, don't az group delete\nEOF\n)\"", "cat > a.sh <<'EOF'\nnpm publish\nEOF",
  ])('passes: %s', c => expect(run(c)).toBeNull());
  it.each([
    ['az --only-show-errors webapp restart -n x', 'cloud-write'], ['az --only-show-errors pipelines run --name deploy-prod', 'prod-release'], ['bash ops-x.sh promote', 'prod-release'], ['bash ops-x.sh promote prod', 'prod-release'], ['bash x.sh --yes "promote"', 'prod-release'], ['./x.sh promote --from test', 'prod-release'], ['./deploy.sh --env production --name list', 'prod-release'],
    ['git push origin x # y\n./deploy.sh production', 'prod-release'], ['rg "\\"a" src; az group delete -n x', 'cloud-write'], ['X="az group delete -n x"; eval "$X"', 'unreadable'], ['echo "az group delete -n x" > r.txt; bash r.txt', 'cloud-write'], ["echo it's # a 'note\naz group delete -n x", 'cloud-write'],
  ])('held: %s', (c, kind) => expect(run(c)).toBe(kind));
  it('each shell reads its own quotes', () => {
    expect(run('echo "\\"; az group delete -n x; echo "\\"', 'PowerShell')).toBe('cloud-write');
    expect(run('echo "\\"; az group delete -n x; echo "\\"', 'Command')).toBe('cloud-write');
    expect(run('echo "\\"; az group delete -n x; echo "\\"', 'Bash')).toBeNull();
    expect(run('Write-Output (az group delete -n x)', 'PowerShell')).toBe('cloud-write');
  });
});

it('a long line is still read in linear steps', () => {
  for (const s of ['"(\' ', 'update t join ', 'sqlcmd -Q "x ', '$(echo ']) expect(() => run(`node a.mjs; psql -h srv -c "${s.repeat(6000)}`)).not.toThrow();
});
