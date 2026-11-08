// Test-only preload for correction-catch-hook.test.ts: control AbortSignal.timeout in the real hook subprocess.
// The real HTTP/MCP exchange stays intact; IPC advances virtual deadlines without racing the machine's load.
let now = 0;
const deadlines = [];
AbortSignal.timeout = ms => {
  const controller = new AbortController();
  deadlines.push({ at: now + ms, controller });
  process.send?.({ clock: 'armed', ms });
  return controller.signal;
};
process.on('message', message => {
  if (message?.clock !== 'advance' || typeof message.ms !== 'number') return;
  now += message.ms;
  let expired = 0;
  for (const deadline of deadlines) {
    if (deadline.at <= now && !deadline.controller.signal.aborted) {
      deadline.controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      expired++;
    }
  }
  process.send?.({ clock: 'advanced', expired });
});
// IPC is only a test clock, not a reason to keep a completed hook alive.
process.channel?.unref();
