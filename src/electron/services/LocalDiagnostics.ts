import {appendFile,mkdir,readFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';

export type DiagnosticValue=string|number|boolean|null;
export type DiagnosticFields=Record<string,DiagnosticValue>;
const MAX_LOG_BYTES=256*1024;
const MAX_FIELD_COUNT=24;
const EVENT_PATTERN=/^[a-z][a-z0-9-]{0,39}$/;
const KEY_PATTERN=/^[a-z][a-zA-Z0-9]{0,31}$/;

function safeString(value:string):string{
  return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\\\\[^\\\s]+\\[^\s"']+/g,'[path]').replace(/\b[A-Za-z]:\\[^\s"']+/g,'[path]').replace(/\/(?:Users|home)\/[^\s"']+/g,'[path]').slice(0,120);
}

function normalizeFields(fields:DiagnosticFields):DiagnosticFields{
  const safe:DiagnosticFields={};
  for(const [key,value] of Object.entries(fields).slice(0,MAX_FIELD_COUNT)){
    if(!KEY_PATTERN.test(key))continue;
    if(typeof value==='string')safe[key]=safeString(value);
    else if(value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))safe[key]=value;
  }
  return safe;
}

/** Bounded local event log. Callers provide only privacy-reviewed, low-cardinality fields. */
export class LocalDiagnostics{
  private queue:Promise<void>=Promise.resolve();
  constructor(private readonly filePath:string){}

  record(event:string,fields:DiagnosticFields={}):Promise<void>{
    if(!EVENT_PATTERN.test(event))return Promise.resolve();
    const row=JSON.stringify({at:new Date().toISOString(),event,fields:normalizeFields(fields)});
    const task=this.queue.then(()=>this.appendBounded(`${row}\n`));
    this.queue=task.catch(()=>{});
    return task.catch(()=>{});
  }

  async recentEntries(maxEntries=200):Promise<unknown[]>{
    await this.queue;
    let raw='';try{raw=await readFile(this.filePath,'utf8');}catch{return[];}
    const entries:unknown[]=[];
    for(const line of raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(1,Math.min(500,maxEntries)))){
      try{entries.push(JSON.parse(line));}catch{}
    }
    return entries;
  }

  private async appendBounded(line:string):Promise<void>{
    await mkdir(path.dirname(this.filePath),{recursive:true});
    const bytes=Buffer.byteLength(line,'utf8');
    let current=0;try{current=(await stat(this.filePath)).size;}catch{}
    if(current+bytes>MAX_LOG_BYTES){
      for(let index=2;index>=1;index--){
        const source=index===1?this.filePath:`${this.filePath}.${index-1}`;
        const destination=`${this.filePath}.${index}`;
        if(index===2)await rm(destination,{force:true});
        try{await rename(source,destination);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      }
    }
    await appendFile(this.filePath,line,'utf8');
  }
}
