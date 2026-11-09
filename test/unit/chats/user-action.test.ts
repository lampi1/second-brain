// The app's own question for a run stopped on a step only the user can do (#358, chats/user-action.ts): what it says,
// how a Sì, a No or the user's words are read, what the owner of the work is told; which report words name such a step.
import { describe, expect, it } from 'vitest';
import { isUserActionRequest, userActionAnswer, userActionMessage, userActionRequest } from '../../../src/main/chats/user-action';
import { USER_ONLY_BLOCKER, checkResult } from '../../../src/shared/delegation';

describe('user-action', () => {
  const req = userActionRequest(5, { id: 'c1', title: 'Supporto', runId: 'r1' }, { kind: 'command', text: 'Premi Esegui sul comando.', command: 'az login' });
  const q = req.questions![0]!.question;
  it('names the chat, the step and the command, as a Sì/No question of the app', () => {
    expect(isUserActionRequest(req)).toBe(true);
    expect(req.id).toBe('user-action-r1-5');
    expect(q).toBe('«Supporto» è fermo: Premi Esegui sul comando. Fatto?\n\n```\naz login\n```');
    expect(req.questions![0]!.options.map(o => o.label)).toEqual(['Sì', 'No']);
  });
  it('reads Sì, No and the user\'s own words', () => {
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'Sì (consigliato)' } })).toEqual({ yes: true });
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'No' } })).toEqual({ yes: false });
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'VPN accesa ma la query va in timeout' } })).toEqual({ yes: false, words: 'VPN accesa ma la query va in timeout' });
    expect(userActionAnswer(req, { kind: 'question', answers: {} })).toBeNull();
  });
  it('tells the owner to reassign the chat', () => {
    expect(userActionMessage({ title: 'Supporto', text: 'Accendi la VPN' }, { yes: true }, 'parent')).toMatch(/^\[azione dell’utente fatta · chat «Supporto»\]\n.*agent_assign_task/);
    expect(userActionMessage({ title: 'Supporto', text: 'Accendi la VPN' }, { yes: false, words: 'domani' }, 'orchestrator')).toContain('«domani»');
  });
  it('knows the words of a user-only block, and keeps userAction off a done report', () => {
    for (const s of ['VPN spenta', 'serve il login', 'MFA richiesto', 'premi Esegui', 'Permission denied (publickey)']) expect(USER_ONLY_BLOCKER.test(s), s).toBe(true);
    for (const s of ['La vpnconfig è letta', 'Ho eseguito i test', 'tutto pronto', 'the log in /tmp/x is long', 'fixed login.ts', 'route /login', 'login_page ok']) expect(USER_ONLY_BLOCKER.test(s), s).toBe(false);
    for (const s of ['needs sudo', 'credentials missing', 'serve la password', 'SSO required']) expect(USER_ONLY_BLOCKER.test(s), s).toBe(true);
    const base = { outcome: 'partial', summary: 's', output: 'o', doneWhen: [] };
    expect(checkResult({ ...base, userAction: { kind: 'vpn', text: 'Accendi la VPN' } }, []).userAction).toEqual({ kind: 'vpn', text: 'Accendi la VPN' });
    expect(() => checkResult({ ...base, userAction: { kind: 'boh', text: 'x' } }, [])).toThrow(/userAction.kind/);
    expect(() => checkResult({ ...base, outcome: 'done', userAction: { kind: 'vpn', text: 'x' } }, [])).toThrow(/partial/);
  });
});
