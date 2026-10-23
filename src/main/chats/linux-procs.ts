// Linux process-list fallback for the chat reaper when ps cannot read a parent-mounted /proc in a PID namespace.
// Maps only processes in our exact namespace, preserving ancestry and executable identity before tools are killed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Proc } from './proctree';

export interface LinuxProcSnapshot { stat: string; status: string; namespace: string; executable?: string }

/** Read Linux's stat without splitting the parenthesized comm (which may contain spaces or parentheses). */
function statFields(stat: string): { hostPid: number; hostParent: number; hostGroup: number; ticks: number; name: string } | null {
  const m = /^(\d+) \((.*)\) ([A-Z]) (.*)$/s.exec(stat.trim());
  if (!m) return null;
  const fields = m[4]!.split(/\s+/);
  const [hostPid, hostParent, hostGroup, ticks] = [m[1], fields[0], fields[1], fields[18]].map(Number);
  if (![hostPid, hostParent, hostGroup, ticks].every(n => Number.isSafeInteger(n) && n! >= 0) || !hostPid || !hostGroup) return null;
  return { hostPid: hostPid!, hostParent: hostParent!, hostGroup: hostGroup!, ticks: ticks!, name: m[2]! };
}

function namespaceIds(status: string, field: string): number[] | null {
  const line = status.split('\n').find(l => l.startsWith(`${field}:`));
  const value = line?.slice(field.length + 1).trim();
  if (!value || !/^\d+(?:\s+\d+)*$/.test(value)) return null;
  const ids = value.split(/\s+/).map(Number);
  return ids.every(n => Number.isSafeInteger(n) && n > 0) ? ids : null;
}

/** Pure conversion for regression fixtures. Unknown namespaces, IDs, parents and duplicate IDs fail closed. */
export function linuxProcList(snapshots: LinuxProcSnapshot[], self: LinuxProcSnapshot, pid: number, clockTicks: number, bootMs: number): Proc[] | null {
  const selfIds = namespaceIds(self.status, 'NSpid');
  if (!selfIds || selfIds.at(-1) !== pid || !self.namespace || !Number.isFinite(bootMs) || !Number.isSafeInteger(clockTicks) || clockTicks <= 0) return null;
  const rows = snapshots.flatMap(s => {
    if (s.namespace !== self.namespace) return [];
    const stat = statFields(s.stat), ids = namespaceIds(s.status, 'NSpid'), groups = namespaceIds(s.status, 'NSpgid');
    if (!stat || !ids || !groups || ids.length !== selfIds.length || groups.length !== selfIds.length || ids[0] !== stat.hostPid || groups[0] !== stat.hostGroup) return [];
    return [{ ...stat, pid: ids.at(-1)!, pgid: groups.at(-1)!, name: s.executable ? path.basename(s.executable.replace(/ \(deleted\)$/, '')) : stat.name }];
  });
  if (new Set(rows.map(p => p.pid)).size !== rows.length || new Set(rows.map(p => p.hostPid)).size !== rows.length) return null;
  const byHost = new Map(rows.map(p => [p.hostPid, p]));
  return rows.flatMap(p => {
    const parent = byHost.get(p.hostParent);
    // Missing parent metadata is not proof of adoption: it might be a protected user program. Namespace init's
    // parent may live outside this namespace; no other process may acquire a synthetic parent on that basis.
    // Retain its identity, unattached, so descendants can still detect a reused engine PID and enforce its birth
    // cutoff. Dropping the row could make that new process's children appear to belong to the old engine.
    if (!parent && p.hostParent !== 0 && p.pid !== 1) return [{ pid: p.pid, ppid: p.pid, created: bootMs + p.ticks * 1000 / clockTicks, name: p.name }];
    const ppid = parent?.pid ?? 0;
    const adopted = ppid === 0 || ppid === 1;
    return [{ pid: p.pid, ppid: p.pgid !== p.pid && adopted && parent?.pgid !== p.pgid ? p.pgid : ppid,
      created: bootMs + p.ticks * 1000 / clockTicks, name: p.name }];
  });
}

/** Never translates or signals a process outside our PID namespace. No /proc access or ambiguous identity → null. */
export async function listLinuxProcesses(): Promise<Proc[] | null> {
  try {
    const namespace = async (dir: string): Promise<string> => {
      const s = await fs.stat(`${dir}/ns/pid`);
      return `${s.dev}:${s.ino}`;
    };
    const read = async (dir: string): Promise<LinuxProcSnapshot> => {
      const [stat, status, ns, executable] = await Promise.all([fs.readFile(`${dir}/stat`, 'utf8'), fs.readFile(`${dir}/status`, 'utf8'), namespace(dir), fs.readlink(`${dir}/exe`).catch(() => undefined)]);
      // A PID recycled while reading must not combine its old namespace with its new executable or ancestry.
      const again = statFields(await fs.readFile(`${dir}/stat`, 'utf8'));
      const before = statFields(stat);
      if (!again || !before || again.hostPid !== before.hostPid || again.ticks !== before.ticks || again.hostParent !== before.hostParent || again.hostGroup !== before.hostGroup || again.name !== before.name) throw new Error('process changed');
      return { stat, status, namespace: ns, executable };
    };
    const [self, entries, bootMs, ticks] = await Promise.all([read('/proc/self'), fs.readdir('/proc'), fs.readFile('/proc/uptime', 'utf8').then(uptime => Date.now() - Number(uptime.trim().split(/\s+/)[0]) * 1000),
      new Promise<number>((resolve, reject) => execFile('getconf', ['CLK_TCK'], { timeout: 5000 }, (err, out) => err ? reject(err) : resolve(Number(out.trim()))))]);
    const snapshots = await Promise.all(entries.filter(n => /^\d+$/.test(n)).map(async n => {
      const dir = `/proc/${n}`;
      try { return await namespace(dir) === self.namespace ? await read(dir) : null; } catch { return null; }
    }));
    return linuxProcList(snapshots.filter((s): s is LinuxProcSnapshot => s !== null), self, process.pid, ticks, bootMs);
  } catch { return null; }
}
