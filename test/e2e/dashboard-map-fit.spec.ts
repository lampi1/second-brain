// Brain map fit (issue #77): the 2D map in Dashboard → Mappa brain fills its panel, centred, with no overlapping
// labels at the default zoom, for the demo brain and for a large synthetic one (the brain-ui fixture plus 140 notes);
// "Adatta" re-fits after zooming, and the map re-fits when the window changes shape. Frozen demo; screenshots in
// test-results/shots/dashboard-map-fit-*.png.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, setSize, shot } from './helpers';

function brain(extra: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-map-fit-'));
  const tools = path.join(root, 'ops', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  const fixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
  fs.copyFileSync(path.join(fixture, 'brain-site.mjs'), path.join(tools, 'brain-site.mjs'));
  fs.copyFileSync(path.join(fixture, 'data.mjs'), path.join(tools, 'brain-ui-data.mjs'));
  if (extra) fs.writeFileSync(path.join(root, 'MAP_EXTRA'), String(extra));
  return root;
}

/** The nodes' bounding box against the drawing area, and how many visible labels overlap another one. */
async function measure(page: Page) {
  return page.getByTestId('dash-map').evaluate(map => {
    const svg = map.querySelector('svg')!.getBoundingClientRect();
    const dots = [...map.querySelectorAll('.dash-node-dot')].map(d => d.getBoundingClientRect());
    const labels = [...map.querySelectorAll('.dash-label rect')].map(r => r.getBoundingClientRect());
    const x0 = Math.min(...dots.map(d => d.left)), x1 = Math.max(...dots.map(d => d.right));
    const y0 = Math.min(...dots.map(d => d.top)), y1 = Math.max(...dots.map(d => d.bottom));
    let overlaps = 0, outside = 0;
    labels.forEach((a, i) => {
      if (a.left < svg.left - 1 || a.right > svg.right + 1 || a.top < svg.top - 1 || a.bottom > svg.bottom + 1) outside++;
      for (const b of labels.slice(i + 1)) if (a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) overlaps++;
    });
    return {
      nodes: dots.length, labels: labels.length, overlaps, outside,
      fillX: (x1 - x0) / svg.width, fillY: (y1 - y0) / svg.height,
      offX: ((x0 + x1) / 2 - (svg.left + svg.width / 2)) / svg.width, offY: ((y0 + y1) / 2 - (svg.top + svg.height / 2)) / svg.height,
    };
  });
}

function expectFilled(m: Awaited<ReturnType<typeof measure>>) {
  const facts = JSON.stringify(m);
  expect(m.fillX, facts).toBeGreaterThan(.75);
  expect(m.fillY, facts).toBeGreaterThan(.7);
  expect(Math.abs(m.offX), facts).toBeLessThan(.05);
  expect(Math.abs(m.offY), facts).toBeLessThan(.05);
  expect(m.overlaps, facts).toBe(0);
  expect(m.outside, facts).toBe(0);
  expect(m.labels, facts).toBeGreaterThan(0);
}

async function openMap(page: Page, large: boolean) {
  await page.getByTestId('nav-dashboard').click();
  await page.getByRole('tab', { name: 'Mappa brain' }).click();
  const dots = page.getByTestId('dash-map').locator('.dash-node-dot');
  if (large) await expect(dots).toHaveCount(100); // the map draws at most 100 of the 150+ nodes
  else await expect(dots.first()).toBeVisible();
  await expect(page.locator('.dash-label').first()).toBeVisible();
}

for (const [name, extra] of [['demo', 0], ['large', 140]] as const) {
  test(`the brain map fills its panel, centred and readable (${name} brain)`, async () => {
    const { app, page } = await launchDemo({ env: { SB_BRAIN: brain(extra) } });
    try {
      await openMap(page, extra > 0);
      expectFilled(await measure(page));
      await shot(page, `dashboard-map-fit-${name}`);

      // zoom in, then "Adatta" shows the whole map again
      const map = page.getByTestId('dash-map');
      await map.getByRole('button', { name: 'Ingrandisci' }).click();
      await map.getByRole('button', { name: 'Ingrandisci' }).click();
      await expect(map.locator('output')).toHaveText('200%');
      await map.getByRole('button', { name: 'Adatta' }).click();
      await expect(map.locator('output')).toHaveText('100%');
      expectFilled(await measure(page));

      // a narrower, taller window: the map re-fits to the new shape
      await setSize(app, 1100, 1000);
      await expect.poll(async () => (await measure(page)).fillX).toBeGreaterThan(.75);
      expectFilled(await measure(page));
      await shot(page, `dashboard-map-fit-${name}-narrow`);
      if (name === 'large') {
        await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await shot(page, `dashboard-map-fit-${name}-light`);
      }
    } finally { await app.close(); }
  });
}
