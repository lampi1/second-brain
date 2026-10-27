// Windows Job Objects for the engines (ADR 0026). libuv puts each CLI in its own kill-on-close job but lets the CLI's
// children break away silently, so MCP servers, shells and background commands outlive a killed or crashed app, and
// `taskkill /T` (15-40 s on a loaded box) misses every child whose parent already exited. Node has no Job Object API,
// so one hidden PowerShell helper (C# via Add-Type, started once, lives as long as the app) holds one job per engine:
// - add: the engine joins a new job (kill-on-close, explicit breakaway allowed); its later children are born inside it,
//   orphans included (nested jobs: the innermost job, ours, decides; it allows no silent breakaway). The job also has
//   die-on-unhandled-exception (SEM_NOGPFAULTERRORBOX): the Claude CLI kills its own Bash/tool children with
//   `taskkill /PID x /T /F`, and under load those taskkill crash (access violation, ~10 a minute on 2026-10-13), each one
//   with a Windows error dialog and the VS JIT debugger; inside the job they just end;
// - kill: TerminateJobObject, the whole tree at once, orphans included, in milliseconds;
// - list: the job's members (pid, parent pid, image), for the reap after a clean exit (proctree.ts reapEngine);
// - release: drops kill-on-close and the handle, so what the chat opened for the user outlives the app;
// - closeall: every job not released dies (the quit's last kill);
// - quit: closeall, then starts a booster that raises the threads of the app's process tree until the app is gone (a slow
//   exit under load, Boost), and ends.
// Jobs are named by our own ids, never by pid: Windows reuses pids, and a kept engine's job outlives its process.
// The helper is a normal child of the app, so libuv kills it with the app (quit or crash): its handles close and every
// job not released dies with it. No helper (not Windows, Add-Type blocked, tests) = the taskkill paths alone.
// Also the engines' common end (killEngineTree, closePipes), their CPU priority (lowerEnginePriority) and the forced-kill
// count for app_state's health.
// Used by claude.ts, acp.ts, proctree.ts, manager.ts and index.ts (start).
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errText, log } from '../log';
import { killTrees } from './cli';

