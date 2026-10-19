// Renderer deadline bridge keeps newer events over a late initial snapshot, and counts down with local monotonic time.
import { expect, it, vi } from 'vitest';
import { autoCloseRemaining, autoCloseState, autoCloseProblem, connectAutoClose,reportAutoClosePresence } from '../../src/renderer/store/auto-close';
import type { AutoCloseStatus } from '../../src/shared/auto-close';

it('never lets an old get response overwrite a keep-open event', async () => {
  let accept: (rows: AutoCloseStatus[]) => void = () => {};
  let resolve: (rows: AutoCloseStatus[]) => void = () => {};
  const row: AutoCloseStatus = { chatId: 'a', deadline: 10_000, clockAt: 1_000, warningStartedAt: null, generation: 1, keptOpen: false, reason: null };
  const off = connectAutoClose({ get: () => new Promise(r => { resolve = r; }), presence: async () => {}, keep: async () => {}, listen: f => { accept = f; return () => {}; } });
  accept([{ ...row, deadline: null, generation: 2, keptOpen: true }]); resolve([row]); await Promise.resolve();
  expect(autoCloseState.get()[0]?.keptOpen).toBe(true); off();
});
it('handles malformed startup data without inventing empty status or authorizing closure',async()=>{
  const row:AutoCloseStatus={chatId:'a',deadline:121000,clockAt:1000,warningStartedAt:1000,generation:1,keptOpen:false,reason:null};
  autoCloseState.set([row]);const presence=vi.fn(async()=>{});
  const off=connectAutoClose({get:async()=>null as unknown as AutoCloseStatus[],presence,keep:async()=>{},listen:()=>()=>{}});
  await Promise.resolve();await Promise.resolve();
  expect(autoCloseState.get()).toEqual([row]);expect(autoCloseProblem.get()).toContain('sospesa');
  reportAutoClosePresence([{chatId:'a',draft:false,shown:false,browser:false,queued:0,touchedAt:0,ackDeadline:121000,ackGeneration:1}]);
  expect(presence).toHaveBeenLastCalledWith([{chatId:'a',draft:false,shown:true,browser:false,queued:0,touchedAt:0}]);off();
});
it('reports rejected startup reads and accepts a later valid recovery event',async()=>{
  let event!:(rows:AutoCloseStatus[])=>void;
  const off=connectAutoClose({get:async()=>{throw Error('unavailable');},presence:async()=>{},keep:async()=>{},listen:accept=>{event=accept;return()=>{};}});
  await Promise.resolve();await Promise.resolve();expect(autoCloseProblem.get()).toContain('sospesa');event([]);expect(autoCloseProblem.get()).toBeNull();off();
});
it('uses elapsed performance time rather than the mutable wall clock for the displayed countdown', async () => {
  let mono = 10;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => mono);
  const row: AutoCloseStatus = { chatId: 'a', deadline: 121_000, clockAt: 1_000, warningStartedAt: 1_000, generation: 1, keptOpen: false, reason: null };
  const off = connectAutoClose({ get: async () => [row], presence: async () => {}, keep: async () => {}, listen: () => () => {} });
  try { await Promise.resolve(); mono += 5_000; expect(autoCloseRemaining(autoCloseState.get()[0]!)).toBe(115_000); }
  finally { off(); spy.mockRestore(); }
});
it('accepts a known waiting label and refuses an unknown one (ADR 0084)', async () => {
  let event!: (rows: AutoCloseStatus[]) => void;
  const off = connectAutoClose({ get: async () => [], presence: async () => {}, keep: async () => {}, listen: accept => { event = accept; return () => {}; } });
  await Promise.resolve(); await Promise.resolve();
  const row: AutoCloseStatus = { chatId: 'a', deadline: null, clockAt: 1, warningStartedAt: null, generation: 1, keptOpen: false, reason: 'In attesa dei colleghi', waitingFor: 'colleagues' };
  event([row]); expect(autoCloseState.get()[0]?.waitingFor).toBe('colleagues'); expect(autoCloseProblem.get()).toBeNull();
  event([{ ...row, waitingFor: 'nonsense' as never }]); expect(autoCloseProblem.get()).toContain('sospesa');
  off();
});
