import {copyFile,open,readFile,rename,rm,stat,mkdir} from 'node:fs/promises';
import {mkdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DEFAULTS,type Settings} from '../../shared/types';
import {mergeSettings,normalizeSettings} from '../../shared/settings';

const MAX_SETTINGS_BYTES=256*1024;

export class SettingsStore{
  private value:Settings={...DEFAULTS};
  private queue:Promise<void>=Promise.resolve();

  constructor(private readonly filePath:string,private readonly diagnose:(message:string)=>void=()=>{}){}

  get current():Settings{return structuredClone(this.value);}

  async load():Promise<Settings>{
    try{
      const info=await stat(this.filePath);
      if(info.size>MAX_SETTINGS_BYTES){this.diagnose('Settings file is oversized; safe defaults are active.');return this.current;}
      const raw=JSON.parse(await readFile(this.filePath,'utf8'));
      this.value=normalizeSettings(raw);
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT'){
        if(error instanceof SyntaxError){
          const backup=`${this.filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g,'-')}`;
          try{await copyFile(this.filePath,backup);this.diagnose('Invalid settings JSON was preserved in a local recovery copy; safe defaults are active.');}
          catch{this.diagnose('Invalid settings JSON could not be backed up; safe defaults are active.');}
        }else this.diagnose('Settings could not be read; safe defaults are active.');
      }
      this.value={...DEFAULTS};
    }
    return this.current;
  }

  update(patch:unknown):Promise<Settings>{
    let result:Settings|undefined;
    const task=this.queue.then(async()=>{
      const candidate=mergeSettings(this.value,patch);
      await this.atomicWrite(JSON.stringify(candidate,null,2));
      this.value=candidate;result=this.current;
    });
    this.queue=task.catch(()=>{});
    return task.then(()=>result!);
  }

  async flush():Promise<void>{await this.queue;}

  saveSync():void{
    const directory=path.dirname(this.filePath),temporary=`${this.filePath}.closing-${process.pid}`;
    try{
      mkdirSync(directory,{recursive:true});
      writeFileSync(temporary,JSON.stringify(this.value,null,2),{encoding:'utf8',flag:'w'});
      renameSync(temporary,this.filePath);
    }catch(error){
      try{rmSync(temporary,{force:true});}catch{}
      this.diagnose(error instanceof Error?'Settings could not be synchronously flushed during shutdown.':'Settings shutdown flush failed.');
    }
  }

  private async atomicWrite(contents:string):Promise<void>{
    const directory=path.dirname(this.filePath),temporary=`${this.filePath}.tmp-${process.pid}`;
    await mkdir(directory,{recursive:true});
    let handle;
    try{
      handle=await open(temporary,'w');
      await handle.writeFile(contents,'utf8');
      await handle.sync();
      await handle.close();handle=undefined;
      await rename(temporary,this.filePath);
    }catch(error){
      try{await handle?.close();}catch{}
      try{await rm(temporary,{force:true});}catch{}
      throw error;
    }
  }
}
