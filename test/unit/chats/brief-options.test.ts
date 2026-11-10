// #378: a worker tool that records approval only from its own picker labels («Approve Plan» / «Request Changes») can
// ask with them when the brief maps them (yesOption / noOption): the user answers a Sì / No card, the engine gets its
// label back. Real adapter gates with an intercepted wire, no process.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpSession } from '../../../src/main/chats/acp';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { asYesNo, engineLabel, mappedYesNo } from '../../../src/shared/yes-no';
import { recSink } from './helpers';

type Packet = Record<string, unknown>;
interface ClaudeWire { onControlRequest(packet: Packet): Promise<void>; write(packet: unknown): void; answer: ClaudeSession['answer'] }
interface AcpWire { onAgentRequest(id: string, method: string, packet: Packet): Promise<void>; write(packet: unknown): void; answer: AcpSession['answer'] }
const Q = 'Approvi il piano del modulo Ordini?';
const MAP = { yes: 'Approve Plan', no: 'Request Changes' };

afterEach(() => { vi.restoreAllMocks(); });

describe('the option map', () => {
  it('matches only one short single-choice question with exactly the two declared labels', () => {
    const q = (labels: string[], extra = {}) => [{ question: Q, options: labels.map(label => ({ label })), ...extra }];
    expect(mappedYesNo(q(['Request Changes', 'Approve Plan']), MAP)).toEqual(MAP);
    expect(mappedYesNo(q(['Approve Plan', 'Reject']), MAP)).toBeNull();
    expect(mappedYesNo(q(['Approve Plan', 'Request Changes'], { multiSelect: true }), MAP)).toBeNull();
    expect(mappedYesNo(q(['Approve Plan', 'Request Changes']), null)).toBeNull();
    expect(mappedYesNo([...q(['Approve Plan', 'Request Changes']), ...q(['Approve Plan', 'Request Changes'])], MAP)).toBeNull();
    expect(mappedYesNo(q(['Approve Plan', 'Request Changes']), { yes: 'X', no: 'X' })).toBeNull();
    expect(asYesNo({ question: Q, options: [{ label: 'Request Changes', description: 'back to the plan' }, { label: 'Approve Plan' }] }, MAP).options)
      .toEqual([{ label: 'Sì' }, { label: 'No', description: 'back to the plan' }]);
    expect([engineLabel('Sì (consigliato)', MAP), engineLabel('No', MAP), engineLabel('Prima cambia il titolo', MAP)]).toEqual(['Approve Plan', 'Request Changes', 'Prima cambia il titolo']);
  });
});

describe('the gates', () => {
  it('Claude: the card shows Sì / No, the AskUserQuestion answer carries the engine label', async () => {
    const sink = recSink();
    const wire = new ClaudeSession({ chatId: 'w', cwd: '.', yesNo: true, briefReady: () => true, briefOptions: async () => MAP }, sink) as unknown as ClaudeWire;
    const reply = vi.spyOn(wire, 'write').mockImplementation(() => {});
    await wire.onControlRequest({ request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 't1',
      input: { questions: [{ question: Q, options: [{ label: 'Approve Plan' }, { label: 'Request Changes' }] }] } } });
    expect(reply).not.toHaveBeenCalled(); // not sent back as «not yes/no»
    expect(sink.pendings).toHaveLength(1);
    expect(sink.pendings[0]!.questions?.[0]?.options.map(o => o.label)).toEqual(['Sì', 'No']);
    expect(wire.answer('r1', { kind: 'question', answers: { [Q]: 'Sì' } })).toBe(true);
    const sent = JSON.stringify(reply.mock.calls.at(-1));
    expect(sent).toContain('"answers":{"Approvi il piano del modulo Ordini?":"Approve Plan"}');
  });

  it('Claude: without the map the same question is sent back, as before', async () => {
    const sink = recSink();
    const wire = new ClaudeSession({ chatId: 'w', cwd: '.', yesNo: true, briefReady: () => true, briefOptions: () => null }, sink) as unknown as ClaudeWire;
    const reply = vi.spyOn(wire, 'write').mockImplementation(() => {});
    await wire.onControlRequest({ request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 't1',
      input: { questions: [{ question: Q, options: [{ label: 'Approve Plan' }, { label: 'Request Changes' }] }] } } });
    expect(sink.pendings).toHaveLength(0);
    expect(JSON.stringify(reply.mock.calls.at(-1))).toContain('yesOption');
  });

  it('Cursor (ACP): the card shows Sì / No, the answer selects the engine option id', async () => {
    const sink = recSink();
    const wire = new AcpSession({ chatId: 'w', cwd: '.', engineId: 'cursor', label: 'Cursor', args: ['acp'], yesNo: true, briefReady: () => true, briefOptions: () => MAP }, sink) as unknown as AcpWire;
    const reply = vi.spyOn(wire, 'write').mockImplementation(() => {});
    await wire.onAgentRequest('7', 'cursor/ask_question', { questions: [{ id: 'q', prompt: Q, options: [{ id: 'approve', label: 'Approve Plan' }, { id: 'changes', label: 'Request Changes' }] }] });
    expect(sink.pendings).toHaveLength(1);
    const p = sink.pendings[0]!;
    expect(p.questions?.[0]?.options.map(o => o.label)).toEqual(['Sì', 'No']);
    wire.answer(p.id, { kind: 'question', answers: { [Q]: 'No' } });
    expect(JSON.stringify(reply.mock.calls.at(-1))).toContain('"selectedOptionIds":["changes"]');
  });
});