const CS = `
using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices;
public static class SbJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long A; public long B; public uint Flags; public UIntPtr MinWs; public UIntPtr MaxWs; public uint Active; public UIntPtr Affinity; public uint Prio; public uint Sched; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A, B, C, D, E, F; }
  [StructLayout(LayoutKind.Sequential)] struct Ext { public Basic B; public Io I; public UIntPtr P1, P2, P3, P4; }
  [StructLayout(LayoutKind.Sequential)] struct Pbi { public IntPtr Exit; public IntPtr Peb; public IntPtr Aff; public IntPtr Prio; public IntPtr Pid; public IntPtr Parent; }
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref Ext i, int l);
  [DllImport("kernel32", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr j, int c, IntPtr i, int l, IntPtr r);
  [DllImport("kernel32", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32", SetLastError = true)] static extern bool TerminateJobObject(IntPtr j, uint c);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr OpenProcess(uint a, bool i, int p);
  [DllImport("kernel32", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll")] static extern int NtQueryInformationProcess(IntPtr p, int c, ref Pbi i, int l, IntPtr r);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr OpenThread(uint a, bool i, int t);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetThreadPriority(IntPtr t, int p);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Si { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Pe { public int size, usage, pid; public IntPtr heap; public int mod, threads, ppid, pri, flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe; }
  [StructLayout(LayoutKind.Sequential)] struct Te { public int size, usage, tid, owner, basePri, deltaPri, flags; }
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint f, int pid);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr s, ref Pe e);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr s, ref Pe e);
  [DllImport("kernel32")] static extern bool Thread32First(IntPtr s, ref Te e);
  [DllImport("kernel32")] static extern bool Thread32Next(IntPtr s, ref Te e);
  [StructLayout(LayoutKind.Sequential)] struct Pi { public IntPtr P, T; public int Pid, Tid; }
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref Si si, out Pi pi);
  static Dictionary<int, IntPtr> jobs = new Dictionary<int, IntPtr>();
  static bool Limit(IntPtr j, uint flags) { var e = new Ext(); e.B.Flags = flags; return SetInformationJobObject(j, 9, ref e, Marshal.SizeOf(typeof(Ext))); }
  static string Err() { return "win32 " + Marshal.GetLastWin32Error(); }
  static long Parent(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return 0;
    try { var b = new Pbi(); return NtQueryInformationProcess(h, 0, ref b, Marshal.SizeOf(typeof(Pbi)), IntPtr.Zero) == 0 ? b.Parent.ToInt64() : 0; } finally { CloseHandle(h); }
  }
  public static string Run(string cmd, int id, int pid) {
    IntPtr j;
    if (cmd == "add") {
      if (jobs.ContainsKey(id)) return "err exists";
      j = CreateJobObject(IntPtr.Zero, null);
      if (j == IntPtr.Zero) return "err create " + Err();
      if (!Limit(j, 0x2000 | 0x800 | 0x400)) { var m = "err limit " + Err(); CloseHandle(j); return m; }
      IntPtr p = OpenProcess(0x0100 | 0x0001, false, pid);
      if (p == IntPtr.Zero) { var m = "err open " + Err(); CloseHandle(j); return m; }
      bool ok = AssignProcessToJobObject(j, p); var am = ok ? "" : "err assign " + Err(); CloseHandle(p);
      if (!ok) { CloseHandle(j); return am; }
      jobs[id] = j; return "ok";
    }
    if (cmd == "closeall") { foreach (var h in jobs.Values) CloseHandle(h); jobs.Clear(); return "ok"; }
    if (!jobs.TryGetValue(id, out j)) return "err nojob";
    if (cmd == "list") {
      int size = 8 + 8 * 4096; IntPtr buf = Marshal.AllocHGlobal(size);
      try {
        if (!QueryInformationJobObject(j, 3, buf, size, IntPtr.Zero)) return "err list " + Err();
        int n = Marshal.ReadInt32(buf, 4); var parts = new List<string>();
        for (int i = 0; i < n; i++) {
          int m = (int)Marshal.ReadIntPtr(buf, 8 + 8 * i).ToInt64(); string name = "?";
          try { name = Process.GetProcessById(m).ProcessName + ".exe"; } catch { }
          parts.Add(m + ":" + Parent(m) + ":" + name);
        }
        return "ok " + string.Join("|", parts);
      } finally { Marshal.FreeHGlobal(buf); }
    }
    if (cmd == "kill") { bool ok = TerminateJobObject(j, 1); var m = ok ? "ok" : "err kill " + Err(); CloseHandle(j); jobs.Remove(id); return m; }
    if (cmd == "release") { Limit(j, 0x800); CloseHandle(j); jobs.Remove(id); return "ok"; }
    return "err command";
  }
  // Started by the quit: Boost below in a process of its own, with no handle of ours: whatever the helper inherited from
  // the app (its sockets: the inspector's under the e2e) is closed once the helper exits, and the app's teardown waits
  // for none of it. Out of libuv's job too (silent breakaway), so it outlives the helper; it ends with the app's process.
  // In the high class (0x80) so it starts within seconds on a busy CPU; it lives only as long as the app's exit.
  public static string SpawnBoost(string dll, int pid) {
    var si = new Si(); si.cb = Marshal.SizeOf(typeof(Si)); Pi pi;
    var cmd = new System.Text.StringBuilder("powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \\"[void][Reflection.Assembly]::LoadFrom('" + dll.Replace("'", "''") + "'); [SbJob]::Boost(" + pid + ", 30000)\\"");
    // Reuse this helper's executable: a clean installer PATH need not include WindowsPowerShell.
    var exe = Process.GetCurrentProcess().MainModule.FileName;
    cmd.Remove(0, "powershell.exe".Length).Insert(0, string.Concat((char)34, exe, (char)34));
    if (!CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x08000080, IntPtr.Zero, null, ref si, out pi)) return "err spawn " + Err();
    CloseHandle(pi.T); CloseHandle(pi.P); return "ok";
  }
  // The app's process after app.exit: Windows ends a process only once each of its threads has run, and the app's exit
  // waits for its Chromium children (GPU, network, renderers) to end theirs; on a busy CPU, at normal and background
  // priority (Chromium's pool threads: 4), that took 20-130 s (2026-10-15). Every thread of the app and its descendants
  // goes to time-critical (only exit work is left), new ones on each pass, until the app's process is gone or \`ms\` passed
  // (30 s, the quit e2e's bound): under the same load the exit then took 5-6 s, the booster's own start included. On the
  // way out every raised thread still alive goes back to normal: a hung app or a Chromium child left behind never keeps
  // time-critical threads.
  public static void Boost(int pid, int ms) {
    // the handle stays open (p.Handle) so the pid stays ours until the booster ends: a reused pid is never the root
    Process p; DateTime born; string exe; try { p = Process.GetProcessById(pid); var held = p.Handle; born = p.StartTime; exe = null; } catch { return; }
    var sw = Stopwatch.StartNew(); var raised = new Dictionary<int, int>(); // thread id -> its process
    try { while (sw.ElapsedMilliseconds < ms) {
      IntPtr snap = CreateToolhelp32Snapshot(0x6, 0);
      if (snap != new IntPtr(-1)) try {
        // the app's process and its descendants (GPU, network, renderers: its exit waits for theirs)
        // only processes of the app's own executable started after it: a program the user opened from the app (an
        // editor, Excel) is its child too and would keep time-critical threads for good; a stale parent pid that
        // happens to match is older than the app
        var parent = new Dictionary<int, int>(); var image = new Dictionary<int, string>();
        var pe = new Pe(); pe.size = Marshal.SizeOf(typeof(Pe));
        for (bool ok = Process32FirstW(snap, ref pe); ok; ok = Process32NextW(snap, ref pe)) { parent[pe.pid] = pe.ppid; image[pe.pid] = pe.exe; }
        if (exe == null && !image.TryGetValue(pid, out exe)) exe = "";
        var tree = new HashSet<int> { pid }; var no = new HashSet<int>();
        for (bool grew = true; grew; ) {
          grew = false;
          foreach (var kv in parent) {
            if (kv.Key == 0 || tree.Contains(kv.Key) || no.Contains(kv.Key) || !tree.Contains(kv.Value)) continue;
            bool mine = false;
            if (string.Equals(image[kv.Key], exe, StringComparison.OrdinalIgnoreCase)) try { using (var c = Process.GetProcessById(kv.Key)) mine = c.StartTime >= born; } catch { }
            if (mine) { tree.Add(kv.Key); grew = true; } else no.Add(kv.Key);
          }
        }
        var te = new Te(); te.size = Marshal.SizeOf(typeof(Te));
        for (bool ok = Thread32First(snap, ref te); ok; ok = Thread32Next(snap, ref te)) {
          if (!tree.Contains(te.owner) || te.basePri >= 15) continue;
          IntPtr h = OpenThread(0x0020 | 0x0040, false, te.tid);
          if (h != IntPtr.Zero) { if (SetThreadPriority(h, 15)) raised[te.tid] = te.owner; CloseHandle(h); }
        }
      } finally { CloseHandle(snap); }
      try { if (p.WaitForExit(100)) return; } catch { return; }
    } } finally { Lower(raised); }
  }
  // the threads Boost raised, back to normal (0) if they still run in the same process: a reused thread id elsewhere is left
  static void Lower(Dictionary<int, int> raised) {
    if (raised.Count == 0) return;
    IntPtr snap = CreateToolhelp32Snapshot(0x4, 0);
    if (snap == new IntPtr(-1)) return;
    try {
      var te = new Te(); te.size = Marshal.SizeOf(typeof(Te)); int owner;
      for (bool ok = Thread32First(snap, ref te); ok; ok = Thread32Next(snap, ref te)) {
        if (!raised.TryGetValue(te.tid, out owner) || owner != te.owner) continue;
        IntPtr h = OpenThread(0x0020 | 0x0040, false, te.tid);
        if (h != IntPtr.Zero) { SetThreadPriority(h, 0); CloseHandle(h); }
      }
    } finally { CloseHandle(snap); }
  }
}`;

