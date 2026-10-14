// Reaps what an engine leaves behind when its chat closes. A CLI that ends cleanly (stdin closed, ✕, Ctrl+W, auto
// close) does not end its own children: MCP servers (npx/node), hooks, PowerShell shells, background commands such as
// a dev copy of this app. Windows keeps them alive with a parent id that points to the dead CLI, and `taskkill /T` on
// a dead pid finds no tree. So after the engine exits we list every process once (pid, parent pid, creation time,
// name), walk down from the engine's pid, and kill what is left. Creation times guard against reused pids: a child
// counts only if it was born after its parent and before any other process took the parent's pid. Only tools are
// killed (node, shells, python, MCP servers, a dev Electron…): a program with a window the chat opened for the user
// (Chrome, Excel) stays, with everything it started (owner, 2026-10-12); hence one kill per pid, never `/T`.
// Limit: a process whose launcher already exited (`Start-Process` from a shell that ended, `cmd /c start`) has a parent
// id that points to nothing we can see, so it is not found. Hence reapEngine: when the engine ran in a Job Object
// (jobguard.ts) its job lists every process it started, orphans included, in milliseconds; this walk is the fallback.
// Used by claude.ts, acp.ts and manager.ts when an engine exits or its chat really closes.
import { execFile, spawn } from 'node:child_process';
import { errText, log } from '../log';
import { killTrees } from './cli';
import { jobGuard, type JobMember } from './jobguard';

export interface Proc { pid: number; ppid: number; /** creation time, ms since epoch */ created: number; /** image name, e.g. node.exe */ name?: string }

/** The process an engine ran as: its pid, when we started it (ms; spawning makes the real time a bit later) and when
 *  it exited. Anything born after the exit under the same pid belongs to whoever reused it. */
export interface Root { pid: number; created: number; exited: number; /** its Job Object (jobguard.ts), if it had one */ job?: number | null }

/** How far an engine's real creation time may be from the time we recorded around spawn (loaded box). */
const ROOT_SLACK_MS = 5000;
/** Clock granularity between a parent's and a child's creation time. */
const CHILD_SLACK_MS = 1000;

/** Image names of tools a chat runs for itself; anything else is the user's program and is never killed. */
const TOOL = /^(node|npm|npx|pnpm|yarn|cmd|conhost|powershell|pwsh|bash|sh|git|ssh|python\d*(\.\d+)?|pythonw|py|uv|uvx|pip\d*|deno|bun|dotnet|java|claude|agent|cursor-agent|electron|esbuild|tsx|rg|sqlcmd|az|snyk[\w-]*|[\w.-]*mcp[\w.-]*|chrome-headless-shell|timeout|ping|curl|sleep|tail|head|cat|tee|grep|sed|awk|gawk|xargs|find|watch|less|docker|make|go|cargo|ruby|php|perl)(\.exe)?$/i;
export const isTool = (name: string | undefined): boolean => !!name && TOOL.test(name);

/** `pid ppid createdMs [name]` lines → processes (bad lines skipped; the name may hold spaces). */
export function parseProcList(text: string): Proc[] {
  const out: Proc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(.+?))?\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), created: Number(m[3]), ...(m[4] ? { name: m[4] } : {}) });
  }
  return out;
}

/** Every live tool process descending from the exited engine `root` (never a live process holding its pid: the
 *  engine is dead, so that one is someone else). A process that is not a tool is left alone with all it started. */
