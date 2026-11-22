// Unit tests for multi-harness provider usage normalizers and local collectors (src/main/brain/provider-usage.ts).
// Pure fixtures and injected fetch/fs only — no real network, no real processes, no secrets (AGENTS.md rule 7).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  collectClaudeUsage,
  collectCodexUsage,
  collectCursorUsage,
  collectOpenCodeUsage,
  normalizeAntigravityUsage,
  normalizeClaudeOAuthUsage,
  normalizeCodexNotification,
  normalizeCodexUsage,
  normalizeCursorUsage,
  normalizeOpenCodeGoUsage,
} from '../../../src/main/brain/provider-usage';
import { tmpDir } from './helpers';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const okJson = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('provider-usage normalizers', () => {
  it('normalizes Claude OAuth usage: 5h, 7d, model-scoped weekly, Max 20x plan and extra credits', () => {
    const u = normalizeClaudeOAuthUsage({
      five_hour: { utilization: 42.3, resets_at: '2026-11-22T15:00:00Z' },
      seven_day: { utilization: 100, resets_at: '2026-11-27T08:00:00Z' },
      limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'Sonnet' } }, percent: 25, resets_at: '2026-11-27T08:00:00Z' }],
      extra_usage: { is_enabled: true, used_credits: 450, monthly_limit: 5000 },
    }, { subscriptionType: 'max', rateLimitTier: 'claude_max_20x', email: 'dev@example.com' }, NOW);
    expect(u.status).toBe('ok');
    expect(u.planLabel).toBe('Max 20x');
    expect(u.accountEmail).toBe('dev@example.com');
    expect(u.windows).toEqual([
      { kind: 'five-hour', label: '5h', usedPercent: 42.3, resetsAt: Date.parse('2026-11-22T15:00:00Z') },
      { kind: 'weekly', label: '7g', usedPercent: 100, resetsAt: Date.parse('2026-11-27T08:00:00Z') },
      { kind: 'weekly', label: '7g · Sonnet', model: 'sonnet', usedPercent: 25, resetsAt: Date.parse('2026-11-27T08:00:00Z') },
    ]);
    expect(u.creditsDetail).toBe('$4.50 / $50.00');
  });

  it('normalizes Cursor DashboardService usage: auto/3P pools, billing cycle reset and on-demand spend', () => {
    const cycleEnd = Date.parse('2026-12-01T00:00:00Z');
    const u = normalizeCursorUsage({
      billingCycleEnd: String(cycleEnd),
      planUsage: { totalPercentUsed: 70, autoPercentUsed: 64.4, apiPercentUsed: 28 },
      spendLimitUsage: { overallLimit: 5000, overallUsed: 1250 },
    }, { planInfo: { planName: 'Pro' } }, 'dev@example.com', NOW);
    expect(u.status).toBe('ok');
    expect(u.planLabel).toBe('Pro');
    expect(u.windows).toEqual([
      { kind: 'plan', label: 'Piano', usedPercent: 64.4, resetsAt: cycleEnd },
      { kind: 'plan', label: 'Modelli 3P', model: '3p', usedPercent: 28, resetsAt: cycleEnd },
      { kind: 'spend', label: 'On-demand', usedPercent: 25, resetsAt: cycleEnd, cost: { usedUsdCents: 1250, limitUsdCents: 5000 } },
    ]);
  });

  it('normalizes Codex wham/usage and app-server account/rateLimits/updated notifications', () => {
    const u = normalizeCodexUsage({
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 18, reset_at: Math.floor(NOW / 1000) + 3600, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 74.2, reset_at: Math.floor(NOW / 1000) + 86_400 * 3, limit_window_seconds: 604_800 },
      },
    }, 'dev@example.com', NOW);
    expect(u.status).toBe('ok');
    expect(u.planLabel).toBe('Plus');
    expect(u.windows.map(w => [w.kind, w.label, w.usedPercent])).toEqual([['five-hour', '5h', 18], ['weekly', '7g', 74.2]]);

    const live = normalizeCodexNotification({
      rateLimits: {
        planType: 'pro',
        primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: Math.floor(NOW / 1000) + 1800 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: Math.floor(NOW / 1000) + 86_400 },
      },
    }, NOW)!;
    expect(live.status).toBe('ok');
    expect(live.planLabel).toBe('Pro');
    expect(live.source).toBe('stream');
    expect(live.windows.map(w => [w.kind, w.usedPercent])).toEqual([['five-hour', 55], ['weekly', 40]]);
  });

  it('normalizes OpenCode Go usage and Antigravity statusLine quota buckets', () => {
    const oc = normalizeOpenCodeGoUsage({
      rollingUsage: { usagePercent: 12, resetInSec: 3600 },
      weeklyUsage: { usagePercent: 45, resetInSec: 86_400 * 2 },
    }, NOW);
    expect(oc.status).toBe('ok');
    expect(oc.windows.map(w => [w.kind, w.usedPercent, w.resetsAt])).toEqual([
      ['five-hour', 12, NOW + 3600_000],
      ['weekly', 45, NOW + 86_400_000 * 2],
    ]);

    const ag = normalizeAntigravityUsage({
      email: 'dev@example.com',
      plan_tier: 'Google AI Pro',
      quota: {
        'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 7200 },
        'gemini-weekly': { remaining_fraction: 0.81, reset_time: '2026-11-28T00:00:00Z' },
        '3p-weekly': { remaining_fraction: 0.5, reset_time: '2026-11-28T00:00:00Z' },
      },
    }, null, NOW);
    expect(ag.status).toBe('ok');
    expect(ag.planLabel).toBe('Google AI Pro');
    expect(ag.windows.map(w => [w.label, w.usedPercent])).toEqual([['5h', 25], ['7g', 19], ['7g · 3P', 50]]);
  });
});

