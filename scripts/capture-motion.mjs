import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';

const require=createRequire('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {_electron}=require('playwright'),root=process.cwd(),out=path.join(root,'qa/runtime');
const onlyAction=process.argv.find(arg=>arg.startsWith('--action='))?.slice(9);
const preview=process.argv.includes('--performances-only'),label=onlyAction?`motion-${onlyAction}`:preview?'performance-review':'motion';
if(onlyAction&&!/^[a-z-]+$/.test(onlyAction))throw new Error('Invalid action id');
const destination=path.join(out,label),userData=path.join(out,'user-data',label);
const manifest=JSON.parse(await readFile(path.join(root,'assets/runtime/animations.json'),'utf8'));
const report={startedAt:new Date().toISOString(),scope:'Deterministic time sampling of the actual Electron Canvas renderer; no OS input, no simulated artwork',fps:12,clips:[],errors:[]};
report.evidence=await beginEvidence(root,label,[label,`${label}.json`]);
// Only this task-owned, fixed capture directory is replaced; previous outputs are archived above.
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});await mkdir(userData,{recursive:true});
await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,scale:1,roam:false,bridge:false,reducedMotion:false,outfit:'none'}));
const env={...process.env,CLAWD_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root,'--studio','--force-device-scale-factor=1'],cwd:root,env});
  const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>window.clawdDebug);
  if(process.env.CLAWD_QA_HIDE)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.hide()));
  // Studio directions are disabled so idle sampling shows the original blink sequence.
  await page.uncheck('#directions');
  async function capture(id,label,kind,duration,outfit='none',actionId=id){
    const directory=path.join(destination,id);await mkdir(directory,{recursive:true});
    await page.evaluate(({actionId,kind,outfit})=>{window.clawdDebug.outfit(outfit);if(kind==='performance')window.clawdDebug.performance(actionId);else window.clawdDebug.action(actionId);},{actionId,kind,outfit});
    const initial=await page.evaluate(()=>window.clawdDebug.snapshot());
    if(kind!=='performance')assert.equal(initial.sourceAvailable,true,`Unavailable action: ${id}`);
    const count=Math.max(2,Math.ceil(duration/1000*report.fps));
    for(let i=0;i<count;i++){
      const time=Math.min(duration-1,i*1000/report.fps);
      const png=await page.evaluate(ms=>{window.clawdDebug.time(ms);return document.querySelector('#stage').toDataURL('image/png').split(',')[1];},time);
      await writeFile(path.join(directory,`${String(i).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
    }
    report.clips.push({id,label,kind,outfit,durationMs:count/report.fps*1000,sampledThroughMs:Math.min(duration-1,(count-1)*1000/report.fps),frameCount:count,width:640,height:420,directory:path.relative(root,directory).replaceAll('\\','/')});
  }
  if(!preview){
    for(const [id,def] of Object.entries(manifest.animations).filter(([id])=>!onlyAction||id===onlyAction)){
      await capture(id,def.label??id,'action',def.durations.reduce((a,b)=>a+b,0));
    }
    for(const id of onlyAction?[]:['none','headphones','skateboard','wizard','hardhat','detective','chef','cowboy']){
      const action=({none:'idle',headphones:'headphone-groove',skateboard:'skate',wizard:'wizard-cast',hardhat:'hardhat-work',detective:'detective-inspect',chef:'chef-prepare',cowboy:'cowboy-tip'})[id];
      const def=manifest.outfits?.[id]?.animations?.[action]??manifest.animations[action];
      await capture(`wardrobe-${id}`,id,'action',def.durations.reduce((a,b)=>a+b,0),id,action);
    }
  }
  if(!onlyAction)for(const [id,title,duration] of [['welcome','欢迎屏裂开一条缝',3200],['agreement','You’re Absolutely Right!',4800],['sigil','陶土星印',4000],['ensemble','小蟹合奏',5500]])await capture(id,title,'performance',duration);
  if(!onlyAction&&!preview&&manifest.look){
    const id='look-directions',directory=path.join(destination,id);await mkdir(directory,{recursive:true});
    await page.evaluate(()=>{window.clawdDebug.outfit('none');window.clawdDebug.action('idle');});await page.check('#directions');
    for(let i=0;i<32;i++){
      const png=await page.evaluate(({direction,time})=>{const input=document.querySelector('#direction');input.value=String(direction);input.dispatchEvent(new Event('input'));window.clawdDebug.time(time);return document.querySelector('#stage').toDataURL('image/png').split(',')[1];},{direction:Math.floor(i/2),time:i*1000/report.fps});
      await writeFile(path.join(directory,`${String(i).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
    }
    report.clips.push({id,label:'十六向注视',kind:'look',outfit:'none',durationMs:32/report.fps*1000,frameCount:32,width:640,height:420,directory:path.relative(root,directory).replaceAll('\\','/')});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;}
finally{if(app)await app.close();report.endedAt=new Date().toISOString();await writeFile(path.join(out,`${label}.json`),JSON.stringify(report,null,2));await retainEvidence(root,report.evidence,report);console.log(JSON.stringify({passed:report.passed,clips:report.clips.length,failure:report.failure,evidence:report.evidence}));}
