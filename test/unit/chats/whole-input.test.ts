// What Codex and the ACP engines hand the app as the whole input of a permission request (ADR 0292): the app's own
// answer reads what will run, never the copy shortened for the screen. No whole input known = undefined, and the app
// then judges the short copy (which asks only where a rule of the brain could hold the tool and the copy is cut).
import { describe, expect, it } from 'vitest';
import { acpWhole } from '../../../src/main/chats/acp';
import { codexWholeCommand } from '../../../src/main/chats/codex';
import { trimInput } from '../../../src/main/chats/session';

const long = `echo ${'x'.repeat(9000)} && deploy --prod`;

describe('codexWholeCommand', () => {
  it('is the request\'s own command, however long', () => {
    expect(codexWholeCommand({ command: long }, undefined)).toBe(long);
  });
  it('falls back to the running item as the engine sent it', () => {
    expect(codexWholeCommand({}, { command: long })).toBe(long);
  });
  it('is empty when neither is there: the shortened copy on screen is never taken for the whole', () => {
    expect(codexWholeCommand({}, undefined)).toBe('');
    expect((trimInput({ command: long }) as { command: string }).command).not.toBe(long);
  });
});

describe('acpWhole', () => {
  it('is the request\'s own raw input, with its locations', () => {
    expect(acpWhole({ rawInput: { command: long }, locations: [{ path: 'a' }] }, undefined)).toEqual({ command: long, locations: [{ path: 'a' }] });
  });
  it('falls back to the earlier tool call\'s raw input when the request brings none (OpenCode)', () => {
    expect(acpWhole({ rawInput: {} }, { command: long })).toEqual({ command: long });
    expect(acpWhole({ locations: [{ path: 'b' }] }, { command: long })).toEqual({ command: long, locations: [{ path: 'b' }] });
  });
  it('is undefined when no raw input is known', () => {
    expect(acpWhole({ rawInput: {} }, undefined)).toBeUndefined();
    expect(acpWhole({}, {})).toBeUndefined();
  });
});
