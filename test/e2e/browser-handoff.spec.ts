// Login hand-off, end to end in the real app (fake Claude CLI, fixture brain, fixture site):
// - handoff_to_user called with a progressToken streams progress notifications at once and the result when the user
//   answers (Claude Code aborts a call silent for 300 s: the bug of 2026-10-11 in "Prova · Browser su test 3");
// - the banner on the chat's browser tile shows who waits, the instructions and the account from the brain's
//   credentials file; the password is never in the page nor in the tool result, Copia puts it on the clipboard
//   (in-memory under SB_TEST, never the user's real one);
// - when the agent stopped waiting, the user's Fatto wakes the chat with a message;
// - the "Credenziali" panel lists the same file without the password, Copia puts it on the clipboard (and agents may not
//   paste meanwhile), Apri opens the sign-in URL in a tab of the user's.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { launch, shot } from './helpers';
import { startSites, McpClient, type Sites } from './fixture-server';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');
const SECRET = ['fixture', 'only', '7f3a'].join('-');   // a fake password of the fixture file, never a real one

let app: ElectronApplication;
let page: Page;
let sites: Sites;
let chat: ChatSummary;
let agent: McpClient;
let logFile: string;

const clip = () => app.evaluate(() => (globalThis as unknown as { __sbClipboard: { readText(): string } }).__sbClipboard.readText());

