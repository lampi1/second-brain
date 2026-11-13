// Main-only manual capability semantics regression; no update network/acquisition/apply/restart. The staged-updater
// panel lives in Settings → Aggiornamenti (ADR 0079: "Migliora l'app" is gone) and shows only when this installation
// has the staged updater, a prepared package or a problem; in the demo it never offers an enabled apply.
import {expect,test} from '@playwright/test';
import { launchDemo, shot, goPage } from './helpers';
test('demo reports updater availability truthfully without an enabled application action',async()=>{
  const {app,page}=await launchDemo();
  try{
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('st-update')).toBeVisible();
    const updates=page.getByTestId('app-updates');
    if(await updates.count()){
      await expect(updates).not.toContainText('Verifica dello stato…');
      const apply=updates.getByRole('button',{name:'Applica aggiornamento',exact:true});
      if(await apply.count())await expect(apply).toBeDisabled();
    }
    await shot(page,'prepared-update-demo-unavailable');
  }finally{await app.close();}
});
