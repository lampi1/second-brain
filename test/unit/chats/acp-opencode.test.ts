// AcpSession as OpenCode (`opencode acp`, ADR 0216) against the fake ACP agent in its OpenCode shape
// (test/fixtures/fake-cursor-acp.mjs, FAKE_ACP_OPENCODE=1): the model and the mode are config options, set on the session
// after every open; without modelOption the same answers give no model choice. No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import type { AcpSession } from '../../../src/main/chats/acp';
import { permissionView, streamErrorOf, streamRetryOf } from '../../../src/main/chats/acp';

const open: AcpSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });
describe('AcpSession as OpenCode (modelOption, ADR 0216)', () => {
  it('a Cursor MCP permission whose content is a ```json block shows its arguments, never the fences (real run 2026-10-31)', () => {
    const text = (t: string) => [{ type: 'content', content: { type: 'text', text: t } }];
    const title = 'Second-brain-agent_catalog: agent_catalog';
    expect(permissionView({ title, content: text('```json\n{}\n```') }, undefined, 'Tool').detail).toBe('');
    expect(permissionView({ title, content: text('```json\n{\n  "query": "acp cancel",\n  "limit": 5\n}\n```') }, undefined, 'Tool').detail).toBe('query: acp cancel\nlimit: 5');
    const mixed = permissionView({ title, content: text('Reads two files\n```\nmarker.txt\nnotes.md\n```') }, undefined, 'Tool').detail;
    expect(mixed).toBe('Reads two files\nmarker.txt\nnotes.md');
    expect(permissionView({ title, content: text('```json\n[1, 2]\n```') }, undefined, 'Tool').detail).toBe('[1,2]');
  });

  it('a fenced payload never hides or merges what will run: multi-line commands, inline, nested and unclosed fences', () => {
    const text = (t: string) => [{ type: 'content', content: { type: 'text', text: t } }];
    const view = (t: string) => permissionView({ title: 'Shell', content: text(t) }, undefined, 'Tool').detail;
    expect(view('```json\n{"command":"git status\\ngit push --force"}\n```')).toBe('command: git status\ngit push --force');
    expect(view('Run ```rm -rf /tmp/x```')).toBe('Run\nrm -rf /tmp/x');
    expect(view('```whoami```')).toBe('whoami');
    expect(view('````md\nPlan\n```json\n{"limit": 5}\n```\n````')).toBe('Plan\nlimit: 5');
    expect(view('```json\n{"query": "x"')).toBe('{"query": "x"');
    // an unclosed fence or a first line that is no language never hides a word of what runs
    expect(view('```reboot')).toBe('reboot');
    expect(view('Esegui:\n```shutdown\n')).toBe('Esegui:\nshutdown');
    expect(view('```whoami\nrm -rf /\n```')).toBe('whoami\nrm -rf /');
    expect(view('```bash\nrm -rf /\n```')).toBe('rm -rf /');
    expect(view('```python')).toBe('python');
  });

  it('a multi-line command keeps one line per command in the panel, never one flattened line', () => {
    const v = permissionView({ title: 'bash', rawInput: { command: 'git status\r\ngit push   --force origin main', description: 'two steps' } }, undefined, 'Execute');
    expect(v.detail.split('\n').slice(0, 2)).toEqual(['git status', 'git push --force origin main']);
    expect(v.detail).toContain('description: two steps');
  });

  it('streamErrorOf reads only the running session\'s main stream errors', () => {
    const line = (extra: string) => `timestamp=2026-11-01T10:18:29.000Z level=ERROR run=x message="stream error" providerID=opencode modelID=m session.id=ses_a ${extra}`;
    expect(streamErrorOf(line('small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached."'), 'ses_a')).toMatchObject({ error: 'Free usage limit reached.', credits: true, final: false });
    expect(streamErrorOf(line('small=false agent=build error.error="AI_APICallError: Bad \\"gateway\\""'), 'ses_a')).toMatchObject({ error: 'Bad "gateway"', credits: false });
    expect(streamErrorOf(line('small=false error.error="insufficient_quota: You exceeded your current quota"'), 'ses_a')?.credits).toBe(true);
    expect(streamErrorOf(line('small=false error.error="AI_APICallError: The usage limit has been reached"'), 'ses_a')?.credits).toBe(true);
    // a per-minute rate limit worded as quota and billing (Gemini free) is retried by OpenCode: not out of credits
    expect(streamErrorOf(line('small=false error.error="AI_APICallError: You exceeded your current quota, please check your plan and billing details."'), 'ses_a')?.credits).toBe(false);
    // OpenCode's give-up after its retries (real log 2026-11-01 08:46)
    const gaveUp = 'timestamp=2026-11-01T08:46:04.930Z level=ERROR run=x message=process session.id=ses_a messageID=msg_1 error="The usage limit has been reached" stack="AI_APICallError: x"';
    expect(streamErrorOf(gaveUp, 'ses_a')).toEqual({ error: 'The usage limit has been reached', credits: true, final: true });
    expect(streamRetryOf('timestamp=t level=INFO run=x message=stream providerID=openai session.id=ses_a small=false agent=build', 'ses_a')).toBe(true);
    expect(streamRetryOf('timestamp=t level=INFO run=x message=stream providerID=openai session.id=ses_a small=true agent=title', 'ses_a')).toBe(false);
    expect(streamErrorOf(line('small=true agent=title error.error="AI_RetryError: x"'), 'ses_a')).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"'), 'ses_b')).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"'), null)).toBeNull();
    expect(streamErrorOf(line('small=false error.error="x"').replace('level=ERROR', 'level=WARN'), 'ses_a')).toBeNull();
  });

});