export function descendants(procs: readonly Proc[], root: Root, opts: { live?: boolean } = {}): Proc[] {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) { if (p.pid !== p.ppid) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]); }
  const out: Proc[] = [];
  const seen = new Set<number>([root.pid]);
  // the engine's own children were born before it exited, and before any process that took its pid since; `live`:
  // the engine still runs (the list holds the engine itself, not a reuser), so no upper bound
  const reuser = opts.live ? undefined : procs.find(p => p.pid === root.pid);
  const until = opts.live ? Infinity : Math.min(root.exited + CHILD_SLACK_MS, reuser ? reuser.created : Infinity);
  const queue: { pid: number; created: number; until: number }[] = [{ pid: root.pid, created: root.created - ROOT_SLACK_MS, until }];
  while (queue.length) {
    const n = queue.shift()!;
    for (const c of kids.get(n.pid) ?? []) {
      if (seen.has(c.pid) || c.created < n.created - CHILD_SLACK_MS || c.created >= n.until) continue;
      seen.add(c.pid);
      if (!isTool(c.name)) continue;
      out.push(c);
      queue.push({ pid: c.pid, created: c.created, until: Infinity });
    }
  }
  return out;
}

// CreationDate as Unix ms; -EncodedCommand so no quoting reaches the shell
const PS_LIST = "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId,$_.ParentProcessId,([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(),$_.Name }";

/** Every process on the machine, or null when the list cannot be read. WMI takes 3-40 s on a loaded box (measured
 *  2026-10-12): never awaited on a path the user waits for. */
export function listProcesses(timeoutMs = 90000): Promise<Proc[] | null> {
  return new Promise(resolve => {
    const done = (err: Error | null, stdout: string): void => {
      resolve(err ? null : parseProcList(String(stdout ?? ''))); // a timeout's partial list could miss a pid's new owner
    };
    try {
      if (process.platform === 'win32') {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_LIST, 'utf16le').toString('base64')],
          { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, done);
      } else {
        execFile('ps', ['-A', '-o', 'pid=,ppid=,etimes=,comm='], { encoding: 'utf8', timeout: timeoutMs }, (err, stdout) => {
          const now = Date.now();
          done(err, String(stdout ?? '').split('\n').map(l => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(m => !!m)
            .map(m => `${m[1]} ${m[2]} ${now - Number(m[3]) * 1000} ${(m[4] ?? '').split('/').pop()}`).join('\n'));
        });
      }
    } catch { resolve(null); }
  });
}

/** The quit's picture of the engines' trees (the job guard off or failed): a process list taken at shutdown start and
 *  once more when it comes back, while there is time. At the cap the engines still alive are terminated directly, with
 *  what this picture says they started (children first): a detached taskkill that has not read the tree yet (15-40 s
 *  on a loaded box) would otherwise lose the children once the engine is gone. Never awaited: the newest list wins. */
export function snapshotTrees(pids: number[], capMs: number, list: typeof listProcesses = listProcesses): (pid: number) => number[] {
  let procs: Proc[] | null = null;
  const end = Date.now() + capMs;
  const take = (again: boolean): void => {
    void list(Math.max(1000, end - Date.now())).then(got => {
      if (got) procs = got;
      if (again && Date.now() < end) take(false);
    });
  };
  if (pids.length) take(true);
  return pid => {
    const self = procs?.find(p => p.pid === pid);
    if (!procs || !self) return [];
    // breadth first from the engine: reversed, the deepest come first
    return descendants(procs, { pid, created: self.created, exited: Infinity }, { live: true }).map(p => p.pid).reverse();
  };
}

/** The PowerShell of reapAfterQuit: waits for the engines to be gone, lists every process once, walks down from each
 *  with descendants' rules (creation-time guards, tools only, a non-tool keeps all it started) and stops what it finds
 *  deepest first; writes `<pid>.done` into `doneDir` (if given) for each engine when it is over, found or not. One
 *  script for all the engines: one WMI list, and a command line that stays far under Windows' 32 767 characters (one
 *  script each, ~4 700 characters encoded, broke it at 7 engines). Exported for its unit test. */
