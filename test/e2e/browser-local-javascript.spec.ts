// Main-only runtime gate using loopback fixture sites, never a real account or model. No listener/exploit code.
import {expect,test} from '@playwright/test';
import {launch,shot} from './helpers';
import {McpClient,startSites} from './fixture-server';
test('remote browser inspection works while caller JavaScript is limited to the verified local page',async()=>{
  const sites=await startSites();
  if(!sites.remote){await sites.close();test.skip(true,'127.0.0.2 fixture unavailable');return;}
  const {app,page}=await launch();
  try{
    const info=await page.evaluate(()=>window.sb.invoke('app:info',undefined));
    const agent=new McpClient(info.mcpUrl);await agent.init();
    await agent.ok('tabs_create',{url:sites.remote+'/index.html'});
    await expect.poll(async()=>(await agent.call('read_page')).text).toContain('Fixture QA');
    const refused=await agent.call('javascript',{code:'document.title'});
    expect(refused.text).toContain('only on local stacks');
    await agent.ok('navigate',{url:sites.a+'/index.html'});
    await expect.poll(async()=>(await agent.call('javascript',{code:'document.title'})).text).toContain('Fixture QA');
    await shot(page,'browser-local-js-remote-standard-inspection');
  }finally{await app.close();await sites.close();}
});