// Add-Type compiles for 8-13 s on a loaded box (measured 2026-10-13): the first run writes the assembly to the cache
// folder (SB_JOBGUARD_DLL, named by a hash of the source), later starts only load it.
// The source appears once: -EncodedCommand (UTF-16, base64) must stay under Windows' 32767-char command line.
const PS = `$ErrorActionPreference = 'Stop'
$cs = @'
${CS}
'@
try {
  $dll = $env:SB_JOBGUARD_DLL
  if ($dll -and (Test-Path -LiteralPath $dll)) { [void][Reflection.Assembly]::LoadFrom($dll) }
  elseif ($dll) {
    $tmp = "$dll.$PID.tmp"
    Add-Type -OutputAssembly $tmp -TypeDefinition $cs
    try { Move-Item -LiteralPath $tmp -Destination $dll -ErrorAction Stop } catch { $dll = $tmp } # another instance won the race
    [void][Reflection.Assembly]::LoadFrom($dll)
  }
  else { Add-Type -TypeDefinition $cs }
} catch { [Console]::Out.WriteLine('0 fatal ' + $_.Exception.Message.Replace([char]10, ' ')); exit 1 }
[Console]::Out.WriteLine('0 ready'); [Console]::Out.Flush()
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $p = $l.Split(' ')
  if ($p[1] -eq 'quit') {
    [void][SbJob]::Run('closeall', 0, 0)
    $r = if ($dll) { [SbJob]::SpawnBoost($dll, [int]$p[3]) } else { 'err no assembly file' }
    [Console]::Out.WriteLine($p[0] + ' ' + $r); [Console]::Out.Flush(); exit 0
  }
  try { $r = [SbJob]::Run($p[1], [int]$p[2], [int]$p[3]) } catch { $r = 'err ' + $_.Exception.Message.Replace([char]10, ' ') }
  [Console]::Out.WriteLine($p[0] + ' ' + $r); [Console]::Out.Flush()
}`;