export function quitReapScript(roots: { pid: number; created: number; /** when it was terminated (ms, read by the caller) */ exited: number }[], doneDir?: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  return [
    // pid, creation, and the kill time read by the caller, never the time this script got to run (seconds later under
    // load: a short-lived process that took the pid meanwhile could have started tools that would pass the guards)
    // (the unary comma keeps one engine an array of one triple: @(@(a, b, c)) would flatten into three numbers)
    `$roots = @(${roots.map(r => `,@(${r.pid}, ${r.created}, ${r.exited})`).join('; ')}); $tool = ${q(TOOL.source)}`,
    // tests (doneDir): a marker per phase, so a reaper that never ends says where it stopped
    doneDir ? `$mark = { param($ph) foreach ($r in $roots) { Set-Content -LiteralPath (Join-Path ${q(doneDir)} ('{0}.{1}' -f $r[0], $ph)) -Value $ph } }; & $mark 'started'` : '',
    // the engines are being terminated as this starts: wait for them, so a live process holding a pid is a reuser
    "$t = [DateTime]::UtcNow.AddSeconds(15); while ((@($roots | Where-Object { Get-Process -Id $_[0] -ErrorAction SilentlyContinue }).Count) -and [DateTime]::UtcNow -lt $t) { Start-Sleep -Milliseconds 100 }",
    "try {",
    "  $all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; Pp = [int]$_.ParentProcessId; Made = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); Name = [string]$_.Name } })",
    doneDir ? "  & $mark 'listed'" : '',
    "  foreach ($r in $roots) {",
    "    $root = [int]$r[0]",
    `    $until = $r[2] + ${CHILD_SLACK_MS}; $reuser = $all | Where-Object { $_.Id -eq $root } | Select-Object -First 1; if ($reuser -and $reuser.Made -lt $until) { $until = $reuser.Made }`,
    "    $seen = @{ $root = $true }; $out = New-Object System.Collections.ArrayList; $queue = New-Object System.Collections.Queue",
    `    $queue.Enqueue(@($root, ($r[1] - ${ROOT_SLACK_MS}), $until))`,
    "    while ($queue.Count) {",
    "      $n = $queue.Dequeue()",
    "      foreach ($c in $all) {",
    `        if ($c.Pp -ne $n[0] -or $c.Id -eq $c.Pp -or $seen.ContainsKey($c.Id) -or $c.Made -lt ($n[1] - ${CHILD_SLACK_MS}) -or $c.Made -ge $n[2]) { continue }`,
    "        $seen[$c.Id] = $true",
    "        if ($c.Name -notmatch $tool) { continue }",
    "        [void]$out.Add($c.Id); $queue.Enqueue(@($c.Id, $c.Made, [double]::PositiveInfinity))",
    "      }",
    "    }",
    "    $out.Reverse(); foreach ($p in $out) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }",
    "  }",
    "} finally {",
    doneDir ? `  foreach ($r in $roots) { Set-Content -LiteralPath (Join-Path ${q(doneDir)} ('{0}.done' -f $r[0])) -Value 'done' }` : '',
    "}",
  ].join('\n');
}

/** The quit's last resort for engines terminated directly at the cap: when snapshotTrees had no picture yet (WMI slow
 *  under load) or an engine started more since, and the detached taskkill had not read its tree, their children would
 *  live on until the next start's orphan sweep (2026-10-13, manager.test at 100% CPU). A detached PowerShell that
 *  outlives the app finds and stops them after the engines are gone. SB_QUIT_REAP_DONE (a folder; tests) gets
 *  `<pid>.done` for each engine when it ends. */
export function reapAfterQuit(roots: { pid: number; created: number; exited: number }[]): void {
  const ok = roots.filter(r => r.created > 0);
  if (process.platform !== 'win32' || !ok.length) return;
  const ps = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(quitReapScript(ok, process.env.SB_QUIT_REAP_DONE || undefined), 'utf16le').toString('base64')];
  // a detached PowerShell has no console and exits at once without running anything (measured 2026-10-14): a detached
  // Node (this binary as Node) outlives the app and starts it as its own child, which gets a hidden console; one spawn
  // for all the engines: the quit pays for it within its cap (a spawn takes hundreds of ms at full CPU)
  const js = `delete process.env.ELECTRON_RUN_AS_NODE; require('node:child_process').execFile('powershell.exe', ${JSON.stringify(ps)}, { windowsHide: true }, () => {});`;
  try {
    const k = spawn(process.execPath, ['-e', js], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'ignore', detached: true });
    k.on('error', e => log.warn('chats', 'quit reaper did not start', { data: { pids: ok.map(r => r.pid) }, cause: errText(e), hint: "the next start's orphan sweep kills what the engines left" }));
    k.unref();
  } catch (e) { log.warn('chats', 'quit reaper did not start', { data: { pids: ok.map(r => r.pid) }, cause: errText(e), hint: "the next start's orphan sweep kills what the engines left" }); }
}

