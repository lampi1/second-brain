// Main-only UI acceptance: the user's own browser is available from the toolbar and command palette.
import{expect,test}from'@playwright/test';import{launchDemo,shot}from'./helpers';
for(const lang of['it','en'])test(`manual browser has no agent owner (${lang})`,async()=>{
 const{app,page}=await launchDemo({config:{questionsModal:false},env:{SB_LANG:lang}});
 try{
  const count=()=>page.evaluate(async()=> (await window.sb.invoke('browser:list',undefined)).filter(tab=>tab.ownerChatId===null&&tab.url==='about:blank').length);
  const before=await count();await page.getByTestId('topbar-new-browser').click();await expect.poll(count).toBe(before+1);
  await expect(page.getByTestId('view-agents')).toBeVisible();
  const id=await page.evaluate(async()=> (await window.sb.invoke('browser:list',undefined)).filter(tab=>tab.ownerChatId===null&&tab.url==='about:blank').at(-1)!.id);
  await page.getByTestId(`browser-url-${id}`).click();await expect(page.getByTestId(`browser-url-input-${id}`)).toBeFocused();
  await page.getByTestId(`browser-url-input-${id}`).fill('about:blank');await page.getByTestId(`browser-url-input-${id}`).press('Enter');
  await page.keyboard.press('Control+k');await page.getByTestId('palette-input').fill(lang==='it'?'Nuovo browser':'New browser');
  await page.getByTestId('palette-item-new-browser').click();await expect.poll(count).toBe(before+2);await shot(page,`manual-browser-${lang}`);
 }finally{await app.close();}
});