export interface JobMember { pid: number; ppid: number; name: string }

/** `12:4:node.exe|34:12:cmd.exe` → members (bad parts skipped). */
export function parseMembers(text: string): JobMember[] {
  const out: JobMember[] = [];
  for (const part of text.split('|')) {
    const m = /^(\d+):(\d+):(.*)$/.exec(part.trim());
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3] ?? '' });
  }
  return out;
}

/** On by default on Windows; tests turn it on only where they check it (SB_JOBGUARD=1), like the reap. */
export function jobGuardEnabled(): boolean {
  if (process.platform !== 'win32') return false;
  // tests (unit, e2e) start one app per spec: no helper there unless a test asks for it
  return process.env.VITEST || process.env.SB_TEST === '1' ? process.env.SB_JOBGUARD === '1' : process.env.SB_JOBGUARD !== '0';
}

type GuardState = 'off' | 'starting' | 'ready' | 'failed';
type Pending = { resolve: (r: string) => void; timer: NodeJS.Timeout };

export class JobGuard {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private nextJob = 0;
  private buf = '';
  private readonly pending = new Map<number, Pending>();
  private st: GuardState = 'off';
  private readyWaiters: ((ok: boolean) => void)[] = [];
  private readonly jobs = new Set<number>();

  get state(): GuardState { return this.st; }

