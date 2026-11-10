// Credential broker tests: pinned endpoint/headers, bounded pull streams and no key in serialized launches/replies.
import { expect, it, vi } from 'vitest';
import { RuntimeBroker, wireAdapter } from '../../src/main/agent-runtime/broker';
import type { PreparedAdapter } from '../../src/main/agent-runtime/adapter-contract';

function fixture(chunks = ['ab', 'a']) {
  const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } })));
  const launch: PreparedAdapter = { kind: 'api', options: { chatId: 'chat', cwd: '.', engineId: 'api',
    protocol: 'openai', baseUrl: 'https://provider.example/v1', apiKey: () => 'aba', historyFile: 'unused.json', fetchImpl } };
  return { broker: new RuntimeBroker(launch), launch, fetchImpl };
}

it('strips known callbacks and never serializes API keys', () => {
  const f = fixture();
  const wire = wireAdapter(f.launch);
  expect(wire.options).not.toHaveProperty('apiKey');
  expect(wire.options).not.toHaveProperty('fetchImpl');
  expect(JSON.stringify(wire)).not.toContain('aba');
});

it('rejects unknown function-valued launch options instead of silently dropping them', () => {
  const f = fixture();
  Object.assign(f.launch.options, { futurePermissionHook() {} });
  expect(() => wireAdapter(f.launch)).toThrow();
});

it('pins the HTTP destination and authorization in main and redacts a key split between chunks', async () => {
  const f = fixture();
  await f.broker.call({ method: 'open', input: { id: 'r', body: '{}' } });
  let text = '';
  for (;;) {
    const result = await f.broker.call({ method: 'read', input: 'r' }) as { done: boolean; text: string };
    text += result.text;
    if (result.done) break;
  }
  expect(text).toBe('***');
  expect(f.fetchImpl).toHaveBeenCalledWith('https://provider.example/v1/chat/completions', expect.objectContaining({
    redirect: 'error', headers: expect.objectContaining({ authorization: 'Bearer aba' }),
  }));
  f.broker.dispose();
});

it('refuses callbacks after the generation is closed', async () => {
  const f = fixture(); f.broker.dispose();
  await expect(f.broker.call({ method: 'open', input: { id: 'r', body: '{}' } })).rejects.toThrow('closed');
  expect(f.fetchImpl).not.toHaveBeenCalled();
});

it('a brief or pre-tool check that throws on main is answered by the broker, never a failed broker call', async () => {
  const launch = { kind: 'claude', options: { chatId: 'chat', cwd: '.', sessionId: 'abc12345',
    briefReady: async () => { throw new Error('brief store unreadable'); },
    preToolUse: { decide: async () => { throw new Error('budget file unreadable'); }, turnEnded: () => {} } } } as unknown as PreparedAdapter;
  const broker = new RuntimeBroker(launch);
  await expect(broker.call({ method: 'brief', input: undefined })).resolves.toBe(true); // shown, as with no brief check
  await expect(broker.call({ method: 'decide', input: { tool: 'Bash', input: {} } })).resolves.toBeNull(); // goes on, as in-process
});

it('carries the brief\'s option map across the broker (#378); a failing lookup only means no map', async () => {
  const map = { yes: 'Approve Plan', no: 'Request Changes' };
  const launch: PreparedAdapter = { kind: 'claude', options: { chatId: 'chat', cwd: '.', briefOptions: () => map } };
  expect(wireAdapter(launch).callbacks).toMatchObject({ briefOptions: true });
  expect(wireAdapter(launch).options).not.toHaveProperty('briefOptions');
  await expect(new RuntimeBroker(launch).call({ method: 'briefOptions', input: undefined })).resolves.toEqual(map);
  const failing: PreparedAdapter = { kind: 'claude', options: { chatId: 'chat', cwd: '.', briefOptions: () => { throw new Error('store gone'); } } };
  await expect(new RuntimeBroker(failing).call({ method: 'briefOptions', input: undefined })).resolves.toBeNull();
});
