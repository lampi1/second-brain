// Main-only visual gate for provider children under collapsed/expanded parents and the Orchestrator: each sub-agent names
// the role it runs as (or "nessun agente"), and a parent whose turn ended reads "in attesa" while one works (#69).
// Uses frozen demo telemetry; the unit suites separately exercise provider event parsing and lifecycle updates.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('child activity at work stays visible beneath each parent strip and the Orchestrator; ended children leave', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const work = page.getByTestId('child-strips-fix');
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
    await expect(work.getByTestId('child-strip')).toHaveCount(2);
    await expect(work.locator('[data-child-kind="shell"]')).toContainText('dotnet test');
    await expect(work.locator('[data-child-state="completed"]')).toHaveCount(0);
    await expect(work.getByTestId('child-time').first()).toBeVisible();
    // the role each sub-agent runs as; a command names none
    await expect(work.locator('[data-child-kind="agent"]').getByTestId('child-agent')).toHaveText('Scout');
    await expect(work.locator('[data-child-kind="shell"]').getByTestId('child-agent')).toHaveCount(0);
    await expect(page.getByTestId('child-strips-orchestrator').locator('[data-child-key="claude:task:a1"]').getByTestId('child-agent')).toHaveText('nessun agente');
    const parentBox = (await page.getByTestId('tile-chat-fix').boundingBox())!;
    const childBox = (await work.boundingBox())!;
    expect(childBox.x).toBeGreaterThan(parentBox.x);
    expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y + parentBox.height - 1);
    await expect(page.getByTestId('child-strips-orchestrator').getByTestId('child-strip')).toHaveCount(2);
    await expect(page.getByTestId('child-strips-sms')).toContainText('Riproduci il bug');
    await shot(page, 'child-strips-collapsed');
    await page.getByTestId('chat-expand-fix').click();
    await expect(work.getByTestId('child-strip')).toHaveCount(2);
    await work.scrollIntoViewIfNeeded();
    await shot(page, 'child-strips-expanded');
    await page.getByTestId('chat-max-fix').click();
    await expect(work.getByTestId('child-strip')).toHaveCount(2);
  } finally { await app.close(); }
});

test('a parent whose turn ended reads "in attesa" while its sub-agent works, "finito" once it ends (#69)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'fix'));
    expect(chat?.agentChildren?.children.some(c => c.kind === 'agent' && c.state === 'running')).toBe(true);
    const send = (patch: object) => app.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.webContents.send('chat:updated', next), { ...chat!, ...patch });
    await send({ state: 'idle' });
    await expect(page.getByTestId('chat-state-fix')).toHaveText('in attesa');
    await page.mouse.move(2, 2);
    await shot(page, 'child-strips-parent-waiting');
    await send({ state: 'idle', agentChildren: { ...chat!.agentChildren!, children: chat!.agentChildren!.children.map(c => ({ ...c, state: 'completed' })) } });
    await expect(page.getByTestId('chat-state-fix')).toHaveText('finito');
    await expect(page.getByTestId('child-strips-fix')).toHaveCount(0);
  } finally { await app.close(); }
});
