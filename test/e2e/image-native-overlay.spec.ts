// Main-only local attachment viewer regression: actual layout IPC must park all native browser views.
import { expect,test } from '@playwright/test';
import { demoLayout,launchDemo,shot,showBrowsers } from './helpers';
test('an attachment modal hides native pages and closing it restores them',async()=>{
  // wide: QA's browser beside its chat (AgentStrips.tsx; narrower it goes under the chat's question, out of the window),
  // so opening the image scrolls neither out of view
  const {app,page}=await launchDemo({width:1920});
  try{
    await showBrowsers(page,'qa'); // QA's open strip: its input, and its browser unfolded by its globe
    await page.getByTestId('tile-browser-tab-qa').scrollIntoViewIfNeeded(); // a native view is placed while its tile is in the window
    await expect.poll(async()=>(await demoLayout(app)).some(view=>view.rect!==null)).toBe(true);
    await page.evaluate(async()=>{
      const canvas=new OffscreenCanvas(64,64);canvas.getContext('2d')!.fillRect(0,0,64,64);
      const blob=await canvas.convertToBlob({type:'image/png'});
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));
      document.querySelector('[data-testid="chat-input-qa"]')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    });
    await page.getByTestId('chat-input-qa-images-0').getByRole('button',{name:'Apri l’immagine 1',exact:true}).click();
    const viewer=page.getByTestId('chat-input-qa-images-viewer');await expect(viewer).toBeVisible();
    await expect.poll(async()=>(await demoLayout(app)).every(view=>view.rect===null)).toBe(true);
    await shot(page,'image-modal-native-views-parked');
    await viewer.getByRole('button',{name:'Chiudi',exact:true}).click();
    await expect.poll(async()=>(await demoLayout(app)).some(view=>view.rect!==null)).toBe(true);
  }finally{await app.close();}
});
