// Main-only manual capability semantics regression; no update network/acquisition/apply/restart.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('demo reports updater availability truthfully without an enabled application action',async()=>{
  const {app,page}=await launchDemo();
  try{
    await page.getByTestId('nav-migliora').click();const updates=page.getByTestId('app-updates');await expect(updates).toBeVisible();
    await expect(updates).not.toContainText('Verifica dello stato…');
    const apply=updates.getByRole('button',{name:'Applica aggiornamento',exact:true});
    if(await apply.count())await expect(apply).toBeDisabled();
    await shot(page,'prepared-update-demo-unavailable');
  }finally{await app.close();}
});
