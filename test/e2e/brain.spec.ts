// End-to-end: the real app pointed (SB_BRAIN) at a temporary fixture brain (never the user's): the brain's parsers, a
// fake chats.mjs and a fake data server. A new idea line reaches the page as a 'feed:events' event; settings change
// live with a change event and undo; an agent's protected change waits for confirmation; the brain data API, the
// estimate and the usage answer through the typed bridge.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FeedEvent, SettingChange } from '../../src/shared/contract';
import { launch, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain');

function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools', 'brain-site'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'parse.mjs'), path.join(d, 'ops', 'tools', 'brain-site', 'parse.mjs'));
  fs.copyFileSync(path.join(FIX, 'fake-brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.mkdirSync(path.join(d, 'harness', 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(d, 'harness', 'cursor', 'chats.mjs'), "console.log('- Claude · OS · Prova e2e · brain · 11/10, 09:00 · in corso · id e2e00001')\n");
  fs.writeFileSync(path.join(d, 'ideas.md'), '# Idee\n\n## 2026-10-10 · [personale] · Vecchia idea · `aperta`\n- **Idea:** x\n');
  return d;
}

type W = { __feed: FeedEvent[]; __changes: (SettingChange & { settings: unknown })[] };

test('brain: an idea line becomes a live feed event; settings change live, undo, protected proposals; data API', async () => {
  const brain = fixtureBrain();
  const { app, page } = await launch({ SB_BRAIN: brain });
  await expect(page.getByTestId('app')).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__feed = []; w.__changes = [];
    window.sb.on('feed:events', e => { w.__feed.push(...e); });
    window.sb.on('settings:changed', c => { w.__changes.push(c); });
  });
  // the live feed: give the watcher a moment after start, then append an idea "dell'IA"
  await page.waitForTimeout(500);
  fs.appendFileSync(path.join(brain, 'ideas.md'), "\n## 2026-10-11 · [personale] · Idea dal test e2e · `aperta`\n- **Idea:** arriva live\n- **Fonte:** IA, chat e2e\n");
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__feed.map(e => `${e.kind}|${e.title}|${e.label}|${e.who}`)), { timeout: 10000 })
    .toContain("idea|Idea dal test e2e|Idea aggiunta|dell'IA");
  const listed = await page.evaluate(() => window.sb.invoke('feed:list', undefined));
  expect(listed.some(e => e.title === 'Idea dal test e2e' && e.priority === 'normal')).toBe(true);

  // settings: the brain folder comes from SB_BRAIN (locked); a change is live, logged and undoable
  const s = await page.evaluate(() => window.sb.invoke('settings:get', undefined));
  expect(s.brainRoot).toBe(path.normalize(brain));
  expect(s.locked).toContain('brainRoot');
  const schema = await page.evaluate(() => window.sb.invoke('settings:schema', undefined));
  expect(schema.find(d => d.key === 'view')).toMatchObject({ protected: false, label: 'Vista', values: ['mosaico'] });
  await page.evaluate(() => window.sb.invoke('settings:set', { language: 'it' }));
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__changes.map(c => `${c.key}:${String(c.after)}:${c.by}`))).toContain('language:it:user');
  const [last] = await page.evaluate(() => window.sb.invoke('settings:history', { limit: 1 }));
  const undo = await page.evaluate(id => window.sb.invoke('settings:undo', { changeId: id }), last!.id);
  expect(undo).toMatchObject({ key: 'language', before: 'it', after: 'system', undoOf: last!.id });
  // an agent's request: a free key applies at once, a protected key becomes a proposal until the user clicks
  const free = await page.evaluate(() => window.sb.invoke('settings:propose', { key: 'theme', value: 'light', chatId: 'e2e' }));
  expect(free).toMatchObject({ applied: { key: 'theme', by: 'agent', chatId: 'e2e' } });
  const prot = await page.evaluate(() => window.sb.invoke('settings:propose', { key: 'dnd', value: true, reason: 'test' }));
  expect('proposal' in prot).toBe(true);
  expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).dnd).toBe(false);
  const pid = (prot as { proposal: { id: string } }).proposal.id;
  expect((await page.evaluate(() => window.sb.invoke('settings:pending', undefined))).map(p => p.id)).toEqual([pid]);
  const ok = await page.evaluate(id => window.sb.invoke('settings:confirm', { proposalId: id, accept: true }), pid);
  expect(ok.change).toMatchObject({ key: 'dnd', after: true, by: 'user', proposalId: pid });
  await expect(page.evaluate(() => window.sb.invoke('settings:set', { view: 'griglia' as never }))).rejects.toThrow(/Vista/);

  // the brain's data server through the GET-only proxy; /api/send is never forwarded
  const tables = await page.evaluate(() => window.sb.invoke('brain:api', { path: '/api/tables' }));
  expect(tables).toEqual({ ok: true, data: { root: brain, ideas: 2 } });
  expect(await page.evaluate(() => window.sb.invoke('brain:api', { path: '/api/send' }))).toMatchObject({ ok: false });

  // the job ledger: real cost and time only (ADR 0053 removed the per-job estimate); usage without cost.mjs says so
  const rec = await page.evaluate(() => window.sb.invoke('estimate:record', { harness: 'claude', model: 'claude-opus-5-5', effort: 'high', prompt: 'Fix it', actual: { usd: 1, minutes: 3, tokensIn: null, tokensOut: null, turns: 1 } }));
  expect(rec.id).toMatch(/^job_/);
  const usage = await page.evaluate(() => window.sb.invoke('app:usage', undefined));
  expect(usage).toMatchObject({ costKnown: false, fiveHourPct: null });

  // the feed event as the page received it, for the record (the UI module draws the feed itself)
  await page.evaluate(() => {
    const w = window as unknown as W;
    const pre = document.createElement('pre');
    pre.setAttribute('data-testid', 'brain-e2e');
    pre.style.cssText = 'position:fixed;left:16px;top:64px;right:16px;margin:0;padding:12px 16px;border-radius:8px;background:#ffffff;color:#1b2030;border:1px solid #d5dbe6;font:13px/1.5 Consolas,monospace;white-space:pre-wrap';
    pre.textContent = `feed:events ricevuti dalla pagina\n\n${w.__feed.map(e => `${e.label}: ${e.title} (${e.priority}${e.who ? `, ${e.who}` : ''})`).join('\n')}\n\nsettings:changed\n\n${w.__changes.map(c => `${c.key}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)} (${c.by})`).join('\n')}`;
    document.body.appendChild(pre);
  });
  await shot(page, 'brain-feed');
  await app.close();
});