  /** Starts the helper (idempotent). Commands sent before it is ready wait for it. `cacheDir`: where the compiled
   *  helper is kept between starts (none = compile every time). */
  start(cacheDir?: string): void {
    if (this.st !== 'off' || !jobGuardEnabled()) return;
    this.st = 'starting';
    const t0 = Date.now();
    try {
      const enc = Buffer.from(PS, 'utf16le').toString('base64');
      const env = { ...process.env };
      delete env.SB_JOBGUARD_DLL;
      if (cacheDir) {
        fs.mkdirSync(cacheDir, { recursive: true });
        env.SB_JOBGUARD_DLL = path.join(cacheDir, `sbjob-${crypto.createHash('sha256').update(CS).digest('hex').slice(0, 12)}.dll`);
      }
      const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      this.proc = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch (e) { this.failed(String(e)); return; }
    const p = this.proc;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.onLine(line, t0);
      }
    });
    p.stderr.on('data', () => { /* Add-Type noise; failures come back on stdout */ });
    p.stdin.on('error', () => { /* helper gone: handled by 'exit' */ });
    p.on('error', e => this.failed(String(e)));
    p.on('exit', code => {
      if (this.st === 'ready') log.warn('chats', 'job guard helper exited', { cause: `exit ${code}`, hint: 'engines started from now on are killed with taskkill /T; restart the app to get the job guard back' });
      this.failed(`exit ${code}`);
    });
  }

  private onLine(line: string, t0: number): void {
    const m = /^(\d+) (.*)$/.exec(line);
    if (!m) return;
    const id = Number(m[1]), rest = m[2] ?? '';
    if (id === 0) {
      if (rest === 'ready') { this.st = 'ready'; log.info('chats', 'job guard ready', { data: { ms: Date.now() - t0 } }); this.flushReady(true); }
      else if (rest.startsWith('fatal')) log.warn('chats', 'job guard unavailable', { cause: rest.slice(6), hint: 'Add-Type may be blocked (constrained language mode); engines are still killed with taskkill /T' });
      return;
    }
    const pnd = this.pending.get(id);
    if (!pnd) return;
    clearTimeout(pnd.timer);
    this.pending.delete(id);
    pnd.resolve(rest);
  }

  private failed(why: string): void {
    if (this.st === 'failed') return;
    const was = this.st;
    this.st = 'failed';
    this.proc = null;
    this.jobs.clear();
    if (was === 'starting') log.warn('chats', 'job guard did not start', { cause: why, hint: 'engines are still killed with taskkill /T; npm run doctor' });
    this.flushReady(false);
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.resolve('err helper gone'); }
    this.pending.clear();
  }

  private flushReady(ok: boolean): void {
    const w = this.readyWaiters; this.readyWaiters = [];
    for (const f of w) f(ok);
  }

  /** Resolves once the helper answers (true) or could not start (false). */
  ready(): Promise<boolean> {
    if (this.st === 'ready') return Promise.resolve(true);
    if (this.st !== 'starting') return Promise.resolve(false);
    return new Promise(r => this.readyWaiters.push(r));
  }

  private async call(cmd: string, job: number, pid = 0, timeoutMs = 10000): Promise<string> {
    if (!(await this.ready()) || !this.proc) return 'err off';
    const id = ++this.seq;
    const p = this.proc;
    return new Promise<string>(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve('err timeout'); }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, timer });
      try { p.stdin.write(`${id} ${cmd} ${job} ${pid}\n`); } catch { clearTimeout(timer); this.pending.delete(id); resolve('err write'); }
    });
  }

  /** The engine joins a new job of its own: resolves with the job's id, null when it could not (no helper, gone). */
  async add(pid: number | null | undefined, chatId?: string): Promise<number | null> {
    if (!pid || this.st === 'off' || this.st === 'failed') return null;
    const job = ++this.nextJob;
    const r = await this.call('add', job, pid);
    if (r === 'ok') { this.jobs.add(job); log.info('chats', 'engine in a job', { chat: chatId, data: { pid, job } }); return job; }
    // the helper may still assign it later: queued after the add, this release keeps a forgotten job from killing on quit
    if (r === 'err timeout') void this.call('release', job);
    if (r !== 'err off') log.warn('chats', 'engine not put in a job', { chat: chatId, data: { pid }, cause: r, hint: 'its children are killed with taskkill /T and the reap instead' });
    return null;
  }

  has(job: number | null | undefined): boolean { return !!job && this.jobs.has(job); }

  /** Terminates the whole job (orphans included). False = no such job or it failed (use taskkill). */
  async kill(job: number | null | undefined, chatId?: string): Promise<boolean> {
    if (!job || !this.jobs.has(job)) return false;
    this.jobs.delete(job);
    const r = await this.call('kill', job);
    if (r === 'ok') return true;
    log.warn('chats', 'job kill failed', { chat: chatId, data: { job }, cause: r, hint: 'falling back to taskkill /T' });
    return false;
  }

  /** Processes still in the job (empty when none or no job). */
  async members(job: number | null | undefined): Promise<JobMember[]> {
    if (!job || !this.jobs.has(job)) return [];
    const r = await this.call('list', job);
    return r.startsWith('ok') ? parseMembers(r.slice(3)) : [];
  }

  /** Drops the job without killing it: what is left lives on after the app. */
  async release(job: number | null | undefined): Promise<void> {
    if (!job || !this.jobs.has(job)) return;
    this.jobs.delete(job);
    await this.call('release', job);
  }

  /** Every job not released dies (kill-on-close); the helper stays for the quit. A helper that does not answer is
   *  ended instead, which closes the jobs too. */
  async closeAll(): Promise<void> {
    if (!this.proc) return;
    this.jobs.clear();
    if ((await this.call('closeall', 0, 0, 2000)) !== 'ok') this.stop();
  }

  /** The app's last step before app.exit: the jobs die, the helper starts a booster of its own that raises the threads
   *  of the app's process tree until the app's process is gone (the C# SpawnBoost/Boost: on a busy CPU the exit took
   *  20-130 s), and ends. Resolves with its answer, at most `ms`; no helper = nothing to do. */
  async quit(pid: number, ms = 1000): Promise<void> {
    if (!this.proc || this.st !== 'ready') return;
    this.jobs.clear();
    // no answer in time: the helper is left alone (it may be starting the booster); a stuck one dies with the app
    // (libuv's job) and its jobs with it
    const r = await this.call('quit', 0, pid, ms);
    if (r !== 'ok') log.warn('chats', 'job guard quit not confirmed', { cause: r, hint: 'the app may take long to exit on a busy CPU; the jobs still die with the helper' });
  }

  /** Ends the helper: every job not released dies with it. */
  stop(): void {
    const p = this.proc;
    if (!p) return;
    try { p.stdin.end(); } catch { /* gone */ }
    try { p.kill(); } catch { /* gone */ }
  }
}

