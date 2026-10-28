// Task read retries remain read-only, bounded and quiet; fake time verifies backoff, shutdown and unchanged UTF-8 labels.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskService } from '../../src/main/tasks/service';
import { log } from '../../src/main/log';
const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
function setup() {
  vi.useFakeTimers(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-retry-')); dirs.push(dir);
  let root = dir;
  const ok = { stdout: JSON.stringify({ news: [], assigned: [], prs: [] }), stderr: '', code: 0 };
  const run = vi.fn(async () => ok), emit = vi.fn(), feed = vi.fn(), warning = vi.spyOn(log, 'warn').mockImplementation(() => {});
  const service = new TaskService({ file: path.join(dir, 'tasks.json'), brainRoot: () => root, settings: () => ({ enabled: false, sound: false, everyMin: 30 }), locate: () => 'reader.mjs', locateQa: () => null, run, emit, feed });
  return { service, run, emit, feed, warning, ok, changeBrain: () => { root += '-other'; } };
}
it.each(['ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'])('recovers from %s with backoff without a bug warning', async code => {
  const s = setup(); s.run.mockResolvedValueOnce({ stdout: '', stderr: code, code: 1 });
  const pending = s.service.refresh(); await vi.advanceTimersByTimeAsync(999); expect(s.run).toHaveBeenCalledTimes(1); expect(s.service.get().error).toBeNull();
  await vi.advanceTimersByTimeAsync(1); expect((await pending).error).toBeNull(); expect(s.run).toHaveBeenCalledTimes(3); expect(s.warning).not.toHaveBeenCalled(); expect(s.feed).not.toHaveBeenCalled(); s.service.shutdown();
});
it('fails only after three attempts with increasing backoff and one warning', async () => {
  const s = setup(); s.run.mockResolvedValue({ stdout: '', stderr: 'ECONNRESET', code: 1 }); const pending = s.service.refresh();
  await vi.advanceTimersByTimeAsync(1000); expect(s.run).toHaveBeenCalledTimes(2); expect(s.service.get().error).toBeNull();
  await vi.advanceTimersByTimeAsync(2999); expect(s.run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect((await pending).error?.message).toContain('Lettura delle novità'); expect(s.run).toHaveBeenCalledTimes(3); expect(s.warning).toHaveBeenCalledTimes(1); s.service.shutdown();
});
it.each(['AADSTS700082', 'HTTP 403', 'Malformed JSON'])('does not retry a permanent failure: %s', async stderr => {
  const s = setup(); s.run.mockResolvedValue({ stdout: '', stderr, code: 1 }); await s.service.refresh(); expect(s.run).toHaveBeenCalledTimes(1); expect(s.warning).toHaveBeenCalledTimes(1); s.service.shutdown();
});
it.each(['shutdown', 'brain-change'])('stops retries on %s without applying an obsolete result', async reason => {
  const s = setup(); s.run.mockResolvedValue({ stdout: '', stderr: 'ECONNRESET', code: 1 }); const pending = s.service.refresh(); await vi.advanceTimersByTimeAsync(0);
  if (reason === 'shutdown') s.service.shutdown(); else s.changeBrain();
  await vi.advanceTimersByTimeAsync(4000); await pending; expect(s.run).toHaveBeenCalledTimes(1); expect(s.service.get().at).toBeNull(); expect(s.warning).not.toHaveBeenCalled(); s.service.shutdown();
});
it('retries the PR read independently and does not publish partial news', async () => {
  const s = setup(); s.run.mockResolvedValueOnce(s.ok).mockResolvedValueOnce({ stdout: '', stderr: 'UND_ERR_CONNECT_TIMEOUT', code: 1 }).mockResolvedValue(s.ok);
  const pending = s.service.refresh(); await vi.advanceTimersByTimeAsync(0); expect(s.service.get().at).toBeNull(); await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).at).not.toBeNull(); expect(s.run).toHaveBeenCalledTimes(3); s.service.shutdown();
});
