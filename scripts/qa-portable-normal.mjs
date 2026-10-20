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
const intervalSeconds=Number(process.env.CLAWD_QA_SAMPLE_SECONDS??10);
if(!Number.isInteger(sampleSeconds)||sampleSeconds<20||sampleSeconds>14400)throw new Error('Sample duration must be an integer from 20 to 14400 seconds');
if(!Number.isInteger(intervalSeconds)||intervalSeconds<1||intervalSeconds>300)throw new Error('Sample interval must be an integer from 1 to 300 seconds');

const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const exe=process.env.CLAWD_QA_EXE?path.resolve(process.env.CLAWD_QA_EXE):path.join(root,`release/Clawd-${version}-windows-x64.exe`);
const runDirectory=new Date().toISOString().replace(/[:.]/g,'-');
const userData=path.join(out,'user-data',`portable-normal-${runDirectory}`),progressPath=path.join(out,'portable-normal-progress.json');
await mkdir(userData,{recursive:true});
await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,outfit:'none',roam:true,paused:false,reducedMotion:false,quietMode:false,bridge:false}));

const env={...process.env,CLAWD_TEST_USER_DATA:userData};
delete env.CLAWD_AUTOTEST;
delete env.CLAWD_QA_SECONDS;
delete env.CLAWD_QA_SAMPLE_SECONDS;
delete env.CLAWD_QA_EXE;
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,[],{cwd:root,env,windowsHide:true,stdio:'ignore'});
let launcherExit,appPid,evidence;
child.once('exit',(code,signal)=>{launcherExit={code,signal};});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sampleTree(){
  const ps=`$ErrorActionPreference='Stop'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ClawdQaWindow { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); public static bool HasVisibleWindow(int targetPid) { bool found=false; EnumWindows((hWnd,lParam)=>{ uint pid; GetWindowThreadProcessId(hWnd,out pid); if(pid==targetPid && IsWindowVisible(hWnd)) found=true; return true; },IntPtr.Zero); return found; } }'; $root=${Number(child.pid)}; $all=@(Get-CimInstance Win32_Process); $ids=[System.Collections.Generic.List[int]]::new(); $ids.Add($root); do { $added=$false; foreach($item in $all) { $id=[int]$item.ProcessId; if($ids.Contains([int]$item.ParentProcessId) -and -not $ids.Contains($id)) { $ids.Add($id); $added=$true } } } while($added); $rows=@(); foreach($id in $ids) { $item=$all|Where-Object { [int]$_.ProcessId -eq $id }|Select-Object -First 1; if(-not $item) { continue }; try { $p=Get-Process -Id $id -ErrorAction Stop; $handle=[int64]$p.MainWindowHandle; $rows+=@([PSCustomObject]@{pid=$id;name=$p.ProcessName;cpuSeconds=$p.CPU;privateBytes=$p.PrivateMemorySize64;responding=if($handle -gt 0){[bool]$p.Responding}else{$true};windowHandle=$handle;visible=if($handle -gt 0){[ClawdQaWindow]::IsWindowVisible([IntPtr]$handle)}else{$false};isMain=($item.Name -eq 'Clawd.exe' -and $item.CommandLine -notmatch '--type=');isProbe=($item.Name -eq 'window-probe.exe')}) } catch {} }; $main=$rows|Where-Object isMain|Select-Object -First 1; $sumCpu=($rows|Measure-Object -Property cpuSeconds -Sum).Sum; $sumMemory=($rows|Measure-Object -Property privateBytes -Sum).Sum; $windowVisible=if($main){[ClawdQaWindow]::HasVisibleWindow([int]$main.pid)}else{$false}; [PSCustomObject]@{at=[DateTimeOffset]::UtcNow.ToString('o');processCount=$rows.Count;cpuSeconds=[double]$sumCpu;privateBytes=[double]$sumMemory;mainFound=($null -ne $main);mainPid=if($main){[int]$main.pid}else{0};mainResponding=if($main){[bool]$main.responding}else{$false};mainWindowVisible=[bool]$windowVisible;nativeProbeAlive=[bool]($rows|Where-Object isProbe|Select-Object -First 1)}|ConvertTo-Json -Compress`;
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,maxBuffer:1024*1024});
  return JSON.parse(stdout.trim());
}

async function closeWindow(pid){
  const code='import ctypes,sys; u=ctypes.windll.user32; cb=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p); pid=int(sys.argv[1]);\ndef close(h,l):\n p=ctypes.c_ulong(); u.GetWindowThreadProcessId(ctypes.c_void_p(h),ctypes.byref(p));\n if p.value==pid: u.PostMessageW(ctypes.c_void_p(h),0x0010,0,0)\n return True\nu.EnumWindows(cb(close),0)';
  await runPython('-c',[code,String(pid)]);
}

async function forceCloseTree(){
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}
}

