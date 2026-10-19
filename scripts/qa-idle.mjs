import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
import {loadElectronDriver} from './qa-support.mjs';
const exec=promisify(execFile);
const _electron=loadElectronDriver(),root=process.cwd(),out=path.join(root,'qa/runtime'),userData=path.join(out,'user-data','idle-benchmark');
const sampleSeconds=Number(process.env.CLAWD_QA_SECONDS??20),label=sampleSeconds>20?'stability-qa':'idle-benchmark';
if(!Number.isInteger(sampleSeconds)||sampleSeconds<20||sampleSeconds>600)throw new Error('Sample duration must be an integer from 20 to 600 seconds');
await mkdir(userData,{recursive:true});await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,outfit:'none',roam:false,paused:false,reducedMotion:false}));
const env={...process.env,CLAWD_TEST_USER_DATA:userData,CLAWD_AUTOTEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:process.env.CLAWD_QA_EXE??path.join(root,'node_modules/electron/dist/electron.exe'),args:process.env.CLAWD_QA_EXE?[]:[root],cwd:root,env});
const page=await app.firstWindow(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
const evidence=await beginEvidence(root,label,[`${label}.json`]);
try{
  await page.waitForFunction(()=>window.clawdDebug);await sleep(3000);
  const mainPID=await app.evaluate(()=>process.pid);
  const nativeSample=async()=>{const query=`$p=Get-CimInstance Win32_Process -Filter 'ParentProcessId=${mainPID}' | Where-Object Name -eq 'window-probe.exe'; @($p | ForEach-Object { $v=Get-Process -Id $_.ProcessId; [PSCustomObject]@{pid=$v.Id;cpuSeconds=$v.TotalProcessorTime.TotalSeconds;privateBytes=$v.PrivateMemorySize64} }) | ConvertTo-Json -Compress`;const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',query],{windowsHide:true});return stdout.trim()?JSON.parse(stdout):null;};
  const helperFirst=await nativeSample();
  const samples=[];for(let i=0;i<=sampleSeconds;i++){samples.push(await app.evaluate(({app})=>({time:Date.now(),processes:app.getAppMetrics()})));if(i<sampleSeconds)await sleep(1000);}
  const helperLast=await nativeSample();
  const first=samples[0],last=samples.at(-1),seconds=(last.time-first.time)/1000;
  const cpuSeconds=sample=>sample.processes.reduce((sum,p)=>sum+p.cpu.cumulativeCPUUsage,0);
  const normalizedCPU=(cpuSeconds(last)-cpuSeconds(first))/seconds/os.cpus().length*100;
  const privateMiB=samples.map(s=>s.processes.reduce((sum,p)=>sum+p.memory.privateBytes,0)/1024);
  const helpers=value=>Array.isArray(value)?value:value?[value]:[],sum=(values,key)=>helpers(values).reduce((n,v)=>n+v[key],0),helperCPU=(sum(helperLast,'cpuSeconds')-sum(helperFirst,'cpuSeconds'))/seconds/os.cpus().length*100,helperMiB=Math.max(sum(helperFirst,'privateBytes'),sum(helperLast,'privateBytes'))/1024**2;
  const third=Math.max(1,Math.floor(privateMiB.length/3)),mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const result={evidence,application:await app.evaluate(({app})=>({packaged:app.isPackaged,appPath:app.getAppPath(),version:app.getVersion()})),startedAt:new Date(first.time).toISOString(),seconds,hardware:{cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,ramGiB:os.totalmem()/1024**3,os:os.release()},cpu:{averageWindowsNormalizedPercent:normalizedCPU+helperCPU,oneCorePercent:(normalizedCPU+helperCPU)*os.cpus().length},memory:{averageTreePrivateMiB:mean(privateMiB)+helperMiB,peakTreePrivateMiB:Math.max(...privateMiB)+helperMiB,firstThirdAverageMiB:mean(privateMiB.slice(0,third))+helperMiB,lastThirdAverageMiB:mean(privateMiB.slice(-third))+helperMiB},scope:`Electron process tree with native helper (helper memory sampled at start/end), ${sampleSeconds} seconds idle after warm-up; finite observation, not proof of long-term stability`,helperFirst,helperLast,samples};
  if(process.env.CLAWD_QA_EXE)result.packagedBytes={executable:process.env.CLAWD_QA_EXE,asarSha256:createHash('sha256').update(await readFile(path.join(path.dirname(process.env.CLAWD_QA_EXE),'resources','app.asar'))).digest('hex')};
  result.finalSnapshot=await page.evaluate(()=>window.clawdDebug.snapshot());result.pageErrors=pageErrors;result.runtimeHealthy=pageErrors.length===0&&result.finalSnapshot.sourceAvailable===true;
  await writeFile(path.join(out,`${label}.json`),JSON.stringify(result,null,2));await retainEvidence(root,evidence,result);console.log(JSON.stringify({...result,samples:undefined},null,2));
  if(!result.runtimeHealthy)throw new Error('Runtime health failed during the measured interval');
}finally{await app.close();}
