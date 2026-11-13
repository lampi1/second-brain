// Projected map labels must remain nonoverlapping and deterministic across zoom and selection changes.
import {expect,it} from 'vitest';
import {mapLabels,mapObjectVisible,projectedMapLabel,readableMapLabel,type MapLabelBox} from '../../src/renderer/brain/lib/map-labels';
import {Group,PerspectiveCamera,Sprite,Vector3} from 'three';
const box=(id:string,x:number,y:number,priority=0):MapLabelBox=>({id,x,y,width:80,height:16,priority});
it('keeps the selected label and admits only separated neighbours',()=>{
  expect([...mapLabels([box('other',10,10),box('selected',10,10,100),box('free',200,100)],400,300)]).toEqual(['selected','free']);
});
it('handles padding across grid cells and small/offscreen/nonfinite projections',()=>{
  expect([...mapLabels([{...box('a',90,10),width:5},{...box('b',99,10),width:5}],300,200)]).toEqual(['a']);
  expect(mapLabels([box('left',-1,20),box('outside',280,20),{...box('tiny',50,20),height:10},{...box('invalid',50,20),x:NaN}],300,200).size).toBe(0);
});
it('readmits labels as projection separates and gives stable ties independent of input order',()=>{
  const crowded=[box('b',10,10),box('a',10,10)];expect([...mapLabels(crowded,400,300)]).toEqual(['a']);
  expect([...mapLabels([...crowded].reverse(),400,300)]).toEqual(['a']);
  expect(mapLabels([crowded[0]!,box('a',220,10)],400,300).size).toBe(2);
});
it('projects the true world scale at camera-space depth for off-axis and oblique labels',()=>{
  const camera=new PerspectiveCamera(60,1.5,0.1,1000);camera.position.set(12,3,15);camera.lookAt(0,0,0);camera.zoom=1.3;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const group=new Group(),sprite=new Sprite();group.scale.setScalar(1.2);group.position.set(2,1,0);sprite.position.set(4,2,0);sprite.scale.set(3,1,1);group.add(sprite);group.updateMatrixWorld();
  const box=projectedMapLabel(sprite,camera,1200,800)!;
  const center=sprite.getWorldPosition(new Vector3()),right=new Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(1.8);
  const left=center.clone().sub(right).project(camera),edge=center.clone().add(right).project(camera);
  expect(box.width).toBeCloseTo((edge.x-left.x)*600,6);
  expect(box.x).toBeCloseTo((left.x+1)*600,6);
});
it('excludes hidden labels or hidden ancestors before any cached hit can be used',()=>{
  const parent=new Group(),sprite=new Sprite();parent.add(sprite);expect(mapObjectVisible(sprite)).toBe(true);
  sprite.visible=false;expect(mapObjectVisible(sprite)).toBe(false);sprite.visible=true;parent.visible=false;expect(mapObjectVisible(sprite)).toBe(false);
});
it('admits real SpriteText plane scales at the initial overview distance',()=>{
  const camera=new PerspectiveCamera(40,1.5,0.1,10000);camera.position.z=4000;camera.updateMatrixWorld();
  const group=new Group(),sprite=new Sprite();sprite.scale.set(180,23,0);group.add(sprite);group.updateMatrixWorld();
  const projected=readableMapLabel(sprite,camera,1500,1000,23,14,22)!;
  expect(projected.height).toBeCloseTo(14,6);expect(projected.resized).toBe(true);
  expect([...mapLabels([{id:'name',priority:0,...projected}],1500,1000)]).toEqual(['name']);
  expect(readableMapLabel(sprite,camera,1500,1000,23,14,22)?.resized).toBe(false);
  camera.position.z=500;camera.updateMatrixWorld();
  expect(readableMapLabel(sprite,camera,1500,1000,23,14,22)?.height).toBeCloseTo(22,6);
  camera.position.z=4000;camera.updateMatrixWorld();
  expect(readableMapLabel(sprite,camera,1500,1000,23,14,22)?.height).toBeCloseTo(projected.height,6);
});
it('keeps selected names readable ahead of overlapping names after overview scaling',()=>{
  const camera=new PerspectiveCamera(40,1.5,0.1,10000);camera.position.z=4000;camera.updateMatrixWorld();
  const candidates=[['ordinary',0,0],['selected',0,100],['separate',1000,0]] as const;
  const boxes=candidates.map(([id,x,priority])=>{const sprite=new Sprite();sprite.position.x=x;sprite.scale.set(180,23,0);return{id,priority,...readableMapLabel(sprite,camera,1500,1000,23,14,22)!};});
  expect([...mapLabels(boxes,1500,1000)]).toEqual(['selected','separate']);
});
it('gives the same label size for the same camera whatever the path, even a step under 0.1%',()=>{
  const camera=new PerspectiveCamera(40,1.5,0.1,10000),project=(sprite:Sprite,z:number)=>{camera.position.z=z;camera.updateMatrixWorld();return readableMapLabel(sprite,camera,1500,1000,23,14,22)!;};
  const fresh=new Sprite();fresh.scale.set(180,23,0);const direct=project(fresh,4002);
  const moved=new Sprite();moved.scale.set(180,23,0);project(moved,4000);project(moved,4006);const back=project(moved,4002);
  expect(back.height).toBe(direct.height);expect(moved.scale.y).toBe(fresh.scale.y);expect(moved.scale.x).toBeCloseTo(fresh.scale.x,9);
});
it('restores the natural initial projection after zooming nearer and resetting the camera',()=>{
  const camera=new PerspectiveCamera(40,1.5,0.1,10000),sprite=new Sprite();sprite.scale.set(180,23,0);
  const project=()=>{camera.updateMatrixWorld();return readableMapLabel(sprite,camera,1500,1000,23,14,22)!;};
  camera.position.z=2000;const original=project();
  expect(original.height).toBeGreaterThan(14);expect(original.height).toBeLessThan(22);
  camera.position.z=500;expect(project().height).toBeCloseTo(22,6);
  camera.position.z=2000;const restored=project();
  for(const key of ['x','y','width','height'] as const)expect(restored[key]).toBeCloseTo(original[key],6);
});
