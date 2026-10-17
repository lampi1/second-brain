// Main-only review UI fixture. Never calls Publish or GitHub: main's capability block must remain visible/enforced.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('isolated modification diff and checks are reviewable while publication prerequisites remain blocked',async()=>{
  const {app,page}=await launchDemo();
  try{
    await page.getByTestId('nav-migliora').click();
    await expect(page.getByTestId('app-proposals')).toBeVisible();
    await app.evaluate(({BrowserWindow})=>{
      const head='a'.repeat(40),check={state:'passed',head};
      BrowserWindow.getAllWindows()[0]!.webContents.send('improve:proposals',[{id:'fixture',directory:'isolated',branch:'app/proposal-fixture',base:'b'.repeat(40),phase:'ready',head,files:['src/renderer/example.ts'],diff:'diff --git a/src/renderer/example.ts b/src/renderer/example.ts\n+Example',quality:check,privacy:check,reviews:check,problem:null,url:null,publication:null}]);
    });
    const proposal=page.getByTestId('proposal-fixture');await expect(proposal).toBeVisible();
    await proposal.getByTestId('proposal-diff').locator('summary').click();
    await expect(proposal).toContainText('Example');
    await proposal.getByRole('checkbox').check();
    await expect(proposal.getByTestId('proposal-pr')).toBeDisabled();
    await expect(page.getByTestId('app-proposals')).toContainText('Condivisione non disponibile');
    await shot(page,'proposal-review-blocked-publication');
    await expect(page.getByTestId('improve-promote')).toHaveCount(0);
  }finally{await app.close();}
});
