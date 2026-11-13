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

import { PLAIN_SHARE, QUIP_AIR, QUIP_MS, quipDelay, quipMoment, quipTurn } from '../../src/renderer/lib/quips';
import { AgentSprite } from '../../src/renderer/components/AgentSprite';
import { SPRITE_IDS } from '../../src/renderer/lib/agent-sprites';

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
    expect(pickQuip('artisan', 'edit', 'it', () => 0, undefined, 'Refund.cs')).toBe('Refund.cs: a mazzate');
    for (const r of [0, 0.5, 0.999]) expect(pickQuip('artisan', 'edit', 'it', () => r)).toBe('Limo e incollo');
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

  it('speaks at its turn only: one voice at a time, quiet when asked, an end always as an end', () => {
    const edit = { kind: 'edit' as const, x: 'cart.ts' };
    const turn = (o: Partial<Parameters<typeof quipTurn>[0]>) => quipTurn({ quiet: false, at: 10_000, busyUntil: 0, moment: () => edit, rnd: 0.9, ...o });
    // its own moment, and the voice is taken for the bubble and a little air
    expect(turn({})).toEqual({ say: edit, busyUntil: 10_000 + QUIP_MS + QUIP_AIR });
    // one line in three is plain nonsense, but never in place of an end
    expect(turn({ rnd: PLAIN_SHARE - 0.01 })?.say).toEqual({ kind: 'work' });
    expect(turn({ rnd: PLAIN_SHARE })?.say).toEqual(edit);
    expect(turn({ rnd: 0, moment: () => ({ kind: 'done' }) })?.say).toEqual({ kind: 'done' });
    // nothing to say
    expect(turn({ moment: () => null })).toBeNull();
    // quiet (hidden window, frozen clock, reduced motion) or somebody else speaking: silent, and the moment is not
    // even asked (asking uses up the one line about an end)
    let asked = 0;
    const moment = () => { asked++; return edit; };
    expect(turn({ quiet: true, moment })).toBeNull();
    expect(turn({ busyUntil: 10_001, moment })).toBeNull();
    expect(asked).toBe(0);
    expect(turn({ busyUntil: 10_000, moment })?.say).toEqual(edit);
    expect(asked).toBe(1);
  });

  it('says only a plain program name, and a test only for a command that runs tests', () => {
    // a `$` in the name is text, not a pattern of the replacement
    expect(pickQuip('artisan', 'edit', 'it', () => 0, undefined, 'a$&b')).toBe('a$&b: a mazzate');
    // variables in front are dropped with their values; a piece of a value or a quoted path is never the program
    expect(quipOfTool('Bash', { command: 'AUTH="Bearer abc123xyz" curl https://example.org' })).toEqual({ kind: 'run', x: 'curl' });
    expect(quipOfTool('PowerShell', { command: '$t="abc def"; curl https://example.org' })).toEqual({ kind: 'run' });
    expect(quipOfTool('PowerShell', { command: '& "C:\\Program Files\\Git\\bin\\git.exe" status' })).toEqual({ kind: 'run' });
    expect(quipOfTool('PowerShell', { command: 'Set-Location app; npm run build' })).toEqual({ kind: 'run', x: 'npm' });
    expect(quipOfTool('Bash', { command: 'git commit -m "add tests"' })).toEqual({ kind: 'run', x: 'git' });
    expect(quipOfTool('Bash', { command: 'cat test.txt' })).toEqual({ kind: 'run', x: 'cat' });
    expect(quipOfTool('Bash', { command: 'npm run check:quick' })).toEqual({ kind: 'test', x: 'npm' });
    expect(quipOfTool('Bash', { command: 'node_modules/.bin/vitest run' })).toEqual({ kind: 'test', x: 'vitest' });
    // a cut never splits a character
    expect(quipX('📦📦📦📦📦📦📦📦📦📦📦📦📦')).toBe(`${'📦'.repeat(QUIP_X_MAX - 1)}…`);
  });
});
