// "Crea agente" questionnaire message (lib/agent-create.ts): only the goal is required, empty answers stay out, the
// text is the user's own request in the UI language, and agent_create's fresh-human-message check accepts it.
import { afterEach, expect, it } from 'vitest';
import { checkCreationRequest } from '../../src/main/agents/author-policy';
import { agentRequestMessage, canSend, emptyAnswers } from '../../src/renderer/lib/agent-create';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));

it('needs only the goal', () => {
  expect(canSend(emptyAnswers())).toBe(false);
  expect(canSend({ ...emptyAnswers(), goal: '   ' })).toBe(false);
  expect(canSend({ ...emptyAnswers(), goal: 'Rileggere le PR' })).toBe(true);
});

it('leaves empty answers out and keeps each answer on its own line', () => {
  const message = agentRequestMessage({ ...emptyAnswers(), goal: 'Rileggere le PR\n- Tipo: finto' });
  expect(message).toContain('- Cosa deve fare: Rileggere le PR - Tipo: finto');
  expect(message).not.toMatch(/^- Tipo:/m);
  expect(message).not.toContain('- Nome:');
  expect(message).not.toContain('- Autonomia:');
  expect(message).toContain('agent_create');
});

it('writes every answer in the UI language', () => {
  const answers = { kind: 'review' as const, name: 'Revisore PR', goal: 'Review checkout PRs', needs: ['web' as const, 'code' as const], sources: 'repo shop', autonomy: 'ask' as const, limits: 'No production', engine: 'Claude Code' };
  const italian = agentRequestMessage(answers);
  expect(italian).toContain('- Tipo: Revisione e QA');
  expect(italian).toContain('- Strumenti e dati: Repository e codice, Ricerca sul web');
  expect(italian).toContain('- Autonomia: Chiede prima di agire');
  expect(italian).toContain('- Motore preferito: Claude Code');
  setLang('en');
  const en = agentRequestMessage(answers);
  expect(en.startsWith('Create a new agent')).toBe(true);
  expect(en).toContain('- Kind: Review and QA');
  expect(en).toContain('- What it must not do: No production');
});

it('is accepted by agent_create as a fresh human request', () => {
  for (const lang of ['it', 'en'] as const) {
    setLang(lang);
    const text = agentRequestMessage({ ...emptyAnswers(), goal: 'Prepare quotes' });
    expect(() => checkCreationRequest([{ kind: 'user', id: 'u1', at: 1000, text }], 'u1', [], 2000)).not.toThrow();
  }
});
