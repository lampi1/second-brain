// Main-only, no synthetic success awards: demo capability must remain read-only.
import {expect,test} from '@playwright/test';
import {launchDemo,openAgents, shot} from './helpers';
test('personal milestones do not offer success confirmation when capability is unavailable',async()=>{
  const {app,page}=await launchDemo();
  try{
    await openAgents(page);const progress=page.getByTestId('personal-progress');await expect(progress).toBeVisible();
    await expect(progress.getByRole('button',{name:'Nascondi',exact:true})).toBeDisabled();
    await expect(progress.getByRole('button',{name:'Confermo: ho ottenuto un risultato utile'})).toHaveCount(0);
    await expect(progress).toContainText('0 di 3 traguardi');await shot(page,'personal-progress-demo-readonly');
  }finally{await app.close();}
});
