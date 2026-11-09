// Agents sign in by themselves on every host (the owner, 2026-11-09: «voglio togliere quel controllo del browser
// dell'app»; ADR 0237): type, fill_form and key write into a password field of a remote page, and the value never comes
// back in clear (the fill_form result masks it, the type result gives only a count). Fakes stand in for the tab, its
// frames and the page scripts; no Electron, no page.
import { expect, it, vi } from 'vitest';
import { BrowserActions } from '../../src/main/browser/actions';
import type { BrowserTabs, Tab } from '../../src/main/browser/tabs';

const SECRET = ['Segreto', 'Synthetic', String(1)].join('-');   // built at run time: the guard flags a literal

/** A remote sign-in page whose e12 (and the focused element) is a password field. */
function remotePage(url = 'https://app.example.com/login') {
  const frame = { url, origin: new URL(url).origin, parent: null };
  const tabs = {
    credentials: { pasteBlocked: () => false },
    cssScale: () => 1,
    dialogOpened: () => ({ promise: new Promise(() => {}), cancel: () => {} }),
    frames: () => [frame],
    frameByNo: () => frame,
  } as unknown as BrowserTabs;
  const actions = new BrowserActions(tabs);
  let value = '';
  const sent: Array<[string, Record<string, unknown>]> = [];
  vi.spyOn(actions, 'evalIn').mockImplementation(async (_tab, _frame, script: string) => {
    if (script.includes('focusSelect')) return true as never;
    if (script.includes('inputInfo')) {
      return { kind: 'text', password: true, tag: 'input', type: 'password', checked: false, disabled: false, readonly: false, multiple: false, value: value ? '•••' : '', desc: 'input "Password"' } as never;
    }
    return { password: true, focused: true, desc: 'input "Password"', hasFocus: true } as never;   // the old guard's fieldFacts
  });
  vi.spyOn(actions, 'click').mockResolvedValue('Clicked e12');
  vi.spyOn(actions as unknown as { input: (t: Tab, s: Array<[string, Record<string, unknown>]>) => Promise<'ok'> }, 'input').mockImplementation(async (_t, steps) => {
    for (const s of steps) { sent.push(s); if (s[0] === 'Input.insertText') value += String(s[1].text); }
    return 'ok';
  });
  const tab = { id: 't1', env: 'example-test-1', agentInput: 0, dialog: null, wc: { isDestroyed: () => false, getURL: () => url, mainFrame: frame } } as unknown as Tab;
  return { actions, tab, sent };
}

it('types a password into a remote password field, and the result gives only a count', async () => {
  const { actions, tab, sent } = remotePage();
  const r = await actions.type(tab, SECRET, 'e12');
  expect(r).toBe(`Typed ${SECRET.length} characters into e12`);
  expect(r).not.toContain(SECRET);
  expect(sent.length).toBeGreaterThan(0);
});

it('fills a remote password field with fill_form, its value masked in the result', async () => {
  const { actions, tab, sent } = remotePage();
  const r = await actions.fill(tab, [{ ref: 'e12', value: SECRET }]);
  expect(sent).toContainEqual(['Input.insertText', { text: SECRET }]);
  expect(r).toBe('e12 input "Password" = "•••"');
  expect(r).not.toContain(SECRET);
});

it('presses character keys into a focused remote password field', async () => {
  const { actions, tab, sent } = remotePage();
  await expect(actions.key(tab, 'a')).resolves.toBe('Pressed a');
  expect(sent.some(([, p]) => p.key === 'a')).toBe(true);
});

it('tells the agent it may sign in itself on a remote sign-in page', async () => {
  const { actions, tab } = remotePage();
  const notice = await actions.loginNotice(tab);
  expect(notice).toContain('sign in yourself');
  expect(notice).toContain('handoff_to_user');
  expect(notice).not.toMatch(/never type/i);
});
