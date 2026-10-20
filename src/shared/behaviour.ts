import type {AutonomyFrequency,DoubleClickAction} from './types';

const RANGE:Record<AutonomyFrequency,readonly[number,number]>={calm:[45_000,75_000],standard:[20_000,35_000],lively:[12_000,22_000]};
const QUIET_ACTIONS=new Set(['waving','sway','peek-left','peek-right','cowboy-tip']);

export function autonomyDelayMs(frequency:AutonomyFrequency,quietMode:boolean,random=Math.random()):number{
  const [minimum,maximum]=quietMode?[60_000,90_000]:RANGE[frequency];
  const normalized=Number.isFinite(random)?Math.max(0,Math.min(1,random)):0.5;
  return Math.round(minimum+(maximum-minimum)*normalized);
}

export function mayAutonomouslyRoam(roam:boolean,quietMode:boolean):boolean{return roam&&!quietMode;}

export function autonomousActions(actions:readonly string[],quietMode:boolean):string[]{
  return quietMode?actions.filter(action=>QUIET_ACTIONS.has(action)):[...actions];
}

export function doubleClickIntent(action:DoubleClickAction):{type:'performance'|'action';value:string}|null{
  if(action==='performance')return{type:'performance',value:'agreement'};
  if(action==='waving'||action==='sway')return{type:'action',value:action};
  return null;
}
