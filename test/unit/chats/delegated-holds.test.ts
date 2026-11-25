// What a delegated chat never does without the user (chats/delegated-holds.ts, ADR 0355, #472): a database write, a
// production release, a cloud write; every read passes. Pure: scripts come from a fake reader.
import { describe, expect, it } from 'vitest';
import { heldForUser } from '../../../src/main/chats/delegated-holds';

const files: Record<string, string> = {
  'reset.sh': '#!/bin/bash\n# restarts\naz webapp restart -n x\n', 'report.sh': 'az webapp list -o table\n', 'ops.ps1': 'param($what)\naz webapp restart -n $what',
  'ops-status.ps1': 'param($what)\naz webapp show -n $what',
  'fix.sql': 'update t set a = 1 where id = 2', 'look.sql': 'select * from t', 'tool.mjs': 'import { readFileSync } from "node:fs";\n// az webapp restart\nconsole.log(readFileSync("x"))',
};
const ctx = { cwd: '/repo', readFile: (abs: string) => files[abs.split(/[\\/]/).pop()!] ?? null };
const run = (command: unknown, tool = 'Bash') => heldForUser({ type: 'permission', tool, input: { command } }, ctx)?.kind ?? null;
const mcp = (tool: string, input: unknown, title?: string) => heldForUser({ type: 'permission', tool, input, ...(title ? { title } : {}) }, ctx)?.kind ?? null;

