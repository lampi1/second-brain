// Main-only identity screenshot: unknown provider telemetry stays explicit; no spawning, models or awards.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('agent owner and team observability are available before entering the transcript',async()=>{
  const {app,page}=await launchDemo();
  try{
    const identity=page.getByTestId('agent-identity-fix');
    await expect(identity).toBeVisible();
    await expect(identity).toContainText('Titolare');
    await expect(page.getByTestId('agent-team-fix')).toBeVisible();
    await page.getByTestId('agent-team-fix').click();
    await expect(identity).toContainText('distinte dai sottoagenti');
    await shot(page,'agent-identity-team-observability');
  }finally{await app.close();}
});
