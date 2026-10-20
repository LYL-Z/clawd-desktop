import {mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
import {runPython} from './qa-support.mjs';

const exec=promisify(execFile),root=process.cwd(),out=path.join(root,'qa/runtime');
const sampleSeconds=Number(process.env.CLAWD_QA_SECONDS??20);
if(!Number.isInteger(sampleSeconds)||sampleSeconds<20||sampleSeconds>14400)throw new Error('Sample duration must be an integer from 20 to 14400 seconds');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const exe=process.env.CLAWD_QA_EXE?path.resolve(process.env.CLAWD_QA_EXE):path.join(root,`release/Clawd-${version}-windows-x64.exe`);
const userData=path.join(out,'user-data','portable-idle'),reportPath=path.join(userData,'runtime-report.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await mkdir(userData,{recursive:true});
await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,outfit:'none',roam:false,paused:false,reducedMotion:false,bridge:false}));
await rm(reportPath,{force:true});

const env={...process.env,CLAWD_TEST_USER_DATA:userData,CLAWD_AUTOTEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,[],{cwd:root,env,windowsHide:true,stdio:'ignore'});
let launcherExit;
child.once('exit',(code,signal)=>{launcherExit={code,signal};});
let browserPID,evidence;

async function readReportAfter(afterMtime,timeoutMs=5000){
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){
    try{
      const file=await stat(reportPath);
      if(file.mtimeMs>afterMtime){
        const state=JSON.parse(await readFile(reportPath,'utf8'));
        return {state,mtime:file.mtimeMs};
      }
    }catch{}
    await sleep(100);
  }
  throw new Error('Packaged runtime report did not advance within five seconds');
}

async function nativeSample(pid){
  const query=`$p=Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Where-Object Name -eq 'window-probe.exe'; @($p | ForEach-Object { $v=Get-Process -Id $_.ProcessId; [PSCustomObject]@{pid=$v.Id;cpuSeconds=$v.TotalProcessorTime.TotalSeconds;privateBytes=$v.PrivateMemorySize64} }) | ConvertTo-Json -Compress`;
  const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',query],{windowsHide:true});
  return stdout.trim()?JSON.parse(stdout):null;
}

async function closeWindow(pid){
  const code='import ctypes,sys; u=ctypes.windll.user32; cb=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p); pid=int(sys.argv[1]);\ndef close(h,l):\n p=ctypes.c_ulong(); u.GetWindowThreadProcessId(ctypes.c_void_p(h),ctypes.byref(p));\n if p.value==pid: u.PostMessageW(ctypes.c_void_p(h),0x0010,0,0)\n return True\nu.EnumWindows(cb(close),0)';
  await runPython('-c',[code,String(pid)]);
}

async function forceCloseTree(){
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}
}

