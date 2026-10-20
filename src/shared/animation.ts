import type {ActionDef} from './types';
export function durationOf(def:ActionDef):number{return def.durations.slice(0,def.count).reduce((s,n)=>s+n,0);}
export function frameAt(def:ActionDef,elapsed:number,loop=true):number {
  const total=durationOf(def);if(total<=0)return 0;
  let t=loop?Math.max(0,elapsed)%total:Math.min(Math.max(0,elapsed),total-1);
  for(let i=0;i<def.count;i++){const d=def.durations[i]??140;if(t<d)return i;t-=d;}return def.count-1;
}
export function lookIndex(dx:number,dy:number):number|null {
  if(Math.hypot(dx,dy)<45)return null;
  const angle=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;return Math.round(angle/22.5)%16;
}
/** Keep the current 16-way gaze sector until the pointer clears a small angular hysteresis band. */
export function stableLookIndex(dx:number,dy:number,current:number|null,hysteresisDegrees=5):number|null{
  const distance=Math.hypot(dx,dy);if(distance<45)return null;
  const angle=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
  const next=Math.round(angle/22.5)%16;
  if(current===null||!Number.isInteger(current)||current<0||current>15)return next;
  const center=current*22.5;
  const delta=((angle-center+540)%360)-180;
  return Math.abs(delta)<=11.25+Math.max(0,Math.min(10,hysteresisDegrees))?current:next;
}
export class ClickArbiter {
  private pending:ReturnType<typeof setTimeout>|undefined;
  private last=0;
  constructor(private single:()=>void,private double:()=>void,private delay=330){}
  click(now:number):void {
    if(this.pending&&now-this.last<=this.delay){this.cancel();this.double();return;}
    this.cancel();this.last=now;this.pending=setTimeout(()=>{this.pending=undefined;this.single();},this.delay);
  }
  cancel():void{if(this.pending)clearTimeout(this.pending);this.pending=undefined;}
}
