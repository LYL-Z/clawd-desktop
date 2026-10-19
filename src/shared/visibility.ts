import type {AppRule,SceneKind,Settings,VisibilityReason,VisibilitySnapshot} from './types';
import type {ForegroundSample} from './probe';

const AUTOMATIC_REASONS:VisibilityReason[]=['game','fullscreen'];

function normalizedName(value:string|undefined):string{
  return value?.trim().split(/[\\/]/).pop()?.toLocaleLowerCase('en-US')??'';
}

function ruleMatches(rule:AppRule,path:string|undefined,name:string|undefined):boolean{
  if(!rule.enabled)return false;
  if(rule.match==='path')return Boolean(path)&&normalizePath(rule.exePath)===normalizePath(path!);
  return normalizedName(rule.exeName)===normalizedName(name);
}

function normalizePath(value:string):string{
  return value.trim().replaceAll('/','\\').replace(/\\+/g,'\\').toLocaleLowerCase('en-US');
}

export function classifyScene(settings:Settings,sample:ForegroundSample):{scene:SceneKind;automaticReasons:Set<VisibilityReason>}{
  const foregroundPath=sample.foregroundPath??undefined;
  const foregroundName=sample.foregroundName??undefined;
  const exception=settings.appRules.some(rule=>rule.kind==='exception'&&ruleMatches(rule,foregroundPath,foregroundName));
  const reasons=new Set<VisibilityReason>();
  const games=settings.appRules.filter(rule=>rule.kind==='game'&&rule.enabled);
  const foregroundGame=games.some(rule=>ruleMatches(rule,foregroundPath,foregroundName));
  const runningGame=games.some(rule=>sample.runningRuleIds.includes(rule.id));
  const scene:SceneKind=foregroundGame||runningGame?'game':sample.fullscreen?'fullscreen':'desktop';
  if(settings.autoHideMode==='manual')return{scene,automaticReasons:reasons};
  if(settings.autoHideMode==='game-running'){
    const running=new Set(sample.runningRuleIds);
    if(games.some(rule=>running.has(rule.id)))reasons.add('game');
  }else if(!exception){
    if(foregroundGame)reasons.add('game');
    if(settings.hideFullscreen&&sample.fullscreen)reasons.add('fullscreen');
  }
  return{scene,automaticReasons:reasons};
}

export class VisibilityController{
  private userHidden=false;
  private systemReasons=new Set<VisibilityReason>();
  private automaticReasons=new Set<VisibilityReason>();
  private pendingReasons:Set<VisibilityReason>|null=null;
  private pendingTimer:ReturnType<typeof setTimeout>|undefined;
  private current:VisibilitySnapshot;

  constructor(private readonly onChange:(snapshot:VisibilitySnapshot)=>void){
    this.current={visible:true,reasons:[],scene:'desktop',probeHealthy:false};
  }

  get snapshot():VisibilitySnapshot{return{...this.current,reasons:[...this.current.reasons]};}

  setProbeState(healthy:boolean,scene:SceneKind,foregroundName?:string,updatedAt=Date.now()):void{
    const changed=this.current.scene!==scene||this.current.foregroundName!==foregroundName||this.current.probeHealthy!==healthy;
    if(!changed&&updatedAt-(this.current.updatedAt??0)<1000)return;
    this.commit({...this.current,scene,foregroundName,probeHealthy:healthy,updatedAt});
  }

  setUserHidden(hidden:boolean):void{
    this.userHidden=hidden;this.reconcile();
  }

  setSystemBlocked(reason:'lock'|'suspend',blocked:boolean):void{
    if(blocked)this.systemReasons.add(reason);else this.systemReasons.delete(reason);
    this.reconcile();
  }

  updateAutomatic(reasons:Iterable<VisibilityReason>,restoreDelayMs=900,immediate=false):void{
    const next=new Set([...reasons].filter(reason=>AUTOMATIC_REASONS.includes(reason)));
    if(sameSet(next,this.automaticReasons)){this.cancelPending();return;}
    if(this.pendingReasons&&sameSet(next,this.pendingReasons))return;
    this.cancelPending();
    const currentBlocks=this.automaticReasons.size>0;
    const nextBlocks=next.size>0;
    if(immediate||currentBlocks===nextBlocks){this.automaticReasons=next;this.reconcile();return;}
    this.pendingReasons=next;
    const delay=nextBlocks?400:Math.round(Math.max(500,Math.min(5000,restoreDelayMs)));
    this.pendingTimer=setTimeout(()=>{
      this.pendingTimer=undefined;
      this.automaticReasons=this.pendingReasons??new Set();
      this.pendingReasons=null;
      this.reconcile();
    },delay);
  }

  destroy():void{this.cancelPending();}

  private cancelPending():void{
    if(this.pendingTimer)clearTimeout(this.pendingTimer);
    this.pendingTimer=undefined;this.pendingReasons=null;
  }

  private reconcile():void{
    const reasons=new Set<VisibilityReason>(this.systemReasons);
    for(const reason of this.automaticReasons)reasons.add(reason);
    if(this.userHidden)reasons.add('user');
    const ordered=(['lock','suspend','user','game','fullscreen'] as const).filter(reason=>reasons.has(reason));
    this.commit({...this.current,visible:ordered.length===0,reasons:ordered});
  }

  private commit(next:VisibilitySnapshot):void{
    if(this.current.visible===next.visible&&this.current.scene===next.scene&&this.current.foregroundName===next.foregroundName&&this.current.probeHealthy===next.probeHealthy&&this.current.updatedAt===next.updatedAt&&sameArray(this.current.reasons,next.reasons))return;
    this.current=next;this.onChange(this.snapshot);
  }
}

function sameSet(a:Set<VisibilityReason>,b:Set<VisibilityReason>):boolean{return a.size===b.size&&[...a].every(value=>b.has(value));}
function sameArray(a:VisibilityReason[],b:VisibilityReason[]):boolean{return a.length===b.length&&a.every((value,index)=>value===b[index]);}
