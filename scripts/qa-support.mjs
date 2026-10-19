import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

export function loadElectronDriver(){
  const require=createRequire(import.meta.url);
  const driver=require('playwright-core')._electron;
  if(!driver||typeof driver.launch!=='function')throw new Error('Playwright Electron support is unavailable. Run npm ci and try again.');
  return driver;
}

const execute=promisify(execFile);

/** Use the configured interpreter or the first standard Python launcher on PATH. */
export async function runPython(script,args=[],options={}){
  const candidates=[];
  if(process.env.CLAWD_PYTHON)candidates.push({command:process.env.CLAWD_PYTHON,args:[]});
  else if(process.platform==='win32')candidates.push({command:'py.exe',args:['-3']},{command:'python.exe',args:[]},{command:'python',args:[]});
  else candidates.push({command:'python3',args:[]},{command:'python',args:[]});
  let missing;
  for(const candidate of candidates){
    try{return await execute(candidate.command,[...candidate.args,script,...args],{windowsHide:true,...options});}
    catch(error){
      if(error?.code==='ENOENT'){missing=error;continue;}
      throw error;
    }
  }
  throw new Error('Python 3 is required for this Windows-only input QA. Add it to PATH or set CLAWD_PYTHON to its executable path.',{cause:missing});
}
