// The top bar's PC load and connectors chip (ADR 0349): the CPU delta between two os.cpus() reads, the free RAM, the
// tones and GB text of SystemLoad.tsx, and the chip's count (an account never touched and a server off are not counted).
import { describe, expect, it } from 'vitest';
import { busyPct, cpuSnap, loadOf, systemLoadReader } from '../../src/main/system-load';
import { cpuTone, gb, ramTone } from '../../src/renderer/components/SystemLoad';
import { chipSummary } from '../../src/renderer/lib/mcp-servers';
import type { ConnectorState } from '../../src/shared/connectors';
import type { McpServerView } from '../../src/shared/mcp-servers';

const times = (busy: number, idle: number) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

describe('system load', () => {
  it('sums every core and measures the busy share between two reads', () => {
    expect(cpuSnap([times(10, 90), times(30, 70)])).toEqual({ busy: 40, total: 200 });
    expect(busyPct({ busy: 40, total: 200 }, { busy: 100, total: 300 })).toBe(60);
    expect(busyPct({ busy: 40, total: 200 }, { busy: 40, total: 200 })).toBeNull();
  });
  it('reads the CPU since the previous read and the free RAM', () => {
    const snaps = [{ busy: 0, total: 0 }, { busy: 25, total: 100 }, { busy: 125, total: 200 }];
    let i = 0;
    const read = systemLoadReader(() => snaps[Math.min(i++, snaps.length - 1)]!, () => ({ free: 4 * 1024 ** 3, total: 16 * 1024 ** 3 }));
    expect(read()).toEqual({ cpu: 25, freeRamBytes: 4 * 1024 ** 3, totalRamBytes: 16 * 1024 ** 3, freeRamPct: 25 });
    expect(read().cpu).toBe(100);
    expect(read().cpu).toBeNull(); // no time passed
    expect(loadOf(null, 0, 0).freeRamPct).toBe(0);
  });
  it('colours and formats the bar figures', () => {
    expect([cpuTone(null), cpuTone(50), cpuTone(70), cpuTone(95)]).toEqual(['none', 'green', 'amber', 'red']);
    expect([ramTone(50), ramTone(20), ramTone(8)]).toEqual(['green', 'amber', 'red']);
    expect(gb(12.34 * 1024 ** 3, 'it-IT')).toBe('12,3 GB');
    expect(gb(512 * 1024 ** 2, 'it-IT')).toBe('512 MB');
  });
});

describe('connectors chip', () => {
  const acc = (provider: ConnectorState['provider'], status: ConnectorState['status'], account: string | null = null): ConnectorState => ({ provider, status, checkedAt: null, account, projects: [], selected: [], detail: '' });
  const srv = (id: string, patch: Partial<McpServerView>): McpServerView => ({ id, label: id, transport: 'stdio', secrets: [], enabled: true, secretMasks: {}, ...patch } as McpServerView);
  it('counts what works of what is in use and flags what needs a fix', () => {
    const s = chipSummary([acc('github', 'verified', 'me'), acc('jira', 'pending'), acc('azure', 'failed', 'x')], [
      srv('a', { lastTest: { ok: true, tools: [] } as unknown as McpServerView['lastTest'] }),
      srv('b', { secretMasks: { 'env:TOKEN': null } }),
      srv('c', { enabled: false }),
      srv('d', {}),
    ]);
    expect(s).toEqual({ ok: 2, total: 5, bad: 2, tone: 'bad' });
  });
  it('a clean install shows no red', () => {
    expect(chipSummary([acc('github', 'pending'), acc('jira', 'pending')], [])).toEqual({ ok: 0, total: 0, bad: 0, tone: 'idle' });
  });
});

describe('the chip reads the servers without the keyring check', () => {
  it('views() never asks the cipher whether it works (macOS Keychain at start)', async () => {
    const { McpServersService } = await import('../../src/main/mcp-servers/service');
    const { McpServer } = await import('../../src/main/mcp/server');
    const { tmp } = await import('./chats/helpers');
    let asked = 0;
    const cipher = { unavailable: () => { asked++; return null; }, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
    const svc = new McpServersService({ userData: tmp('chip-svc'), cipher, mcp: new McpServer({ name: 't', version: '1' }), context: () => null, home: tmp('chip-home') });
    svc.save({ def: { id: 'docs', label: 'Docs', transport: 'stdio', command: 'node', args: [], secrets: [], enabled: true } });
    asked = 0;
    expect(svc.views().map(s => s.id)).toEqual(['docs']);
    expect(asked).toBe(0);
    svc.state();
    expect(asked).toBeGreaterThan(0);
  });
});
