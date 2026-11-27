// The top bar's version chip (lib/version-chip.ts + components/VersionChip.tsx, ADR 0366, issue #491) and what is left
// of the launch banner (components/LaunchBanner.tsx: only the fallback warning): «● Versione nuova · Aggiorna» when
// GitHub is ahead, «Aggiornata a <sha> · Novità ✕» after a start on a new version, nothing otherwise.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
const launch = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('../../src/renderer/store/source', () => ({
  useSource: (sel: (s: unknown) => unknown) => sel(launch.value ? { launch: launch.value } : null),
  dismissLaunch: vi.fn(), askUpdateNow: vi.fn(),
}));
vi.mock('../../src/renderer/actions', () => ({ go: vi.fn() }));
import type { AppSourceState } from '../../src/shared/contract';
import { shortVersion, versionChipOf } from '../../src/renderer/lib/version-chip';
import { VersionChipView } from '../../src/renderer/components/VersionChip';
import { LaunchBanner } from '../../src/renderer/components/LaunchBanner';

afterEach(() => { launch.value = null; });
const state = (p: { behind?: number; srcState?: string; outcome?: string; subject?: string; commits?: string[]; canUpdate?: boolean } = {}) => ({
  running: '0.1.0-6dd4bea', stable: true, candidate: p.subject ? { subject: p.subject } : null,
  launch: p.outcome ? { outcome: p.outcome, running: '0.1.0-6dd4beaf00', wanted: '0.1.0-6dd4bea', reason: '', at: 1 } : null,
  source: { state: p.srcState ?? 'idle', behind: p.behind ?? 0, commits: p.commits ?? [], message: '', canUpdate: p.canUpdate ?? true, at: 1 },
}) as unknown as AppSourceState;
const noop = () => {};

describe('shortVersion', () => {
  it('keeps the seven-letter sha of a build id, and a plain release id whole', () => {
    expect(shortVersion('0.1.0-6dd4beaf00c1')).toBe('6dd4bea');
    expect(shortVersion('0.1.0-6dd4bea')).toBe('6dd4bea');
    expect(shortVersion('1.2.0')).toBe('1.2.0');
  });
});

describe('versionChipOf', () => {
  it('offers the update when GitHub is ahead, with the subject of the newest commit', () => {
    expect(versionChipOf(state({ behind: 2, subject: 'feat: x' }))).toEqual({ kind: 'available', behind: 2, subject: 'feat: x', canUpdate: true });
    expect(versionChipOf(state({ behind: 1, commits: ['abc1234 fix: y'], canUpdate: false }))).toEqual({ kind: 'available', behind: 1, subject: 'fix: y', canUpdate: false });
  });
  it('says the version it started on after an update, while nothing newer waits', () => {
    expect(versionChipOf(state({ outcome: 'new' }))).toEqual({ kind: 'updated', sha: '6dd4bea' });
    expect(versionChipOf(state({ outcome: 'new', behind: 1, srcState: 'updating' }))).toEqual({ kind: 'updated', sha: '6dd4bea' });
  });
  it('says nothing otherwise: no state, an up-to-date copy, a fallback (the banner says it)', () => {
    expect(versionChipOf(null)).toBeNull();
    expect(versionChipOf(state())).toBeNull();
    expect(versionChipOf(state({ outcome: 'fallback' }))).toBeNull();
    expect(versionChipOf(state({ behind: 3, srcState: 'restarting' }))).toBeNull();
  });
});

describe('VersionChipView', () => {
  const render = (chip: Parameters<typeof VersionChipView>[0]['chip']) => renderToStaticMarkup(createElement(VersionChipView, { chip, onUpdate: noop, onNews: noop, onDismiss: noop }));
  it('is a neutral button «Versione nuova · Aggiorna» with a dot when GitHub is ahead', () => {
    const html = render({ kind: 'available', behind: 1, subject: 'feat: x', canUpdate: true });
    expect(html).toMatch(/^<button type="button" class="version-chip is-new"/);
    expect(html).toContain('<span class="version-dot" aria-hidden="true"></span><span>Versione nuova</span>');
    expect(html).toContain('<b>Aggiorna</b>');
    expect(html).toContain('feat: x');
  });
  it('says «Aggiornata a <sha> · Novità» with a close button after an update', () => {
    const html = render({ kind: 'updated', sha: '6dd4bea' });
    expect(html).toContain('role="status"');
    expect(html).toContain('Aggiornata a <b class="version-sha">6dd4bea</b>');
    expect(html).toContain('data-testid="version-news">Novità</button>');
    expect(html).toContain('data-testid="version-dismiss"');
    expect(html).not.toContain('launch-banner');
  });
  it('renders nothing without a chip', () => { expect(render(null)).toBe(''); });
});

describe('LaunchBanner', () => {
  const render = () => renderToStaticMarkup(createElement(LaunchBanner));
  it('warns only when the new version did not start', () => {
    launch.value = { outcome: 'fallback', running: '0.1.0-aaaaaaa', wanted: '0.1.0-bbbbbbb', reason: 'non risponde', at: 1 };
    const html = render();
    expect(html).toContain('class="launch-banner warn"');
    expect(html).toContain('0.1.0-bbbbbbb');
  });
  it('is gone after a start on the new version (the chip says it) and without a launch', () => {
    launch.value = { outcome: 'new', running: '0.1.0-aaaaaaa', wanted: '0.1.0-aaaaaaa', reason: '', at: 1 };
    expect(render()).toBe('');
    launch.value = null;
    expect(render()).toBe('');
  });
});
