// E2E of diagrams and charts in a chat reply (components/VisualBlock.tsx; frozen demo, dark and light): a ```mermaid
// block becomes a diagram image (mermaid loaded on demand, strict, shown as an <img>, a click opens it large), a
// ```chart block a Chart.js canvas; "Codice" shows the source; an invalid spec stays a code block. No remote script,
// no eval: the app's CSP is untouched and nothing is reported against it. Screenshots in test-results/shots/visuals-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { say(c: string, t: string): void };
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.say(c, t); }, [chatId, text] as const);

const DIAGRAM = [
  'Ecco come passa una richiesta dall\'Orchestrator ai ruoli:',
  '```mermaid',
  'flowchart TD',
  '  U([Utente]) --> O{Orchestrator}',
  '  O -->|domanda breve| R[Risponde da sé]',
  '  O -->|un pezzo| A[Artisan]',
  '  O -->|più pezzi| S[Strategist]',
  '  S --> A & SC[Scout]',
  '  A --> SE[Sentinel]',
  '  SE -->|verde| D([Fatto])',
  '```',
].join('\n');
const CHARTS = [
  'E quanto è costata la settimana, per motore:',
  '```chart',
  '{"type":"bar","title":"Costo per giorno","unit":"$","labels":["lun","mar","mer","gio","ven"],"series":[{"name":"Claude","data":[4.2,6.8,3.1,7.5,5.4]},{"name":"Cursor","data":[1.1,2.4,0.8,3.2,1.9]}]}',
  '```',
  'La ripartizione del lavoro:',
  '```chart',
  '{"type":"doughnut","labels":["Artisan","Scout","Sentinel","Herald"],"series":[{"name":"Ore","data":[14,6,5,2]}]}',
  '```',
  'Questo invece non si disegna:',
  '```chart',
  '{"type":"bar","labels":["a"],"series":[{"data":["tanti"]}]}',
  '```',
].join('\n');

for (const scheme of ['dark', 'light'] as const) {
  test(`a reply's mermaid diagram and charts are drawn (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    const csp: string[] = [];
    page.on('console', m => { if (/Content Security Policy|unsafe-eval/i.test(m.text())) csp.push(m.text()); });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await say(app, 'fix', DIAGRAM);
    // the demo's open questions show in the questions window: answered later, so the chat is reachable
    for (let i = 0; i < 10 && await page.getByTestId('qwin-backdrop').isVisible(); i++) await page.getByTestId('qwin-later').click();
    await expect(page.getByTestId('qwin-backdrop')).toBeHidden();
    await page.getByTestId('chat-max-fix').click();
    const tile = page.getByTestId('maximized');
    const viz = tile.getByTestId('viz');
    const diagram = tile.getByTestId('viz-diagram').locator('img');
    await expect(diagram).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => diagram.evaluate(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(200);
    expect(await diagram.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    await page.waitForTimeout(300);
    await shot(page, `visuals-diagram-${scheme}`);

    await say(app, 'fix', CHARTS);
    await expect(viz).toHaveCount(3);
    // the invalid spec is the plain code block it was
    await expect(tile.locator('[data-testid="codeblock"][data-lang="chart"]').filter({ hasText: 'tanti' })).toHaveCount(1);
    const charts = tile.getByTestId('viz-chart');
    await expect(charts).toHaveCount(2);
    for (const c of await charts.all()) await expect(c).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
    await page.waitForTimeout(300);
    await shot(page, `visuals-charts-${scheme}`);

    // "Codice" shows the source, and back
    await viz.first().getByTestId('viz-source').click();
    await expect(viz.first().locator('pre.cb-code')).toContainText('flowchart TD');
    await viz.first().getByTestId('viz-source').click();
    await expect(diagram).toBeVisible();
    // a click opens the diagram large
    await diagram.click();
    await expect(page.locator('[data-testid^="viz-zoom"]').first()).toBeVisible();
    if (scheme === 'dark') await shot(page, 'visuals-diagram-zoom');
    await page.keyboard.press('Escape');
    expect(csp).toEqual([]);
    await app.close();
  });
}
