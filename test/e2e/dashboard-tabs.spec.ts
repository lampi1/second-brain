// Dashboard tabs: the title and the tab bar stay in the same place on every tab (the content does not jump when
// switching); the Dashboard holds statistics only (ADR 0077), and the brain map, now the Mappa page's "Note del brain"
// view, keeps its controls (search, overview, 3D, zoom, legend) inside the map as an overlay toolbar. Frozen demo with the brain-ui fixture; screenshots in test-results/shots/dashboard-*.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, openNotesMap, shot } from './helpers';

test('the Dashboard header keeps its place on every tab and the notes map hosts its own controls', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-dash-tabs-'));
  const tools = path.join(brain, 'ops', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  const fixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
  fs.copyFileSync(path.join(fixture, 'brain-site.mjs'), path.join(tools, 'brain-site.mjs'));
  fs.copyFileSync(path.join(fixture, 'data.mjs'), path.join(tools, 'brain-ui-data.mjs'));
  const { app, page } = await launchDemo({ env: { SB_BRAIN: brain } });
  try {
    await page.getByTestId('nav-dashboard').click();
    const dashboard = page.getByTestId('dashboard');
    await expect(dashboard).toBeVisible();
    const title = dashboard.getByRole('heading', { level: 1, name: 'Dashboard' });
    const tabs = dashboard.getByRole('tablist', { name: 'Dashboard' });
    const place = async () => {
      const [h, t] = [await title.boundingBox(), await tabs.boundingBox()];
      return h && t ? `${Math.round(h.y)}/${Math.round(t.y)}/${Math.round(t.height)}` : 'hidden';
    };
    const seen: Record<string, string> = {};
    await expect(page.getByRole('tab', { name: 'Mappa brain' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Costi' })).toHaveCount(0); // costs live under Andamento → Costi (#125)
    for (const [name, file] of [['Mappa agenti', 'agents'], ['Errori', 'errors']] as const) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await shot(page, `dashboard-tab-${file}`);
      await expect(title).toBeVisible();
      seen[name] = await place();
    }
    expect(new Set(Object.values(seen)).size, JSON.stringify(seen)).toBe(1);

    // the map's commands are drawn inside the map itself (Mappa → Note del brain)
    await openNotesMap(page);
    await expect(page.locator('.dash-label').first()).toBeVisible();
    const map = page.getByTestId('dash-map');
    await expect(map).toBeVisible();
    const toolbar = map.getByTestId('dash-map-toolbar');
    await expect(toolbar.getByLabel('Cerca note')).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Esplora in 3D' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Vista completa' })).toBeVisible();
    await expect(map.getByRole('button', { name: 'Ingrandisci' })).toBeVisible();
    await expect(map.getByLabel('Legenda')).toBeVisible();
    const [m, b] = [await map.boundingBox(), await toolbar.boundingBox()];
    expect(m && b && b.y >= m.y && b.x >= m.x && b.x + b.width <= m.x + m.width + 1).toBe(true);
    await map.getByRole('button', { name: 'Ingrandisci' }).click();
    await expect(map.getByRole('button', { name: 'Riduci' })).toBeEnabled();
    await shot(page, 'dashboard-map-controls');
  } finally { await app.close(); }
});
