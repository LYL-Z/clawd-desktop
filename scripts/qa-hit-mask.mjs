import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
import {loadElectronDriver} from './qa-support.mjs';
const _electron=loadElectronDriver(),root=process.cwd(),out=path.join(root,'qa/runtime');
const manifest=JSON.parse(await readFile(path.join(root,'assets/runtime/animations.json'),'utf8'));
const report={startedAt:new Date().toISOString(),scope:'Independent visible-canvas alpha compared with actual hit result via trusted cursor IPC; no OS mouse movement',profiles:[],errors:[]};
report.evidence=await beginEvidence(root,'hit-mask',['hit-mask-qa.json']);let app;
if(process.env.CLAWD_QA_EXE)report.packagedBytes={asarSha256:createHash('sha256').update(await readFile(path.join(path.dirname(process.env.CLAWD_QA_EXE),'resources/app.asar'))).digest('hex')};
try{
  for(const dpr of [1,2.5]){
    const userData=path.join(out,'user-data',`hit-mask-${dpr}`);await mkdir(userData,{recursive:true});
    await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,paused:true,bridge:false,outfit:'none',scale:1}));
    const env={...process.env,CLAWD_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:process.env.CLAWD_QA_EXE??path.join(root,'node_modules/electron/dist/electron.exe'),args:[...(process.env.CLAWD_QA_EXE?[]:[root]),`--force-device-scale-factor=${dpr}`],cwd:root,env});
    const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>window.clawdDebug);
    await page.waitForFunction(()=>window.clawdDebug.hitPoints().opaque!==null);
    if(process.env.CLAWD_QA_HIDE)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.hide()));
    await page.evaluate(()=>window.clawd.onCursor(p=>{const pending=window.__qaPendingHit;if(pending&&p.x===pending.point.x&&p.y===pending.point.y){window.__qaPendingHit=null;pending.resolve(window.clawdDebug.snapshot().interactive);}}));
    const profile={requestedDPR:dpr,cases:0};report.profiles.push(profile);
    for(const [action,def] of Object.entries(manifest.animations))for(const fraction of [.15,.5,.85]){
      await page.evaluate(({action,ms})=>{window.clawdDebug.action(action);window.clawdDebug.time(ms);},{action,ms:def.durations.reduce((a,b)=>a+b,0)*fraction});
      const samples=await page.evaluate(()=>{
        const canvas=document.querySelector('#stage'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const solid=[],clear=[];
        for(let y=3;y<canvas.height;y+=9)for(let x=3;x<canvas.width;x+=9)(data[(y*canvas.width+x)*4+3]>127?solid:clear).push({x,y});
        return [...[0,.3,.7,1].map(f=>({...solid[Math.floor((solid.length-1)*f)],expected:true})),...[0,.3,.7,1].map(f=>({...clear[Math.floor((clear.length-1)*f)],expected:false}))].map(p=>({...p,x:(p.x+.5)/devicePixelRatio,y:(p.y+.5)/devicePixelRatio}));
      });
      const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
      for(const sample of samples){
        assert.ok(Number.isFinite(sample.x)&&Number.isFinite(sample.y),'Visible frame must contain both opaque and transparent samples');
        const point={x:bounds.x+sample.x,y:bounds.y+sample.y};
        await page.evaluate(point=>{window.__qaHitResult=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.__qaPendingHit=null;reject(new Error('Trusted cursor observation timed out'));},3000);window.__qaPendingHit={point,resolve:value=>{clearTimeout(timer);resolve(value);}};});},point);
        await app.evaluate(({BrowserWindow},{point,bounds})=>BrowserWindow.getAllWindows()[0].webContents.send('clawd:cursor',point,bounds,false),{point,bounds});
        assert.equal(await page.evaluate(()=>window.__qaHitResult),sample.expected,`${dpr}/${action}/${fraction}/${JSON.stringify(sample)}`);profile.cases++;
      }
    }
    await app.close();app=undefined;
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack??String(error);process.exitCode=1;}
finally{if(app)await app.close();report.endedAt=new Date().toISOString();await writeFile(path.join(out,'hit-mask-qa.json'),JSON.stringify(report,null,2));await retainEvidence(root,report.evidence,report);console.log(JSON.stringify(report,null,2));}
