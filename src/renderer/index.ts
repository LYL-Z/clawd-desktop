import {Assets} from './assets';
import {CORE_ACTIONS,EXT_ACTIONS,OUTFITS,PERFORMANCES,DEFAULTS,type ActionDef,type ClawdBridge,type Environment,type HostCommand,type Manifest,type Outfit,type Point,type TaskEvent} from '../shared/types';
import {frameAt,durationOf,lookIndex,ClickArbiter} from '../shared/animation';
import {integrate,recover,chooseArea,throwVelocity,type Body,clamp} from '../shared/physics';
declare global{interface Window{clawd:ClawdBridge;clawdDebug?:{snapshot:()=>unknown;action:(name:string)=>void;performance:(name:string)=>void;time:(ms:number)=>void;outfit:(name:Outfit)=>void;hitPoints:()=>{opaque:Point|null;transparent:Point};};}}
const isStudio=new URLSearchParams(location.search).get('mode')==='studio';
document.body.className=isStudio?'studio':'pet';
const canvas=document.querySelector<HTMLCanvasElement>('#stage')!;
const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
const mask=document.createElement('canvas'),maskCtx=mask.getContext('2d',{willReadFrequently:true})!;
const text=(selector:string,value:string)=>{const e=document.querySelector(selector);if(e)e.textContent=value;};
const ease=(t:number)=>{t=clamp(t,0,1);return 1-(1-t)**3;};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const napTime=180;
class Runtime {
  private assets:Assets;
  private body:Body;
  private env:Environment;
  private action='idle';
  private actionSince=0;
  private animationTime=0;
  private clock=0;
  private last=0;
  private accumulator=0;
  private paused=isStudio;
  private systemPause=false;
  private sleeping=false;
  private manualSleep=false;
  private sleepNotBefore=0;
  private performance:string|null=null;
  private performanceSince=0;
  private lastPerformance=-Infinity;
  private frame=0;
  private direction:number|null=null;
  private manualDirection=false;
  private forcedDirection=0;
  private pointing:Point={x:-10000,y:-10000};
  private local:Point={x:120,y:210};
  private windowOrigin:Point={x:0,y:0};
  private drag:{offset:Point;origin:Point;time:number;moved:boolean;samples:{point:Point;time:number}[];long:boolean;timer:ReturnType<typeof setTimeout>}|null=null;
  private mouseDown=false;
  private pressedAt=0;
  private interactive=false;
  private nativeCaptured=false;
  private task:TaskEvent|null=null;
  private pendingTask:TaskEvent|null|undefined;
  private handledEvents=new Set<string>();
  private nextAutonomy=18000;
  private autonomousHistory:string[]=[];
  private roamUntil=0;
  private wanderDirection=1;
  private lastDraw=0;
  private lastReport=0;
  private lastMove=0;
  private width=isStudio?640:240;
  private height=isStudio?420:280;
  private dpr=1;
  private clicks=new ClickArbiter(()=>this.startAction(this.sleeping?'wake':'waving'),()=>this.startPerformance('agreement'));
  private marks=new Map<string,HTMLImageElement>();
  constructor(env:Environment,assets:Assets){
    this.env=env;this.assets=assets;this.windowOrigin={x:env.windowBounds.x,y:env.windowBounds.y};
    const area=env.workArea;this.body={position:env.settings.position??{x:area.x+area.width/2,y:area.y+area.height},velocity:{x:0,y:0},airborne:false,halfWidth:70*env.settings.scale};recover(this.body,area);
    this.body.position.y=area.y+area.height;
  }
  async start(){
    await this.assets.load();
    await Promise.all(['mark.png','chorus.webp'].map(name=>new Promise<void>((resolve,reject)=>{const img=new Image();img.onload=()=>{this.marks.set(name,img);resolve();};img.onerror=()=>reject(new Error(`演出素材无法载入：${name}`));img.src=`assets/${name}`;})));
    this.resize();this.configureStudio();this.bindInput();
    window.clawd.onCommand(c=>this.command(c));window.clawd.onCursor((point,bounds,down)=>{
      this.windowOrigin={x:bounds.x,y:bounds.y};this.width=bounds.width;this.height=bounds.height;
      this.pointing=point;this.mouseDown=down;if(this.drag){this.updateDrag(point);if(!down&&performance.now()-this.pressedAt>100)this.finishDrag(false);}
      this.hitCheck(point.x-bounds.x,point.y-bounds.y);
    });
    window.addEventListener('resize',()=>this.resize());
    window.clawdDebug={snapshot:()=>this.snapshot(),action:name=>this.startAction(name,true),performance:name=>this.startPerformance(name,true),time:ms=>{this.paused=true;this.animationTime=Math.max(0,ms);this.clock=this.actionSince+ms;if(this.performance)this.performanceSince=this.clock-ms;this.render();},outfit:name=>this.changeOutfit(name),hitPoints:()=>this.hitPoints()};
    text('#status','素材已载入。点击播放，或拖动时间轴检查。');
    const readyActions=Object.keys(this.assets.manifest.animations).filter(name=>this.exists(name)).length;
    text('#asset-count',`${readyActions} 个可用动作 · ${OUTFITS.filter(o=>o.id==='none'||this.assets.manifest.outfits?.[o.id]).length} 套造型${this.assets.manifest.look?'':' · 十六向注视待交付'}`);
    window.clawd.ready();
    if(!isStudio&&!this.env.settings.welcomeSeen){this.startPerformance('welcome',true);this.env.settings.welcomeSeen=true;window.clawd.save({welcomeSeen:true});}
    requestAnimationFrame(t=>this.tick(t));
  }
  private reduced(){return this.env.settings.reducedMotion||this.env.systemReducedMotion;}
  private pixelScale(){return Math.max(1,Math.round(this.env.settings.scale*this.dpr))/this.dpr;}
  private resize(){
    if(isStudio){this.width=640;this.height=420;}else{this.width=innerWidth;this.height=innerHeight;}
    this.dpr=devicePixelRatio||1;canvas.width=Math.round(this.width*this.dpr);canvas.height=Math.round(this.height*this.dpr);mask.width=canvas.width;mask.height=canvas.height;
    if(!isStudio){canvas.style.width=`${this.width}px`;canvas.style.height=`${this.height}px`;}
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);maskCtx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.imageSmoothingEnabled=false;maskCtx.imageSmoothingEnabled=false;
  }
  private definition(name=this.action):ActionDef{return this.assets.definition(name,this.env.settings.outfit)??this.assets.definition('idle','none')!;}
  private exists(name:string):boolean{return Boolean(this.assets.definition(name,this.env.settings.outfit));}
  private startAction(name:string,force=false){
    if(name==='sleep-toggle'){name=this.sleeping?'wake':'sleep';}
    if(name==='cancel-drag'){this.finishDrag(true);return;}
    if(!force&&(this.systemPause||this.env.settings.paused||this.drag))return;
    if(this.task&&['working','waiting','thinking','failed'].includes(this.task.state)&&!force)return;
    this.stopPerformance();this.action=name;this.actionSince=this.clock;this.animationTime=0;this.direction=null;
    if(name==='sleep'){this.sleeping=true;this.manualSleep=true;}else{this.sleeping=false;this.manualSleep=false;this.sleepNotBefore=this.clock+5000;}
    if(name==='running-right'||name==='skate'||name==='skate-jump')this.wanderDirection=1;else if(name==='running-left')this.wanderDirection=-1;
    if(['running-right','running-left','skate','skate-jump'].includes(name)&&!this.reduced())this.roamUntil=this.clock+Math.max(1600,durationOf(this.definition(name)));
    else this.roamUntil=0;
    text('#status',this.exists(name)?'':'此动作的源素材尚未交付；当前仅预览已批准的待机帧。');
    text('#scene-name',[...CORE_ACTIONS,...EXT_ACTIONS].find(([id])=>id===name)?.[1]??name);
  }
  private changeOutfit(outfit:Outfit){
    if(!OUTFITS.some(o=>o.id===outfit))return;
    if(outfit!=='none'&&!this.assets.manifest.outfits?.[outfit]){text('#status','该造型的源素材尚未完成。');return;}
    this.stopPerformance();this.env.settings.outfit=outfit;this.action='waving';this.actionSince=this.clock;
    if(!isStudio)window.clawd.save({outfit});text('#scene-name',OUTFITS.find(o=>o.id===outfit)?.label??'Clawd');
  }
  private startPerformance(name:string,force=false){
    if(!PERFORMANCES.some(p=>p[0]===name)||(!force&&(this.drag||this.systemPause||this.env.settings.paused||this.task||this.clock-this.lastPerformance<30000)))return;
    this.clicks.cancel();this.body.velocity={x:0,y:0};this.performance=name;this.performanceSince=this.clock;this.lastPerformance=this.clock;this.action='idle';this.actionSince=this.clock;
    text('#scene-name',PERFORMANCES.find(p=>p[0]===name)?.[1]??name);if(isStudio)this.paused=false;
  }
  private stopPerformance(){this.performance=null;}
  private command(command:HostCommand){
    switch(command.type){
      case'action':this.startAction(String(command.value));break;
      case'performance':this.startPerformance(String(command.value));break;
      case'outfit':this.changeOutfit(command.value as Outfit);break;
      case'setting':{Object.assign(this.env.settings,command.value);if(this.reduced()||this.env.settings.paused){this.stopPerformance();this.finishDrag(true);this.action='idle';this.body.velocity={x:0,y:0};}break;}
      case'environment':{
        const env=command.value as Environment;this.env.displays=env.displays;this.env.systemReducedMotion=env.systemReducedMotion;this.env.idleSeconds=env.idleSeconds;this.env.workArea=chooseArea(this.body.position,env.displays)??env.workArea;
        if(!this.body.airborne&&!this.drag){const area=this.env.workArea;this.body.position.x=clamp(this.body.position.x,area.x+this.body.halfWidth,area.x+area.width-this.body.halfWidth);this.body.position.y=area.y+area.height;}
        break;
      }
      case'recover':{this.finishDrag(true);this.stopPerformance();const area=command.value as Environment['workArea'];this.env.workArea=area;this.body.position={x:area.x+area.width/2,y:area.y+area.height};this.body.velocity={x:0,y:0};this.body.airborne=false;this.action='idle';break;}
      case'pause-system':this.systemPause=true;this.finishDrag(true);this.stopPerformance();this.clicks.cancel();break;
      case'resume-system':{
        this.systemPause=false;this.accumulator=0;this.last=performance.now();
        recover(this.body,this.env.workArea);this.body.position.y=this.env.workArea.y+this.env.workArea.height;this.body.airborne=false;
        this.action=this.sleeping?'sleep':({thinking:'review',working:'running',waiting:'waiting'} as Record<string,string>)[this.task?.state??'']??'idle';this.actionSince=this.clock;
        break;
      }
      case'task':this.applyTask(command.value as TaskEvent|null);break;
    }
    this.render();
  }
  private applyTask(event:TaskEvent|null){
    if(this.drag||this.body.airborne){this.pendingTask=event;return;}
    this.task=event;this.stopPerformance();this.finishDrag(true);this.body.velocity={x:0,y:0};
    if(!event){this.action='idle';this.actionSince=this.clock;this.nextAutonomy=this.clock+20000;return;}
    const key=`${event.eventId}:${event.state}`;
    if((event.state==='done'||event.state==='failed')&&this.handledEvents.has(key))return;
    if(event.state==='done'||event.state==='failed'){this.handledEvents.add(key);if(this.handledEvents.size>100)this.handledEvents.delete(this.handledEvents.values().next().value!);}
    this.sleeping=false;this.manualSleep=false;this.action=({idle:'idle',thinking:'review',working:'running',waiting:'waiting',done:'waving',failed:'failed'} as const)[event.state];this.actionSince=this.clock;
  }
  private tick(now:number){
    const elapsed=this.last?Math.min((now-this.last)/1000,.1):0;this.last=now;
    const frozen=this.systemPause||this.env.settings.paused||(isStudio&&this.paused);
    if(!frozen){this.clock+=elapsed*1000;this.animationTime=this.clock-this.actionSince;this.accumulator+=elapsed;
      let steps=0;while(this.accumulator>=1/60&&steps++<5){this.update(1/60);this.accumulator-=1/60;}if(steps>=5)this.accumulator=0;
    }
    const moving=this.body.airborne||this.drag||this.roamUntil>this.clock||this.performance;
    const interval=this.systemPause?1000:this.env.settings.paused?500:moving?1000/30:1000/10;
    if(now-this.lastDraw>=interval){this.render();this.lastDraw=now;}
    if(!isStudio&&now-this.lastMove>30){window.clawd.move(this.body.position,Boolean(this.performance));this.lastMove=now;}
    if(now-this.lastReport>1000){window.clawd.report(this.snapshot());this.lastReport=now;}
    requestAnimationFrame(t=>this.tick(t));
  }
  private update(dt:number){
    if(isStudio)return;
    this.body.halfWidth=72*this.pixelScale();
    if(!this.drag){
      const result=integrate(this.body,this.env.workArea,dt,this.reduced());
      if(result.landed&&!this.reduced()){
        this.action=this.exists('landing')?'landing':'jumping';this.actionSince=this.clock;
        if(this.pendingTask!==undefined){const pending=this.pendingTask;this.pendingTask=undefined;this.applyTask(pending);}
        else if(this.task)this.applyTask(this.task);
      }
      if(this.roamUntil>this.clock&&!this.body.airborne&&!this.reduced()&&!this.task){
        this.body.position.x+=this.wanderDirection*60*dt;
        if(this.body.position.x<=this.env.workArea.x+this.body.halfWidth||this.body.position.x>=this.env.workArea.x+this.env.workArea.width-this.body.halfWidth){this.wanderDirection*=-1;this.action=this.wanderDirection>0?'running-right':'running-left';}
      }
    }
    if(this.performance){const p=PERFORMANCES.find(p=>p[0]===this.performance)!;if(this.clock-this.performanceSince>(this.reduced()?1200:p[2])){this.stopPerformance();this.action='idle';this.actionSince=this.clock;this.nextAutonomy=this.clock+20000;}return;}
    if(this.drag)return;
    if(this.task){
      if((this.task.state==='done'||this.task.state==='failed')&&this.action!=='idle'&&this.animationTime>=durationOf(this.definition())){this.action='idle';this.actionSince=this.clock;}
      return;
    }
    if(this.action!=='idle'&&this.action!=='sleep'&&!(this.action==='thrown'&&this.body.airborne)&&this.animationTime>durationOf(this.definition())&&this.roamUntil<=this.clock){this.action='idle';this.actionSince=this.clock;}
    if(this.sleeping){if(this.env.idleSeconds<3&&!this.manualSleep){this.sleeping=false;this.sleepNotBefore=this.clock+5000;this.action=this.exists('wake')?'wake':'waving';this.actionSince=this.clock;}return;}
    if(this.env.idleSeconds>napTime&&this.clock>=this.sleepNotBefore&&!this.reduced()){this.sleeping=true;this.action='sleep';this.actionSince=this.clock;return;}
    if(this.reduced()||this.action!=='idle'||this.clock<this.nextAutonomy)return;
    this.nextAutonomy=this.clock+20000+Math.random()*15000;
    const candidates=['waving','sway','peek-left','peek-right','headphone-groove','cowboy-tip'].filter(a=>this.exists(a)&&!this.autonomousHistory.slice(-2).includes(a));
    if(this.env.settings.roam&&Math.random()<.5){this.roamUntil=this.clock+4000+Math.random()*4000;this.action=this.wanderDirection>0?'running-right':'running-left';this.actionSince=this.clock;}
    else{const name=candidates[Math.floor(Math.random()*candidates.length)]??'idle';this.autonomousHistory.push(name);this.startAction(name);}
  }
  private drawActor(target:CanvasRenderingContext2D,x:number,y:number,scale:number,action=this.action,outfit=this.env.settings.outfit,phase=this.animationTime,look:number|null=this.direction){
    const actionOutfits:Record<string,Outfit>={'headphone-groove':'headphones',skate:'skateboard','skate-jump':'skateboard','wizard-charge':'wizard','wizard-cast':'wizard','hardhat-work':'hardhat','detective-inspect':'detective','chef-prepare':'chef','cowboy-tip':'cowboy',football:'football'};
    outfit=this.assets.manifest.animations[action]?.outfit??actionOutfits[action]??outfit;
    const chosen=this.assets.definition(action,outfit)?action:'idle';const def=this.assets.definition(chosen,outfit)??this.assets.definition('idle','none')!;
    const frame=this.reduced()?0:frameAt(def,phase,def.loop!==false);this.frame=frame;
    const t=phase/1000,progress=clamp(phase/Math.max(durationOf(def),1),0,1);let actorX=x,actorY=y,actorLook=chosen==='idle'?look:null;
    if(!this.reduced()){
      if(action==='sway'){actorX+=Math.sin(t*7)*3*scale*(1-progress);actorY-=Math.abs(Math.sin(t*7))*2*scale*(1-progress);}
      if(action==='headphone-groove')actorY-=Math.max(0,Math.sin(t*9))*5*scale;
      if(action==='skate-jump')actorY-=Math.sin(progress*Math.PI)*8*scale;
    }
    const peeking=action==='peek-left'||action==='peek-right';
    if(peeking){const sign=action==='peek-left'?-1:1,reveal=this.reduced()?1:Math.sin(progress*Math.PI);target.save();target.beginPath();target.rect(x-96*scale,y-208*scale,192*scale,208*scale);target.clip();actorX+=sign*(1-reveal)*110*scale;}
    this.assets.draw(target,chosen,frame,actorX,actorY,scale,outfit,actorLook,this.reduced()?0:phase);if(peeking)target.restore();
  }
  private drawPaper(x:number,y:number,w:number,h:number){
    const left=Math.round(x-w/2),top=Math.round(y-h/2),width=Math.round(w),height=Math.round(h);if(width<2||height<2)return;
    ctx.fillStyle='#e7e5df';ctx.fillRect(left,top,width,height);ctx.fillStyle='#faf9f5';ctx.fillRect(left+1,top+1,width-2,height-2);
  }
  private drawMark(x:number,y:number,size:number){const img=this.marks.get('mark.png');if(img){ctx.imageSmoothingEnabled=false;ctx.drawImage(img,Math.round(x-size/2),Math.round(y-size/2),Math.round(size),Math.round(size));}}
  private drawChorus(x:number,y:number,scale:number,t:number){
    const img=this.marks.get('chorus.webp');if(img){const cw=img.width/4;for(let i=0;i<4;i++){const bounce=this.reduced()?0:Math.max(0,Math.sin(t*5-i*.8))*8;ctx.drawImage(img,i*cw,0,cw,img.height,Math.round(x+(i-1.5)*176*scale-cw*scale/2),Math.round(y-img.height*scale-bounce),Math.round(cw*scale),Math.round(img.height*scale));}}
    else for(let i=0;i<4;i++)this.drawActor(ctx,x+(i-1.5)*76,y-Math.max(0,Math.sin(t*5-i*.8))*7,.4,'waving','none',t*1000+i*150,null);
  }
  private renderPerformance(x:number,y:number,scale:number){
    const t=(this.clock-this.performanceSince)/1000,w=this.width,h=this.height,center=w/2;
    if(this.reduced()){
      this.drawPaper(center,Math.max(100,y-120),Math.min(w-30,360),100);ctx.fillStyle='#141413';ctx.font='bold 22px Segoe UI';ctx.textAlign='center';ctx.fillText(this.performance==='agreement'?'You’re Absolutely Right!':'Welcome, Claw’d',center,Math.max(100,y-120)+8);this.drawActor(ctx,x,y,scale,'idle',this.env.settings.outfit,0,null);return;
    }
    if(this.performance==='welcome'){
      const reveal=ease(t/.45),cross=ease((t-.5)/.6),descent=ease((t-1.1)/.95),exit=ease((t-1.1)/.9),py=Math.min(y-130,h/2),cardWidth=Math.min(w-30,310),edge=py+100;
      this.drawPaper(center,py,cardWidth*(1-exit)*reveal,200*(1-exit)*reveal);
      if(t>.2&&t<.55){ctx.fillStyle='#141413';ctx.textAlign='center';ctx.font='600 18px Segoe UI';ctx.fillText('Welcome, Claw’d',center,py+63);}
      const ax=lerp(center,x,descent),ay=lerp(lerp(py+20,edge+5,cross),y,descent)-Math.sin(descent*Math.PI)*22;
      const actorScale=lerp(scale*.8,scale,descent),action=t<.5?'idle':t<1.1?'waving':t<2.05?'jumping':t<2.45?'landing':'waving';
      const phase=t<.5?t*1000:t<1.1?(t-.5)*1000:t<2.05?280+(t-1.1)*300:t<2.45?(t-2.05)*1000:(t-2.45)*1000;
      const actor=(target:CanvasRenderingContext2D)=>this.drawActor(target,ax,ay,actorScale,action,'none',phase,null);
      if(t<1.1){
        // The lower paper edge masks the legs until the same sprite steps across it.
        ctx.save();ctx.beginPath();ctx.rect(center-cardWidth/2,py-100,cardWidth,194);ctx.clip();actor(ctx);ctx.restore();
        if(cross>.55){ctx.save();ctx.beginPath();ctx.rect(0,edge+1,w,h-edge);ctx.clip();actor(ctx);ctx.restore();}
        maskCtx.save();maskCtx.beginPath();maskCtx.rect(center-cardWidth/2,py-100,cardWidth,194);maskCtx.clip();actor(maskCtx);maskCtx.restore();
        if(cross>.55){maskCtx.save();maskCtx.beginPath();maskCtx.rect(0,edge+1,w,h-edge);maskCtx.clip();actor(maskCtx);maskCtx.restore();}
      }else{actor(ctx);actor(maskCtx);}
      if(t>1.1&&t<2){const line=1-exit;ctx.fillStyle='#d97757';for(let i=0;i<24;i++){const px=center+(i-11.5)*10*line;ctx.fillRect(Math.round(px),Math.round(edge-80*exit),2,2);}}
      return;
    }
    if(this.performance==='agreement'){
      const enter=ease((t-.4)/.7),exit=ease((t-3.5)/1.1),size=enter*(1-exit);
      const py=Math.max(145,y-180),paperW=Math.min(w-30,440)*size;
      this.drawPaper(center,py,paperW,270*size);this.drawMark(center-paperW*.3,py-80*size,135*size);
      if(size>.4){ctx.save();ctx.beginPath();ctx.rect(center-paperW/2,py-135*size,paperW,270*size);ctx.clip();ctx.fillStyle='#141413';ctx.textAlign='center';ctx.font=`900 ${Math.round(44*size)}px Segoe UI`;for(const [i,line] of ['You’re','Absolutely','Right!'].entries())ctx.fillText(line,center,py-36+i*45*size);this.drawChorus(center,py+122*size,.36*size,t);ctx.restore();}
      const jump=Math.sin(clamp(t/.9,0,1)*Math.PI)*40,heroX=lerp(x,center+paperW*.39,size),heroY=lerp(y-jump,py-72,size),heroScale=lerp(scale,scale*.6,size),heroOutfit:Outfit=this.assets.manifest.outfits?.wizard?'wizard':this.env.settings.outfit;this.drawActor(ctx,heroX,heroY,heroScale,'wizard-cast',heroOutfit,t*1000,null);this.drawActor(maskCtx,heroX,heroY,heroScale,'wizard-cast',heroOutfit,t*1000,null);return;
    }
    if(this.performance==='sigil'){
      const grow=ease((t-.7)/.8)*(1-ease((t-2.5)/1.1));this.drawMark(x,y-110,210*grow);
      const name=this.exists('wizard-cast')?'wizard-cast':'waving',outfit:Outfit=this.assets.manifest.outfits?.wizard?'wizard':this.env.settings.outfit;
      if(t>1.7&&t<2.5){const spread=Math.sin((t-1.7)/.8*Math.PI)*3*scale;const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;const lc=layer.getContext('2d')!;lc.scale(this.dpr,this.dpr);this.drawActor(lc,x,y,scale,name,outfit,t*1000,null);
        const block=8*this.dpr;for(let by=0;by<layer.height;by+=block)for(let bx=0;bx<layer.width;bx+=block){const stable=Math.abs(bx/this.dpr-x)<55*scale&&by/this.dpr>y-122*scale&&by/this.dpr<y-30*scale;const dx=stable?0:Math.sin(bx*13+by*7)*spread*this.dpr,dy=stable?0:Math.cos(by*9+bx*2)*spread*this.dpr;ctx.drawImage(layer,bx,by,block,block,Math.round((bx+dx)/this.dpr),Math.round((by+dy)/this.dpr),8,8);}
      }else this.drawActor(ctx,x,y,scale,name,outfit,t*1000,null);
      ctx.fillStyle='#e8b93c';for(let i=0;i<Math.min(32,Math.floor(grow*32));i++){const r=25+(i*29%100)*grow;ctx.fillRect(Math.round(x+Math.cos(i*2.4)*r),Math.round(y-120+Math.sin(i*2.4)*r),3,3);}
      this.drawActor(maskCtx,x,y,scale,name,outfit,t*1000,null);return;
    }
    if(this.performance==='ensemble'){
      const appear=ease(t/1.2)*(1-ease((t-4.1)/1.2));
      ctx.fillStyle='#b0aea5';for(let i=0;i<48;i++){const px=center-150+(i%16)*20,py=y-30-Math.floor(i/16)*10;if(i/48<appear)ctx.fillRect(Math.round(px),Math.round(py),2,2);}
      const jump=t>3.5&&t<4.2?Math.sin((t-3.5)/.7*Math.PI)*25:0;
      if(appear>.03)for(const side of [-1,1]){const action=t<1.2?(side<0?'running-right':'running-left'):t>4.1?(side<0?'running-left':'running-right'):'waving';this.drawActor(ctx,x+side*(110+170*(1-appear)),y-jump-Math.max(0,Math.sin(t*5-side))*9,.55*scale,action,'none',t*1000+side*100,null);}
      const closing=t>5.05,outfit:Outfit=!closing&&this.assets.manifest.outfits?.headphones?'headphones':this.env.settings.outfit;
      const mainY=y-jump-Math.max(0,Math.sin(t*5))*5*(1-ease((t-4.8)/.5)),mainAction=!closing&&this.exists('headphone-groove')?'headphone-groove':'waving';this.drawActor(ctx,x,mainY,scale,mainAction,outfit,t*1000,null);this.drawActor(maskCtx,x,mainY,scale,mainAction,outfit,t*1000,null);
      const table=this.assets.images.get('wardrobe.webp'),chef=this.assets.manifest.outfits?.chef?.animations?.['chef-prepare'];if(table&&chef&&appear>.05){const size=.75*scale,cw=this.assets.manifest.cellWidth,ch=this.assets.manifest.cellHeight;ctx.drawImage(table,0,chef.row*ch+119,cw,89,Math.round(x-cw*size/2),Math.round(y-65*size),Math.round(cw*size),Math.round(89*size));}
    }
  }
  private render(){
    if(canvas.width!==Math.round(this.width*this.dpr)||canvas.height!==Math.round(this.height*this.dpr))this.resize();
    ctx.clearRect(0,0,this.width,this.height);maskCtx.clearRect(0,0,this.width,this.height);
    const scale=this.pixelScale();
    this.local=isStudio?{x:this.width/2,y:this.height-38}:{x:this.body.position.x-this.windowOrigin.x,y:this.body.position.y-this.windowOrigin.y};
    if(!isStudio&&(!Number.isFinite(this.local.x)||Math.abs(this.local.x)>this.width*2))this.local={x:this.width/2,y:210};
    const {x,y}=this.local;
    const blink=frameAt(this.assets.manifest.animations.idle!,this.animationTime)===2;
    this.direction=this.assets.manifest.look?(this.manualDirection?this.forcedDirection:(!isStudio&&!blink&&!this.reduced()&&this.action==='idle'&&!this.sleeping&&!this.drag&&!this.performance?lookIndex(this.pointing.x-this.body.position.x,this.pointing.y-(this.body.position.y-75)):null)):null;
    if(this.performance)this.renderPerformance(x,y,scale);
    else{this.drawActor(ctx,x,y,scale);this.drawActor(maskCtx,x,y,scale);}
    if(this.task?.detail){ctx.fillStyle='#faf9f5';const tw=Math.min(260,ctx.measureText(this.task.detail).width+24);ctx.fillRect(Math.round(x-tw/2),Math.round(y-174),Math.round(tw),28);ctx.fillStyle='#141413';ctx.font='12px Microsoft YaHei';ctx.textAlign='center';ctx.fillText(this.task.detail,x,y-155);}
    if(isStudio){text('#clock',`${(this.animationTime/1000).toFixed(2)} s`);const timeline=document.querySelector<HTMLInputElement>('#timeline')!;if(document.activeElement!==timeline)timeline.value=String(this.performance?this.clock-this.performanceSince:this.animationTime);}
  }
  private hitCheck(x:number,y:number){
    if(isStudio)return;const px=Math.floor(x*this.dpr),py=Math.floor(y*this.dpr);
    // The cursor needs one alpha value. Reading the entire high-DPI mask every
    // rendered frame allocated megabytes repeatedly even while standing still.
    const hit=px>=0&&py>=0&&px<mask.width&&py<mask.height&&maskCtx.getImageData(px,py,1,1).data[3]!>127;
    const captured=Boolean(this.drag);if(this.interactive!==hit||this.nativeCaptured!==captured){this.interactive=hit;this.nativeCaptured=captured;window.clawd.interactive(hit,captured);}
  }
  private hitPoints(){
    // Whole-mask scans are reserved for this explicit diagnostic helper.
    const alpha=maskCtx.getImageData(0,0,mask.width,mask.height).data;
    let opaque:Point|null=null;const preferred={x:Math.round(this.local.x*this.dpr),y:Math.round((this.local.y-60*this.env.settings.scale)*this.dpr)};
    const solid=(x:number,y:number)=>x>=0&&y>=0&&x<mask.width&&y<mask.height&&(alpha[(y*mask.width+x)*4+3]??0)>127;
    if(solid(preferred.x,preferred.y))opaque={x:preferred.x/this.dpr+this.windowOrigin.x,y:preferred.y/this.dpr+this.windowOrigin.y};
    else{let longest=0;for(let y=0;y<mask.height;y+=2){let start=-1;for(let x=0;x<=mask.width;x++){if(solid(x,y)){if(start<0)start=x;}else if(start>=0){if(x-start>longest){longest=x-start;opaque={x:(start+x)/2/this.dpr+this.windowOrigin.x,y:y/this.dpr+this.windowOrigin.y};}start=-1;}}}}
    return{opaque,transparent:{x:this.windowOrigin.x+10,y:this.windowOrigin.y+10}};
  }
  private bindInput(){
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();this.clicks.cancel();if(!isStudio)window.clawd.menu();});
    canvas.addEventListener('pointerdown',e=>{
      if(isStudio||e.button!==0)return;this.pressedAt=performance.now();this.pointing={x:e.screenX,y:e.screenY};this.stopPerformance();
      const point={...this.pointing};this.drag={offset:{x:this.body.position.x-point.x,y:this.body.position.y-point.y},origin:point,time:performance.now(),moved:false,samples:[{point,time:performance.now()}],long:false,timer:setTimeout(()=>{if(this.drag&&!this.drag.moved){this.drag.long=true;this.clicks.cancel();window.clawd.menu(true);}},700)};
      try{canvas.setPointerCapture(e.pointerId);}catch{}this.hitCheck(e.offsetX,e.offsetY);
    });
    canvas.addEventListener('pointermove',e=>{this.pointing={x:e.screenX,y:e.screenY};if(this.drag)this.updateDrag(this.pointing);this.hitCheck(e.offsetX,e.offsetY);});
    canvas.addEventListener('pointerup',e=>{if(e.button===0)this.finishDrag(false);});canvas.addEventListener('pointercancel',()=>this.finishDrag(true));
    window.addEventListener('blur',()=>this.finishDrag(true));
  }
  private updateDrag(point:Point){
    const drag=this.drag;if(!drag)return;
    if(Math.hypot(point.x-drag.origin.x,point.y-drag.origin.y)>6){if(!drag.moved){this.clicks.cancel();clearTimeout(drag.timer);this.action='held';this.actionSince=this.clock;}drag.moved=true;}
    if(!drag.moved)return;
    drag.samples.push({point:{...point},time:performance.now()});drag.samples=drag.samples.filter(s=>performance.now()-s.time<150);
    this.body.position={x:point.x+drag.offset.x,y:point.y+drag.offset.y};this.body.velocity={x:0,y:0};this.body.airborne=false;
    const area=chooseArea(this.body.position,this.env.displays);if(area)this.env.workArea=area;
  }
  private finishDrag(cancel:boolean){
    const drag=this.drag;if(!drag)return;clearTimeout(drag.timer);this.drag=null;
    if(drag.moved){this.clicks.cancel();const v=cancel||this.reduced()?{x:0,y:0}:throwVelocity(drag.samples);this.body.velocity=v;this.body.airborne=true;this.action='thrown';this.actionSince=this.clock;
      if(cancel||this.reduced()){recover(this.body,this.env.workArea);this.body.position.y=this.env.workArea.y+this.env.workArea.height;this.body.airborne=false;this.action='idle';}
      window.clawd.save({position:this.body.position});
    }else if(!cancel&&!drag.long)this.clicks.click(performance.now());
    if(!this.body.airborne&&this.pendingTask!==undefined){const pending=this.pendingTask;this.pendingTask=undefined;this.applyTask(pending);}
    this.hitCheck(this.pointing.x-this.windowOrigin.x,this.pointing.y-this.windowOrigin.y);
  }
  private configureStudio(){
    if(!isStudio)return;
    const option=(value:string,label:string)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
    const action=document.querySelector<HTMLSelectElement>('#action')!,outfit=document.querySelector<HTMLSelectElement>('#outfit')!,perf=document.querySelector<HTMLSelectElement>('#performance')!;
    for(const [id,label] of [...CORE_ACTIONS,...EXT_ACTIONS])action.add(option(id,`${label}${this.exists(id)?'':'（待素材）'}`));
    for(const o of OUTFITS){const op=option(o.id,o.label);op.disabled=o.id!=='none'&&!this.assets.manifest.outfits?.[o.id];outfit.add(op);}
    for(const [id,label] of PERFORMANCES)perf.add(option(id,label));
    if(!this.assets.manifest.look){document.querySelector<HTMLInputElement>('#directions')!.disabled=true;document.querySelector<HTMLInputElement>('#direction')!.disabled=true;}
    action.onchange=()=>{this.startAction(action.value,true);perf.value='';this.render();};outfit.onchange=()=>{this.changeOutfit(outfit.value as Outfit);this.render();};perf.onchange=()=>{if(perf.value)this.startPerformance(perf.value,true);};
    document.querySelector<HTMLButtonElement>('#play')!.onclick=()=>{this.paused=!this.paused;};
    document.querySelector<HTMLButtonElement>('#restart')!.onclick=()=>{this.actionSince=this.clock;this.performanceSince=this.clock;this.animationTime=0;this.paused=false;};
    document.querySelector<HTMLInputElement>('#timeline')!.oninput=e=>{this.paused=true;const ms=Number((e.target as HTMLInputElement).value);this.animationTime=ms;this.clock=this.actionSince+ms;this.performanceSince=this.actionSince;this.render();};
    document.querySelector<HTMLInputElement>('#reduced')!.onchange=e=>{this.env.settings.reducedMotion=(e.target as HTMLInputElement).checked;this.render();};
    document.querySelector<HTMLInputElement>('#directions')!.onchange=e=>{this.manualDirection=(e.target as HTMLInputElement).checked;this.action='idle';this.render();};
    document.querySelector<HTMLInputElement>('#direction')!.oninput=e=>{this.forcedDirection=Number((e.target as HTMLInputElement).value);this.manualDirection=true;this.action='idle';this.render();};
  }
  snapshot(){return{action:this.action,sourceAvailable:this.exists(this.action),frame:this.frame,performance:this.performance,outfit:this.env.settings.outfit,look:this.direction,taskState:this.task?.state??null,position:this.body.position,velocity:this.body.velocity,airborne:this.body.airborne,dragging:Boolean(this.drag),interactive:this.interactive,paused:this.systemPause||this.env.settings.paused,reducedMotion:this.reduced(),animationTime:this.animationTime,devicePixelRatio:this.dpr,physicalPixelScale:Math.round(this.pixelScale()*this.dpr),loadedAtlases:[...this.assets.images.keys()],manifestActions:Object.keys(this.assets.manifest.animations)};}
}
async function boot(){
  const env=await window.clawd.init();
  if(!env?.manifest||!env.manifest.animations?.idle)throw new Error('角色素材尚未完成，当前不绘制占位宠物。请完成视觉流水线后重新构建。');
  const runtime=new Runtime(env,new Assets(env.manifest));await runtime.start();
}
void boot().catch(error=>{const el=document.querySelector<HTMLElement>('#error')!;el.hidden=false;el.textContent=String(error.message??error);text('#status',String(error.message??error));window.clawd?.report({error:String(error.message??error)});});
