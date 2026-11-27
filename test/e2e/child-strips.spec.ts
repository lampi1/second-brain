// Main-only visual gate for provider children of closed/open strips (ADR 0366: «↳ n» and the ⓘ when closed, the rows when
// open) and of the Orchestrator: each sub-agent names
// the role it runs as (or the engine's type, «Explore · sola lettura», #356), and a parent whose turn ended reads "in attesa" while one works (#69).
// Uses frozen demo telemetry; the unit suites separately exercise provider event parsing and lifecycle updates.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('child activity: a small «↳ n» on a closed strip with the details in its ⓘ, the full rows when open and on the Orchestrator', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const work = page.getByTestId('child-strips-fix');
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
    // on a closed strip they are a small count, each one a line of the ⓘ (ADR 0366): the rows only when it opens
    await expect(page.getByTestId('strip-subs-fix')).toHaveText('↳ 2');
    await expect(work).toHaveCount(0);
    await expect(page.getByTestId('strip-info-fix')).toHaveAttribute('aria-label', /↳ comando: dotnet test/);
    await expect(page.getByTestId('strip-info-fix')).toHaveAttribute('aria-label', /↳ sottoagente/);
    // the Orchestrator keeps its rows, with the time (ADR 0311)
    await expect(page.getByTestId('child-strips-orchestrator').getByTestId('child-time').first()).toBeVisible();
    await expect(page.getByTestId('child-strips-orchestrator').locator('[data-child-key="claude:task:a1"]').getByTestId('child-agent')).toHaveText('Explore · sola lettura'); // the engine type (#356)
    await expect(page.getByTestId('child-strips-orchestrator').getByTestId('child-strip')).toHaveCount(2);
    await expect(page.getByTestId('strip-info-sms')).toHaveAttribute('aria-label', /Riproduci il bug/);
    await page.getByTestId('strip-info-fix').hover();
    await shot(page, 'child-strips-collapsed');
    await page.mouse.move(2, 2);
    await page.getByTestId('chat-expand-fix').click();
    await expect(work.getByTestId('child-strip')).toHaveCount(2);
    await expect(work.locator('[data-child-state="completed"]')).toHaveCount(0);
    await expect(work.locator('[data-child-kind="shell"]')).toContainText('dotnet test');
    // the role each sub-agent runs as; a command names none
    await expect(work.locator('[data-child-kind="agent"]').getByTestId('child-agent')).toHaveText('Scout');
    await expect(work.locator('[data-child-kind="shell"]').getByTestId('child-agent')).toHaveCount(0);
    await work.scrollIntoViewIfNeeded();
    await shot(page, 'child-strips-expanded');
  } finally { await app.close(); }
});

test('a parent whose turn ended reads "aspetta sotto-agenti" while its sub-agent works, "finito" once it ends (#69)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'fix'));
    expect(chat?.agentChildren?.children.some(c => c.kind === 'agent' && c.state === 'running')).toBe(true);
    const send = (patch: object) => app.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.webContents.send('chat:updated', next), { ...chat!, ...patch });
    await send({ state: 'idle' });
    await expect(page.getByTestId('chat-state-fix')).toHaveText('aspetta sotto-agenti');
    await page.mouse.move(2, 2);
    await shot(page, 'child-strips-parent-waiting');
    await send({ state: 'idle', agentChildren: { ...chat!.agentChildren!, children: chat!.agentChildren!.children.map(c => ({ ...c, state: 'completed' })) } });
    await expect(page.getByTestId('chat-state-fix')).toHaveText('finito');
    await expect(page.getByTestId('strip-subs-fix')).toHaveCount(0);
  } finally { await app.close(); }
});
