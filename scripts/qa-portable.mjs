import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
import {runPython} from './qa-support.mjs';
const root=process.cwd(),out=path.join(root,'qa/runtime'),userData=path.join(out,'user-data','portable');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const exe=process.env.CLAWD_QA_EXE?path.resolve(process.env.CLAWD_QA_EXE):path.join(root,`release/Clawd-${version}-windows-x64.exe`),sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(userData,{recursive:true});await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true}));
await rm(path.join(userData,'runtime-report.json'),{force:true});
const env={...process.env,CLAWD_TEST_USER_DATA:userData,CLAWD_AUTOTEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,['--studio'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
let launcherExit;
child.once('exit',(code,signal)=>{launcherExit={code,signal};});
let qaBrowserPID;
async function closeQaBrowser(pid){
  const code='import ctypes,sys; u=ctypes.windll.user32; cb=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p); pid=int(sys.argv[1]);\ndef close(h,l):\n p=ctypes.c_ulong(); u.GetWindowThreadProcessId(ctypes.c_void_p(h),ctypes.byref(p));\n if p.value==pid: u.PostMessageW(ctypes.c_void_p(h),0x0010,0,0)\n return True\nu.EnumWindows(cb(close),0)';
  await runPython('-c',[code,String(pid)]);
}
const report={artifact:exe,sha256:createHash('sha256').update(await readFile(exe)).digest('hex'),startedAt:new Date().toISOString()};
report.evidence=await beginEvidence(root,'portable',['portable-qa.json']);
try{
  let state;for(let i=0;i<100;i++){try{state=JSON.parse(await readFile(path.join(userData,'runtime-report.json'),'utf8'));if(state.lastReport?.sourceAvailable)break;}catch{}await sleep(300);}
  if(!state?.lastReport?.sourceAvailable)throw new Error('Portable did not report an actual loaded sprite within 30 seconds');
  qaBrowserPID=state.processMetrics.find(p=>p.type==='Browser').pid;
  report.snapshot=state.lastReport;report.nativeProbeAvailable=state.nativeProbeAvailable;report.startupExecutable=state.startupExecutable;
  if(!state.lastReport.loadedAtlases.includes('core.webp')||!state.lastReport.loadedAtlases.includes('curious.webp')||!state.lastReport.loadedAtlases.includes('turn.webp'))throw new Error('Portable did not load the final V2, curious and turn atlases');
  if(path.resolve(state.startupExecutable)!==path.resolve(exe))throw new Error('Portable startup target points to a temporary extraction instead of the stable EXE');
  const pid=qaBrowserPID;
  await closeQaBrowser(pid);
  const alive=()=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
  for(let i=0;i<100&&(alive()||launcherExit===undefined);i++)await sleep(100);
  report.browserProcessExited=!alive();report.launcherExit=launcherExit;
  if(!report.browserProcessExited||launcherExit?.code!==0)throw new Error('Normal close was not confirmed for both application and portable launcher');
  report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;}
finally{if(report.failure){if(qaBrowserPID)try{await closeQaBrowser(qaBrowserPID);}catch{}child.kill();}report.endedAt=new Date().toISOString();await writeFile(path.join(out,'portable-qa.json'),JSON.stringify(report,null,2));await retainEvidence(root,report.evidence,report);console.log(JSON.stringify(report,null,2));}
