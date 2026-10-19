// Main-only E2E: actual transcript/Orchestrator previews use authorized IPC and data URLs, never local DOM src.
import {expect,test} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expandChats,launchDemo,shot} from './helpers';
test('authorized absolute and owner-relative images render in chat and Regia; outside roots stays refused',async()=>{
  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'sb-image-profile-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'sb-image-outside-'));
  const {app,page}=await launchDemo({userData,regia:true,config:{questionsModal:false}});
  try{
    const png=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.from([80,120,220,255]),{width:1,height:1}).toPNG().toString('base64'));
    for(const file of [path.join(userData,'absolute.png'),path.join(userData,'relative.png'),path.join(outside,'outside.png')])fs.writeFileSync(file,Buffer.from(png,'base64'));
    const owner=await page.evaluate(cwd=>window.sb.invoke('chat:create',{harness:'claude',cwd,title:'Image preview fixture'}),userData);
    const say=(id:string,text:string)=>app.evaluate((_e,[chatId,body])=>(globalThis as unknown as {__sbDemo:{say(id:string,text:string):void}}).__sbDemo.say(chatId,body),[id,text] as const);
    await say(owner.id,`![Absolute](${path.join(userData,'absolute.png').replaceAll('\\','/')}) ![Relative](relative.png)`);
    await expandChats(page,owner.id); // Grindhouse strips start collapsed
    const tile=page.getByTestId('tile-chat-'+owner.id),images=tile.locator('.ask-imgs-row img');
    await expect(images).toHaveCount(2);await expect.poll(()=>images.evaluateAll(list=>list.every(image=>(image as HTMLImageElement).naturalWidth===1))).toBe(true);
    await expect(tile.locator('.md img')).toHaveCount(0);for(const image of await images.all())await expect(image).toHaveAttribute('src',/^data:image\//);
    await say('regia',`![Regia screen](${path.join(userData,'absolute.png').replaceAll('\\','/')})`);
    // the message's own thumbnails (the Orchestrator's pending decision shows the turn's images in its context too)
    const regia=page.getByTestId('tile-regia').locator('[data-testid^="message-"][data-testid$="-imgs"] img');await expect(regia).toHaveCount(1);await expect(regia).toHaveJSProperty('naturalWidth',1);
    await say(owner.id,`![Outside](${path.join(outside,'outside.png').replaceAll('\\','/')})`);
    await expect(tile.locator('.ask-img-bad')).toContainText('Fuori dalle cartelle ammesse');
    await expect(page.locator('img[src^="file:"]')).toHaveCount(0);await shot(page,'message-authorized-images');
  }finally{await app.close();}
});
