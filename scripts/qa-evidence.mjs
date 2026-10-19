import {cp,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export async function beginEvidence(root,label,previousPaths=[]){
  const runId=`${label}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const directory=path.join(root,'qa/runtime/history',runId);
  await mkdir(directory,{recursive:true});
  for(const relative of previousPaths){
    const source=path.join(root,'qa/runtime',relative);
    try{await cp(source,path.join(directory,'previous',relative),{recursive:true});}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const files=[];
  async function visit(relative){
    const absolute=path.join(root,relative),entry=await stat(absolute);
    if(entry.isDirectory()){
      for(const child of await readdir(absolute))await visit(path.join(relative,child));
    }else{
      const data=await readFile(absolute);
      files.push({path:relative.replaceAll('\\','/'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
    }
  }
  for(const relative of ['src','scripts','assets/runtime','app/main.cjs','app/preload.cjs','app/ui.js','app/window-probe.exe','package.json','package-lock.json'])await visit(relative);
  const evidence={runId,recordedAt:new Date().toISOString(),files};
  await writeFile(path.join(directory,'inputs.json'),JSON.stringify(evidence,null,2));
  return{runId,inputManifest:path.relative(root,path.join(directory,'inputs.json')).replaceAll('\\','/')};
}

export async function retainEvidence(root,evidence,report){
  await writeFile(path.join(root,'qa/runtime/history',evidence.runId,'result.json'),JSON.stringify(report,null,2));
}
