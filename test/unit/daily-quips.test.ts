// The little people's lines of the day (ADR 0305): what a model wrote is said only as a few plain words for a known
// role and moment (shared/agent-quips.ts cleanQuip, parseDailyQuips, mergeDailyQuips), the lines of the day are said
// beside the fixed ones (setDailyQuips, pickQuip), and the service asks the lightest model at most twice a day per
// language, in a few small calls, keeps a week of lines and never trusts its own file (main/quips/daily.ts). The engine
// is a fake and the clock is given: nothing here waits or measures time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DAILY_MAX, QUIP_KINDS, QUIP_MAX, QUIP_ROLES, QUIP_X_KINDS, QUIP_X_REST, cleanQuip, fixedQuips, mergeDailyQuips, parseDailyQuips, pickQuip, quips, setDailyQuips, type QuipRole } from '../../src/shared/agent-quips';
import type { OneShotRequest, OneShotResult } from '../../src/main/agents/oneshot';
import { DAILY_BATCHES, DAILY_KEEP_DAYS, DAILY_RETRY_MS, DAILY_SYSTEM, DAILY_TRIES, DailyQuipsService, dailyCount, dailyPrompt } from '../../src/main/quips/daily';

describe('a line a model wrote', () => {
  it('is said only as a few plain words that fit the bubble', () => {
    expect(cleanQuip('  «Compilo e prego»  ', 'work')).toBe('Compilo e prego');
    expect(cleanQuip('due   spazi', 'work')).toBe('due spazi');
    for (const bad of [42, null, '', '   ', 'x'.repeat(QUIP_MAX + 1), 'una due tre quattro cinque sei', '**grassetto**', '<b>ciao</b>', 'vai su www.sito.it', 'apri http://a.b', '`rm -rf`', 'riga\u0000nulla', '!!!', 'ciao 🙂', '[link](x)', 'a_b', 'a/b', 'a\\b', '{y} boh', '$HOME dolce']) expect(cleanQuip(bad, 'work'), String(bad)).toBeNull();
    expect(cleanQuip('riga uno\nriga due', 'work')).toBe('riga uno riga due');
  });
  it('names the real thing only where there is one, once, and stays short around it', () => {
    for (const kind of QUIP_KINDS) expect(cleanQuip('{x}: lo sbrano', kind), kind).toBe(QUIP_X_KINDS.includes(kind) ? '{x}: lo sbrano' : null);
    expect(cleanQuip('{x} e {x}', 'read')).toBeNull();
    expect(cleanQuip(`{x} ${'a'.repeat(QUIP_X_REST - 1)}`, 'read')).not.toBeNull();
    expect(cleanQuip(`{x} ${'a'.repeat(QUIP_X_REST)}`, 'read')).toBeNull();
    expect(cleanQuip('{x}', 'read')).toBeNull();
  });
  it('is read from rows «role.moment: line | line», for known roles and moments only', () => {
    const fixed = fixedQuips('scout', 'work', 'it')[0]!;
    const got = parseDailyQuips([
      'Theme: pirates', 'scout.work: Fiuto la rotta | fiuto la rotta | Mappa bagnata | <script> | ' + fixed,
      '- Herald.DONE: Annuncio fatto', 'scout.read: {x} sa di sale | Leggo il vento', 'scout.idle: {x} dorme',
      'pirate.work: Arrr', 'scout.sail: Vele su', 'scout.work Senza due punti', 'artisan.work: | |',
    ].join('\r\n'), 'it');
    expect(got).toEqual({ scout: { work: ['Fiuto la rotta', 'Mappa bagnata'], read: ['{x} sa di sale', 'Leggo il vento'] }, herald: { done: ['Annuncio fatto'] } });
    expect(parseDailyQuips('', 'it')).toEqual({});
    // never more than DAILY_MAX for one moment
    const many = Array.from({ length: DAILY_MAX + 10 }, (_, i) => `Riga numero ${i}`).join(' | ');
    expect(parseDailyQuips(`scout.work: ${many}`, 'it').scout?.work).toHaveLength(DAILY_MAX);
  });
  it('joins two days: the first one first, none twice', () => {
    expect(mergeDailyQuips({ scout: { work: ['Oggi uno', 'Oggi due'] } }, { scout: { work: ['oggi UNO', 'Ieri tre'], idle: ['Ieri pisolo'] }, herald: { done: ['Ieri fatto'] } }))
      .toEqual({ scout: { work: ['Oggi uno', 'Oggi due', 'Ieri tre'], idle: ['Ieri pisolo'] }, herald: { done: ['Ieri fatto'] } });
  });
});

