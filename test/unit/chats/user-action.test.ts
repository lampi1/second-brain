// The app's own question for a run stopped on a step only the user can do (#358, chats/user-action.ts): what it says,
// how a Sì, a No or the user's words are read, what the owner of the work is told; which report words name such a step.
import { describe, expect, it } from 'vitest';
import { isUserActionRequest, sameCommand, userActionAnswer, userActionMessage, userActionRequest, userDecisionMessage, userStepParams } from '../../../src/main/chats/user-action';
import { SYS_IT } from '../../../src/shared/sys';
import { USER_ONLY_BLOCKER, checkResult } from '../../../src/shared/delegation';

describe('user-action', () => {
  const req = userActionRequest(5, { id: 'c1', title: 'Supporto', runId: 'r1' }, { kind: 'command', text: 'Premi Esegui sul comando.', command: 'az login' });
  const q = req.questions![0]!.question;
  it('names the chat, the step and the command, as a Sì/No question of the app', () => {
    expect(isUserActionRequest(req)).toBe(true);
    expect(req.id).toBe('user-action-r1-5');
    expect(q).toBe('«Supporto» è fermo: Premi Esegui sul comando. Lo riprendo quando il comando ha girato?\n\n```\naz login\n```');
    // without a command: the user's own step, asked plainly (#371)
    expect(userActionRequest(5, { id: 'c1', title: 'Supporto', runId: null }, { kind: 'vpn', text: 'Accendi la VPN' }).questions![0]!.question).toBe('«Supporto» è fermo: Accendi la VPN. L’hai fatto tu?');
    expect(req.questions![0]!.options.map(o => o.label)).toEqual(['Sì', 'No']);
  });
  it('reads Sì, No and the user\'s own words', () => {
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'Sì (consigliato)' } })).toEqual({ yes: true });
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'No' } })).toEqual({ yes: false });
    expect(userActionAnswer(req, { kind: 'question', answers: { [q]: 'VPN accesa ma la query va in timeout' } })).toEqual({ yes: false, words: 'VPN accesa ma la query va in timeout' });
    expect(userActionAnswer(req, { kind: 'question', answers: {} })).toBeNull();
  });
  it('tells the owner to reassign the chat', () => {
    // a Sì alone is the user's word, never a fact the app checked; with a run it carries the run's result (#371)
    expect(userActionMessage({ title: 'Supporto', text: 'Accendi la VPN' }, { yes: true }, 'parent')).toMatch(/^\[l’utente dice di aver fatto il passo · chat «Supporto»\]\n.*non l’ha verificato.*agent_assign_task/s);
    expect(userActionMessage({ title: 'Supporto', text: 'Login', command: 'az login' }, { yes: true }, 'orchestrator', 'Esito: riuscito (exit code 0)')).toMatch(/^\[comando dell’utente eseguito · chat «Supporto»\]\n[\s\S]*Esito: riuscito[\s\S]*app_assign_task/);
    expect(userActionMessage({ title: 'Supporto', text: 'Accendi la VPN' }, { yes: false, words: 'domani' }, 'orchestrator')).toContain('«domani»');
  });
  it('compares commands without their surrounding space or line ends', () => {
    expect(sameCommand('az login\r\n', '  az login')).toBe(true);
    expect(sameCommand('az login', 'az logout')).toBe(false);
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

describe('a user step and a decision without a question (ADR 0269)', () => {
  it('the note says what to do and how it resumes: the command with Esegui, else his «fatto»', () => {
    const cmd = SYS_IT['sys.userStep'](userStepParams('Deploy test', { kind: 'command', text: 'Lancia la build.', command: 'npm run build' }));
    expect(cmd).toContain('«Deploy test» è in pausa: Lancia la build.');
    expect(cmd).toContain('```powershell\nnpm run build\n```');
    expect(cmd).not.toMatch(/fatto tu\?/);
    const vpn = SYS_IT['sys.userStep'](userStepParams('Deploy test', { kind: 'vpn', text: 'Accendi la VPN' }));
    expect(vpn).toBe('«Deploy test» è in pausa: Accendi la VPN.\n\nRiparte quando mi scrivi «fatto».');
  });
  it('a decision goes to the owner of the work, who decides as the user and asks only what is his alone', () => {
    const m = userDecisionMessage('Traduzione skill', 'Avviare 6 chat Artisan?', 'orchestrator');
    expect(m).toMatch(/^\[decisione da prendere · chat «Traduzione skill»\]/);
    expect(m).toContain('app_assign_task');
    expect(m).toContain('produzione');
    expect(userDecisionMessage('X', 'y', 'parent')).toContain('agent_assign_task');
  });
});
