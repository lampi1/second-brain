// Screen-space label admission: important names survive zoom while overlapping/offscreen text stays hidden.
import type {Vector3,PerspectiveCamera,Sprite} from 'three';
interface ProjectionScratch {position:Vector3;scale:Vector3;cameraPosition:Vector3}
export function projectedMapLabel(sprite:Sprite,camera:PerspectiveCamera,width:number,height:number,scratch?:ProjectionScratch):Omit<MapLabelBox,'id'|'priority'>|null{
  const {position,scale,cameraPosition}=scratch??{position:sprite.position.clone(),scale:sprite.scale.clone(),cameraPosition:sprite.position.clone()};
  // SpriteText uses a zero-depth plane. Object3D.getWorldScale decomposes that singular matrix as unit scale;
  // Sprite's own renderer/raycast instead reads the matrix columns, preserving the real width and height.
  sprite.getWorldPosition(position);scale.setFromMatrixScale(sprite.matrixWorld);
  cameraPosition.copy(position).applyMatrix4(camera.matrixWorldInverse);const depth=-cameraPosition.z;
  if(depth<=0)return null;position.project(camera);if(position.z < -1||position.z>1)return null;
  const perWorld=height*camera.zoom/(2*Math.tan(camera.fov*Math.PI/360)*depth),w=Math.abs(scale.x)*perWorld,h=Math.abs(scale.y)*perWorld;
  return {x:(position.x+1)*width/2-w*sprite.center.x,y:(1-position.y)*height/2-h*(1-sprite.center.y),width:w,height:h};
}
/** Keep admitted names readable at overview zoom; collision checks use the actual resized sprite, never a fake box. */
export function readableMapLabel(sprite:Sprite,camera:PerspectiveCamera,width:number,height:number,naturalHeight:number,minHeight:number,maxHeight:number,scratch?:ProjectionScratch){
  const previous=sprite.scale.y,previousX=sprite.scale.x;
  if(!(previous>0)||!(naturalHeight>0))return null;
  // SpriteText's textHeight is the unscaled single-line height; its width follows its canvas (as it sets it itself),
  // a plain sprite keeps its own aspect
  const image=sprite.material.map?.image as {width?:number;height?:number}|undefined;
  const aspect=image?.width&&image.height?image.width/image.height:sprite.scale.x/previous;
  // Measured at the natural size and set from it, never from the current scale nor left "close enough": the same
  // camera always gives the very same labels (Home after a rotation draws the same picture to the pixel).
  sprite.scale.set(aspect*naturalHeight,naturalHeight,sprite.scale.z);
  const natural=projectedMapLabel(sprite,camera,width,height,scratch);
  if(!natural||!Number.isFinite(natural.height)||natural.height<=0){sprite.scale.set(previousX,previous,sprite.scale.z);return null;}
  const target=natural.height<minHeight?naturalHeight*minHeight/natural.height:natural.height>maxHeight?naturalHeight*maxHeight/natural.height:naturalHeight;
  // any change, however small, is a change: the engine draws one more frame for it, so the picture never keeps a stale size
  const resized=target!==previous;
  if(target===naturalHeight)return {...natural,resized};
  sprite.scale.set(aspect*target,target,sprite.scale.z);
  const box=projectedMapLabel(sprite,camera,width,height,scratch);
  return box?{...box,resized}:null;
}
export function mapObjectVisible(object:{visible:boolean;parent?:{visible:boolean;parent?:unknown}|null}):boolean{
  let current: {visible:boolean;parent?:unknown}|null=object;
  while(current){if(!current.visible)return false;current=current.parent as typeof current;}
  return true;
}
export interface MapLabelBox {id:string;x:number;y:number;width:number;height:number;priority:number}
export function mapLabels(boxes:readonly MapLabelBox[],width:number,height:number):Set<string>{
  const visible=new Set<string>(),grid=new Map<string,MapLabelBox[]>(),cell=96;
  for(const box of [...boxes].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))){
    if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<11||box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height)continue;
    const cells:string[]=[];let overlap=false;
    for(let x=Math.floor((box.x-6)/cell);x<=Math.floor((box.x+box.width+6)/cell);x++)for(let y=Math.floor((box.y-6)/cell);y<=Math.floor((box.y+box.height+6)/cell);y++){
      const key=x+':'+y;cells.push(key);
      if(grid.get(key)?.some(other=>box.x<other.x+other.width+6&&box.x+box.width+6>other.x&&box.y<other.y+other.height+6&&box.y+box.height+6>other.y))overlap=true;
    }
    if(overlap)continue;
    visible.add(box.id);for(const key of cells){const entries=grid.get(key)??[];entries.push(box);grid.set(key,entries);}
  }
  return visible;
}
