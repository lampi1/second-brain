// Main-only acceptance; demo renderer coverage is not proof of native WebContentsView behavior.
import {expect,test} from '@playwright/test';
import {launchDemo,shot} from './helpers';
test('workspace keyboard docking, resize and reload preserve panel topology',async()=>{
  const {app,page}=await launchDemo();
  try{
    const grip=page.getByTestId('workspace-grip-chat:fix');await expect(grip).toBeVisible();
    await grip.focus();await page.keyboard.press('Alt+ArrowRight');await expect(grip).toBeFocused();
    const sash=page.getByRole('separator',{name:'Ridimensiona pannelli'}).first();
    await sash.focus();const before=Number(await sash.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowRight');
    await expect(sash).toHaveAttribute('aria-valuenow',String(Math.min(85,before+3)));
    const saved=await page.evaluate(()=>localStorage.getItem('sb.agents.workspace.v1'));
    const rendered=await page.locator('.workspace-split').evaluateAll(nodes=>nodes.map(node=>({style:node.getAttribute('style'),panes:Array.from(node.querySelectorAll('[data-workspace-pane]')).map(pane=>pane.getAttribute('data-workspace-pane'))})));
    expect(saved).not.toBeNull();await page.reload();await expect(grip).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('sb.agents.workspace.v1'))).toBe(saved);
    expect(await page.locator('.workspace-split').evaluateAll(nodes=>nodes.map(node=>({style:node.getAttribute('style'),panes:Array.from(node.querySelectorAll('[data-workspace-pane]')).map(pane=>pane.getAttribute('data-workspace-pane'))})))).toEqual(rendered);
    await shot(page,'agents-workspace-docked-restored');
  }finally{await app.close();}
});
test('Escape cancels a pointer gesture without changing saved layout',async()=>{
  const {app,page}=await launchDemo();
  try{
    const grip=page.getByTestId('workspace-grip-chat:fix');await expect(grip).toBeVisible();
    const saved=await page.evaluate(()=>localStorage.getItem('sb.agents.workspace.v1'));
    const box=(await grip.boundingBox())!;await page.mouse.move(box.x+8,box.y+8);await page.mouse.down();
    const target=page.locator('[data-workspace-pane]').filter({hasNot:grip}).first();const destination=(await target.boundingBox())!;
    await page.mouse.move(destination.x+4,destination.y+destination.height/2);
    await expect(target).toHaveClass(/drop-left/);await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-dragging')).toHaveCount(0);await expect(target).not.toHaveClass(/drop-left/);
    await page.mouse.up();
    expect(await page.evaluate(()=>localStorage.getItem('sb.agents.workspace.v1'))).toBe(saved);
    await expect(page.locator('.workspace-dragging')).toHaveCount(0);await shot(page,'agents-workspace-drag-cancel');
  }finally{await app.close();}
});