describe('provider-usage collectors with injected local files and fetch', () => {
  it('reads Claude OAuth credentials and handles 429 cleanly without leaking tokens', async () => {
    const home = tmpDir();
    const fakeToken = ['tok', 'secret', 'claude'].join('-'); // built at run time: never a secret-shaped literal
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: fakeToken, refreshToken: 'ref', expiresAt: NOW + 60_000, subscriptionType: 'max', rateLimitTier: 'claude_max_5x' },
    }));
    const seenAuth: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      seenAuth.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''));
      return okJson({ five_hour: { utilization: 15, resets_at: '2026-11-22T15:00:00Z' }, seven_day: { utilization: 33, resets_at: '2026-11-27T08:00:00Z' } });
    }) as typeof fetch;
    const res = await collectClaudeUsage({ home, env: {}, fetchFn, now: () => NOW });
    expect(res.status).toBe('ok');
    expect(res.planLabel).toBe('Max 5x');
    expect(res.windows.map(w => w.usedPercent)).toEqual([15, 33]);
    expect(seenAuth).toEqual([`Bearer ${fakeToken}`]);
    expect(JSON.stringify(res)).not.toContain(fakeToken);

    const throttled = await collectClaudeUsage({ home, env: {}, fetchFn: (async () => okJson({}, 429)) as typeof fetch, now: () => NOW });
    expect(throttled.status).toBe('error');
    expect(throttled.message).toMatch(/429/);
  });

  it('reads Cursor auth.json and queries DashboardService endpoints', async () => {
    const home = tmpDir(), appData = tmpDir();
    fs.mkdirSync(path.join(appData, 'Cursor'), { recursive: true });
    fs.writeFileSync(path.join(appData, 'Cursor', 'auth.json'), JSON.stringify({ accessToken: 'tok-cursor' }));
    const fetchFn = (async (url: string | URL | Request) => {
      const s = String(url);
      if (s.endsWith('GetPlanInfo')) return okJson({ planInfo: { planName: 'Pro' } });
      return okJson({ billingCycleEnd: NOW + 86_400_000, planUsage: { totalPercentUsed: 52 } });
    }) as typeof fetch;
    const res = await collectCursorUsage({ home, appData, env: {}, platform: 'win32', fetchFn, now: () => NOW });
    expect(res.status).toBe('ok');
    expect(res.planLabel).toBe('Pro');
    expect(res.windows[0]?.usedPercent).toBe(52);
    expect(JSON.stringify(res)).not.toContain('tok-cursor');
  });

  it('reads Codex auth.json and OpenCode OpenAI OAuth tokens', async () => {
    const home = tmpDir();
    const jwt = makeJwt({ email: 'u@example.com', exp: Math.floor(NOW / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1' } });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: jwt, refresh_token: 'r' } }));
    const fetchFn = (async () => okJson({
      plan_type: 'plus',
      rate_limit: { secondary_window: { used_percent: 61, reset_at: Math.floor(NOW / 1000) + 86_400, limit_window_seconds: 604_800 } },
    })) as typeof fetch;
    const codex = await collectCodexUsage({ home, env: {}, fetchFn, now: () => NOW });
    expect(codex.status).toBe('ok');
    expect(codex.windows[0]?.usedPercent).toBe(61);

    fs.mkdirSync(path.join(home, '.local', 'share', 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'share', 'opencode', 'auth.json'), JSON.stringify({
      openai: { type: 'oauth', access: jwt, accountId: 'acc-1', expires: NOW + 60_000 },
    }));
    const oc = await collectOpenCodeUsage({ home, env: {}, fetchFn, now: () => NOW });
    expect(oc.status).toBe('ok');
    expect(oc.planLabel).toBe('OpenAI · Plus');
    expect(oc.windows[0]?.usedPercent).toBe(61);
  });
});
