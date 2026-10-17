// Main-only acceptance for truthful unavailable capability; no picker, helper or filesystem creation.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('setup offers existing memory when new memory creation is unavailable',async()=>{
  const {app,page}=await launchDemo();
  try{
    await page.getByTestId('nav-agenti').click();
    await page.getByTestId('agent-studio').getByRole('button',{name:'Configura il tuo lavoro',exact:true}).click();
    const setup=page.getByTestId('first-interview');
    for(let step=0;step<4;step++)await setup.getByRole('button',{name:'Continua',exact:true}).click();
    const create=page.getByTestId('create-memory');await create.locator('summary').click();
    await expect(create).toHaveAttribute('data-capability','unavailable');
    await expect(create.getByRole('status')).toBeVisible();await expect(page.getByTestId('create-memory-start')).toHaveCount(0);
    await expect(setup.getByRole('button',{name:/cartella della memoria/})).toBeEnabled();
    await expect(page.getByTestId('setup-complete')).toBeEnabled();await shot(page,'setup-memory-unavailable-fallback');
  }finally{await app.close();}
});
