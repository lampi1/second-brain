// The agents' nonsense lines (src/shared/agent-quips.ts, ADR 0303): every role speaks in every language at every
// moment, each line fits a small bubble, and a pick never repeats the line said last; the lines follow what the agent
// is really doing (the moment of a tool, the real file or command in the line). Also when a person speaks by itself
// (renderer lib/quips.ts): the waits, the moment of a chat, its turn to speak (one voice at a time, silence when it
// must be quiet, an end said once as an end) and no bubble in a person nobody clicked.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { QUIP_CHARACTER, QUIP_KINDS, QUIP_MAX, QUIP_ROLES, QUIP_X_MAX, isQuipRole, pickQuip, quipOfTool, quipX, quips } from '../../src/shared/agent-quips';

import { PLAIN_SHARE, QUIP_MS, QUIP_REACTION_AT, QUIP_VOICES, QUIP_WORK_MS, quipDelay, quipMoment, quipTurn } from '../../src/renderer/lib/quips';
import { AgentSprite } from '../../src/renderer/components/AgentSprite';
import { REACTION_S, SPRITE_IDS } from '../../src/renderer/lib/agent-sprites';

const LANGS = ['it', 'en', 'de'] as const;

describe('agent quips', () => {
  it('gives every role lines of its own for every moment, in the three languages', () => {
    for (const lang of LANGS) for (const role of QUIP_ROLES) {
      for (const kind of QUIP_KINDS) {
        const all = quips(role, kind, lang);
        expect(all.length, `${lang} ${role} ${kind}`).toBeGreaterThanOrEqual(2);
        // every moment has a line that needs no name
        expect(all.some(q => !q.includes('{x}')), `${lang} ${role} ${kind}: no plain line`).toBe(true);
        expect(new Set(all).size, `${lang} ${role} ${kind}: a line twice`).toBe(all.length);
      }
      expect(quips(role, 'work', lang).length).toBeGreaterThanOrEqual(12);
    }
    // a character each: no role says in its work what another one says
    for (const lang of LANGS) {
      const said = QUIP_ROLES.flatMap(role => quips(role, 'work', lang));
      expect(new Set(said).size).toBe(said.length);
    }
    for (const role of QUIP_ROLES) expect(QUIP_CHARACTER[role].length).toBeGreaterThan(20);
    expect(isQuipRole('scout')).toBe(true);
    expect(isQuipRole('flash')).toBe(false);
  });

  it('keeps every line short: a few words that fit the bubble', () => {
    for (const lang of LANGS) for (const role of QUIP_ROLES) for (const kind of QUIP_KINDS) for (const q of quips(role, kind, lang)) {
      expect(q.length, q).toBeLessThanOrEqual(QUIP_MAX);
      expect(q.split(/\s+/).length, q).toBeLessThanOrEqual(5);
      expect(q.trim(), q).toBe(q);
    }
  });

  it('picks by the given chance and never the line said last', () => {
    const all = quips('artisan', 'work', 'it');
    expect(pickQuip('artisan', 'work', 'it', () => 0)).toBe(all[0]);
    expect(pickQuip('artisan', 'work', 'it', () => 0.999999)).toBe(all[all.length - 1]);
    expect(pickQuip('artisan', 'work', 'it', () => 0, all[0])).toBe(all[1]);
    for (const q of all) for (const r of [0, 0.3, 0.6, 0.999]) expect(pickQuip('artisan', 'work', 'it', () => r, q)).not.toBe(q);
    // a chance of exactly 1 (out of range) still lands on a line
    expect(all).toContain(pickQuip('artisan', 'work', 'it', () => 1));
  });

  it('has a speaker for every little person, and they wait before speaking by themselves', () => {
    expect([...SPRITE_IDS].sort()).toEqual([...QUIP_ROLES].sort());
    // the first line after 15 to 60 s, the next ones every 60 to 150 s; a bubble lasts a moment
    expect([quipDelay(0, true), quipDelay(0.999999, true)]).toEqual([15_000, 60_000]);
    expect([quipDelay(0, false), quipDelay(0.999999, false)]).toEqual([60_000, 150_000]);
    expect(QUIP_MS).toBeLessThanOrEqual(3000);
    // nobody clicked, no time passed: the person is drawn without a bubble
    expect(renderToStaticMarkup(createElement(AgentSprite, { id: 'scout', state: 'work', mood: () => ({ kind: 'work' as const }) }))).not.toContain('class="quip"');
  });

  it('follows what the agent is really doing: the moment of each tool and the real name in the line', () => {
    expect(quipOfTool('Read', { file_path: 'C:\\progetti\\shop\\src\\Refund.cs' })).toEqual({ kind: 'read', x: 'Refund.cs' });
    expect(quipOfTool('Edit', { file_path: '/repo/src/cart.ts' })).toEqual({ kind: 'edit', x: 'cart.ts' });
    expect(quipOfTool('Write', {})).toEqual({ kind: 'edit' });
    expect(quipOfTool('Bash', { command: 'cd app && FOO=1 /usr/bin/git status' })).toEqual({ kind: 'run', x: 'git' });
    expect(quipOfTool('PowerShell', { command: 'dotnet test Shop.Tests --filter Orders' })).toEqual({ kind: 'test', x: 'dotnet' });
    expect(quipOfTool('Bash', { command: 'npx vitest run' })).toEqual({ kind: 'test', x: 'npx' });
    expect(quipOfTool('Grep', { pattern: 'Recalculate' })).toEqual({ kind: 'search', x: 'Recalculate' });
    expect(quipOfTool('WebFetch', { url: 'https://www.example.org/docs/a' })).toEqual({ kind: 'web', x: 'example.org' });
    expect(quipOfTool('mcp__sb-browser__browser_click', { ref: 'e1' })).toEqual({ kind: 'web' });
    expect(quipOfTool('Agent', { prompt: 'x' })).toEqual({ kind: 'delegate' });
    expect(quipOfTool('mcp__second-brain__agent_delegate', {})).toEqual({ kind: 'delegate' });
    expect(quipOfTool('TodoWrite', { todos: [] })).toEqual({ kind: 'work' });
    expect(quipOfTool('Read', 'not an object')).toEqual({ kind: 'read' });
    // the name goes in the line, cut short; without a name only the lines that need none are said
    expect(quipX('  OrderTotalsTests.cs ')).toBe('OrderTotals…');
    expect(quipX('OrderTotalsTests.cs').length).toBe(QUIP_X_MAX);
    expect(pickQuip('artisan', 'edit', 'it', () => 0, undefined, 'Refund.cs')).toBe('Raddrizzo Refund.cs');
    for (const r of [0, 0.5, 0.999]) expect(pickQuip('artisan', 'edit', 'it', () => r)).toBe('Lima e martello');
    for (const lang of LANGS) for (const role of QUIP_ROLES) for (const kind of QUIP_KINDS) for (const r of [0, 0.5, 0.999]) {
      expect(pickQuip(role, kind, lang, () => r)).not.toContain('{x}');
      expect(pickQuip(role, kind, lang, () => r, undefined, 'OrderTotalsTests.cs')).not.toContain('{x}');
    }
  });

  it('reads the moment of a chat from its state and its last tool', () => {
    const tool = (name: string, input: unknown): ChatItem => ({ kind: 'tool', id: name, at: 0, name, summary: '', input, status: 'ok' });
    const text: ChatItem = { kind: 'assistant', id: 'a', at: 0, text: 'ok' };
    for (const state of ['think', 'wait', 'err', 'done', 'idle'] as const) expect(quipMoment(state, [tool('Read', { file_path: 'a.ts' })])).toEqual({ kind: state });
    expect(quipMoment('work', [tool('Read', { file_path: 'a.ts' }), tool('Edit', { file_path: 'src/b.ts' }), text])).toEqual({ kind: 'edit', x: 'b.ts' });
    expect(quipMoment('work', undefined)).toEqual({ kind: 'work' });
    expect(quipMoment('work', [text])).toEqual({ kind: 'work' });
    // a tool many steps ago is no longer what it is doing
    expect(quipMoment('work', [tool('Read', { file_path: 'a.ts' }), ...Array.from({ length: 6 }, () => text)])).toEqual({ kind: 'work' });
  });

  it('speaks at its turn only: a few voices at a time, quiet when asked, an end always as an end', () => {
    const edit = { kind: 'edit' as const, x: 'cart.ts' };
    const turn = (o: Partial<Parameters<typeof quipTurn>[0]>) => quipTurn({ quiet: false, speaking: 0, moment: () => edit, rnd: 0.9, ...o });
    // its own moment; a short bubble at rest, one that stays while its chat works
    expect(turn({})).toEqual({ say: edit, ms: QUIP_MS });
    expect(turn({ lively: true })).toEqual({ say: edit, ms: QUIP_WORK_MS });
    expect(QUIP_WORK_MS).toBeGreaterThan(QUIP_MS);
    // one line in three is plain nonsense, but never in place of an end
    expect(turn({ rnd: PLAIN_SHARE - 0.01 })?.say).toEqual({ kind: 'work' });
    expect(turn({ rnd: PLAIN_SHARE })?.say).toEqual(edit);
    expect(turn({ rnd: 0, moment: () => ({ kind: 'done' }) })?.say).toEqual({ kind: 'done' });
    // nothing to say
    expect(turn({ moment: () => null })).toBeNull();
    // quiet (hidden window, frozen clock, reduced motion) or enough others speaking: silent, and the moment is not
    // even asked (asking uses up the one line about an end)
    let asked = 0;
    const moment = () => { asked++; return edit; };
    expect(turn({ quiet: true, moment })).toBeNull();
    expect(turn({ speaking: QUIP_VOICES, moment })).toBeNull();
    // nor over a line of its own: the one on the page, or a click's line that waits for the stick to leave
    expect(turn({ busy: true, moment })).toBeNull();
    expect(asked).toBe(0);
    expect(turn({ speaking: QUIP_VOICES - 1, moment })?.say).toEqual(edit);
    expect(asked).toBe(1);
  });

  it('while its chat works the pause between two lines is shorter than a line: it is seen speaking most of the time', () => {
    for (const rnd of [0, 0.5, 0.999]) {
      expect(quipDelay(rnd, true, true)).toBeLessThanOrEqual(QUIP_WORK_MS);
      expect(quipDelay(rnd, false, true)).toBeLessThanOrEqual(QUIP_WORK_MS);
      expect(quipDelay(rnd, false, true)).toBeGreaterThan(0);
      // at rest: now and then, as before
      expect(quipDelay(rnd, true)).toBeGreaterThanOrEqual(15_000);
      expect(quipDelay(rnd, false)).toBeGreaterThanOrEqual(60_000);
    }
    // the line about a click starts after the hand or the stick has left the head
    expect(QUIP_REACTION_AT.whack).toBeGreaterThan(QUIP_REACTION_AT.pat);
    expect(QUIP_REACTION_AT.whack).toBeLessThan(REACTION_S.whack * 1000);
  });

  it('the line is about the kind of work its person is drawn doing, with the last thing of that kind', () => {
    const tool = (name: string, input: unknown): ChatItem => ({ kind: 'tool', id: name, at: 0, name, summary: '', input, status: 'ok' });
    const items = [tool('Read', { file_path: 'src/a.ts' }), tool('Edit', { file_path: 'src/b.ts' })];
    // the drawing changes a little later than the tools: it still reads, so it speaks of the file it read
    expect(quipMoment('work', items, 'read')).toEqual({ kind: 'read', x: 'a.ts' });
    // no tool of that kind in sight: the kind alone
    expect(quipMoment('work', items, 'web')).toEqual({ kind: 'web' });
    // nothing shown: the last tool, as before; and a state that is not work is that state
    expect(quipMoment('work', items, null)).toEqual({ kind: 'edit', x: 'b.ts' });
    expect(quipMoment('done', items, 'read')).toEqual({ kind: 'done' });
  });

  it('says only a plain program name, and a test only for a command that runs tests', () => {
    // a `$` in the name is text, not a pattern of the replacement
    expect(pickQuip('artisan', 'edit', 'it', () => 0, undefined, 'a$&b')).toBe('Raddrizzo a$&b');
    // the program is said only as a plain name: a value, a quoted path, a sign or something computed never is
    const said: [string, string | undefined][] = [
      ['AUTH="Bearer abc123xyz" curl https://example.org', 'curl'], ['GREETING=my\\ words cmd', 'cmd'], ['TOKEN=$(pass show github) gh api', 'gh'],
      ['export API_KEY="sk;abcdef123 zz"; curl x', 'curl'], ['export MSG="a | hunter2 b"', undefined], ['$t="abc def"; curl https://example.org', undefined],
      ['& "C:\\Program Files\\Git\\bin\\git.exe" status', undefined], ['"C:\\Program Files\\Git\\bin\\git.exe" status', undefined],
      ["'/home/me/my secret dir/tool' run", undefined], ['Set-Location app; npm run build', 'npm'], ['C:\\tools\\dotnet.exe build', 'dotnet'], ['', undefined],
    ];
    for (const [command, x] of said) expect(quipOfTool('Bash', { command }).x, command).toBe(x);
    // a test is a step that runs tests: a runner, or a tool asked to test; the word in a message or a file name is not
    const tests = ['npm test', 'npm t', 'npm run test:unit', 'npm run -s test', 'npm --prefix app test', 'pnpm -r test', 'yarn jest', 'yarn workspace web test',
      'npx vitest run', 'node_modules/.bin/vitest run', 'npx playwright test', 'dotnet test', 'dotnet.exe test', 'pytest -k x', 'python -m pytest', 'python manage.py test',
      'cargo test', 'cargo nextest run', 'go test ./...', 'mvn clean test', 'node --test', 'node scripts/e2e.mjs ui', 'npm run check:quick', 'npm run build && npm test'];
    const others = ['npm install -D vitest', 'pip install pytest', 'npx playwright install', 'cat playwright.config.ts', 'git commit -m "bump jest"', 'git commit -m "npm test is red"',
      'git commit -m "add tests"', 'grep -rn mocha src', 'cargo check', 'node test.js', 'cat test.txt', 'ls tests', 'npm run build', 'echo test', 'curl https://x/test'];
    for (const command of tests) expect(quipOfTool('Bash', { command }).kind, command).toBe('test');
    for (const command of others) expect(quipOfTool('Bash', { command }).kind, command).toBe('run');
    // a cut never splits a character
    expect(quipX('📦📦📦📦📦📦📦📦📦📦📦📦📦')).toBe(`${'📦'.repeat(QUIP_X_MAX - 1)}…`);
  });
});
