// Main-only UI acceptance for local catalog/interview; no provider or image-generation requests.
import { expect,test } from '@playwright/test';
import { launchDemo,shot } from './helpers';
test('offline interview is resumable and agent drafts survive page navigation',async()=>{
  const {app,page}=await launchDemo();
  try {
    await page.getByTestId('nav-agenti').click();
    const studio=page.getByTestId('agent-studio');await expect(studio).toBeVisible();
    await studio.getByRole('button',{name:'Configura il tuo lavoro',exact:true}).click();
    const setup=page.getByTestId('first-interview');await expect(setup).toBeVisible();
    await setup.getByRole('button',{name:'Continua',exact:true}).click();
    await page.getByTestId('setup-goals').fill('Preparare riunioni e documenti');
    await setup.getByRole('button',{name:'Salva e riprendi più tardi',exact:true}).click();
    await expect(setup).not.toBeVisible();
    await studio.getByRole('button',{name:'Configura il tuo lavoro',exact:true}).click();
    await expect(page.getByTestId('setup-goals')).toHaveValue('Preparare riunioni e documenti');
    await shot(page,'setup-offline-resume');
    await setup.getByRole('button',{name:'Salva e riprendi più tardi',exact:true}).click();
    await studio.getByRole('button',{name:'Crea agente',exact:true}).click();
    await expect(page.getByTestId('agent-name')).toBeFocused();
    await page.getByTestId('agent-name').fill('Assistente offerte');
    await page.getByTestId('nav-devops').click();
    await page.getByTestId('nav-agenti').click();
    await expect(page.getByTestId('agent-name')).toHaveValue('Assistente offerte');
    await shot(page,'agent-editor-local-draft');
  } finally {await app.close();}
});
