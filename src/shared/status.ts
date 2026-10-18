import type {TaskEvent} from './types';
const states=new Set(['idle','thinking','working','waiting','done','failed']);
export function parseStatus(text:string,now=Date.now()):TaskEvent|null {
  if(BufferByteLength(text)>4096)return null;
  try{const v:unknown=JSON.parse(text.replace(/^\uFEFF/,''));if(!v||typeof v!=='object')return null;
    const s=v as Record<string,unknown>;
    if(s.schemaVersion!==1||typeof s.eventId!=='string'||!s.eventId||s.eventId.length>80||typeof s.state!=='string'||!states.has(s.state)||typeof s.updatedAt!=='string'||typeof s.ttlMs!=='number'||!Number.isFinite(s.ttlMs)||s.ttlMs<1000||s.ttlMs>300000)return null;
    const date=Date.parse(s.updatedAt);if(!Number.isFinite(date)||date>now+5000||now-date>s.ttlMs)return null;
    return{schemaVersion:1,eventId:s.eventId,state:s.state as TaskEvent['state'],updatedAt:s.updatedAt,ttlMs:s.ttlMs,detail:typeof s.detail==='string'?Array.from(s.detail.replace(/[\u0000-\u001f]/g,' ')).slice(0,24).join(''):''};
  }catch{return null;}
}
function BufferByteLength(s:string):number{return new TextEncoder().encode(s).length;}