const result={artifact:exe,sha256:createHash('sha256').update(await readFile(exe)).digest('hex'),version,mode:'normal packaged run; CLAWD_AUTOTEST is unset',instrumented:false,sampleSeconds,intervalSeconds,logicalProcessors:os.cpus().length,startedAt:new Date().toISOString()};
const samples=[];
try{
  evidence=await beginEvidence(root,'portable-normal-stability');
  let initial;
  const readyUntil=Date.now()+30000;
  while(Date.now()<readyUntil){
    if(launcherExit)throw new Error(`Portable launcher exited during startup: ${JSON.stringify(launcherExit)}`);
    try{const point=await sampleTree();if(point.mainFound&&point.mainResponding&&point.nativeProbeAlive){initial=point;break;}}catch{}
    await sleep(500);
  }
  if(!initial)throw new Error('Normal-mode package did not expose a responsive desktop process tree and native probe within 30 seconds');
  appPid=initial.mainPid;
  result.startup={processCount:initial.processCount,mainResponding:initial.mainResponding,windowsApiVisible:initial.mainWindowVisible,nativeProbeAlive:initial.nativeProbeAlive};
  const started=Date.now();
  let consecutiveUnresponsive=0;
  async function takeSample(){
    const point=await sampleTree();
    if(!point.mainFound)throw new Error('Packaged browser process disappeared during the sample');
    if(!point.mainResponding)consecutiveUnresponsive++;else consecutiveUnresponsive=0;
    if(consecutiveUnresponsive>=3)throw new Error('Packaged browser window did not respond in three consecutive external samples');
    if(!point.nativeProbeAlive)throw new Error('Native window probe was absent from the packaged process tree');
    const elapsedMs=Date.now()-started;
    const sample={elapsedMs,cpuSeconds:point.cpuSeconds,privateBytes:point.privateBytes,mainResponding:point.mainResponding,mainWindowVisible:point.mainWindowVisible,nativeProbeAlive:point.nativeProbeAlive,processCount:point.processCount};
    samples.push(sample);
    await writeFile(progressPath,JSON.stringify({startedAt:result.startedAt,sampleSeconds,intervalSeconds,elapsedSeconds:Math.round(elapsedMs/1000),sampleCount:samples.length,last:sample},null,2));
    if(samples.length===1||elapsedMs%60000<intervalSeconds*1000)console.log(JSON.stringify({phase:'normal-mode-sample',elapsedSeconds:Math.round(elapsedMs/1000),sampleCount:samples.length,visible:sample.mainWindowVisible,probe:sample.nativeProbeAlive}));
  }
  await takeSample();
  let nextDue=started+intervalSeconds*1000;
  while(samples.at(-1).elapsedMs<sampleSeconds*1000){
    const due=Math.min(nextDue,started+sampleSeconds*1000);
    await sleep(Math.max(0,due-Date.now()));
    await takeSample();
    nextDue+=intervalSeconds*1000;
  }
  const finalHash=createHash('sha256').update(await readFile(exe)).digest('hex');
  if(finalHash!==result.sha256)throw new Error('Candidate EXE changed while the packaged run was active');
  const calculate=points=>{
    if(points.length<2)return null;
    const first=points[0],last=points.at(-1),elapsed=(last.elapsedMs-first.elapsedMs)/1000;
    const memory=points.map(point=>point.privateBytes/1024**2);
    const cpu=((last.cpuSeconds-first.cpuSeconds)/elapsed/os.cpus().length)*100;
    return{seconds:elapsed,averageWindowsNormalizedCpuPercent:cpu,averageTreePrivateMiB:memory.reduce((sum,value)=>sum+value,0)/memory.length,peakTreePrivateMiB:Math.max(...memory),windowsApiVisibleSamples:points.filter(point=>point.mainWindowVisible).length,respondingSamples:points.filter(point=>point.mainResponding).length,probeSamples:points.filter(point=>point.nativeProbeAlive).length,samples:points.length};
  };
  const baseline=samples.filter(point=>point.elapsedMs<=300000),logPath=path.join(userData,'logs','clawd.jsonl');
  let events=[];
  try{events=(await readFile(logPath,'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch{}
  const unexpectedEvents=events.filter(event=>['renderer-gone','renderer-error','startup-failed'].includes(event.event)||(event.event==='probe-health'&&event.fields?.healthy===false));
  result.baselineFiveMinutes=samples.at(-1).elapsedMs>=300000?calculate(baseline):null;
  result.fullRun=calculate(samples);
  const visibilityEvents=events.filter(event=>event.event==='visibility');
  result.visibilityLog=visibilityEvents.map(event=>({at:event.at,visible:event.fields?.visible===true,scene:event.fields?.scene,reasons:event.fields?.reasons}));
  result.unexpectedDiagnostics=unexpectedEvents.map(event=>({event:event.event,at:event.at}));
  result.eventCounts=events.reduce((counts,event)=>(counts[event.event]=(counts[event.event]??0)+1,counts),{});
  result.passed=samples.at(-1).elapsedMs>=sampleSeconds*1000&&result.fullRun?.respondingSamples===samples.length&&result.fullRun?.probeSamples===samples.length&&unexpectedEvents.length===0;
  result.scope='Single Windows x64 host; exact packaged EXE; natural Windows idle state; external process and window sampling; no injected renderer telemetry; finite observation only';
  result.evidence=evidence;
}catch(error){
  result.passed=false;
  result.failure=String(error);
}finally{
  if(appPid)try{await closeWindow(appPid);}catch{}
  for(let i=0;i<40&&launcherExit===undefined;i++)await sleep(100);
  if(launcherExit===undefined){result.cleanupMethod='closed isolated test process tree after WM_CLOSE left the tray resident';await forceCloseTree();}
  for(let i=0;i<100&&launcherExit===undefined;i++)await sleep(100);
  result.launcherExit=launcherExit??null;
  result.processTreeTerminated=launcherExit!==undefined;
  result.endedAt=new Date().toISOString();
  result.evidence=evidence??null;
  await writeFile(path.join(out,'portable-normal-stability.json'),JSON.stringify({...result,samples},null,2));
  if(evidence)await retainEvidence(root,evidence,result);
  console.log(JSON.stringify(result,null,2));
}
if(!result.passed)process.exitCode=1;
