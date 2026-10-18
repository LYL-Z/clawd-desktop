import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
const require=createRequire('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'),{_electron}=require('playwright'),root=process.cwd(),out=path.join(root,'qa/runtime'),userData=path.join(out,'user-data','recovery');
await mkdir(userData,{recursive:true});await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,bridge:true}));
const env={...process.env,CLAWD_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:process.env.CLAWD_QA_EXE??path.join(root,'node_modules/electron/dist/electron.exe'),args:process.env.CLAWD_QA_EXE?[]:[root],cwd:root,env}),page=await app.firstWindow(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(process.env.CLAWD_QA_HIDE)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.hide()));
const report={startedAt:new Date().toISOString(),scope:'Real renderer and status watcher; host commands injected through trusted main process, no OS mouse input',checks:[]};
report.evidence=await beginEvidence(root,'state-recovery',['state-recovery-qa.json','recovery-reduced.png']);
if(process.env.CLAWD_QA_EXE)report.packagedBytes={executable:process.env.CLAWD_QA_EXE,asarSha256:createHash('sha256').update(await readFile(path.join(path.dirname(process.env.CLAWD_QA_EXE),'resources','app.asar'))).digest('hex')};
const snapshot=()=>page.evaluate(()=>window.clawdDebug.snapshot());
const command=(type,value)=>app.evaluate(({BrowserWindow},c)=>BrowserWindow.getAllWindows()[0].webContents.send('clawd:command',c),{type,value});
try{
  await page.waitForFunction(()=>window.clawdDebug);assert.equal((await snapshot()).manifestActions.length,28);report.checks.push('all 28 source descriptors loaded');
  await page.evaluate(()=>window.clawdDebug.action('sleep'));await sleep(900);assert.equal((await snapshot()).action,'sleep');await page.evaluate(()=>window.clawdDebug.action('wake'));await sleep(350);assert.equal((await snapshot()).action,'wake');report.checks.push('manual sleep persisted until explicit wake');
  await command('setting',{paused:true});const frozen=(await snapshot()).animationTime;await sleep(600);assert.equal((await snapshot()).animationTime,frozen);await command('setting',{paused:false});report.checks.push('user pause froze logical time');
  for(const name of ['welcome','agreement','sigil','ensemble']){await page.evaluate(n=>window.clawdDebug.performance(n),name);await sleep(120);await command('pause-system');await sleep(50);assert.equal((await snapshot()).performance,null);await command('resume-system');assert.equal((await snapshot()).action,'idle');}report.checks.push('all four performances cleared their timeline on host suspend command');
  await page.evaluate(()=>window.clawdDebug.outfit('cowboy'));
  for(const [name,duration] of [['welcome',3200],['agreement',4800],['sigil',4000],['ensemble',5500]]){
    await page.evaluate(n=>window.clawdDebug.performance(n),name);await sleep(duration+250);
    const ended=await snapshot();assert.equal(ended.performance,null);assert.equal(ended.action,'idle');assert.equal(ended.outfit,'cowboy');
  }
  report.checks.push('all four live performances ended naturally and restored the selected wardrobe');
  await page.evaluate(()=>window.clawdDebug.outfit('none'));
  for(const name of ['held','thrown']){await page.evaluate(n=>window.clawdDebug.action(n),name);await sleep(800);assert.equal((await snapshot()).action,'idle');}
  report.checks.push('menu-only held and thrown poses returned to idle without a physical drag');
  for(const state of ['working','done','failed']){const event={schemaVersion:1,eventId:'recovery-'+state,state,updatedAt:new Date().toISOString(),ttlMs:8000,detail:'本地恢复验证'};await writeFile(path.join(userData,'status.json'),JSON.stringify(event));await sleep(state==='working'?1300:2500);const snap=await snapshot();assert.equal(snap.taskState,state);assert.equal(snap.action,state==='working'?'running':'idle');if(state==='working'){await command('pause-system');await sleep(80);await command('resume-system');assert.equal((await snapshot()).action,'running');assert.equal((await snapshot()).airborne,false);report.checks.push('active working task resumed at safe ground after injected host suspend');}}report.checks.push('working, done and failed semantics with actual status file');
  await writeFile(path.join(userData,'status.json'),'{');await sleep(1200);assert.equal((await snapshot()).taskState,null);assert.equal((await snapshot()).action,'idle');report.checks.push('malformed file cleared actual task state');
  await command('setting',{reducedMotion:true});await page.evaluate(()=>window.clawdDebug.performance('sigil'));await sleep(200);assert.equal((await snapshot()).reducedMotion,true);await page.screenshot({path:path.join(out,'recovery-reduced.png'),omitBackground:true});report.checks.push('reduced-motion scene remained visible');report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;}finally{await app.close();report.endedAt=new Date().toISOString();await writeFile(path.join(out,'state-recovery-qa.json'),JSON.stringify(report,null,2));await retainEvidence(root,report.evidence,report);console.log(JSON.stringify(report,null,2));}
