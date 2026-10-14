// Unit tests of main/run/runner.ts and shared/runnable.ts: "Esegui" runs only a block of that chat's own message, asks
// a second click for production, runs in PowerShell 5.1 with the real exit code, streams output, stops, and the
// outcome message for the chat. Real powershell.exe (Windows only), harmless commands.
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../../src/shared/contract';
import { CommandRunner, wrapScript } from '../../src/main/run/runner';
import { isRunnable, prodRisk, runReport } from '../../src/shared/runnable';

const win = process.platform === 'win32';

function make(text: string) {
  const events: RunInfo[] = [];
  const r = new CommandRunner({ itemText: (c, i) => (c === 'c1' && i === 'a1' ? text : null), cwdOf: () => os.tmpdir(), emit: e => events.push(e) });
  const done = (id: string) => new Promise<RunInfo>((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const x = r.list().find(y => y.id === id); if (x && x.state !== 'running') res(x); else if (Date.now() - t0 > 30000) rej(new Error('timeout')); else setTimeout(tick, 50); };
    tick();
  });
  return { r, events, done };
}

describe('runnable', () => {
  it('shell languages only', () => {
    expect(['bash', 'powershell', 'PS1', 'pwsh', 'sh'].every(isRunnable)).toBe(true);
    expect(['ts', 'json', '', null, 'sql'].some(isRunnable)).toBe(false);
  });
  it('production commands are recognised', () => {
    expect(prodRisk('sqlcmd -S x.database.windows.net -Q "select 1"')).toMatch(/database/);
    expect(prodRisk('bash ops/runner/deploy.sh')).toMatch(/produzione/);
    expect(prodRisk('az webapp restart -n app -g rg')).toMatch(/Azure/);
    expect(prodRisk('Restart-AzWebApp -Name x')).toMatch(/Azure/);
    expect(prodRisk('restart-azwebapp -Name x')).toMatch(/Azure/);
    expect(prodRisk('az webapp deployment source config-zip -n app -g rg --src a.zip')).toMatch(/Azure/);
    expect(prodRisk('az appservice plan update -n p -g rg --sku P2V3')).toMatch(/Azure/);
    expect(prodRisk('az webapp scale -n app -g rg')).toMatch(/Azure/);
    expect(prodRisk('az rest --method post --uri https://x.scm.azurewebsites.net/api/command')).toMatch(/Azure/);
    expect(prodRisk('sqlpackage /a:Publish /TargetServerName:x.database.windows.net')).toMatch(/database/);
    expect(prodRisk('az rest --method get --uri https://management.azure.com/x')).toBeNull();
    expect(prodRisk('az webapp list -o table')).toBeNull();
    expect(prodRisk('az account show')).toBeNull();
    expect(prodRisk('npm test')).toBeNull();
  });
  it('the outcome message carries command, exit code and output', () => {
    const t = runReport({ id: 'x', chatId: 'c', itemId: 'i', code: 'npm test', cwd: 'C:/', state: 'error', exitCode: 2, output: 'boom', startedAt: 0, endedAt: 1 });
    expect(t).toContain('exit code 2');
    expect(t).toContain('npm test');
    expect(t).toContain('boom');
  });
  it('the script ends with the block exit code', () => {
    expect(wrapScript('cmd /c exit 3')).toMatch(/exit \$__sbCode/);
  });
});

describe.skipIf(!win)('CommandRunner', () => {
  it('refuses code that is not in that chat message, and production without the second click', () => {
    const { r } = make('Prova:\n```powershell\nWrite-Output ciao\n```');
    expect(() => r.start({ chatId: 'c1', itemId: 'a1', code: 'Remove-Item C:/x' })).toThrow(/non è nel messaggio/);
    expect(() => r.start({ chatId: 'c2', itemId: 'a1', code: 'Write-Output ciao' })).toThrow(/non è nel messaggio/);
    const p = make('```bash\naz webapp restart -n a -g b\n```');
    expect(() => p.r.start({ chatId: 'c1', itemId: 'a1', code: 'az webapp restart -n a -g b' })).toThrow(/secondo clic/);
  });

  it('runs in PowerShell 5.1: output, UTF-8, exit code 0', async () => {
    const code = "Write-Output 'città ok'\nWrite-Output $PSVersionTable.PSVersion.Major";
    const { r, events, done } = make(`Lancia:\n\`\`\`powershell\n${code}\n\`\`\``);
    const run = r.start({ chatId: 'c1', itemId: 'a1', code });
    expect(run.state).toBe('running');
    const end = await done(run.id);
    expect(end).toMatchObject({ state: 'ok', exitCode: 0 });
    expect(end.output).toContain('città ok');
    expect(end.output.trim().split('\n').pop()).toBe('5');
    expect(events.at(-1)?.state).toBe('ok');
  }, 40000);

  it('a failing native command gives its exit code; a failing cmdlet gives 1', async () => {
    const { r, done } = make('```\ncmd /c exit 3\n```\n```\nGet-Item C:/nope-sb-xyz\n```');
    expect(await done(r.start({ chatId: 'c1', itemId: 'a1', code: 'cmd /c exit 3' }).id)).toMatchObject({ state: 'error', exitCode: 3 });
    const e = await done(r.start({ chatId: 'c1', itemId: 'a1', code: 'Get-Item C:/nope-sb-xyz' }).id);
    expect(e).toMatchObject({ state: 'error', exitCode: 1 });
    expect(e.output).toContain('Cannot find path');
    expect(e.output).not.toContain('CLIXML');
    expect(e.output).toMatch(/nope-sb-xyz/);
  }, 60000);

  it('Ferma stops a long run', async () => {
    const { r, done } = make('```powershell\nStart-Sleep -Seconds 30\n```');
    const run = r.start({ chatId: 'c1', itemId: 'a1', code: 'Start-Sleep -Seconds 30' });
    r.stop(run.id);
    expect(await done(run.id)).toMatchObject({ state: 'stopped' });
    r.shutdown();
  }, 40000);
});
