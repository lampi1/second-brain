// Read the running instance's timer inventory through its existing read-only app_state tool.
// Used by doctor; old/offline instances are reported as unavailable, never as an empty healthy registry.
import http from 'node:http';

export function readTimers(port) {
  return new Promise(resolve => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'app_state', arguments: {} } });
    const request = http.request({ host: '127.0.0.1', port, path: '/mcp/app', method: 'POST', timeout: 2000,
      headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; if (text.length > 2_000_000) request.destroy(); });
      response.on('error', () => resolve(null));
      response.on('end', () => {
        try {
          const result = JSON.parse(text).result;
          const state = result?.structuredContent ?? JSON.parse(result?.content?.find(c => c.type === 'text')?.text ?? 'null');
          resolve(Array.isArray(state?.timers) ? state.timers : null);
        } catch { resolve(null); }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.end(body);
  });
}

export function timerCheck(timers) {
  return timers === null
    ? { id: 'timers', ok: true, level: 'info', detail: 'Timer inventory unavailable (offline or older app)', hint: '' }
    : { id: 'timers', ok: true, level: 'info', detail: `${timers.length} active periodic/scheduled timers: ${timers.map(t => `${t.owner} (${t.kind}, ${t.delayMs} ms, next ${new Date(t.nextAt).toISOString()})`).join('; ') || 'none'}`, hint: '', timers };
}
