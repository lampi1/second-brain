// Main-only acceptance for truthful unavailable capability; no picker, helper or filesystem creation.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('setup offers existing memory when new memory creation is unavailable',async()=>{
  const {app,page}=await launchDemo();
  try{
    await page.getByTestId('settings').click();await page.getByTestId('settings-all').click();
    await page.getByRole('button',{name:'Configura il mio lavoro',exact:true}).click();
    const setup=page.getByTestId('first-interview');
    const create=page.getByTestId('create-memory');await create.locator('summary').click();
    await expect(create).toHaveAttribute('data-capability','unavailable');
    await expect(create.getByRole('status')).toBeVisible();await expect(page.getByTestId('create-memory-start')).toHaveCount(0);
    await expect(setup.getByTestId('setup-memory').getByRole('button',{name:/cartella/})).toBeEnabled();await shot(page,'setup-memory-unavailable-fallback');
    for(let step=0;step<6;step++)await setup.getByRole('button',{name:'Continua',exact:true}).click();
    await expect(page.getByTestId('setup-complete')).toBeEnabled();
  }finally{await app.close();}
});