/** Reaping is on in the app; unit tests turn it on only where they check it (SB_REAP=1): one WMI list per closed
 *  session would load the box for the whole suite. */
export function reapEnabled(): boolean {
  return process.env.VITEST ? process.env.SB_REAP === '1' : process.env.SB_REAP !== '0';
}

/** After an engine exited: kills every tool process still descending from it, then looks again after `recheckMs`
 *  (taskkill is slow under load; a shell may have started one more meanwhile) and kills what is still there.
 *  Resolves with how many were found the first time. */
export async function reapTree(root: Root, ctx: { chatId: string; what: string }, opts: { recheckMs?: number; list?: typeof listProcesses } = {}): Promise<number> {
  const list = opts.list ?? listProcesses;
  const procs = await list();
  if (!procs) { log.warn('chats', 'process list unavailable, leftovers not checked', { chat: ctx.chatId, cause: 'Get-CimInstance Win32_Process failed or timed out', hint: 'npm run doctor; look for orphaned node/powershell processes by hand' }); return 0; }
  const left = descendants(procs, root);
  if (!left.length) return 0;
  log.info('chats', `${ctx.what} left processes behind, killing them`, { chat: ctx.chatId, data: { root: root.pid, procs: left.map(p => `${p.pid} ${p.name ?? '?'}`) } });
  killTrees(left.map(p => p.pid), { tree: false });
  setTimeout(() => {
    void list().then(again => {
      const still = again ? descendants(again, root) : [];
      if (!still.length) return;
      log.warn('chats', 'leftover processes survived the kill, retrying', { chat: ctx.chatId, data: { procs: still.map(p => `${p.pid} ${p.name ?? '?'}`) } });
      killTrees(still.map(p => p.pid), { tree: false });
    });
  }, opts.recheckMs ?? 20000).unref();
  return left.length;
}

/** The tools among a job's members: the engine itself excluded, and nothing a non-tool started (a browser or Excel
 *  the chat opened stays with everything under it, as in descendants). */
export function jobTools(members: JobMember[], rootPid: number): JobMember[] {
  const byPid = new Map(members.map(m => [m.pid, m]));
  const underUserProgram = (m: JobMember): boolean => {
    const seen = new Set<number>();
    for (let up = byPid.get(m.ppid); up && !seen.has(up.pid); up = byPid.get(up.ppid)) {
      seen.add(up.pid);
      if (!isTool(up.name) && up.pid !== rootPid) return true;
    }
    return false;
  };
  return members.filter(m => m.pid !== rootPid && isTool(m.name) && !underUserProgram(m));
}

/** After an engine exited (and its chat no longer keeps its children): kills the tools it left. With a job: its
 *  members, then the job is released so the user's programs outlive the app; without one: the process-list walk. */
export async function reapEngine(root: Root, ctx: { chatId: string; what: string }): Promise<number> {
  if (!jobGuard.has(root.job)) return reapTree(root, ctx);
  const left = jobTools(await jobGuard.members(root.job), root.pid);
  if (left.length) {
    log.info('chats', `${ctx.what} left processes behind, killing them`, { chat: ctx.chatId, data: { root: root.pid, via: 'job', procs: left.map(p => `${p.pid} ${p.name}`) } });
    for (const p of left) { try { process.kill(p.pid); } catch { /* gone */ } }
  }
  await jobGuard.release(root.job);
  return left.length;
}
