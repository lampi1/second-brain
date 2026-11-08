// Adapter transport milestone routing. Default instrumentation stays in main; the utility sends exact epoch times.
// Only controlled replay installs a forwarder; no prompt, key or payload is retained.
import { percentiles, runtimePerformance } from '../runtime-performance';

let forward: ((chatId: string, at: number) => void) | null = null;
export function setTransportTimingForwarder(value: typeof forward): void { forward = value; }
export function providerWrite(chatId: string): void {
  if (forward) forward(chatId, Date.now());
  else runtimePerformance.providerWrite(chatId);
}

const hostTimes = new Map<string, number[]>();
const hostTextTimes = new Map<string, number[]>();
let retained = 0;
export function resetHostTransportTimes(): void { hostTimes.clear(); hostTextTimes.clear(); retained = 0; }
export function receiveHostTextTime(chatId: string, at: number): void {
  if (process.env.SB_TEST !== '1' || process.env.SB_RUNTIME_PERF !== '1' || !Number.isFinite(at) || retained++ >= 4096) return;
  const times = hostTextTimes.get(chatId) ?? [];
  times.push(at); hostTextTimes.set(chatId, times);
}
export function receiveHostTransportTime(chatId: string, at: number): void {
  if (process.env.SB_TEST !== '1' || process.env.SB_RUNTIME_PERF !== '1' || !Number.isFinite(at)) return;
  runtimePerformance.providerWrite(chatId);
  if (retained++ >= 4096) return;
  const times = hostTimes.get(chatId) ?? [];
  times.push(at); hostTimes.set(chatId, times);
}

/** Recorder bookkeeping uses receipt ordering; exported latency uses the original host transport timestamp. */
export function withHostTransportTimes(snapshot: ReturnType<typeof runtimePerformance.snapshot>): ReturnType<typeof runtimePerformance.snapshot> {
  if (process.env.SB_AGENT_RUNTIME_HOST !== '1') return snapshot;
  for (const row of snapshot.rows) {
    const times = hostTimes.get(row.chatId) ?? [];
    const at = times.find(value => value >= (row.marks.runtime ?? Infinity) && value <= (row.marks.firstText ?? -Infinity));
    if (at === undefined) row.invalid = 'incomplete';
    else {
      row.marks.providerWrite = at;
      const textAt = hostTextTimes.get(row.chatId)?.find(value => value >= at && value <= (row.marks.firstText ?? -Infinity));
      if (textAt === undefined) row.invalid = 'incomplete';
      else row.marks.firstText = textAt;
    }
  }
  for (const group of snapshot.groups) {
    const rows = snapshot.rows.filter(row => !row.invalid && `${row.engine}/${row.temperature}` === group.key);
    group.sendToProviderWriteMs = percentiles(rows.flatMap(row => row.marks.providerWrite === undefined ? [] : [row.marks.providerWrite - row.uiAt]));
    group.sendToFirstTextMs = percentiles(rows.flatMap(row => row.marks.firstText === undefined ? [] : [row.marks.firstText - row.uiAt]));
    group.firstTextToIpcMs = percentiles(rows.flatMap(row => row.marks.firstText === undefined || row.marks.firstTextIpc === undefined ? [] : [row.marks.firstTextIpc - row.marks.firstText]));
    group.coldSessionToFirstTextMs = percentiles(rows.flatMap(row => row.marks.firstText === undefined || row.sessionCreatedAt === undefined ? [] : [row.marks.firstText - row.sessionCreatedAt]));
  }
  return snapshot;
}
