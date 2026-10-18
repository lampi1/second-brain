// Main-only local attachment viewer regression: actual layout IPC must park all native browser views.
import { expect,test } from '@playwright/test';
import { demoLayout,expandChats,launchDemo,shot } from './helpers';
test('an attachment modal hides native pages and closing it restores them',async()=>{
  const {app,page}=await launchDemo();
  try{
    await expandChats(page,'qa','fix'); // the browser and the input show on open strips
    await expect.poll(async()=>(await demoLayout(app)).some(view=>view.rect!==null)).toBe(true);
    await page.evaluate(async()=>{
      const canvas=new OffscreenCanvas(64,64);canvas.getContext('2d')!.fillRect(0,0,64,64);
      const blob=await canvas.convertToBlob({type:'image/png'});
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));
      document.querySelector('[data-testid="chat-input-fix"]')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    });
    await page.getByTestId('chat-input-fix-images-0').getByRole('button',{name:'Apri l’immagine 1',exact:true}).click();
    const viewer=page.getByTestId('chat-input-fix-images-viewer');await expect(viewer).toBeVisible();
    await expect.poll(async()=>(await demoLayout(app)).every(view=>view.rect===null)).toBe(true);
    await shot(page,'image-modal-native-views-parked');
    await viewer.getByRole('button',{name:'Chiudi',exact:true}).click();
    await expect.poll(async()=>(await demoLayout(app)).some(view=>view.rect!==null)).toBe(true);
  }finally{await app.close();}
});
