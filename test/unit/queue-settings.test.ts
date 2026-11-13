// Settings → Avanzate «Coda e avvii» (components/QueueSettings.tsx, lib/queue-settings.ts, ADR 0222): the slot, CPU
// and RAM choices always hold the saved value inside the schema's range; the block shows the PC's cores and the
// automatic count, each row marked protected, and a pick goes through setSetting (settings:set).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { autoColdSlots } from '../../src/shared/cold-slots';
import { coldStartSlots } from '../../src/main/chats/admission';
import { cpuChoices, ramChoices, slotChoices } from '../../src/renderer/lib/queue-settings';

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: (select: (s: unknown) => unknown) => select(mock.state), setSetting: vi.fn() }));
import { QueueSettings } from '../../src/renderer/components/QueueSettings';

describe('queue settings choices', () => {
  it('automatic is half the cores, at least 1, the same number main uses', () => {
    expect([1, 2, 3, 14, 32].map(autoColdSlots)).toEqual([1, 1, 1, 7, 16]);
    expect(coldStartSlots(14)).toBe(autoColdSlots(14));
  });
  it('slots: automatic, then 1..cores (at most 16), plus a saved value outside them', () => {
    expect(slotChoices(4, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(slotChoices(32, 0)).toHaveLength(17);
    expect(slotChoices(4, 9)).toEqual([0, 1, 2, 3, 4, 9]);
    expect(slotChoices(0, 0)).toEqual([0, 1]);
  });
  it('CPU and RAM keep the saved value, clamped to the schema', () => {
    expect(cpuChoices(95)).toEqual([70, 80, 90, 95, 98, 100]);
    expect(cpuChoices(42)).toContain(42);
    expect(cpuChoices(5)).toContain(30);
    expect(ramChoices(10)).toEqual([0, 5, 10, 15, 20, 30]);
    expect(ramChoices(12)).toContain(12);
  });
});

describe('QueueSettings', () => {
  it('shows the cores, the automatic count and the brake values, each row protected', () => {
    mock.state = { info: { cores: 14 }, settings: { coldStartSlots: 0, loadQueueCpu: 95, loadQueueRam: 10 } };
    const html = renderToStaticMarkup(createElement(QueueSettings));
    expect(html).toContain('id="st-queue"');
    for (const s of ['Coda e avvii', 'Questo PC ha 14 core: in automatico partono 7 chat alla volta.', 'Automatico (7)', '95%', '10%']) expect(html).toContain(s);
    expect(html.match(/st-protected/g)).toHaveLength(3);
  });
  it('a set slot count and RAM off read as such; no core line before app:info', () => {
    mock.state = { info: null, settings: { coldStartSlots: 3, loadQueueCpu: 90, loadQueueRam: 0 } };
    const html = renderToStaticMarkup(createElement(QueueSettings));
    expect(html).not.toContain('Questo PC ha');
    for (const s of ['>3<', '90%', 'Non guardare la RAM']) expect(html).toContain(s);
  });
});
