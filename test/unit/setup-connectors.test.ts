// The setup's tools step (src/renderer/lib/setup-connectors.ts): every sign-in ends in a real check, a sign-in window
// still open keeps the row waiting and re-checks by itself until the last try, and a sign-in that did not start shows
// the app's own reason. Fake ports only: no IPC, no network.
import { describe, expect, it } from 'vitest';
import type { ConnectorId, ConnectorState } from '@shared/connectors';
import { POLL_TRIES, connectTool, linkFromState, opensWindow, pollTool, toolBusy, verifyTool } from '../../src/renderer/lib/setup-connectors';

const state = (provider: ConnectorId, patch: Partial<ConnectorState> = {}): ConnectorState => ({ provider, status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: '', ...patch });
const verified = (provider: ConnectorId) => state(provider, { status: 'verified', account: 'giulia', checkedAt: '2026-10-19T18:00:00.000Z', projects: [{ id: '1', name: 'acme/shop' }, { id: '2', name: 'acme/api' }] });
const failed = (provider: ConnectorId) => state(provider, { status: 'failed', checkedAt: '2026-10-19T18:00:00.000Z' });

describe('setup connectors', () => {
  it('reads what main knows: connected with account and projects, failed, signing in, not connected', () => {
    expect(linkFromState(verified('github'))).toEqual({ phase: 'connected', account: 'giulia', projects: 2, checkedAt: '2026-10-19T18:00:00.000Z' });
    expect(linkFromState(failed('jira')).phase).toBe('failed');
    expect(linkFromState(state('azure', { signingIn: true })).phase).toBe('signingIn');
    expect(linkFromState(state('azure')).phase).toBe('idle');
    expect(linkFromState(undefined).phase).toBe('idle');
  });

  it('Collega signs in, then checks at once: connected when the probe reads the account', async () => {
    const calls: string[] = [];
    const link = await connectTool({ login: async id => { calls.push(`login:${id}`); }, probe: async id => { calls.push(`probe:${id}`); return verified(id); } }, 'github');
    expect(calls).toEqual(['login:github', 'probe:github']);
    expect(link).toMatchObject({ phase: 'connected', account: 'giulia', projects: 2 });
  });

  it('a sign-in still open in its window waits (GitHub, Azure); Jira\'s first check is final', async () => {
    const port = { login: async () => {}, probe: async (id: ConnectorId) => failed(id) };
    expect(opensWindow('github')).toBe(true);
    expect((await connectTool(port, 'github')).phase).toBe('waiting');
    expect((await connectTool(port, 'azure')).phase).toBe('waiting');
    expect((await connectTool(port, 'jira')).phase).toBe('failed');
  });

  it('a sign-in that did not start shows the app\'s own sentence', async () => {
    const link = await connectTool({ login: async () => { throw new Error("Error invoking remote method 'connectors:login': Error: Installa GitHub CLI dal sito ufficiale, poi riprova"); }, probe: async id => verified(id) }, 'github');
    expect(link).toEqual({ phase: 'error', error: 'Installa GitHub CLI dal sito ufficiale, poi riprova' });
    expect((await verifyTool({ probe: async () => { throw new Error('Operazione già in corso'); } }, 'github'))).toEqual({ phase: 'error', error: 'Operazione già in corso' });
  });

  it('re-checks by itself while waiting and gives up as "not connected" on the last try', async () => {
    const port = { probe: async (id: ConnectorId) => failed(id) };
    expect((await pollTool(port, 'github', 0)).phase).toBe('waiting');
    expect((await pollTool(port, 'github', POLL_TRIES - 1)).phase).toBe('failed');
    expect((await pollTool({ probe: async id => verified(id) }, 'github', 3)).phase).toBe('connected');
    expect(toolBusy({ phase: 'verifying' })).toBe(true);
    expect(toolBusy({ phase: 'waiting' })).toBe(false);
  });
});
