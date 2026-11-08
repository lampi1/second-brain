// Record mode of the engines' wire (src/main/chats/wire-record.ts, ADR 0221): off without SB_WIRE_RECORD_DIR; on, it
// writes both directions as NDJSON in order, line by line across chunks; secrets (keys named like credentials,
// key/JWT/bearer-shaped values, the app's MCP urls) and the user's prompt text never reach the file unless the user
// keeps prompts (SB_WIRE_RECORD_PROMPTS=1).
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { readWire, recordWire, redactLine, wireRecordDir } from '../../../src/main/chats/wire-record';
import { tmp } from './helpers';

/** a child's two pipes, enough for recordWire: stdin.write and stdout 'data' */
function child() {
  const written: string[] = [];
  const stdout = new EventEmitter();
  const stdin = { write: (chunk: string) => { written.push(chunk); return true; } };
  return { p: { stdin, stdout } as never, stdout, stdin: stdin as { write: (c: string) => boolean }, written };
}
// built at run time, so no secret-shaped literal sits in the repo (guard)
const KEY = ['sk', 'ant', 'api03', 'A'.repeat(24)].join('-');
const JWT = ['eyJ' + 'h'.repeat(10), 'p'.repeat(12), 's'.repeat(12)].join('.');

describe('wire record', () => {
  it('is off unless SB_WIRE_RECORD_DIR is set', () => {
    expect(wireRecordDir({})).toBeNull();
    expect(wireRecordDir({ SB_WIRE_RECORD_DIR: '  ' })).toBeNull();
    const c = child();
    expect(recordWire(c.p, { engine: 'codex', chatId: 'c1' }, {})).toBeNull();
  });

  it('records both directions in order, a line split over chunks once, and leaves the pipes working', () => {
    const dir = tmp('wire');
    const c = child();
    const file = recordWire(c.p, { engine: 'cursor', chatId: 'c/1' }, { SB_WIRE_RECORD_DIR: dir })!;
    expect(path.dirname(file)).toBe(path.join(dir, 'cursor'));
    expect(path.basename(file)).toMatch(/^c_1-[a-z0-9]+\.ndjson$/);
    c.stdin.write('{"id":1,"method":"initialize"}\n');
    c.stdout.emit('data', '{"id":1,"res');
    c.stdout.emit('data', 'ult":{}}\n{"method":"x"}\n');
    expect(c.written).toEqual(['{"id":1,"method":"initialize"}\n']);
    const e = readWire(file);
    expect(e.map(x => [x.seq, x.dir, x.line])).toEqual([
      [0, 'app>engine', '{"id":1,"method":"initialize"}'],
      [1, 'engine>app', '{"id":1,"result":{}}'],
      [2, 'engine>app', '{"method":"x"}'],
    ]);
    expect(new Set(e.map(x => x.run)).size).toBe(1);
  });

  it('redacts credentials, MCP urls and prompt text', () => {
    const out = (o: unknown, dir: 'app>engine' | 'engine>app' = 'app>engine', prompts = false) => redactLine(JSON.stringify(o), { prompts, dir });
    const auth = out({ method: 'authenticate', params: { apiKey: 'abc', headers: { Authorization: `Bearer ${KEY}` }, note: `use ${KEY} or ${JWT}` } });
    expect(auth).not.toContain(KEY);
    expect(auth).not.toContain(JWT);
    expect(JSON.parse(auth).params.apiKey).toBe('<redacted>');
    const mcp = out({ method: 'session/new', params: { mcpServers: [{ url: 'http://127.0.0.1:4567/mcp/browser/0123456789abcdef' }] } });
    expect(mcp).toContain('http://127.0.0.1:4567/mcp/<redacted>');
    expect(mcp).not.toContain('0123456789abcdef');
    // Claude's user message, ACP's prompt, Codex's turn input: the words go, their length stays
    expect(JSON.parse(out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'il mio segreto' }] } })).message.content[0].text).toBe('<prompt 14 chars>');
    expect(JSON.parse(out({ type: 'user', message: { role: 'user', content: 'ciao' } })).message.content).toBe('<prompt 4 chars>');
    expect(JSON.parse(out({ method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'ciao' }] } })).params.prompt[0].text).toBe('<prompt 4 chars>');
    expect(JSON.parse(out({ method: 'turn/start', params: { input: [{ type: 'text', text: 'ciao' }] } })).params.input[0].text).toBe('<prompt 4 chars>');
    // what the engine says is kept (it is what the replay plays back), and prompts when the user keeps them
    expect(JSON.parse(out({ method: 'session/update', params: { content: [{ text: 'risposta' }] } }, 'engine>app')).params.content[0].text).toBe('risposta');
    expect(JSON.parse(out({ method: 'session/prompt', params: { prompt: [{ text: 'ciao' }] } }, 'app>engine', true)).params.prompt[0].text).toBe('ciao');
    // the user's words echoed back by the engine go too: Codex's thread/resume and live userMessage, ACP's session/load
    // replay, Claude's user echo; a tool result inside a user message is the tool's, kept
    const resume = JSON.parse(out({ id: 2, result: { thread: { turns: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: 'il mio segreto' }] }, { type: 'agentMessage', text: 'ok' }] }] } } }, 'engine>app'));
    expect(resume.result.thread.turns[0].items[0].content[0].text).toBe('<prompt 14 chars>');
    expect(resume.result.thread.turns[0].items[1].text).toBe('ok');
    // the Codex thread's preview is the user's first message; an empty one and an option's preview elsewhere stay
    expect(JSON.parse(out({ id: 2, result: { thread: { preview: 'il mio segreto', turns: [] } } }, 'engine>app')).result.thread.preview).toBe('<prompt 14 chars>');
    expect(JSON.parse(out({ id: 2, result: { thread: { preview: '', turns: [] } } }, 'engine>app')).result.thread.preview).toBe('');
    expect(JSON.parse(out({ id: 2, result: { thread: { preview: 'ciao', turns: [] } } }, 'engine>app', true)).result.thread.preview).toBe('ciao');
    expect(JSON.parse(out({ type: 'assistant', options: [{ label: 'A', preview: 'codice' }] }, 'engine>app')).options[0].preview).toBe('codice');
    expect(JSON.parse(out({ method: 'item/started', params: { item: { type: 'userMessage', content: [{ type: 'text', text: 'ciao' }] } } }, 'engine>app')).params.item.content[0].text).toBe('<prompt 4 chars>');
    expect(JSON.parse(out({ method: 'session/update', params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'ciao' } } } }, 'engine>app')).params.update.content.text).toBe('<prompt 4 chars>');
    expect(JSON.parse(out({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'risposta' } } } }, 'engine>app')).params.update.content.text).toBe('risposta');
    const echo = JSON.parse(out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'ciao' }, { type: 'tool_result', content: [{ type: 'text', text: 'output' }] }] } }, 'engine>app'));
    expect(echo.message.content[0].text).toBe('<prompt 4 chars>');
    expect(echo.message.content[1].content[0].text).toBe('output');
    expect(JSON.parse(out({ method: 'item/started', params: { item: { type: 'userMessage', content: [{ type: 'text', text: 'ciao' }] } } }, 'engine>app', true)).params.item.content[0].text).toBe('ciao');
    expect(redactLine(`not json ${KEY}`, { prompts: false, dir: 'engine>app' })).toBe('not json <redacted>');
  });

  it('writes nothing secret to the file', () => {
    const dir = tmp('wire');
    const c = child();
    const file = recordWire(c.p, { engine: 'codex', chatId: 'c2' }, { SB_WIRE_RECORD_DIR: dir })!;
    c.stdin.write(`${JSON.stringify({ id: 2, method: 'turn/start', params: { input: [{ type: 'text', text: 'parola' }], token: KEY } })}\n`);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('parola');
  });
});
