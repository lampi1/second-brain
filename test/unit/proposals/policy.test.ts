// The Proposte policy and its ledger (ADR 0193): the Wilson bound over a group's decisions (an undo after a yes is a
// no, nothing goes by itself below 10 decisions), the 5% undo check over the last 20 auto-applied cards and the
// threshold it raises, the groups and cards that never go by themselves, the reason line, the week's count, the
// ledger's persistence and corrupt read, and the data pack's «decisions» section.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() }, errText: (e: unknown) => String(e instanceof Error ? e.message : e) }));
import { DecisionLedger, LEDGER_FILE, LEDGER_MAX, readLedger, type DecisionEntry } from '../../../src/main/proposals/ledger';
import { allPolicies, autoNow, groupPolicy, neverAuto, POLICY, reversible, savedThisWeek, weekStart, whyAsked } from '../../../src/main/proposals/policy';
import { buildPack, PACK_SECTIONS } from '../../../src/main/brainmodel/research-pack';
import { AUTO_GROUPS, type Proposal, type ProposalGroup } from '../../../src/shared/proposals';

const NOW = Date.parse('2026-10-29T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-policy-'));
let seq = 0;
const entry = (group: ProposalGroup, decision: 'approve' | 'reject', x: Partial<DecisionEntry> = {}): DecisionEntry => ({
  id: `e${seq++}`, card: `research:${seq}`, at: NOW - 1_000_000 + seq, source: 'research', group, ask: 'research', applied: false, reversible: true,
  evidence: false, size: 10, decision, by: 'user', title: 't', ...x,
});
const many = (n: number, group: ProposalGroup, decision: 'approve' | 'reject' = 'approve', x: Partial<DecisionEntry> = {}) => Array.from({ length: n }, () => entry(group, decision, x));
const card = (x: Partial<Proposal> = {}): Proposal => ({
  id: 'research:r1', source: 'research', group: 'rule', applied: false, title: 'Artisan lancia i test', content: '> lancia i test prima di dire fatto',
  ask: { kind: 'research', finding: 'rule', adds: 'una regola', removes: '', why: 'tre correzioni', expected: '', risk: '', evidence: [], sources: [] },
  facts: [], provenance: { who: { kind: 'maintenance', id: 'research' }, at: new Date(NOW).toISOString(), evidence: [] }, canApprove: true, canReject: true, ...x,
});

