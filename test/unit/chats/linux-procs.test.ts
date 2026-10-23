// Regression fixtures for namespace-aware Linux process enumeration, used by the chat cleanup fallback.
// Host IDs must never become signal targets, and protected programs must keep their tool children.
import { describe, expect, it } from 'vitest';
import { linuxProcList, type LinuxProcSnapshot } from '../../../src/main/chats/linux-procs';
import { descendants } from '../../../src/main/chats/proctree';

const NS = '4:123';
function snapshot(host: number, pid: number, parent: number, group: number, pgid: number, name = 'node', ticks = 1200): LinuxProcSnapshot {
  const fields = Array<string>(19).fill('0');
  fields[0] = String(parent); fields[1] = String(group); fields[18] = String(ticks);
  return { stat: `${host} (${name}) S ${fields.join(' ')}`, status: `NSpid:\t${host}\t${pid}\nNSpgid:\t${group}\t${pgid}\n`, namespace: NS, executable: `/usr/bin/${name}` };
}
const init = snapshot(900, 1, 800, 900, 1, 'init', 100);
const self = snapshot(1000, 10, 900, 900, 1);
const root = { pid: 100, created: 10000, exited: 15000 };
const convert = (rows: LinuxProcSnapshot[]): ReturnType<typeof linuxProcList> => linuxProcList([init, self, ...rows], self, 10, 100, 0);

describe('Linux process namespace fallback', () => {
  it('maps orphaned tool groups while retaining live parent boundaries and executable names', () => {
    const tool = snapshot(1200, 200, 900, 1100, 100, 'MainThread');
    tool.executable = '/usr/bin/node';
    const rows = convert([tool, snapshot(1201, 201, 1200, 1100, 100, 'sh'),
      snapshot(1202, 202, 1200, 1100, 100, 'chrome'), snapshot(1203, 203, 1202, 1100, 100)]);
    expect(rows).toContainEqual({ pid: 200, ppid: 100, created: 12000, name: 'node' });
    expect(rows?.find(p => p.pid === 203)?.ppid).toBe(202);
    expect(descendants(rows!, root).map(p => p.pid)).toEqual([200, 201]);
    expect(rows?.some(p => p.pid >= 900)).toBe(false);
  });

  it('never crosses live user programs even when their child retained the old process group', () => {
    const rows = convert([snapshot(1200, 200, 900, 1200, 200, 'chrome'), snapshot(1201, 201, 1200, 1100, 100)]);
    expect(rows?.find(p => p.pid === 201)?.ppid).toBe(200);
    expect(descendants(rows!, root)).toEqual([]);
  });

  it('excludes foreign and nested namespaces even when their local IDs collide', () => {
    const foreign = { ...snapshot(1200, 200, 900, 1100, 100), namespace: '4:456' };
    const nested = { ...snapshot(1201, 201, 900, 1100, 100), namespace: '4:789' };
    expect(convert([foreign, nested])).toHaveLength(2);
  });

  it('fails closed on mismatched identity, namespace depth and missing parent metadata', () => {
    const badPid = snapshot(1200, 200, 900, 1100, 100); badPid.status = badPid.status.replace('1200', '1209');
    const badGroup = snapshot(1201, 201, 900, 1100, 100); badGroup.status = badGroup.status.replace('1100', '1109');
    const depth = snapshot(1202, 202, 900, 1100, 100); depth.status = depth.status.replace('1202\t202', '1202\t202\t2');
    const missingParent = snapshot(1203, 203, 1999, 1100, 100);
    const rows = convert([badPid, badGroup, depth, missingParent]);
    expect(rows).toHaveLength(3);
    expect(rows?.at(-1)?.ppid).toBe(203);
    expect(descendants(rows!, root)).toEqual([]);
    expect(linuxProcList([init, self], self, 11, 100, 0)).toBeNull();
    expect(linuxProcList([init, self], self, 10, 0, 0)).toBeNull();
  });

  it('rejects ambiguous duplicate local IDs and retains the existing birth-time guards', () => {
    expect(convert([snapshot(1200, 200, 900, 1100, 100), snapshot(1201, 200, 900, 1100, 100)])).toBeNull();
    const rows = convert([snapshot(1200, 200, 900, 1100, 100, 'node', 2000)]);
    expect(descendants(rows!, root)).toEqual([]);
  });

  it('retains reused root identity even when its parent is missing, protecting its new children', () => {
    // Both new processes are within the old engine's one-second exit grace. Only the reuser cutoff protects them.
    const rows = convert([snapshot(1100, 100, 1999, 1100, 100, 'node', 1520), snapshot(1201, 201, 1100, 1100, 100, 'node', 1530)]);
    expect(rows?.find(p => p.pid === 100)).toMatchObject({ ppid: 100, created: 15200 });
    expect(descendants(rows!, root)).toEqual([]);
  });

  it('parses comm containing parentheses and spaces without shifting the birth-time fields', () => {
    const row = snapshot(1200, 200, 900, 1100, 100, 'a (user) program');
    delete row.executable;
    expect(convert([row])?.at(-1)).toEqual({ pid: 200, ppid: 100, created: 12000, name: 'a (user) program' });
  });
});