/** The app's one guard (main process). */
export const jobGuard = new JobGuard();

/** Engines killed by force (grace over, Stop on a stuck boot, app quit) since the app started: app_state's health. */
export const engineKills = { count: 0 };

/** Kills an engine's whole tree: through its job when it has one (instant, orphans too), else taskkill /T. True =
 *  the job path (the quit's last resort must not taskkill it again). */
export function killEngineTree(pid: number | null | undefined, job: number | null, fallback: () => void, chatId?: string): boolean {
  engineKills.count++;
  if (!pid) { try { fallback(); } catch { /* gone */ } return false; }
  if (jobGuard.has(job)) { void jobGuard.kill(job, chatId).then(ok => { if (!ok) killTrees([pid], { fallback }); }); return true; }
  killTrees([pid], { fallback });
  return false;
}

/** Puts a just-spawned engine below normal CPU priority (Windows: BELOW_NORMAL_PRIORITY_CLASS; elsewhere nice 10).
 *  Why: on 2026-10-27 the owner's window froze for 1-70 s while 15-20 engines, their MCP servers and the CLIs' taskkill
 *  storms kept the PC at 80-100% CPU; the app's main process (the window's UI thread and Node's event loop) ran at the
 *  same priority and waited for the CPU, with almost none of the freeze inside the app's own code (perf.ts cpuMs).
 *  Every process the engine starts later (MCP servers, shells, git, builds, taskkill) inherits the class (CreateProcess
 *  gives a child of a below-normal parent its class), so the app's window always goes first and agents use what is
 *  left; on an idle PC they run as fast as before. Called right after spawn, before the engine starts anything.
 *  False = not lowered (no pid, or the OS refused): the engine runs anyway, logged once. */
let priorityWarned = false;
export function lowerEnginePriority(pid: number | null | undefined, setPriority: (pid: number, p: number) => void = os.setPriority): boolean {
  if (!pid) return false;
  try { setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); return true; }
  catch (e) {
    if (!priorityWarned) { priorityWarned = true; log.warn('chats', 'engine priority not lowered', { data: { pid }, cause: errText(e), hint: 'the engine runs at normal priority: a busy PC can slow the window again' }); }
    return false;
  }
}

/** The engine exited but 'close' waits: a leftover it started inherited its stdout/stderr and keeps them open. Ending
 *  our side of the pipes lets 'close' fire (the chat closes) without killing what the user may still need. */
export function closePipes(p: ChildProcess): void {
  for (const s of [p.stdin, p.stdout, p.stderr]) { try { s?.destroy(); } catch { /* gone */ } }
}
