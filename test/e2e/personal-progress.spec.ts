// Personal milestones are retired in the demo as well as the real profile; agent metrics remain separate.
import {expect,test} from '@playwright/test';
import {launchDemo,openAgents, shot} from './helpers';
test('personal milestones do not offer success confirmation when capability is unavailable',async()=>{
  const {app,page}=await launchDemo();
  try{
    await openAgents(page);
    await expect(page.getByTestId('personal-progress')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Confermo: ho ottenuto un risultato utile'})).toHaveCount(0);
    await shot(page,'agents-without-personal-milestones');
  }finally{await app.close();}
});
