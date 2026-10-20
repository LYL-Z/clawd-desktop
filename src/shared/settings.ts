import {win32,posix} from 'node:path';
import {DEFAULTS,OUTFITS,type AppRule,type Settings} from './types';

const SCALE_VALUES=[.75,1,1.25,1.5] as const;
const MAX_RULES=48;
const MAX_RULE_PAYLOAD_BYTES=96*1024;

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

export function canonicalExecutablePath(value:string):string{
  const trimmed=value.trim();
  if(!trimmed||trimmed.length>32760||/[\0\r\n|]/.test(trimmed))return '';
  if(win32.isAbsolute(trimmed))return win32.normalize(trimmed).replaceAll('/','\\').toLocaleLowerCase('en-US');
  if(posix.isAbsolute(trimmed))return posix.normalize(trimmed).toLocaleLowerCase('en-US');
  return '';
}

function normalizeRule(value:unknown):AppRule|null{
  const rule=record(value);if(!rule)return null;
  const id=typeof rule.id==='string'?rule.id.trim():'';
  const exePath=typeof rule.exePath==='string'?rule.exePath.trim():'';
  const canonical=canonicalExecutablePath(exePath);
  const exeName=typeof rule.exeName==='string'?rule.exeName.trim():'';
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||!canonical||!exeName||exeName.length>260||/[\0\r\n|/\\]/.test(exeName))return null;
  if(rule.kind!=='game'&&rule.kind!=='exception'&&rule.kind!=='focus')return null;
  if(rule.match!=='path'&&rule.match!=='name')return null;
  if(typeof rule.enabled!=='boolean')return null;
  return{id,kind:rule.kind,match:rule.match,exeName,exePath:canonical,enabled:rule.enabled};
}

/**
 * Versionless and schema-v1 settings are migrated to schema v2. Unknown and
 * malformed fields are ignored; valid existing user choices keep their values.
 */
export function normalizeSettings(input:unknown):Settings{
  const value=record(input)??{};
  const result:Settings={...DEFAULTS};
  for(const key of ['roam','reducedMotion','paused','quietMode','bridge','welcomeSeen','startVisible','hideFullscreen'] as const){
    if(typeof value[key]==='boolean')result[key]=value[key];
  }
  if(value.autonomyFrequency==='calm'||value.autonomyFrequency==='standard'||value.autonomyFrequency==='lively')result.autonomyFrequency=value.autonomyFrequency;
  if(value.doubleClickAction==='performance'||value.doubleClickAction==='waving'||value.doubleClickAction==='sway'||value.doubleClickAction==='none')result.doubleClickAction=value.doubleClickAction;
  if(OUTFITS.some(outfit=>outfit.id===value.outfit))result.outfit=value.outfit as Settings['outfit'];
  if(typeof value.scale==='number'&&SCALE_VALUES.includes(value.scale as typeof SCALE_VALUES[number]))result.scale=value.scale;
  if(value.position){
    const position=record(value.position);
    if(position&&typeof position.x==='number'&&typeof position.y==='number'&&Number.isFinite(position.x)&&Number.isFinite(position.y)&&Math.abs(position.x)<50000&&Math.abs(position.y)<50000){
      result.position={x:position.x,y:position.y};
    }
  }
  if(value.autoHideMode==='smart'||value.autoHideMode==='game-running'||value.autoHideMode==='manual')result.autoHideMode=value.autoHideMode;
  if(typeof value.restoreDelayMs==='number'&&Number.isFinite(value.restoreDelayMs))result.restoreDelayMs=Math.round(Math.min(5000,Math.max(500,value.restoreDelayMs))/100)*100;
  if(Array.isArray(value.appRules)){
    const seen=new Set<string>();
    let payloadBytes=0;
    result.appRules=value.appRules.slice(0,MAX_RULES).flatMap(item=>{
      const rule=normalizeRule(item);if(!rule||seen.has(rule.id))return[];
      const line=`${rule.id}|${rule.match}|${rule.exeName}|${rule.exePath}`;
      const bytes=new TextEncoder().encode(line).byteLength+1;
      if(payloadBytes+bytes>MAX_RULE_PAYLOAD_BYTES)return[];
      seen.add(rule.id);payloadBytes+=bytes;return[rule];
    });
  }
  return result;
}

export function mergeSettings(current:Settings,patch:unknown):Settings{
  const incoming=record(patch);if(!incoming)return current;
  const candidate:Settings={...current};
  for(const key of ['roam','reducedMotion','paused','quietMode','bridge','welcomeSeen','startVisible','hideFullscreen'] as const){
    if(typeof incoming[key]==='boolean')candidate[key]=incoming[key];
  }
  if(incoming.autonomyFrequency==='calm'||incoming.autonomyFrequency==='standard'||incoming.autonomyFrequency==='lively')candidate.autonomyFrequency=incoming.autonomyFrequency;
  if(incoming.doubleClickAction==='performance'||incoming.doubleClickAction==='waving'||incoming.doubleClickAction==='sway'||incoming.doubleClickAction==='none')candidate.doubleClickAction=incoming.doubleClickAction;
  if(OUTFITS.some(outfit=>outfit.id===incoming.outfit))candidate.outfit=incoming.outfit as Settings['outfit'];
  if(typeof incoming.scale==='number'&&SCALE_VALUES.includes(incoming.scale as typeof SCALE_VALUES[number]))candidate.scale=incoming.scale;
  if(incoming.position!==undefined){
    const parsed=normalizeSettings({position:incoming.position});
    if(parsed.position)candidate.position=parsed.position;
  }
  if(incoming.autoHideMode==='smart'||incoming.autoHideMode==='game-running'||incoming.autoHideMode==='manual')candidate.autoHideMode=incoming.autoHideMode;
  if(typeof incoming.restoreDelayMs==='number'&&Number.isFinite(incoming.restoreDelayMs))candidate.restoreDelayMs=Math.round(Math.min(5000,Math.max(500,incoming.restoreDelayMs))/100)*100;
  if(Array.isArray(incoming.appRules))candidate.appRules=normalizeSettings({appRules:incoming.appRules}).appRules;
  return candidate;
}

export function sameRulePath(a:string,b:string):boolean{
  const left=canonicalExecutablePath(a),right=canonicalExecutablePath(b);
  return left!==''&&left===right;
}
