// The hidden restart helper can become ready and be cancelled without launching an app or terminating the parent.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareUpdateRestart } from '../../src/main/update/restart';

const fixtures = path.resolve(import.meta.dirname, '../../test-results/restart-fixtures');
function fixture(tampered = false) {
  fs.mkdirSync(fixtures, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtures, 'case-'));
  const versions = ['44.4.5', '44.4.4'];
  const launcher = ["' second-brain stable launcher, hidden and independent of cmd/PATH", 'Dim s, f, b, r', 'Set s = CreateObject("WScript.Shell")', 'Set f = CreateObject("Scripting.FileSystemObject")', 'b = f.GetParentFolderName(WScript.ScriptFullName)', 'r = ""',
    ...versions.map(version => `If r = "" And f.FileExists(b & "\\electron\\${version}\\electron.exe") Then r = b & "\\electron\\${version}\\electron.exe"`),
    'If r = "" Then WScript.Quit 1', 's.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = "1"', 's.Environment("PROCESS")("SB_RELEASES_ROOT") = b', 's.Run Chr(34) & r & Chr(34) & " " & Chr(34) & b & "\\release.mjs" & Chr(34) & " launch", 0, False', ''].join('\r\n');
  fs.writeFileSync(path.join(root, 'launch.vbs'), launcher + (tampered ? 'WScript.Quit\r\n' : ''));
  fs.writeFileSync(path.join(root, 'release.mjs'), '// Inert fixture: never executed.\n');
  return root;
}

describe.skipIf(process.platform !== 'win32')('update restart native preparation only', () => {
  it('holds the real live parent without launching, then confirms cancellation (idempotent)', async () => {
    const handoff = await prepareUpdateRestart({ base: fixture(), pid: process.pid });
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(process.kill(process.pid, 0)).toBe(true);
    } finally { await handoff.cancel(); }
    await expect(handoff.cancel()).resolves.toBeUndefined();
  }, 12000);

  it('rejects any extra launcher code before reporting ready', async () => {
    await expect(prepareUpdateRestart({ base: fixture(true), pid: process.pid })).rejects.toThrow('prima della conferma');
  }, 12000);

  it('rejects a different PID without spawning any waiter', async () => {
    await expect(prepareUpdateRestart({ base: fixture(), pid: process.pid + 1 })).rejects.toThrow('processo Windows corrente');
  });
});