test.describe.serial('login hand-off', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-'));
    fs.mkdirSync(path.join(brain, 'ops'));
    fs.writeFileSync(path.join(brain, 'ops', 'credentials.md'), [
      '# Test accounts', '', '```json', JSON.stringify({ site: { test: [
        { note: 'holding di prova con modulo X attivo', url: `${sites.a}/login`, email: 'mario@example.com', password: SECRET },
        { email: 'other@example.com', password: 'unused' },
      ] } }, null, 2), '```', '',
    ].join('\n'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
    logFile = path.join(home, 'fake.jsonl');
    ({ app, page } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: logFile, SB_BRAIN: brain, SB_RECALL_GRACE_MS: '8000' }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
    chat = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ciao', title: 'Prova · Browser su test 3' }), cwd);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]?.state, { timeout: 20_000 }).toBe('idle');
    // the chat's own browser endpoint, from the --mcp-config the app gave the CLI
    const start = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { argv?: string[] }).find(l => l.argv?.includes('--mcp-config'))!;
    const cfg = JSON.parse(start.argv![start.argv!.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { url: string }> };
    agent = new McpClient(cfg.mcpServers['second-brain']!.url);
    await agent.init();
    await agent.ok('tabs_create', { url: `${sites.a}/login` });
  });

  test.afterAll(async () => {
    await app?.close();
    await sites?.close();
  });

  test('the Credenziali panel lists the file without the password; Copia copies it and blocks the agents paste; Apri opens a tab', async () => {
    expect((await agent.call('key', { keys: 'ctrl+v' })).text).not.toContain('pasting is blocked');
    await page.getByTestId('topbar-credentials').click();
    const panel = page.getByTestId('credentials');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('site · test');
    await expect(panel).toContainText('holding di prova con modulo X attivo');
    await expect(panel.getByTestId(/^cred-user-/)).toHaveText(['mario@example.com', 'other@example.com']);
    expect(await page.evaluate(() => document.body.innerHTML)).not.toContain(SECRET);
    const list = await page.evaluate(() => window.sb.invoke('credentials:list', undefined));
    expect(JSON.stringify(list)).not.toContain(SECRET);
    await panel.getByTestId('credentials-filter').fill('modulo');
    await expect(panel.getByTestId(/^cred-user-/)).toHaveText(['mario@example.com']);
    await panel.getByTestId(/^cred-copy-password-/).click();
    await expect(panel.getByTestId(/^cred-copy-password-/)).toContainText('Copiata');
    expect(await clip()).toBe(SECRET);
    expect((await agent.call('key', { keys: 'ctrl+v' })).text).toContain('pasting is blocked');
    await panel.getByTestId(/^cred-copy-user-/).click();
    expect(await clip()).toBe('mario@example.com');
    // a stale id (the file changed) copies nothing
    expect(await page.evaluate(() => window.sb.invoke('credentials:copy', { id: 'stale', field: 'password' }))).toBe(false);

    const before = (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length;
    await panel.getByTestId(/^cred-open-/).click();
    await expect(panel).toBeHidden();
    const mine = async () => (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).filter(t => t.ownerChatId === null);
    await expect.poll(async () => (await mine())[0]?.url ?? '').toContain('/login');
    expect((await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length).toBe(before + 1);
    const tab = (await mine())[0]!;
    await page.evaluate(id => window.sb.invoke('browser:close', { tabId: id }), tab.id);
    await page.keyboard.press('Escape');
  });

  test('progress notifications keep the call alive; the banner shows the account, never the password; Fatto answers', async () => {
    // a streaming call, as Claude Code makes it (progressToken + text/event-stream)
    const res = await agent.post({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: {
      name: 'handoff_to_user', _meta: { progressToken: 'p-1' },
      arguments: { kind: 'login', reason: 'Login richiesto su test 3', instructions: 'Accedi con l’account di prova, poi premi Fatto.', account: 'MARIO@example.com' },
    } });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let raw = '';
    const events: Array<{ method?: string; params?: { progressToken: string; progress: number }; result?: { content: { text: string }[] } }> = [];
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        raw += dec.decode(value, { stream: true });
        let i;
        while ((i = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, i); raw = raw.slice(i + 2);
          const data = block.split('\n').find(l => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    })();
    await expect.poll(() => events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ method: 'notifications/progress', params: { progressToken: 'p-1', progress: 1 } });

    const banner = page.getByTestId(/^handoff-t[0-9]+$/);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Login richiesto su test 3');
    await expect(banner).toContainText('Prova · Browser su test 3');
    await expect(banner).toContainText('Accedi con l’account di prova');
    await expect(banner.getByTestId(/^handoff-user-/)).toHaveText('mario@example.com');   // as written in the file
    await expect(banner).toContainText('holding di prova con modulo X attivo');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(SECRET);
    await shot(page, 'handoff-banner-dark');

    await banner.getByTestId(/^handoff-copy-password-/).click();
    await expect(banner.getByTestId(/^handoff-copy-password-/)).toContainText('Copiata');
    expect(await clip()).toBe(SECRET);
    await banner.getByTestId(/^handoff-copy-user-/).click();
    expect(await clip()).toBe('mario@example.com');

    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.waitForTimeout(300);
    await shot(page, 'handoff-banner-light');
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'dark' }));

    await banner.getByTestId(/^handoff-done-/).click();
    await expect(banner).toBeHidden();
    await pump;
    const last = events.at(-1)!;
    const text = last.result!.content.map(c => c.text).join('\n');
    expect(text).toContain('The user clicked Fatto (done)');
    expect(text).toContain('banner shows account mario@example.com');
    expect(text).not.toContain(SECRET);
  });

  test('the mouse over the page (a native view) lights up its chat, and leaving turns it off', async () => {
    const tile = page.getByTestId(`tile-chat-${chat.id}`);
    await expect(tile).toHaveClass(/\bpaired\b/);
    await page.mouse.move(2, 2);
    await expect(tile).not.toHaveClass(/\bpair-hot\b/);
    const send = (type: 'mouseMove' | 'mouseLeave') => app.evaluate(({ webContents }, [t, u]) => {
      webContents.getAllWebContents().find(w => w.getURL().startsWith(u))!.sendInputEvent({ type: t, x: 40, y: 40 });
    }, [type, sites.a] as const);
    await send('mouseMove');
    await expect(tile).toHaveClass(/\bpair-hot\b/);
    await send('mouseLeave');
    await expect(tile).not.toHaveClass(/\bpair-hot\b/);
  });

  test('an account missing from the file is shown as such, without a password', async () => {
    const waiting = agent.call('handoff_to_user', { kind: 'login', account: 'nobody@example.com', wait_seconds: 30 });
    const banner = page.getByTestId(/^handoff-t[0-9]+$/);
    await expect(banner.getByTestId(/^handoff-missing-/)).toContainText('Non è nel file delle credenziali');
    await banner.getByTestId(/^handoff-failed-/).click();
    const r = await waiting;
    expect(r.text).toContain('not in the user\'s credentials file (ops/credentials.md)');
    expect(r.text).toContain('answered Non riesco (failed)');
  });

  test('when the agent stopped waiting, Fatto wakes its chat with a message', async () => {
    const r = await agent.ok('handoff_to_user', { kind: 'login', reason: 'Login richiesto', wait_seconds: 5 });
    expect(r).toContain('Still waiting for the user');
    expect(r).toContain('the app messages you when they answer');
    await page.getByTestId(/^handoff-done-/).click();
    const woken = async () => {
      const items: ChatItem[] = await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id);
      return items.some(i => i.kind === 'user' && /Ho fatto l'accesso nel browser/.test(i.text));
    };
    // the agent just got "still waiting": it has the recall grace (8 s here) to call again before the chat is messaged
    await page.waitForTimeout(4500);
    expect(await woken()).toBe(false);
    await expect.poll(woken, { timeout: 20_000 }).toBe(true);
  });
});
