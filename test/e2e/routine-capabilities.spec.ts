// Native routine approvals expose exact connector scope and on-demand grants; first runs on main per ADR 0027.
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// @ts-expect-error shared native capture helper has no TypeScript declarations
import { captureRoutineCapabilities } from '../../scripts/dev-visual-capabilities.mjs';
test('approves exact connector effects and manual grants without suggesting a schedule', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await captureRoutineCapabilities(app, page, async (name: string) => {
      if (name === 'routine-connector-approval') {
        const modal = page.getByTestId('qwin-flow-definition');
        await expect(modal).toContainText('qa-notes / add_note');
        await expect(modal).toContainText('un solo commento di analisi per run');
        await expect(modal).toContainText('{{message}}');
      } else {
        const modal = page.getByTestId('qwin-flow-automation');
        await expect(modal).toContainText('su richiesta');
        await expect(modal).not.toContainText('in automatico?');
      }
      await shot(page, name);
    });
  } finally { await app.close(); }
});
