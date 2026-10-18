import type {Point,Rect} from './types';
export type Body={position:Point;velocity:Point;airborne:boolean;halfWidth:number};
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function recover(body:Body,area:Rect):void {
  body.position.x=clamp(body.position.x,area.x+body.halfWidth,area.x+area.width-body.halfWidth);
  body.position.y=clamp(body.position.y,area.y+Math.min(160,area.height),area.y+area.height);
  body.velocity={x:0,y:0};body.airborne=body.position.y<area.y+area.height;
}
export function integrate(body:Body,area:Rect,dt:number,reduced=false):{landed:boolean;bounced:boolean} {
  if(!Number.isFinite(dt)||dt<=0)return{landed:false,bounced:false};
  dt=Math.min(dt,1/30);let landed=false,bounced=false;
  if(reduced){recover(body,area);body.position.y=area.y+area.height;body.airborne=false;return{landed:false,bounced:false};}
  if(body.airborne)body.velocity.y+=1200*dt;
  body.position.x+=body.velocity.x*dt;body.position.y+=body.velocity.y*dt;
  const left=area.x+body.halfWidth,right=area.x+area.width-body.halfWidth,floor=area.y+area.height;
  if(body.position.x<left){body.position.x=left;body.velocity.x=Math.abs(body.velocity.x)*.35;bounced=true;}
  if(body.position.x>right){body.position.x=right;body.velocity.x=-Math.abs(body.velocity.x)*.35;bounced=true;}
  if(body.position.y<area.y+40){body.position.y=area.y+40;body.velocity.y=Math.max(0,body.velocity.y)*.35;}
  if(body.position.y>=floor){body.position.y=floor;if(body.airborne){landed=true;body.velocity.x*=.5;}body.velocity.y=0;body.airborne=false;}
  if(!body.airborne){body.velocity.x*=Math.pow(.04,dt);if(Math.abs(body.velocity.x)<2)body.velocity.x=0;}
  return{landed,bounced};
}
export function throwVelocity(samples:{point:Point;time:number}[]):Point {
  if(samples.length<2)return{x:0,y:0};
  const last=samples.at(-1)!;const valid=samples.filter(s=>last.time-s.time<=100);const first=valid[0];
  if(!first||last.time-first.time<8)return{x:0,y:0};
  const dt=(last.time-first.time)/1000;
  return{x:clamp((last.point.x-first.point.x)/dt,-1400,1400),y:clamp((last.point.y-first.point.y)/dt,-1400,1400)};
}
export function chooseArea(point:Point,areas:Rect[]):Rect|undefined {
  return areas.find(a=>point.x>=a.x&&point.x<=a.x+a.width&&point.y>=a.y&&point.y<=a.y+a.height)??areas.reduce<Rect|undefined>((best,a)=>{
    const distance=(r:Rect)=>Math.hypot(point.x-clamp(point.x,r.x,r.x+r.width),point.y-clamp(point.y,r.y,r.y+r.height));
    return !best||distance(a)<distance(best)?a:best;
  },undefined);
}
