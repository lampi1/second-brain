// Exercise real OverlayLayer placement against a native-view fake: absolute top reservations include setup banners.
import{EventEmitter}from'node:events';
import{afterEach,expect,it,vi}from'vitest';
import type{BrowserWindow}from'electron';
import type{OverlayModel}from'../../src/shared/contract';
const mock=vi.hoisted(()=>({bounds:null as null|{x:number;y:number;width:number;height:number}}));
vi.mock('electron',()=>({WebContentsView:class{
 webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler:vi.fn(),session:{setPermissionRequestHandler:vi.fn()},loadFile:vi.fn(async()=>{}),isFocused:()=>false,isDestroyed:()=>false});
 setBackgroundColor(){}setBounds(bounds:typeof mock.bounds){mock.bounds=bounds;}
}}));
vi.mock('../../src/main/ipc',()=>({Emitter:class{emit(){}}}));
vi.mock('../../src/main/keyguard',()=>({swallowCloseKey:()=>{}}));
import{OverlayLayer}from'../../src/main/overlay';
afterEach(()=>{vi.useRealTimers();mock.bounds=null;});
it('keeps a tall request below the top coordinator even with setup banners',()=>{
 vi.useFakeTimers();const children:unknown[]=[];
 const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getContentSize:()=>[1280,800],contentView:{children,addChildView:(view:unknown)=>children.push(view),removeChildView:()=>{}},webContents:{focus:()=>{}}})as unknown as BrowserWindow;
 const layer=new OverlayLayer(()=>win,'/synthetic');layer.start();layer.setSize(420,2000);
 const shellTop=120,coordinatorHeight=300,occupiedBottom=shellTop+coordinatorHeight+16;
 layer.setModel({cards:[{}],waiting:1,avoid:{right:0,bottom:0,top:occupiedBottom}}as OverlayModel);
 expect(mock.bounds?.y).toBeGreaterThanOrEqual(occupiedBottom);expect(mock.bounds!.y+mock.bounds!.height).toBeLessThanOrEqual(800);
 layer.stop();
});