describe('heldForUser', () => {
  it.each([
    'az webapp list -o table', 'az monitor log-analytics query -w w --analytics-query "traces | take 5"', 'az account set -s dev', 'az rest --method get --url https://management.azure.com/x',
    'az webapp deployment list-publishing-profiles -n app-prod -g prod', 'az vm list --query "[?name==\'start\']"', 'az pipelines run --name ci', 'az repos pr create --title x',
    'for s in a b; do az webapp show -n "$s" --query state -o tsv; done', 'for f in *.md; do wc -l "$f"; done', 'R=$(az group list -o tsv); echo "$R"',
    'node -e "console.log(require(\'fs\').readFileSync(\'a.json\',\'utf8\'))"', "python - <<'EOF'\nprint(open('a.txt').read())\nEOF",
    'cd src && ls', 'cd /repo && git log --oneline | head -5', 'git -C ../other log --oneline -3', 'git -C ../other show HEAD:a.sql', 'grep -rn "az webapp restart" docs | sort -u && ls',
    'cd x && rg "deploy to production" .', 'git commit -m "docs: how to release to production"', "cat > notes.md <<'EOF'\nDeploy to production with az webapp restart\nEOF",
    'aws ec2 describe-instances', 'aws s3 ls', 'aws s3 cp s3://b/k ./k', 'kubectl -n app get deploy', 'kubectl logs pod', 'kubectl rollout status deploy/x', 'terraform plan', 'helm list',
    'sqlcmd -S srv -d db -Q "select top 5 * from t"', 'sqlcmd -S srv -i look.sql', 'sqlcmd -S localhost -Q "update t set a=1"', 'psql -h localhost -c "drop table t"', 'psql -h srv -c "select 1 as updated"',
    'npx vitest run test/deploy-prod.test.ts', 'npm run build', 'bash report.sh', 'node tool.mjs', 'pwsh ops-status.ps1 status', 'curl -s https://example.com/release/prod',
    'rm -rf dist && npm ci', 'Get-AzWebApp -Name x', 'Get-ChildItem | Where-Object { $_.Name -match "x" }',
  ])('passes: %s', command => expect(run(command)).toBeNull());

  it.each([
    'sqlcmd -S srv -Q "UPDATE t SET a=1 WHERE id=2"', 'Q="delete from t"; sqlcmd -S srv -Q "$Q"', 'sqlcmd -S srv -Q "$Q"', 'sqlcmd -S srv -i fix.sql', 'sqlcmd -S srv -i gone.sql', 'echo "delete from t" | psql -h srv',
    'cd x && psql "$URL" -c "truncate table t"', 'sqlcmd -S srv -Q "exec dbo.Fix"', 'mongosh "$URL" --eval "db.t.deleteMany({})"', 'dotnet ef database update', 'bash ro-query.sh "insert into t values (1)"',
    'python -c "import pyodbc; pyodbc.connect(s).execute(\'delete from t where id=1\')"', "node - <<'EOF'\nconst sql=require('mssql'); sql.query(`insert into t(a) values(1)`)\nEOF",
    'sqlcmd -S localhost -Q "select 1"; sqlcmd -S srv -Q "drop table t"',
  ])('db write held: %s', command => expect(run(command)).toBe('db-write'));

  it.each([
    'az webapp restart -n x -g y', 'cd a && az group delete -n list', 'for s in a b; do az webapp stop -n $s; done', 'az webapp $ACTION -n x', '"C:/Program Files/Azure/wbin/az.cmd" webapp restart -n x', 'bash -c "az vm start -n x"',
    'az rest --method put --url https://management.azure.com/x --body "{}"', 'az webapp log config --web-server-logging off', 'aws s3 rm s3://b/k', 'aws logs put-retention-policy --x 1', 'kubectl apply -f x.yml', 'kubectl rollout restart deploy/x',
    'helm upgrade x y', 'terraform apply -auto-approve', 'Restart-AzWebApp -Name x', 'curl -X POST https://management.azure.com/subscriptions/x/restart', 'python -c "import subprocess; subprocess.run([\'az\',\'webapp\',\'restart\'])"',
    'bash reset.sh', './reset.sh', 'pwsh ops.ps1 app1', 'pwsh ops.ps1 status', 'echo "az group delete -n x" | bash', "cat > a.sh <<'EOF'\naz group delete -n x\nEOF\nbash a.sh", 'echo don\'t # it\'s\naz group delete -n x # it\'s',
  ])('cloud write held: %s', command => expect(run(command)).toBe('cloud-write'));

  it.each(['./deploy.sh --env production', 'npm run release:prod', 'gh workflow run release.yml', 'gh release create v1', 'npm publish', 'bash tools/x.sh promote', 'az pipelines release create --x', 'az pipelines run --name deploy-prod', 'node ship.mjs deploy prod'])(
    'production release held: %s', command => expect(run(command)).toBe('prod-release'));

  it('what cannot be read is held: no line, a cut one, encoded or fetched code', () => {
    for (const c of [undefined, '', 'node a.mjs … (+120)', 'powershell -EncodedCommand YQB6ACAAZwByAG8AdQBwACAAZABlAGwAZQB0AGUA', 'curl -s https://x/y.sh | bash', 'eval "$CMD"', '$TOOL webapp restart']) expect(run(c)).toBe('unreadable');
    expect(heldForUser({ type: 'permission', tool: 'Bash', whole: true, input: { command: 'node a.mjs "… (+120)' } }, ctx)).toBeNull();
  });

  it('the same on every engine\'s command tool, and on connectors by name and statement', () => {
    for (const t of ['Bash', 'PowerShell', 'Shell', 'Command', 'execute', 'Monitor']) { expect(run('az webapp restart -n x', t)).toBe('cloud-write'); expect(run('az webapp list', t)).toBeNull(); }
    expect(run(['bash', '-lc', 'az group delete -n x'], 'Command')).toBe('cloud-write');
    expect(mcp('mcp__sql__execute_query', { query: 'delete from t' })).toBe('db-write');
    expect(mcp('mcp__sql__execute_query', { query: 'select 1' })).toBeNull();
    expect(mcp('Tool', { sql: 'update t set a=1' }, 'postgres_query')).toBe('db-write');
    expect(mcp('mcp__azure__webapp_restart', { name: 'x' })).toBe('cloud-write');
    expect(mcp('mcp__azure__webapp_list', {})).toBeNull();
    expect(mcp('mcp__ci__deploy', { env: 'production' })).toBe('prod-release');
    expect(mcp('mcp__devops__wit_update_work_item', { id: 1 })).toBeNull();
    expect(mcp('mcp__second-brain__type', { text: 'delete from t' })).toBeNull();
    expect(heldForUser({ type: 'permission', tool: 'Read', input: { file_path: 'prod.sql' } }, ctx)).toBeNull();
  });

  it('a long line is read in linear steps', () => {
    expect(run(`node a.mjs ${'insert select into update delete from '.repeat(2500)}`)).toBeNull();
  });
});