describe('proposals policy (ADR 0193)', () => {
  it('a group goes by itself only when the 90% Wilson lower bound of its yes share reaches 0.95', () => {
    expect(POLICY).toMatchObject({ min: 10, target: 0.95, z: 1.645, autoWindow: 20, maxUndone: 0.05 });
    // all yes: 51 is not enough (low 0.9496), 52 is (0.9505)
    expect(groupPolicy('rule', many(51, 'rule'))).toMatchObject({ mode: 'ask', n: 51, yes: 51, no: 0 });
    const p = groupPolicy('rule', many(52, 'rule'));
    expect(p.mode).toBe('auto');
    expect(p.low).toBeCloseTo(0.9505, 3);
    // one no needs about 87 decisions
    expect(groupPolicy('skill', [...many(1, 'skill', 'reject'), ...many(85, 'skill')]).mode).toBe('ask');
    expect(groupPolicy('skill', [...many(1, 'skill', 'reject'), ...many(86, 'skill')]).mode).toBe('auto');
    // other groups' decisions never count
    expect(groupPolicy('fact', many(60, 'rule'))).toMatchObject({ mode: 'ask', n: 0, low: null });
  });

  it('the first decisions only record: below 10 nothing goes by itself, whatever the share', () => {
    const p = groupPolicy('script', many(9, 'script'));
    expect(p).toMatchObject({ mode: 'ask', n: 9, yes: 9 });
    expect(whyAsked(card({ group: 'script' }), p)).toEqual({ code: 'few', n: 9 });
    expect(whyAsked(card(), groupPolicy('rule', []))).toEqual({ code: 'first' });
  });

  it('an undo after a yes counts as a no', () => {
    const list = [...many(51, 'rule'), entry('rule', 'approve', { undoneAt: NOW })];
    const p = groupPolicy('rule', list);
    expect(p).toMatchObject({ n: 52, yes: 51, no: 1, undone: 1, mode: 'ask' });
    expect(whyAsked(card(), p)).toEqual({ code: 'rejected', no: 1, n: 52 });
  });

  it('more than 5% of the last 20 auto-applied undone sends the group back to asking, with fresh decisions only and a higher bar', () => {
    const user = many(60, 'rule');
    // 1 of 20 undone = 5%: not more than 5%, still the bar rises to 0.97 and the undo counts as a no
    const one = [...user, ...many(19, 'rule', 'approve', { by: 'auto' }), entry('rule', 'approve', { by: 'auto', undoneAt: NOW })];
    const p1 = groupPolicy('rule', one);
    expect(p1).toMatchObject({ autoN: 20, autoUndone: 1, mode: 'ask', yes: 79, n: 80 });
    expect(p1.threshold).toBeCloseTo(0.97);
    // 2 of 20 = 10%: back to asking; only decisions after the last undo count
    const two = [...user, ...many(18, 'rule', 'approve', { by: 'auto' }), entry('rule', 'approve', { by: 'auto', undoneAt: NOW - 10 }), entry('rule', 'approve', { by: 'auto', undoneAt: NOW })];
    const p2 = groupPolicy('rule', two);
    expect(p2).toMatchObject({ mode: 'ask', autoUndone: 2, n: 0 });
    expect(p2.threshold).toBeCloseTo(0.99);
    expect(whyAsked(card(), p2)).toEqual({ code: 'undone', n: 2 });
    // the bar never passes 0.99
    expect(groupPolicy('rule', [...user, ...many(5, 'rule', 'approve', { by: 'auto', undoneAt: NOW })]).threshold).toBeCloseTo(0.99);
  });

  it('never by itself: role, setting, forget, issue, tiers, trials, tools/permissions/hooks, production, external', () => {
    expect([...AUTO_GROUPS].sort()).toEqual(['fact', 'learning', 'rule', 'script', 'skill']);
    for (const g of ['role', 'setting', 'forget', 'issue'] as const) expect(groupPolicy(g, many(200, g)).mode).toBe('never');
    const auto = groupPolicy('rule', many(60, 'rule'));
    expect(autoNow(card(), auto)).toBe(true);
    const nope: [Partial<Proposal>, string][] = [
      [{ group: 'issue', ask: { ...card().ask, finding: 'app-bug' } as Proposal['ask'] }, 'external'],
      [{ ask: { ...card().ask, finding: 'app-idea' } as Proposal['ask'] }, 'external'],
      [{ source: 'setting', group: 'setting', ask: { kind: 'setting', label: 'x', before: '1', after: '2' } }, 'setting'],
      [{ source: 'tier', group: 'role', ask: { kind: 'tier', roles: ['scout'], skills: [] } }, 'permissions'],
      [{ source: 'trial', group: 'role', applied: true, ask: { kind: 'trial', role: 'scout', version: 2, baseline: 1 } }, 'permissions'],
      [{ group: 'role' }, 'role'],
      [{ group: 'forget' }, 'forget'],
      [{ group: 'skill', content: '---\nname: x\nallowed-tools: Bash\n---\nbody' }, 'permissions'],
      [{ group: 'script', code: [{ file: 'scripts/x.ps1', lang: 'powershell', text: 'Invoke-Sql -Server prod-db' }] }, 'production'],
      [{ provenance: { ...card().provenance, files: ['.claude/settings.json'] } }, 'permissions'],
    ];
    for (const [x, what] of nope) {
      const c = card(x);
      expect(neverAuto(c), JSON.stringify(x)).toBe(what);
      expect(autoNow(c, { ...auto, group: c.group })).toBe(false);
      expect(whyAsked(c, auto)).toEqual({ code: 'never', what });
    }
    // «products» is no production
    expect(neverAuto(card({ content: 'i products del catalogo' }))).toBeNull();
  });

  it('a card that cannot be undone from here, or whose approve side is blocked, is asked', () => {
    const auto = groupPolicy('rule', many(60, 'rule'));
    const pulse = card({ id: 'pulse:a', source: 'pulse', ask: { kind: 'rule', role: 'scout' } });
    expect(reversible(pulse)).toBe(false);
    expect(autoNow(pulse, auto)).toBe(false);
    expect(whyAsked(pulse, auto)).toEqual({ code: 'irreversible' });
    expect(reversible(card({ source: 'change', applied: true, canReject: false }))).toBe(false);
    expect(reversible(card({ source: 'change', applied: true }))).toBe(true);
    const blocked = card({ canApprove: false, blocked: ['x'] });
    expect(autoNow(blocked, auto)).toBe(false);
    expect(whyAsked(blocked, auto)).toEqual({ code: 'blocked' });
    expect(whyAsked(card(), groupPolicy('rule', [...many(2, 'rule', 'reject'), ...many(4, 'rule')]))).toEqual({ code: 'rejected', no: 2, n: 6 });
  });

  it('counts the cards saved since Monday, not those taken back', () => {
    const monday = weekStart(NOW);
    expect(new Date(monday).getDay()).toBe(1);
    expect(monday).toBeLessThanOrEqual(NOW);
    expect(NOW - monday).toBeLessThan(7 * 86_400_000);
    const list = [entry('rule', 'approve', { by: 'auto', at: NOW }), entry('rule', 'approve', { by: 'auto', at: NOW, undoneAt: NOW }), entry('rule', 'approve', { at: NOW }), entry('rule', 'approve', { by: 'auto', at: monday - 1 })];
    expect(savedThisWeek(list, NOW)).toBe(1);
  });

  it('the ledger persists, stays bounded, marks undos only on approvals and keeps a corrupt file aside', () => {
    const dir = tmp();
    const l = new DecisionLedger(dir, () => NOW);
    const a = l.add({ card: 'change:c1', source: 'change', group: 'rule', ask: 'applied', applied: true, reversible: true, evidence: false, size: 3, decision: 'approve', by: 'user', title: 'x', changes: ['c1'], ms: 1200 });
    l.add({ card: 'change:c2', source: 'change', group: 'rule', ask: 'applied', applied: true, reversible: true, evidence: false, size: 3, decision: 'reject', by: 'user', title: 'y', changes: ['c2'] });
    expect(new DecisionLedger(dir).all()).toHaveLength(2);
    expect(readLedger(dir)[0]).toMatchObject({ card: 'change:c1', ms: 1200, changes: ['c1'], decision: 'approve' });
    expect(l.changeUndone('c2')).toEqual([]);
    expect(l.changeUndone('c1').map(e => e.id)).toEqual([a.id]);
    expect(new DecisionLedger(dir).get(a.id)?.undoneAt).toBe(NOW);
    expect(l.markUndone(a.id)).toBe(false);
    // bounded
    const big = tmp();
    fs.writeFileSync(path.join(big, LEDGER_FILE), JSON.stringify({ version: 1, entries: many(LEDGER_MAX + 5, 'rule') }));
    expect(new DecisionLedger(big).all()).toHaveLength(LEDGER_MAX);
    // corrupt: moved aside, never overwritten, the ledger starts empty (the policy asks again)
    const bad = tmp();
    fs.writeFileSync(path.join(bad, LEDGER_FILE), '{ not json');
    expect(readLedger(bad)).toEqual([]);
    const fresh = new DecisionLedger(bad, () => NOW);
    expect(fresh.all()).toEqual([]);
    expect(fs.readdirSync(bad).some(f => f.startsWith(`${LEDGER_FILE}.corrupt-`))).toBe(true);
    expect(fs.readFileSync(path.join(bad, fs.readdirSync(bad).find(f => f.includes('corrupt'))!), 'utf8')).toBe('{ not json');
    // invalid entries are dropped one by one
    const odd = tmp();
    fs.writeFileSync(path.join(odd, LEDGER_FILE), JSON.stringify({ entries: [entry('rule', 'approve'), { id: 'x', group: 'nope' }, null] }));
    expect(new DecisionLedger(odd).all()).toHaveLength(1);
  });

  it('the data pack has a «decisions» section with each group\'s counts and policy', () => {
    expect(PACK_SECTIONS).toContain('decisions');
    const ledger = [...many(52, 'rule'), ...many(3, 'issue', 'reject'), entry('skill', 'approve', { undoneAt: NOW })];
    const pack = buildPack({ now: NOW, runs: [], roles: [], past: [], appVersion: '1.0.0', state: { skills: [], rules: [], memory: [], changes: [], lastRun: null } as never, decisions: allPolicies(ledger) });
    expect(pack.decisions).toContain('- rule: applied by itself, with Annulla · 52 decisions: approved 52, rejected 0');
    expect(pack.decisions).toContain('- issue: always asked (never applied by itself) · 3 decisions: approved 0, rejected 3');
    expect(pack.decisions).toContain('- skill: asked · 1 decisions: approved 0, rejected 0, undone after approval 1');
    expect(pack.decisions).not.toContain('- fact:');
    expect(buildPack({ now: NOW, runs: [], roles: [], past: [], appVersion: '1.0.0', state: { skills: [], rules: [], memory: [], changes: [], lastRun: null } as never }).decisions).toContain('no decision recorded yet');
  });
});
