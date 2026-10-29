// «Modalità notte» (ADR 0191): the recommended option the app picks for an absent user (shared/away.ts), the night log
// and its recap (chats/away-log.ts), and the mode's life (attachAway: sleep blocked while on, recap when off).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recommendedAnswers, recommendedOption } from '../../src/shared/away';
import { attachAway, AwayLog, recapOf } from '../../src/main/chats/away-log';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const file = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-awaylog-')); roots.push(d); return path.join(d, 'away-log.json'); };

describe('recommendedOption', () => {
  it('takes only the option the agent marked as recommended', () => {
    expect(recommendedOption({ options: [{ label: 'No' }, { label: 'Sì (consigliato)' }] })).toBe('Sì (consigliato)');
    expect(recommendedOption({ options: [{ label: 'Rimando' }, { label: 'Lascio stare (Recommended)' }] })).toBe('Lascio stare (Recommended)');
    expect(recommendedOption({ options: [{ label: 'No' }, { label: 'Sì' }] })).toBeNull();
    expect(recommendedOption({ options: [] })).toBeNull();
  });
  it('leaves to the user what is reserved to them, whatever the agent recommends', () => {
    expect(recommendedOption({ question: 'Faccio il deploy in produzione?', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] })).toBeNull();
    expect(recommendedOption({ question: 'Invio la mail al cliente?', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] })).toBeNull();
    expect(recommendedOption({ question: 'Faccio il merge della PR?', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] })).toBeNull();
    expect(recommendedOption({ question: 'Aggiungo i test mancanti?', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] })).toBe('Sì (consigliato)');
  });
  it('answers every question by its text; one with no pick leaves the request to the user', () => {
    expect(recommendedAnswers([
      { question: 'Uno?', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] },
      { question: 'Quali?', multiSelect: true, options: [{ label: 'X' }, { label: 'Y (consigliato)' }] },
    ])).toEqual({ 'Uno?': 'Sì (consigliato)', 'Quali?': ['Y (consigliato)'] });
    expect(recommendedAnswers([{ question: 'Vuota?', multiSelect: false, options: [] }])).toBeNull();
    expect(recommendedAnswers([])).toBeNull();
  });
});

describe('the night log', () => {
  it('keeps the night across a restart and gives it once', () => {
    let now = 1_000;
    const f = file(), a = new AwayLog(f, () => now);
    a.start();
    a.add({ kind: 'picked', chatId: 'c1', title: 'Fix login', text: 'Apro la PR? → Sì (consigliato)' });
    now = 1_000 + 7 * 3_600_000;
    const b = new AwayLog(f, () => now);
    expect(b.since()).toBe(1_000);
    const night = b.finish();
    expect(night.entries).toHaveLength(1);
    expect(b.since()).toBeNull();
    expect(new AwayLog(f).finish().entries).toEqual([]);
  });
  it('the recap says what the app chose and what waits for the user', () => {
    const text = recapOf({ since: 0, entries: [
      { at: 1, kind: 'picked', title: 'Fix login', text: 'Apro la PR? → Sì (consigliato)' },
      { at: 2, kind: 'parked', title: 'Deploy', text: 'permesso non concesso, Bash: az webapp deploy' },
    ] }, [{ title: 'Scout', what: 'Quale ambiente?' }], 7.5 * 3_600_000);
    expect(text).toContain('dopo 7,5 h');
    expect(text).toContain('Scelto il consigliato · «Fix login»');
    expect(text).toContain('Aspettano te:');
    expect(text).toContain('Lasciato per te · «Deploy»');
    expect(text).toContain('Ancora aperto · «Scout»: Quale ambiente?');
    expect(recapOf({ since: null, entries: [] }, [])).toContain('Niente aspetta te.');
  });
});

describe('attachAway', () => {
  it('blocks sleep while on, settles what waits, and gives the recap when off', () => {
    const state = { on: false }, calls: string[] = [];
    let listener: ((c: { key: string }) => void) | undefined;
    const log = new AwayLog(file());
    attachAway({ on: () => state.on, log,
      chats: { settleForAway: () => { calls.push('settle'); return 0; }, openForUser: () => [], awayRecap: t => { calls.push(`recap:${t.split('\n')[0]}`); return true; } },
      onSettingChange: f => { listener = f; },
      blocker: { start: () => { calls.push('block'); return 7; }, stop: id => { calls.push(`unblock:${id}`); } } });
    state.on = true; listener!({ key: 'awayMode' });
    expect(log.since()).not.toBeNull();
    listener!({ key: 'theme' });
    state.on = false; listener!({ key: 'awayMode' });
    expect(calls).toEqual(['block', 'settle', 'unblock:7', expect.stringMatching(/^recap:Modalità notte spenta/)]);
    expect(log.since()).toBeNull();
  });
});

describe('workflow proposals while the user is away', () => {
  it('a mockup proposal is approved by the app and says so; off, it waits for the user', async () => {
    const { Workflows } = await import('../../src/main/workflows/service');
    const { workflowTools, AWAY_FEEDBACK } = await import('../../src/main/workflows/tools');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-awaywork-')); roots.push(dir);
    const service = new Workflows(path.join(dir, 'work.json')), state = { on: true }, logged: string[] = [];
    let row = service.create({ title: 'Ricerca', profile: 'feature', priority: 'normal', chatIds: [] });
    row = service.report({ id: row.id, expectedVersion: row.version, action: 'complete', summary: 'ok', evidence: 'requirements.md' });
    expect(row.stage).toBe('mockup');
    const tool = workflowTools(service, () => true, undefined, { on: () => state.on, log: e => logged.push(e.kind) }).find(t => t.name === 'app_work_report')!;
    const out = await tool.run({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Mockup A' }) as { status: string; events: { kind: string; text: string }[]; note: string };
    expect(out.status).toBe('active');
    expect(out.events.at(-1)).toMatchObject({ kind: 'approved', text: expect.stringContaining(AWAY_FEEDBACK) });
    expect(out.note).toMatch(/Modalità notte/);
    expect(logged).toEqual(['proposal']);
    state.on = false;
    const again = service.list()[0]!;
    const waiting = await tool.run({ id: again.id, expectedVersion: again.version, action: 'propose', summary: 'Mockup B' }) as { status: string };
    expect(waiting.status).toBe('approval');
  });
  it('the app\'s approval is marked on the event, never as the user\'s', async () => {
    const { Workflows } = await import('../../src/main/workflows/service');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-awaywork-')); roots.push(dir);
    const service = new Workflows(path.join(dir, 'work.json'));
    let row = service.create({ title: 'Ricerca', profile: 'feature', priority: 'normal', chatIds: [] });
    row = service.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Analisi' });
    expect(row.stage).toBe('analysis');
    const user = service.decide({ id: row.id, expectedVersion: row.version, proposalId: row.proposal!.id, approve: true });
    expect(user.events.at(-1)?.by).toBeUndefined();
  });
});
