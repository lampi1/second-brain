// Main-only identity screenshot: unknown provider telemetry stays explicit; no spawning, models or awards. The details sit
// in the strip's topic row once it is opened (strips start folded, ChatTile.tsx) and open as a popover (AgentIdentity.tsx).
import {expect,test} from '@playwright/test';
import {expandChats,launchDemo,shot} from './helpers';
test('agent owner and team observability are available before entering the transcript',async()=>{
  const {app,page}=await launchDemo();
  try{
    await expandChats(page,'fix');
    const identity=page.getByTestId('agent-identity-fix');
    await expect(identity).toBeVisible();
    await expect(page.getByTestId('agent-team-fix')).toContainText('Dettagli e collaboratori');
    await page.getByTestId('agent-team-fix').click();
    const details=page.getByRole('dialog',{name:'Dettagli e collaboratori'});
    await expect(details).toBeVisible();
    // the engine's own observation of its sub-agents, partial data said as such, never read as zero
    await expect(details).toContainText('Collaboratori interni osservati dal motore');
    await expect(details).toContainText('I dati mancanti non indicano zero attività');
    await expect(details).toContainText('Modello:');
    await shot(page,'agent-identity-team-observability');
  }finally{await app.close();}
});