describe('the lines of the day beside the fixed ones', () => {
  afterEach(() => { setDailyQuips('it', null); });
  it('are said first, in their language only, and leave when taken away', () => {
    const fixed = [...quips('scout', 'work', 'it')];
    setDailyQuips('it', { scout: { work: ['Fiuto la rotta'], read: ['{x} sa di sale'] } });
    expect(quips('scout', 'work', 'it')).toEqual(['Fiuto la rotta', ...fixed]);
    expect(fixedQuips('scout', 'work', 'it')).toEqual(fixed);
    expect(quips('scout', 'work', 'en')).toEqual(fixedQuips('scout', 'work', 'en'));
    expect(quips('herald', 'work', 'it')).toEqual(fixedQuips('herald', 'work', 'it'));
    expect(pickQuip('scout', 'work', 'it', () => 0)).toBe('Fiuto la rotta');
    // a line that names the thing is said only with a thing to name
    expect(pickQuip('scout', 'read', 'it', () => 0, undefined, 'cart.ts')).toBe('cart.ts sa di sale');
    expect(pickQuip('scout', 'read', 'it', () => 0)).not.toContain('{x}');
    setDailyQuips('it', null);
    expect(quips('scout', 'work', 'it')).toEqual(fixed);
  });
});

/** The rows a model would write for some roles: every moment, as many lines as asked, each one its own. */
const rowsFor = (roles: readonly QuipRole[], tag: string): string => roles.flatMap(role => QUIP_KINDS.map(kind =>
  `${role}.${kind}: ${Array.from({ length: dailyCount(kind) }, (_, i) => `${role.slice(0, 3)} ${kind} ${tag} ${i}`).join(' | ')}`)).join('\n');
const ok = (text: string): OneShotResult => ({ ok: true, text, engine: 'claude', model: 'tiny', costUsd: 0.001, costBasis: 'estimated', tokens: null, durationMs: 1 });
const ko = (reason: string, noEngine = false): OneShotResult => ({ ok: false, text: '', reason, noEngine, engine: null, model: null, costUsd: null, costBasis: 'unknown', tokens: null, durationMs: 1 });
/** the roles a request asks for, read from its prompt («- role: character») */
const asked = (req: OneShotRequest): QuipRole[] => QUIP_ROLES.filter(r => req.prompt.includes(`\n- ${r}: `));
const NOON = new Date(2026, 10, 14, 12).getTime(), DAY = 24 * 3_600_000;

