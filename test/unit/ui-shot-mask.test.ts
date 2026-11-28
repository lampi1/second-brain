// app_screenshot hides the credential card's values before it captures the app window (ADR 0367, security review
// 2026-11-27): the capture runs only after the renderer confirmed every value hidden, the values come back after it,
// and a renderer that does not confirm (no answer, an error, a value still visible) refuses the capture. The renderer
// script runs here against a small fake DOM (vm); the card's markup and the CSS rule it relies on are checked too.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(() => Promise.resolve(null)) } }));
import { CRED_VALUE_CLASS, credMaskScript, SHOT_MASK_ATTR, withCredentialsHidden } from '../../src/main/appctl/ui-shot-mask';
import { CredentialCard } from '../../src/renderer/components/CredentialCard';
import { credentialCardItem } from '../../src/main/appctl/credential-card-tool';

/** A fake renderer: values are hidden while the root has the mask attribute, unless `broken` (a CSS rule missing). */
function fakeRenderer(values: number, broken = false) {
  const attrs = new Map<string, string>();
  const root = { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) };
  const els = Array.from({ length: values }, () => ({}));
  const ctx = {
    document: { documentElement: root, querySelectorAll: (sel: string) => (sel === `.${CRED_VALUE_CLASS}` ? els : []) },
    getComputedStyle: () => ({ visibility: attrs.has(SHOT_MASK_ATTR) && !broken ? 'hidden' : 'visible' }),
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
    setTimeout, Array,
  };
  vm.createContext(ctx);
  return { run: (script: string) => Promise.resolve(vm.runInContext(script, ctx) as unknown), masked: () => attrs.has(SHOT_MASK_ATTR) };
}

describe('withCredentialsHidden', () => {
  it('captures only while every value is hidden, and shows them again after', async () => {
    const r = fakeRenderer(3);
    let maskedDuringCapture = false;
    const img = await withCredentialsHidden(r.run, async () => { maskedDuringCapture = r.masked(); return 'img'; });
    expect(img).toBe('img');
    expect(maskedDuringCapture).toBe(true);
    expect(r.masked()).toBe(false);
  });
  it('a window with no card is captured as before', async () => {
    expect(await withCredentialsHidden(fakeRenderer(0).run, async () => 'img')).toBe('img');
  });
  it('refuses the capture when a value stays visible, the renderer fails or does not answer', async () => {
    for (const run of [fakeRenderer(2, true).run, () => Promise.reject(new Error('the page did not answer')), () => Promise.resolve(undefined)]) {
      const capture = vi.fn(async () => 'img');
      await expect(withCredentialsHidden(run, capture)).rejects.toThrow(/Refused/);
      expect(capture).not.toHaveBeenCalled();
    }
  });
  it('shows the values again when the capture fails', async () => {
    const r = fakeRenderer(1);
    await expect(withCredentialsHidden(r.run, () => Promise.reject(new Error('gone')))).rejects.toThrow('gone');
    expect(r.masked()).toBe(false);
  });
  it('the card marks every value, and the stylesheet hides them under the mask', () => {
    expect(credMaskScript(false)).toContain(SHOT_MASK_ATTR);
    const out = renderToStaticMarkup(createElement(CredentialCard, { item: credentialCardItem('e1', 'Air · test3', Date.now()) }));
    for (const f of ['url', 'user', 'password']) expect(out).toMatch(new RegExp(`<code class="[^"]*${CRED_VALUE_CLASS}[^"]*" data-testid="credential-${f}"`));
    const css = readFileSync(path.resolve('src/renderer/styles/orch-chat.css'), 'utf8');
    expect(css).toContain(`:root[${SHOT_MASK_ATTR}] .${CRED_VALUE_CLASS} { visibility: hidden !important; }`);
  });
});
