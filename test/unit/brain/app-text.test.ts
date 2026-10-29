// Unit tests of the brain template's app-text recogniser (brain-template/ops/tools/app-text.mjs) and the correction
// regex (signals-regex.mjs, ADR 0186): the app's labels copied into the template equal their sources, the app's own
// wrapper text is never the owner's correction, and the owner's real corrections still are.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs from the brain template, no types
import * as appText from '../../../brain-template/ops/tools/app-text.mjs';
// @ts-expect-error plain .mjs from the brain template, no types
import { CORRECTION } from '../../../brain-template/ops/tools/signals-regex.mjs';
import { AGENT_LABEL } from '../../../src/shared/agent-label';
import { APP_NOTE_LABEL } from '../../../src/main/chats/reply-rules';
import { APP_EVENT_LABEL } from '../../../src/main/chats/orchestrator-wake';
import { RUN_RESULT_LABEL } from '../../../src/main/run/results';
import { LAMPO_CONTEXT_END, LAMPO_CONTEXT_LABEL } from '../../../src/main/chats/lampo-context';
import { roleFrame } from '../../../src/main/agents/orchestrator-role';
import { USER_NOTES_LABEL } from '../../../src/main/chats/manager';
import { estimateLine } from '../../../src/shared/task-estimate';

const t = appText as { isAppWritten: (s: string) => boolean; ownText: (s: string) => string } & Record<string, string>;
const re = CORRECTION as RegExp;

describe('app-text copies', () => {
  it('equal the app sources', () => {
    expect(t.AGENT_LABEL).toBe(AGENT_LABEL);
    expect(t.APP_NOTE_LABEL).toBe(APP_NOTE_LABEL);
    expect(t.APP_EVENT_LABEL).toBe(APP_EVENT_LABEL);
    expect(t.RUN_RESULT_LABEL).toBe(RUN_RESULT_LABEL);
    expect(t.LAMPO_CONTEXT_LABEL).toBe(LAMPO_CONTEXT_LABEL);
    expect(t.LAMPO_CONTEXT_END).toBe(LAMPO_CONTEXT_END);
    const frame = roleFrame('Sentinel', 'Non va bene: basta.');
    expect(frame.startsWith(t.ROLE_OPEN!)).toBe(true);
    expect(frame.endsWith(t.ROLE_CLOSE!)).toBe(true);
  });
});

describe('ownText', () => {
  it('drops whole app and agent messages', () => {
    for (const l of [AGENT_LABEL, APP_NOTE_LABEL, APP_EVENT_LABEL, RUN_RESULT_LABEL]) {
      expect(t.isAppWritten(`${l}\nnon va, sbagliato`)).toBe(true);
      expect(t.ownText(`${l}\nnon va, sbagliato`)).toBe('');
    }
  });
  it('keeps the owner words around the role frame, the notes and the estimate line', () => {
    const prompt = `${roleFrame('Orchestrator', 'Basta domande. Non va mai fatto.')}\n\n${USER_NOTES_LABEL}\n- nota\n\nfai il deploy\n\n${estimateLine({ path: 'tree', why: 'then also' })}`;
    expect(t.ownText(prompt)).toBe('fai il deploy');
    expect(t.ownText(`${LAMPO_CONTEXT_LABEL}\nUser: non va\n${LAMPO_CONTEXT_END}\ncome stai?`)).toBe('come stai?');
  });
});

describe('CORRECTION', () => {
  it('never matches the app text or plain questions', () => {
    for (const s of [AGENT_LABEL, APP_NOTE_LABEL, roleFrame('Scout', 'Cerca.'), 'non vale', 'i test non funzionano', 'come mai la stima dice tree?', 'perché non usi il tool?', 'ok vai'])
      expect(re.test(s), s).toBe(false);
  });
  it('matches real corrections', () => {
    for (const s of ['no, non così', 'ti ho già detto di aspettare', 'sbagliato', 'non va', 'ma perché non hai letto il file?'])
      expect(re.test(s), s).toBe(true);
  });
});
