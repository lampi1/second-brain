// E2E of the look the owner asked for in issue #85 (ADR 0079): Task and Agenti side by side, in the demo (no
// network, no tokens), dark and light. The two heads share the title's size and weight and the subtitle's color, and
// Task's detail pane wears Agenti's card surface (same radius, border and background). Screenshots for the side-by-side review:
// test-results/shots/look-{task,agenti}-{dark,light}.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, openAgentOverview, shot } from './helpers';

/** The computed style of the page's title and subtitle, and of its first card. */
async function look(page: Page, title: string, sub: string, card: string) {
  return page.evaluate(([t, s, c]) => {
    const st = (sel: string) => { const el = document.querySelector(sel); if (!el) return null; const x = getComputedStyle(el); return { size: x.fontSize, weight: x.fontWeight, color: x.color, radius: x.borderTopLeftRadius, border: x.borderTopColor, bg: x.backgroundImage }; };
    return { title: st(t!), sub: st(s!), card: st(c!) };
  }, [title, sub, card]);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`Task and Agenti share one look (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    try {
      await page.evaluate(theme => window.sb.invoke('settings:set', { theme }), scheme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await page.getByTestId('nav-task').click();
      const dv = page.getByTestId('brain-page-task');
      await dv.getByTestId('task-refresh').click();
      await expect(dv.getByTestId('task-detail')).toBeVisible({ timeout: 30_000 });
      await expect(dv.getByTestId('task-refresh')).toBeEnabled();
      for (const x of await page.getByTestId('toast-close').all()) await x.click();
      await page.mouse.move(2, 2);
      const task = await look(page, '.tk-page .catalog-head h2', '.tk-page .catalog-head p', '.tk-detail');
      await shot(page, `look-task-${scheme}`);

      await openAgentOverview(page);
      await page.mouse.move(2, 2);
      const agents = await look(page, '.agent-overview .catalog-head h2', '.agent-overview .catalog-head p', '.catalog-grid .catalog-card .bm-face-front'); // the flip card's front face (#81)
      await shot(page, `look-agenti-${scheme}`);

      for (const k of ['size', 'weight'] as const) expect(task.title?.[k]).toBe(agents.title?.[k]);
      expect(task.sub?.color).toBe(agents.sub?.color);
      for (const k of ['radius', 'border', 'bg'] as const) expect(task.card?.[k]).toBe(agents.card?.[k]);
    } finally {
      await app.close();
    }
  });
}
