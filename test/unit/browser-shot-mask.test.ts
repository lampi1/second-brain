// Screenshots never show a password (ADR 0237): before a capture every password field of every frame is hidden, a
// revealed one ("show password") included, and shown again after; a frame that cannot be masked refuses the capture.
// Fake frames and a fake page: no Electron, no browser.
import { afterEach, expect, it, vi } from 'vitest';
import type { WebFrameMain } from 'electron';
import { withPasswordsHidden } from '../../src/main/browser/shot-mask';
import { shotMask } from '../../src/main/browser/page';

const frames = ['top', 'login-iframe'].map(name => ({ name }) as unknown as WebFrameMain);
const on = (script: string) => script.includes('shotMask') && script.trimEnd().endsWith('(true)');

it('hides the password fields of every frame before the capture and shows them again after', async () => {
  const log: string[] = [];
  const run = async (f: WebFrameMain, script: string) => { log.push(`${on(script) ? 'hide' : 'show'} ${(f as unknown as { name: string }).name}`); return 1; };
  const shot = await withPasswordsHidden(frames, run, async () => { log.push('capture'); return 'png'; });
  expect(shot).toBe('png');
  expect(log).toEqual(['hide top', 'hide login-iframe', 'capture', 'show top', 'show login-iframe']);
});

it('refuses the capture when a frame cannot be masked, and unmasks the frames it masked', async () => {
  const log: string[] = [];
  const capture = vi.fn(async () => 'png');
  const run = async (f: WebFrameMain, script: string) => {
    const name = (f as unknown as { name: string }).name;
    if (name === 'login-iframe' && on(script)) throw new Error('the page did not answer');
    log.push(`${on(script) ? 'hide' : 'show'} ${name}`);
  };
  await expect(withPasswordsHidden(frames, run, capture)).rejects.toThrow(/^Refused: the password fields/);
  expect(capture).not.toHaveBeenCalled();
  expect(log).toEqual(['hide top', 'show top']);
});

it('shows the fields again when the capture fails', async () => {
  const log: string[] = [];
  const run = async (_f: WebFrameMain, script: string) => { log.push(on(script) ? 'hide' : 'show'); };
  await expect(withPasswordsHidden(frames.slice(0, 1), run, async () => { throw new Error('gone'); })).rejects.toThrow('gone');
  expect(log).toEqual(['hide', 'show']);
});

afterEach(() => { vi.unstubAllGlobals(); });

it('the page side hides a revealed password field and puts its own style back', () => {
  const style = (init: Record<string, [string, string]>) => {
    const props = new Map(Object.entries(init));
    return { props, getPropertyValue: (p: string) => props.get(p)?.[0] ?? '', getPropertyPriority: (p: string) => props.get(p)?.[1] ?? '',
      setProperty: (p: string, v: string, pr = '') => { props.set(p, [v, pr]); }, removeProperty: (p: string) => { props.delete(p); } };
  };
  const revealed = { style: style({}) }, styled = { style: style({ '-webkit-text-security': ['circle', ''] }) };
  const win: Record<string, unknown> = { __sbPw: { scan: () => [revealed, styled], is: () => true } };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: { offsetHeight: 0 } });
  expect(shotMask(true)).toBe(2);
  expect(revealed.style.props.get('-webkit-text-security')).toEqual(['disc', 'important']);
  expect(styled.style.props.get('-webkit-text-security')).toEqual(['disc', 'important']);
  expect(shotMask(false)).toBe(2);
  expect(revealed.style.props.has('-webkit-text-security')).toBe(false);
  expect(styled.style.props.get('-webkit-text-security')).toEqual(['circle', '']);
  expect(shotMask(false)).toBe(0);
});
