// Several Regie (ADR 0021): which Regia a chat answers to (src/shared/regia.ts), tab labels and names, the opacity
// setting's schema. The widget's size and room: regia-dock.test.ts.
import { describe, expect, it } from 'vitest';
import { chatName, cleanRegiaName, regiaLabel, regiaOfChat, regieOf } from '../../src/shared/regia';
import { regiaTabsOf } from '../../src/renderer/lib/regia-route';
import { defOf, validate } from '../../src/main/brain/settings-schema';
import { DEFAULTS } from '../../src/main/brain/config';

const chats = [
  { id: 'w1', isRegia: false },
  { id: 'r1', isRegia: true },
  { id: 'r2', isRegia: true, regiaName: 'App' },
  { id: 'w2', isRegia: false, regiaOf: 'r2' },
  { id: 'w3', isRegia: false, regiaOf: 'gone' },
  { id: 'w4', isRegia: false, regiaOf: 'w1' },
];

describe('which Regia a chat answers to', () => {
  it('the Regie in list order; a Regia answers to itself; regiaOf while it is a Regia; else the first Regia', () => {
    expect(regieOf(chats).map(c => c.id)).toEqual(['r1', 'r2']);
    expect(regiaOfChat(chats[2], chats)).toBe('r2');
    expect(regiaOfChat(chats[3], chats)).toBe('r2');
    expect(regiaOfChat(chats[4], chats)).toBe('r1'); // a closed or replaced Regia
    expect(regiaOfChat(chats[5], chats)).toBe('r1'); // not a Regia
    expect(regiaOfChat(chats[0], chats)).toBe('r1');
    expect(regiaOfChat(undefined, chats)).toBe('r1');
    expect(regiaOfChat(chats[0], [chats[0]!])).toBe(null);
  });

  it('a Regia that replaced another keeps its tab place (regiaSince), so the first Regia stays the first', () => {
    const list = [{ id: 'app', isRegia: true, regiaSince: 2 }, { id: 'new', isRegia: true, regiaSince: 1 }, { id: 'w', isRegia: false }];
    expect(regieOf(list).map(c => c.id)).toEqual(['new', 'app']);
    expect(regiaOfChat(list[2], list)).toBe('new');
  });

  it('a tab shows its name, "Lavoro" for the Regia from before names; names are 1-30 characters on one line', () => {
    expect(regiaLabel({ regiaName: 'App' })).toBe('App');
    expect(regiaLabel({})).toBe('Lavoro');
    expect(regiaLabel({ appRegia: true, regiaName: 'X' })).toBe('App'); // the app's own Regia ("Migliora l'app")
    expect(regiaLabel({ regiaName: '  ' })).toBe('Lavoro');
    expect(cleanRegiaName('  Miglioramento\n app ')).toBe('Miglioramento app');
    for (const bad of ['', '   ', 'x'.repeat(31), 3, null, undefined]) expect(cleanRegiaName(bad), String(bad)).toBe(null);
    expect(cleanRegiaName('x'.repeat(30))).toBe('x'.repeat(30));
  });

  it('lists and cards name a Regia by its tab ("Regia · App"), the first one "Regia", any other chat by its title', () => {
    expect(chatName({ isRegia: true, title: 'Regia' })).toBe('Regia');
    expect(chatName({ isRegia: true, regiaName: 'App', title: 'Regia · App' })).toBe('Regia · App');
    expect(chatName({ isRegia: false, regiaName: 'App', title: 'Fix' })).toBe('Fix');
  });
});

describe('the overlay tabs', () => {
  it('the work Regie in tab order, then the one app Regia (Migliora l’app) while open; never a second concept', () => {
    const c = (id: string, p: object) => ({ id, ...p }) as never;
    const st = (list: { id: string }[]) => ({ order: list.map(x => x.id), chats: Object.fromEntries(list.map(x => [x.id, x])) }) as never;
    const work = [c('r2', { isRegia: true, regiaSince: 2 }), c('r1', { isRegia: true, regiaSince: 1 }), c('w', {})];
    expect(regiaTabsOf(st(work))).toEqual(['r1', 'r2']);
    expect(regiaTabsOf(st([...work, c('app', { appRegia: true, space: 'app' }), c('a1', { space: 'app' })]))).toEqual(['r1', 'r2', 'app']);
    expect(regiaTabsOf(st([...work, c('app', { appRegia: true, space: 'app', closedAt: 5 })]))).toEqual(['r1', 'r2']);
  });
});

describe('the Regia opacity setting', () => {
  it('40-100 %, fully opaque by default, free (not protected)', () => {
    expect(DEFAULTS.regiaOpacity).toBe(100);
    expect(defOf('regiaOpacity')!.protected).toBe(false);
    expect(validate('regiaOpacity', 70)).toMatchObject({ ok: true, value: 70 });
    for (const bad of [39, 101, 'x', null, 55.5]) expect(validate('regiaOpacity', bad).ok, String(bad)).toBe(false);
  });
});
