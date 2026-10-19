// Main-only screenshot regression. Uses frozen demo text and synthetic geometry, no model or network.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
for(const owner of ['fix','orchestrator'] as const)test(`${owner}: follows content and resizing while preserving a reader above`,async()=>{
  const {app,page}=await launchDemo({orchestrator:owner==='orchestrator'});
  try{
    if(owner==='fix')await page.getByTestId('chat-max-fix').click();
    const log=page.locator(`[data-chat-log="${owner}"]`);await expect(log).toBeVisible();
    await log.locator('.items-content').evaluate(body=>{const block=document.createElement('div');block.dataset.scrollFixture='1';block.style.height='1600px';block.style.flex='none';body.appendChild(block);});
    const atBottom=()=>log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<24);
    await expect.poll(atBottom).toBe(true);
    await log.locator('[data-scroll-fixture]').evaluate(block=>{(block as HTMLElement).style.height='2100px';});await expect.poll(atBottom).toBe(true);
    const oldViewport=await log.evaluate(el=>el.clientHeight);
    await log.evaluate(el=>{const pane=el as HTMLElement;pane.style.maxHeight=`${Math.max(1,Math.floor(el.clientHeight/2))}px`;pane.style.minHeight='0';pane.style.paddingBlock='0';});
    await expect.poll(()=>log.evaluate(el=>el.clientHeight)).toBeLessThan(oldViewport);await expect.poll(atBottom).toBe(true);
    await log.hover();await page.mouse.wheel(0,-600);await expect.poll(atBottom).toBe(false);
    await expect.poll(()=>log.evaluate(async el=>{const positions:number[]=[];for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);positions.push(el.scrollTop);}return Math.max(...positions)-Math.min(...positions);})).toBeLessThan(1);
    const reading=await log.evaluate(el=>el.scrollTop);
    await log.locator('[data-scroll-fixture]').evaluate(block=>{(block as HTMLElement).style.height='2700px';});
    await log.evaluate(async()=>{for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);});
    expect(await log.evaluate(el=>el.scrollTop)).toBeCloseTo(reading,0);
    const jump=log.locator('..').getByTestId('unseen');await expect(jump).toBeVisible();await jump.click();await expect.poll(atBottom).toBe(true);
    await shot(page,`follow-bottom-${owner}`);
  }finally{await app.close();}
});