const result={artifact:exe,sha256:createHash('sha256').update(await readFile(exe)).digest('hex'),startedAt:new Date().toISOString(),sampleSeconds,visibilityMode:'visible packaged idle'};
try{
  evidence=await beginEvidence(root,'portable-stability',['portable-stability.json']);
  let first;
  for(let i=0;i<100;i++){
    if(launcherExit)throw new Error(`Portable launcher exited during startup: ${JSON.stringify(launcherExit)}`);
    try{
      const state=JSON.parse(await readFile(reportPath,'utf8'));
      if(state.lastReport?.sourceAvailable&&state.nativeProbeAvailable){first=state;break;}
    }catch{}
    await sleep(300);
  }
  if(!first)throw new Error('Portable did not report loaded sprites and a healthy native probe within 30 seconds');
  if(path.resolve(first.startupExecutable)!==path.resolve(exe))throw new Error('Portable startup target does not match the selected candidate EXE');
  if(first.lastReport.loadedAtlases?.length!==5||first.lastReport.manifestActions?.length!==28)throw new Error('Portable did not load the expected five atlases and 28 action entries');
  browserPID=first.processMetrics.find(process=>process.type==='Browser')?.pid;
  if(!Number.isInteger(browserPID))throw new Error('Packaged browser process id is missing from runtime metrics');
  result.startup={sourceAvailable:first.lastReport.sourceAvailable,nativeProbeAvailable:first.nativeProbeAvailable,loadedAtlases:first.lastReport.loadedAtlases,manifestActions:first.lastReport.manifestActions.length,startupExecutable:first.startupExecutable,window:first.window,visibility:first.visibility};
  await sleep(3000);
  const helperFirst=await nativeSample(browserPID),samples=[];
  let previousMtime=-1;
  for(let i=0;i<=sampleSeconds;i++){
    const point=await readReportAfter(previousMtime);
    previousMtime=point.mtime;
    const state=point.state;
    if(!state.lastReport?.sourceAvailable||!state.nativeProbeAvailable)throw new Error(`Runtime health failed at sample ${i}`);
    samples.push({time:Date.now(),processes:state.processMetrics,visible:state.visibility?.visible===true});
    if(i<sampleSeconds)await sleep(1000);
  }
  const helperLast=await nativeSample(browserPID);
  const firstSample=samples[0],lastSample=samples.at(-1),seconds=(lastSample.time-firstSample.time)/1000;
  const cpuSeconds=sample=>sample.processes.reduce((sum,process)=>sum+process.cpu.cumulativeCPUUsage,0);
  const normalizedCPU=(cpuSeconds(lastSample)-cpuSeconds(firstSample))/seconds/os.cpus().length*100;
  const privateMiB=samples.map(sample=>sample.processes.reduce((sum,process)=>sum+process.memory.privateBytes,0)/1024);
  const helpers=value=>Array.isArray(value)?value:value?[value]:[];
  const sum=(values,key)=>helpers(values).reduce((total,value)=>total+value[key],0);
  const helperCPU=(sum(helperLast,'cpuSeconds')-sum(helperFirst,'cpuSeconds'))/seconds/os.cpus().length*100;
  const helperMiB=Math.max(sum(helperFirst,'privateBytes'),sum(helperLast,'privateBytes'))/1024**2;
  const third=Math.max(1,Math.floor(privateMiB.length/3));
  const mean=values=>values.reduce((total,value)=>total+value,0)/values.length;
  const finalState=JSON.parse(await readFile(reportPath,'utf8'));
  result.application={packaged:true,version,executable:exe};
  result.packagedBytes={executableBytes:(await stat(exe)).size};
  result.hardware={cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,ramGiB:os.totalmem()/1024**3,os:os.release()};
  result.seconds=seconds;
  result.cpu={averageWindowsNormalizedPercent:normalizedCPU+helperCPU,oneCorePercent:(normalizedCPU+helperCPU)*os.cpus().length};
  result.memory={averageTreePrivateMiB:mean(privateMiB)+helperMiB,peakTreePrivateMiB:Math.max(...privateMiB)+helperMiB,firstThirdAverageMiB:mean(privateMiB.slice(0,third))+helperMiB,lastThirdAverageMiB:mean(privateMiB.slice(-third))+helperMiB};
  result.scope=`Packaged Electron process tree with native helper sampled at start/end; ${sampleSeconds} seconds visible idle after warm-up; one Windows host; finite observation, not proof of long-term stability`;
  result.helperFirst=helperFirst;result.helperLast=helperLast;
  result.visibleSamples=samples.filter(sample=>sample.visible).length;
  result.finalSnapshot=finalState.lastReport;
  result.nativeProbeAvailable=finalState.nativeProbeAvailable;
  result.runtimeHealthy=finalState.lastReport?.sourceAvailable===true&&finalState.nativeProbeAvailable===true;
  result.normalExitVerifiedSeparately='scripts/qa-portable.mjs passed normal WM_CLOSE/launcher exit on the same candidate';
  result.startedAt=new Date(firstSample.time).toISOString();
  result.endedAt=new Date(lastSample.time).toISOString();
  result.launcherExit=null;
  result.evidence=evidence;
  await writeFile(path.join(out,'portable-stability.json'),JSON.stringify({...result,samples},null,2));
  if(!result.runtimeHealthy||result.visibleSamples!==samples.length)throw new Error('Packaged runtime health or visibility failed during the measured interval');
}catch(error){
  result.passed=false;result.failure=String(error);
}finally{
  if(browserPID)try{await closeWindow(browserPID);}catch{}
  for(let i=0;i<30&&launcherExit===undefined;i++)await sleep(100);
  if(launcherExit===undefined){result.cleanupMethod='closed isolated test process tree after WM_CLOSE left the tray resident';await forceCloseTree();}
  for(let i=0;i<100&&launcherExit===undefined;i++)await sleep(100);
  result.launcherExit=launcherExit??null;
  result.processTreeTerminated=launcherExit!==undefined;
  result.endedAt??=new Date().toISOString();
  result.passed=result.passed??(result.runtimeHealthy===true&&result.processTreeTerminated===true&&result.visibleSamples===sampleSeconds+1);
  if(evidence){result.evidence=evidence;await writeFile(path.join(out,'portable-stability.json'),JSON.stringify({...result,samples:undefined},null,2));await retainEvidence(root,evidence,result);}
  console.log(JSON.stringify({...result,samples:undefined},null,2));
}
if(!result.passed)process.exitCode=1;
