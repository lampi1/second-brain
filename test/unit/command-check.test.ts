// Unit tests of the check an Esegui command passes before the user sees it (#388): what shared/command-check.ts finds
// (placeholders, shells waiting for the keyboard, missing program and script paths) and never finds in good commands,
// main/run/precheck.ts adding the PowerShell parse errors, and main/run/asks.ts sending a broken block back to its chat
// instead of showing it (at most MAX_BOUNCES in a row, then shown with its problems on the card).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, EventMap, PendingRequest } from '../../src/shared/contract';
import { commandProblems, type CheckEnv } from '../../src/shared/command-check';
import { precheckCommand, parseScript } from '../../src/main/run/precheck';
import { CHECK_LABEL, CommandAsks, MAX_BOUNCES } from '../../src/main/run/asks';

const files = new Set(['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\repo\\scripts\\build.ps1', 'C:\\Profiles\\me\\tool.exe']);
const win: CheckEnv = { cwd: 'C:\\repo', exists: p => files.has(p.replace(/\//g, '\\')), env: { USERPROFILE: 'C:\\Profiles\\me', LOCALAPPDATA: 'C:\\Profiles\\me\\AppData\\Local' }, home: 'C:\\Profiles\\me', platform: 'win32' };
const probs = (code: string, e: CheckEnv = win) => commandProblems(code, e);

describe('commandProblems: what makes a command fail before it starts', () => {
  it('a leftover placeholder', () => {
    expect(probs('git show <commit>')[0]).toMatch(/segnaposto.*<commit>/);
    expect(probs('Copy-Item "<path>" .')[0]).toMatch(/<path>/);
  });

  it('a program path that does not exist, environment variables expanded', () => {
    expect(probs('& "C:\\Program Files\\Git\\usr\\bin\\bash.exe" -lc "ls"')[0]).toMatch(/non esiste su questo PC/);
    expect(probs('& "C:\\Program Files\\Git\\bin\\bash.exe" -lc "ls"')).toEqual([]);
    expect(probs('& "$env:USERPROFILE\\tool.exe" --help')).toEqual([]);
    expect(probs('& "%LOCALAPPDATA%\\nope\\x.exe"')[0]).toMatch(/non esiste/);
    expect(probs('& "$HOME\\x.exe"')).toEqual([]);   // another variable: known only when it runs
  });

  it('a shell started with nothing to run, or a prompt for the keyboard', () => {
    expect(probs('& "C:\\Program Files\\Git\\bin\\bash.exe" -l')[0]).toMatch(/senza un comando/);
    expect(probs('wsl')[0]).toMatch(/wsl/);
    expect(probs('powershell -NoExit -Command "dir"')[0]).toMatch(/senza un comando/);
    expect(probs('$x = Read-Host "nome"')[0]).toMatch(/Read-Host/);
    expect(probs('bash -lc "npm test"')).toEqual([]);
    expect(probs('"ls" | bash')).toEqual([]);
    expect(probs('node -v; python --version')).toEqual([]);
  });

  it('a relative script missing from the folder, unless the block moves or makes it first', () => {
    expect(probs('.\\scripts\\build.ps1')).toEqual([]);
    expect(probs('powershell -File scripts\\deploy.ps1')[0]).toMatch(/deploy\.ps1 non esiste nella cartella C:\\repo/);
    expect(probs('node scripts/missing.mjs')[0]).toMatch(/missing\.mjs/);
    expect(probs('cd C:\\other; .\\run.ps1')).toEqual([]);
    expect(probs('Set-Content tmp\\x.ps1 "echo 1"; .\\tmp\\x.ps1')).toEqual([]);
  });

  it('good commands and comments pass', () => {
    for (const c of ['npm run check:quick', 'git log --oneline -5', "Get-ChildItem | Where-Object { $_.Name -match '<title>' }", '# usa <commit> da sopra\ngit status', 'git commit -m "fix: x"'])
      expect(probs(c), c).toEqual([]);
  });

  it('on macOS/Linux only that platform\'s absolute paths are read', () => {
    const unix: CheckEnv = { cwd: '/repo', exists: () => false, platform: 'linux' };
    expect(probs('/usr/local/bin/tool.sh', unix)[0]).toMatch(/non esiste/);
    expect(probs('npm test', unix)).toEqual([]);
  });
});

describe('precheckCommand: plus the PowerShell 5.1 parse', () => {
  it('adds the parse errors; a failing parser finds nothing', async () => {
    expect(await precheckCommand('git show <commit>', 'C:\\repo', { platform: 'win32', exists: () => true, parse: async () => ["riga 1: The '<' operator is reserved for future use."] }))
      .toEqual(['contiene un segnaposto da riempire: <commit>', "non si legge in PowerShell 5.1 (riga 1: The '<' operator is reserved for future use.)"]);
    expect(await precheckCommand('npm test', 'C:\\repo', { platform: 'win32', exists: () => true, parse: () => Promise.reject(new Error('no shell')) })).toEqual([]);
  });

  it('the parse script carries the block as base64, never as text', () => {
    const s = parseScript('echo "a\'b"');
    expect(s).toContain('ParseInput');
    expect(s).not.toContain('echo');
  });
});

const fence = (code: string) => '```powershell\n' + code + '\n```';
const asst = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text });
const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: 'Lavoro', cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

describe('CommandAsks: a broken block goes back to its chat (#388)', () => {
  afterEach(() => { vi.useRealTimers(); });

  function make(bad: (code: string) => string[]) {
    const asked: PendingRequest[] = [], back: { chatId: string; text: string }[] = [];
    const s = new CommandAsks({
      emit: () => {}, ran: () => false, onAsk: r => asked.push(r), settleMs: 10, now: () => 1000, cwdOf: () => 'C:\\repo',
      check: async code => bad(code), sendBack: async (chatId, text) => { back.push({ chatId, text }); return true; },
    });
    const ev = <K extends keyof EventMap>(ch: K, p: EventMap[K]) => s.observe(ch, p);
    let n = 0;
    const turn = async (code: string) => {
      const id = `a${++n}`;
      ev('chat:updated', chat({ id: 'c1', state: 'running' }));
      ev('chat:item', { chatId: 'c1', item: { kind: 'user', id: `u${n}`, at: 1, text: n === 1 ? 'vai' : `${CHECK_LABEL}\n…` } });
      ev('chat:item', { chatId: 'c1', item: asst(id, `Lancia:\n${fence(code)}`) });
      ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
      await vi.advanceTimersByTimeAsync(20);
    };
    return { s, asked, back, turn };
  }

  it('a good block is shown; a broken one is sent back with its reasons, not shown', async () => {
    vi.useFakeTimers();
    const w = make(c => (c.includes('<') ? ['contiene un segnaposto da riempire: <commit>'] : []));
    await w.turn('git show <commit>');
    expect(w.asked).toHaveLength(0);
    expect(w.back).toHaveLength(1);
    expect(w.back[0]!.text.startsWith(CHECK_LABEL)).toBe(true);
    expect(w.back[0]!.text).toContain('git show <commit>');
    expect(w.back[0]!.text).toContain('segnaposto');
    await w.turn('git show HEAD');
    expect(w.asked.map(r => r.detail)).toEqual(['git show HEAD']);
  });

  it(`after ${MAX_BOUNCES} returns in a row the next broken block is shown, its problems on the card`, async () => {
    vi.useFakeTimers();
    const w = make(() => ['il percorso X non esiste su questo PC']);
    for (let i = 0; i < MAX_BOUNCES; i++) await w.turn(`& X${i}.exe`);
    expect(w.back).toHaveLength(MAX_BOUNCES);
    expect(w.asked).toHaveLength(0);
    await w.turn('& Y.exe');
    expect(w.asked).toHaveLength(1);
    expect(w.asked[0]!.command?.lead).toMatch(/Potrebbe non partire: il percorso X non esiste/);
  });
});

describe('commandProblems: never holds back these good commands (review of #388)', () => {
  it.each([
    'npm run build && node dist/main.js',
    'npx tsc; .\\out\\x.ps1',
    'if (Test-Path "C:\\Program Files\\Git\\usr\\bin\\bash.exe") { "si" } else { "no" }',
    'Invoke-WebRequest https://x/setup.exe -OutFile C:\\Temp\\setup.exe; & C:\\Temp\\setup.exe /S',
    'Copy-Item x.ps1 C:\\tools\\x.ps1',
    'git commit -m "feat: add pause button"',
    'docker compose pause web',
    'Write-Host "usa Read-Host per chiedere"',
    'Set-Content index.html @"\n<html><body>ciao</body></html>\n"@',
    'git commit -m "fix\n\nvedi <issue>"',
    'git status # poi <commit>',
    'wsl bash ~/deploy.sh',
    'wsl bash /opt/app/deploy.sh',
    '& "C:\\Program Files\\Git\\bin\\bash.exe" /c/Users/me/x.sh',
  ])('%s', c => { expect(probs(c)).toEqual([]); });

  it('bash redirection is no placeholder off Windows', () => {
    expect(probs('sort <in.txt >out.txt', { cwd: '/repo', exists: () => true, platform: 'linux' })).toEqual([]);
  });
});

describe('CommandAsks: send-back edge cases (review of #388)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const run = async (o: { text: string; bad: (c: string) => string[]; ok?: boolean; pending?: number }) => {
    const asked: PendingRequest[] = [], back: string[] = [];
    const s = new CommandAsks({
      emit: () => {}, ran: () => false, onAsk: r => asked.push(r), settleMs: 10, now: () => 1000, cwdOf: () => 'C:\\repo',
      check: async c => o.bad(c), sendBack: async (_c, t) => { back.push(t); return o.ok ?? true; },
    });
    s.observe('chat:updated', chat({ id: 'c1', state: 'running' }));
    s.observe('chat:item', { chatId: 'c1', item: { kind: 'user', id: 'u1', at: 1, text: 'vai' } });
    s.observe('chat:item', { chatId: 'c1', item: asst('a1', o.text) });
    s.observe('chat:updated', chat({ id: 'c1', state: o.pending ? 'waiting' : 'idle', pending: o.pending ?? 0 }));
    await vi.advanceTimersByTimeAsync(20);
    return { s, asked, back };
  };
  const two = `Eseguilo:\n${fence('git show <a>')}\n\nPoi eseguilo:\n${fence('git status')}`;

  it('a good block next to a broken one is shown; the broken goes back in one message', async () => {
    vi.useFakeTimers();
    const w = await run({ text: two, bad: c => (c.includes('<') ? ['segnaposto'] : []) });
    expect(w.asked.map(r => r.detail)).toEqual(['git status']);
    expect(w.back).toHaveLength(1);
  });

  it('a send-back that fails shows the block with its problems', async () => {
    vi.useFakeTimers();
    const w = await run({ text: `Lancia:\n${fence('git show <a>')}`, bad: () => ['segnaposto'], ok: false });
    await vi.advanceTimersByTimeAsync(5);
    expect(w.asked).toHaveLength(1);
    expect(w.asked[0]!.command?.lead).toMatch(/segnaposto/);
  });

  it('held while the chat waits on its own question, sent once it is free', async () => {
    vi.useFakeTimers();
    const w = await run({ text: `Lancia:\n${fence('git show <a>')}`, bad: () => ['segnaposto'], pending: 1 });
    expect(w.back).toHaveLength(0);
    w.s.observe('chat:updated', chat({ id: 'c1', state: 'idle', pending: 0 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(w.back).toHaveLength(1);
  });

  it('a held send-back is dropped when the agent wrote a newer message; that one is shown', async () => {
    vi.useFakeTimers();
    const w = await run({ text: `Lancia:\n${fence('git show <a>')}`, bad: c => (c.includes('<') ? ['segnaposto'] : []), pending: 1 });
    w.s.observe('chat:updated', chat({ id: 'c1', state: 'running', pending: 0 }));
    w.s.observe('chat:item', { chatId: 'c1', item: asst('a2', `Lancia:\n${fence('git show HEAD')}`) });
    w.s.observe('chat:updated', chat({ id: 'c1', state: 'idle', pending: 0 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(w.back).toHaveLength(0);
    expect(w.asked.map(r => r.detail)).toEqual(['git show HEAD']);
  });
});
