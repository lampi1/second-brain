// Claude start/turn latency bench: spawns the Claude engine the way the app does (stream-json in/out, partial messages,
// stdio permission prompts) and measures spawn → initialize reply → system/init → message_start → first text token →
// result, for the first turn of a new chat and for a follow-up on the same process; or the plain `claude -p` one-shot
// from a terminal (--plain) as the baseline. Why: "a parità di modello ed effort, Claude Code desktop risponde più
// veloce della nostra app" (owner, 2026-10-13): numbers first. Who: agents tuning the Claude harness (claude.ts).
// SPENDS REAL TOKENS (one tiny prompt per turn): keep --reps low. User hooks are off by default (they write to the
// user's chat feed); --hooks keeps them.
//   node scripts/bench-claude-start.mjs [--reps 2] [--plain] [--engine <exe>] [--cwd <dir>] [--hooks]
//        [--env K=V ...] [--args "<extra cli args>"] [--followups 1] [--warm-first [--warm-wait ms] [--model m] [--effort e] [--mode p]] [--json]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const all = n => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reps = Number(val('--reps', '2'));
const followups = Number(val('--followups', '1'));
const cwd = val('--cwd', root);
const engine = val('--engine', flag('--plain') ? 'claude' : path.join(root, `node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`));
const extra = (val('--args', '') || '').split(' ').filter(Boolean);
const settings = flag('--hooks') ? [] : ['--settings', JSON.stringify({ disableAllHooks: true })];
const env = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
for (const kv of all('--env')) { const i = kv.indexOf('='); env[kv.slice(0, i)] = kv.slice(i + 1); }
delete env.CLAUDECODE; // a nested run must not think it runs inside this session
/** the app's choices for an adopted warm process: --model x --effort y --title t → control requests */
const warmControls = () => [
  ...(val('--model') ? [{ subtype: 'set_model', model: val('--model') }] : []),
  ...(val('--effort') ? [{ subtype: 'apply_flag_settings', settings: { effortLevel: val('--effort') } }] : []),
  ...(val('--mode') ? [{ subtype: 'set_permission_mode', mode: val('--mode') }] : []),
];
const PROMPT = 'Reply with the single word: ok';

function run() {
  return new Promise(resolve => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const plain = flag('--plain');
    const args = plain
      ? ['-p', PROMPT, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...settings, ...extra]
      : ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages',
        '--permission-prompt-tool', 'stdio', ...settings, ...extra];
    const p = spawn(engine, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const turns = [];
    let cur = null, initResp = null, sysInit = null, buf = '', left = followups;
    const send = () => {
      cur = { sent: ms() };
      turns.push(cur);
      p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: PROMPT }] }, parent_tool_use_id: null, session_id: '' })}\n`);
    };
    if (plain) cur = (turns.push({ sent: 0 }), turns[0]);
    else {
      p.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'init1', request: { subtype: 'initialize', hooks: null } })}\n`);
      if (!flag('--warm-first')) send(); // like "Nuova chat" with a prompt: the message is written right after spawn
    }
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'control_response' && m.response?.request_id === 'init1') {
          initResp = ms();
          // --warm-first: the "Nuova chat" click comes later on a process already up; its choices go as control requests
          if (flag('--warm-first') && !cur) setTimeout(() => {
            for (const [i, r] of warmControls().entries()) p.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: `w${i}`, request: r })}
`);
            send();
          }, Number(val('--warm-wait', '0')));
        } else if (m.type === 'control_response' && String(m.response?.request_id).startsWith('w') && m.response.subtype === 'error') console.log('control refused', m.response.error);
        else if (m.type === 'system' && m.subtype === 'init' && sysInit === null) sysInit = { at: ms(), mcp: (m.mcp_servers ?? []).map(s => `${s.name}:${s.status}`) };
        else if (m.type === 'stream_event' && cur) {
          const e = m.event ?? {};
          if (e.type === 'message_start' && cur.msgStart === undefined) cur.msgStart = ms();
          if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && cur.firstText === undefined) cur.firstText = ms();
        } else if (m.type === 'result' && cur) {
          cur.result = ms(); cur.apiMs = m.duration_api_ms; cur.durMs = m.duration_ms; cur.cost = m.total_cost_usd;
          cur.cacheRead = m.usage?.cache_read_input_tokens; cur.cacheWrite = m.usage?.cache_creation_input_tokens;
          if (!plain && left-- > 0) send(); else { cur = null; p.stdin.end(); }
        }
      }
    });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, exit: ms(), initResp, sysInit, turns, err: err.slice(-300) }));
  });
}

const out = [];
for (let i = 0; i < reps; i++) out.push(await run());
if (flag('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
for (const r of out) {
  console.log(`init-reply ${r.initResp ?? '-'}  system/init ${r.sysInit?.at ?? '-'}  exit ${r.exit}  mcp [${r.sysInit?.mcp.join(' ') ?? ''}]${r.code ? ` code ${r.code} ${r.err}` : ''}`);
  for (const [k, t] of r.turns.entries()) {
    const rel = x => (x === undefined ? '-' : x - t.sent);
    console.log(`  turn ${k}: sent@${t.sent} → msg_start +${rel(t.msgStart)} first_text +${rel(t.firstText)} result +${rel(t.result)} (api ${t.apiMs} cli ${t.durMs} cacheR ${t.cacheRead} cacheW ${t.cacheWrite})`);
  }
}
