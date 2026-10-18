// Main-only UI acceptance for local catalog/interview; no provider or image-generation requests.
import { expect,test } from '@playwright/test';
import { launchDemo,openAgents, shot } from './helpers';
test('offline interview is resumable and agent drafts survive page navigation',async()=>{
  const {app,page}=await launchDemo();
  try {
    await openAgents(page);
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
    await openAgents(page);
    await expect(page.getByTestId('agent-name')).toHaveValue('Assistente offerte');
    await shot(page,'agent-editor-local-draft');
  } finally {await app.close();}
});

test('agent manifest edits survive navigation, save and restart, with safe read-only display',async()=>{
  const first=await launchDemo();
  try {
    await openAgents(first.page);
    const studio=first.page.getByTestId('agent-studio');
    await studio.getByRole('button',{name:'Crea agente',exact:true}).click();
    await first.page.getByTestId('agent-name').fill('Manifest test');
    await first.page.getByTestId('agent-purpose').fill('Check persisted delegation criteria');
    await first.page.getByTestId('agent-manifest-editor').locator('summary').click();
    await first.page.getByTestId('agent-manifest-whenToUse').fill('<script>untrusted declaration</script>');
    await first.page.getByTestId('agent-manifest-input').fill('Question and constraints');
    await first.page.getByTestId('agent-manifest-output').fill('Cited result');
    await first.page.getByTestId('agent-manifest-accessScopes').fill('Authorized sources only');
    await first.page.getByTestId('agent-manifest-successCriteria').fill('Checkable references\nUnknowns explicit');
    await first.page.getByTestId('nav-devops').click();
    await openAgents(first.page);
    await expect(first.page.getByTestId('agent-manifest-whenToUse')).toHaveValue('<script>untrusted declaration</script>');
    await first.page.getByTestId('agent-save').click();
    const card=studio.locator('article').filter({has: first.page.getByRole('heading',{name:'Manifest test',exact:true})});
    await card.getByTestId('agent-manifest-view').locator('summary').click();
    await expect(card).toContainText('<script>untrusted declaration</script>');
    await expect(card.locator('script')).toHaveCount(0);
    await shot(first.page,'agent-manifest-saved');
  } finally {await first.app.close();}
  const second=await launchDemo({userData:first.userData});
  try {
    await openAgents(second.page);
    const card=second.page.getByTestId('agent-studio').locator('article').filter({has:second.page.getByRole('heading',{name:'Manifest test',exact:true})});
    await card.getByRole('button',{name:'Modifica',exact:true}).click();
    await expect(second.page.getByTestId('agent-manifest-input')).toHaveValue('Question and constraints');
    await expect(second.page.getByTestId('agent-manifest-successCriteria')).toHaveValue('Checkable references\nUnknowns explicit');
  } finally {await second.app.close();}
});