describe('the service that has the lines of the day written', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const make = (answer: (req: OneShotRequest, n: number) => OneShotResult | Promise<OneShotResult>, o: { on?: () => boolean } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quips-')); dirs.push(dir);
    const file = path.join(dir, 'sub', 'quips-daily.json'), calls: OneShotRequest[] = [], clock = { at: NOON };
    const svc = new DailyQuipsService({ file, runOnce: async req => { calls.push(req); return answer(req, calls.length); }, on: o.on ?? (() => true), now: () => clock.at });
    return { svc, file, calls, clock, stored: () => JSON.parse(fs.readFileSync(file, 'utf8')) as { days: Record<string, Record<string, unknown>>; tries: Record<string, number> } };
  };

  it('asks the lightest model in a few small calls, once, and then only reads', async () => {
    const { svc, calls } = make(req => ok(rowsFor(asked(req), 'oggi')));
    expect(svc.get('it')).toEqual({ lines: {}, pending: true });
    expect(calls).toHaveLength(0);
    const got = await svc.ensure('it');
    expect(got.pending).toBe(false);
    for (const role of QUIP_ROLES) for (const kind of QUIP_KINDS) expect(got.lines[role]?.[kind], `${role} ${kind}`).toHaveLength(dailyCount(kind));
    expect(calls.map(asked)).toEqual(DAILY_BATCHES);
    for (const c of calls) {
      expect(c).toMatchObject({ purpose: 'phrases', light: true, agentId: 'herald' });
      expect(c.system).toBe(DAILY_SYSTEM('it'));
      expect(c.system).toContain('Italian');
      expect(c.maxOutputTokens).toBeLessThanOrEqual(2400);
      expect(c.system.length + c.prompt.length).toBeLessThan(12_000);
    }
    await svc.ensure('it');
    expect(svc.get('it').pending).toBe(false);
    expect(calls).toHaveLength(DAILY_BATCHES.length);
    // another language is another day's work of its own
    expect(svc.get('en')).toEqual({ lines: {}, pending: true });
    expect(svc.get('fr')).toEqual({ lines: {}, pending: false });
    expect(await svc.ensure(undefined)).toEqual({ lines: {}, pending: false });
  });

  it('runs one job at a time for a language', async () => {
    let free!: () => void;
    const gate = new Promise<void>(r => { free = r; });
    const { svc, calls } = make(async req => { await gate; return ok(rowsFor(asked(req), 'oggi')); });
    const a = svc.ensure('it'), b = svc.ensure('it');
    expect(svc.get('it').pending).toBe(true);
    free();
    const [x, y] = await Promise.all([a, b]);
    expect(x).toEqual(y);
    expect(calls).toHaveLength(DAILY_BATCHES.length);
  });

  it('asks nothing and says nothing of its own while the setting is off', async () => {
    let on = true;
    const { svc, calls } = make(req => ok(rowsFor(asked(req), 'oggi')), { on: () => on });
    await svc.ensure('it');
    on = false;
    expect(svc.get('it')).toEqual({ lines: {}, pending: false });
    const { svc: off, calls: none } = make(() => ok(''), { on: () => false });
    expect(await off.ensure('it')).toEqual({ lines: {}, pending: false });
    expect(none).toHaveLength(0);
    expect(calls).toHaveLength(DAILY_BATCHES.length);
  });

  it('tries again later the parts that did not come, never more than its tries a day', async () => {
    // the first part comes back as chatter, the second whole, the third not at all
    const { svc, calls, clock, stored } = make(req => (asked(req).includes('orchestrator') ? ok('I cannot do that.') : asked(req).includes('sentinel') ? ok(rowsFor(asked(req), 'oggi')) : ko('timeout')));
    const first = await svc.ensure('it');
    // what came is there and said; the rest is still due, but not at once
    expect(first.lines.sentinel?.work).toHaveLength(dailyCount('work'));
    expect(first.lines.scout).toBeUndefined();
    expect(first.lines.herald).toBeUndefined();
    expect(first.pending).toBe(false);
    expect(stored().tries).toEqual({ '2026-11-14:it': 1 });
    await svc.ensure('it');
    expect(calls).toHaveLength(DAILY_BATCHES.length);
    clock.at += DAILY_RETRY_MS;
    expect(svc.get('it').pending).toBe(true);
    await svc.ensure('it');
    // only the missing parts are asked again
    expect(calls.slice(DAILY_BATCHES.length).map(asked)).toEqual(DAILY_BATCHES.filter(b => !b.includes('sentinel')));
    expect(stored().tries['2026-11-14:it']).toBe(DAILY_TRIES);
    clock.at += DAILY_RETRY_MS;
    expect(svc.get('it').pending).toBe(false);
    const n = calls.length;
    await svc.ensure('it');
    expect(calls).toHaveLength(n);
    // a new day starts again
    clock.at += DAY;
    expect(svc.get('it').pending).toBe(true);
  });

  it('stops at once with no engine on, and the try still counts', async () => {
    const { svc, calls, stored } = make(() => ko('no engine', true));
    expect(await svc.ensure('it')).toEqual({ lines: {}, pending: false });
    expect(calls).toHaveLength(1);
    expect(stored().tries['2026-11-14:it']).toBe(1);
  });

  it('counts the try before asking: an engine that throws does not make it ask for ever', async () => {
    const { svc, calls, clock, stored } = make(() => { throw new Error('boom'); });
    for (let i = 0; i < DAILY_TRIES + 2; i++) { await svc.ensure('it'); clock.at += DAILY_RETRY_MS; }
    expect(calls).toHaveLength(DAILY_TRIES);
    expect(stored().tries['2026-11-14:it']).toBe(DAILY_TRIES);
  });

  it('keeps a week of lines, today first, and tells the model what was said already', async () => {
    let day = 0;
    const { svc, calls, clock, stored } = make(req => ok(rowsFor(asked(req), `g${day}`)));
    for (; day < DAILY_KEEP_DAYS + 2; day++) { clock.at = NOON + day * DAY; await svc.ensure('it'); }
    const s = stored();
    expect(Object.keys(s.days)).toHaveLength(DAILY_KEEP_DAYS);
    expect(Object.keys(s.days).sort()[0]).toBe('2026-11-16');
    expect(Object.keys(s.tries).sort()[0]).toBe('2026-11-16:it');
    const work = svc.get('it').lines.scout!.work!;
    expect(work).toHaveLength(Math.min(DAILY_MAX, DAILY_KEEP_DAYS * dailyCount('work')));
    expect(work[0]).toBe(`sco work g${DAILY_KEEP_DAYS + 1} 0`);
    expect(work).not.toContain('sco work g0 0');
    // the last request names the day, and yesterday's lines to stay away from
    const last = calls.at(-1)!.prompt;
    expect(last).toContain('Sunday, 22 November 2026');
    expect(last).toContain(`her work g${DAILY_KEEP_DAYS} 0`);
    expect(calls[0]!.prompt).toContain(fixedQuips('scout', 'work', 'it')[0]!);
  });

  it('does not trust its own file: what is read from it is checked like a model’s answer', async () => {
    const { svc, file } = make(() => ko('unused'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 1, tries: { '2026-11-14:it': DAILY_TRIES }, days: { '2026-11-14': { it: {
      scout: { work: ['Riga buona', '<img src=x onerror=alert(1)>', 7, 'x'.repeat(80)], sail: ['Vele su'] }, pirate: { work: ['Arrr'] }, herald: 'tutto', sentinel: { done: 'una stringa' },
    } } } }));
    expect(svc.get('it')).toEqual({ lines: { scout: { work: ['Riga buona'] } }, pending: false });
    for (const broken of ['{ not json', '[]', '{"v":2,"days":{}}', 'null']) {
      fs.writeFileSync(file, broken);
      expect(svc.get('it'), broken).toEqual({ lines: {}, pending: true });
    }
  });

  it('asks every role for every moment, in the words of its character', () => {
    const p = dailyPrompt(DAILY_BATCHES[1]!, 'de', NOON, ['Schon gesagt']);
    expect(DAILY_SYSTEM('de')).toContain('German');
    for (const role of DAILY_BATCHES[1]!) expect(p).toContain(`- ${role}: `);
    for (const role of DAILY_BATCHES[0]!) expect(p).not.toContain(`- ${role}: `);
    for (const kind of QUIP_KINDS) expect(p).toContain(`- ${kind} (${dailyCount(kind)}): `);
    expect(p).toContain('Saturday, 14 November 2026');
    expect(p).toContain('Schon gesagt');
    expect(dailyPrompt(DAILY_BATCHES[0]!, 'it', NOON, [])).not.toContain('Said in the last days');
    expect(DAILY_BATCHES.flat().sort()).toEqual([...QUIP_ROLES].sort());
  });
});
