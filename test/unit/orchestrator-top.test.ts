// Top coordinator and native overlays must reserve the same bounded viewport, including small windows and map mode.
import{expect,it}from'vitest';
import{reserveOf,topSize}from'../../src/renderer/lib/orchestrator-dock';
it('reserves full width at the top without a competing right column',()=>{
 const size=topSize(null,1600,1100,52,240),reserve=reserveOf(true,size,'top');
 expect(size.w).toBe(1344);expect(size.h).toBeGreaterThan(300);expect(reserve).toEqual({right:0,bottom:0,top:size.h+16});
 expect(reserveOf(false,size,'top')).toEqual({right:0,bottom:0,top:50});
 expect(reserveOf(true,size,'top',true)).toEqual({right:0,bottom:0,top:0});
});
it('clamps saved height to actual available laptop space',()=>{
 const size=topSize(700,1280,720,52,56);expect(size.w).toBe(1208);expect(size.h).toBeLessThan(470);
 expect(topSize(700,800,300,52,56).h).toBeLessThanOrEqual(232);
});
