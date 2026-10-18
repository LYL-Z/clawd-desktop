import type {Manifest,ActionDef,Outfit} from '../shared/types';
import {frameAt} from '../shared/animation';
export class Assets {
  images=new Map<string,HTMLImageElement>();
  private headCache=new Map<string,number>();
  constructor(public manifest:Manifest){}
  async load():Promise<void>{
    const names=new Set([this.manifest.atlas,...Object.values(this.manifest.animations).map(a=>a.atlas??this.manifest.atlas),...Object.values(this.manifest.outfits??{}).flatMap(o=>[o!.atlas,...Object.values(o!.animations??{}).map(a=>a.atlas??o!.atlas)])]);
    await Promise.all([...names].filter(n=>/^[\w./-]+\.(png|webp)$/.test(n)&&!n.includes('..')).map(name=>new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>{this.images.set(name,image);resolve();};image.onerror=()=>reject(new Error(`角色素材无法载入：${name}`));image.src=`assets/${name}`;})));
  }
  definition(action:string,outfit:Outfit):ActionDef|undefined{
    const dressed=this.manifest.outfits?.[outfit];
    return (!dressed?.overlay?dressed?.animations?.[action]:undefined)??this.manifest.animations[action];
  }
  private headTop(name:string,row:number,col:number):number{
    const key=`${name}:${row}:${col}`,cached=this.headCache.get(key);if(cached!==undefined)return cached;
    const cw=this.manifest.cellWidth,ch=this.manifest.cellHeight,sample=document.createElement('canvas');sample.width=cw;sample.height=ch;const ctx=sample.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(this.images.get(name)!,col*cw,row*ch,cw,ch,0,0,cw,ch);const alpha=ctx.getImageData(0,0,cw,ch).data;
    let top=ch;for(let y=0;y<ch&&top===ch;y++)for(let x=Math.round(cw*.4);x<cw*.6;x++)if((alpha[(y*cw+x)*4+3]??0)>127){top=y;break;}
    this.headCache.set(key,top);return top;
  }
  draw(ctx:CanvasRenderingContext2D,action:string,frame:number,x:number,y:number,scale:number,outfit:Outfit='none',look:number|null=null,phase=0):boolean{
    const def=this.definition(action,outfit);if(!def)return false;
    const dressed=this.manifest.outfits?.[outfit];const name=def.atlas??(!dressed?.overlay?dressed?.atlas:undefined)??this.manifest.atlas,image=this.images.get(name);if(!image)return false;
    let row=def.row,col=(def.startFrame??0)+Math.max(0,Math.min(frame,def.count-1));
    if(look!==null&&(outfit==='none'||dressed?.overlay)&&this.manifest.look){row=this.manifest.look.startRow+Math.floor(look/8);col=look%8;}
    const cw=this.manifest.cellWidth,ch=this.manifest.cellHeight,a=this.manifest.anchor??{x:96,y:176};
    const dx=Math.round(x-a.x*scale),dy=Math.round(y-a.y*scale);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,col*cw,row*ch,cw,ch,dx,dy+(dressed?.overlay?(dressed.bodyOffsetY??0)*scale:0),cw*scale,ch*scale);
    if(dressed?.overlay){
      const layer=dressed.animations?.[action];const prop=this.images.get(layer?.atlas??dressed.atlas);
      if(prop){const propCount=layer?.count??dressed.count??1,propRow=layer?.row??dressed.row??0;const propDef={row:propRow,count:propCount,durations:layer?.durations??dressed.durations??Array(propCount).fill(140)};const propFrame=frameAt(propDef,phase,layer?.loop!==false);
        const idle=this.manifest.animations.idle!,headShift=dressed.followHead?(this.headTop(name,row,col)-this.headTop(idle.atlas??this.manifest.atlas,idle.row,0))*scale:0;
        const split=dressed.groundRegionY??ch;ctx.drawImage(prop,propFrame*cw,propRow*ch,cw,split,dx,dy+headShift,cw*scale,split*scale);if(split<ch)ctx.drawImage(prop,propFrame*cw,propRow*ch+split,cw,ch-split,dx,dy+split*scale,cw*scale,(ch-split)*scale);
      }
    }
    return true;
  }
}
