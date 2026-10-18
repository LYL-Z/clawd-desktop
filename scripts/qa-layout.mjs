import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
const require=createRequire('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {_electron}=require('playwright'),root=process.cwd(),out=path.join(root,'qa/runtime/layout');
const manifest=JSON.parse(await readFile(path.join(root,'assets/runtime/animations.json'),'utf8'));
const report={startedAt:new Date().toISOString(),scope:'Real Electron renderer with forced software DPR profiles; no Windows display setting changed and no OS mouse input',profiles:[],passed:false};
report.evidence=await beginEvidence(root,'layout',['layout-qa.json','layout']);
await mkdir(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let app;
try{
  for(const dpr of [1,1.25,1.5,2]){
    const userData=path.join(root,'qa/runtime/user-data',`layout-${dpr}`);
    await mkdir(userData,{recursive:true});await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,bridge:false,paused:true,outfit:'none'}));
    const env={...process.env,CLAWD_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
    const executable=process.env.CLAWD_QA_EXE??path.join(root,'node_modules/electron/dist/electron.exe');
    app=await _electron.launch({executablePath:executable,args:[...(process.env.CLAWD_QA_EXE?[]:[root]),`--force-device-scale-factor=${dpr}`],cwd:root,env});
    const page=await app.firstWindow();await page.waitForFunction(()=>window.clawdDebug);
    await page.waitForFunction(()=>window.clawdDebug.snapshot().sourceAvailable);
    if(process.env.CLAWD_QA_HIDE)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.hide()));
    report.application=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),appPath:app.getAppPath()}));
    if(process.env.CLAWD_QA_EXE)report.packagedBytes={executable,asarSha256:createHash('sha256').update(await readFile(path.join(path.dirname(executable),'resources/app.asar'))).digest('hex')};
    const profile={requestedDPR:dpr,cases:[],errors:[]};report.profiles.push(profile);page.on('pageerror',e=>profile.errors.push(e.message));
    const command=(type,value)=>app.evaluate(({BrowserWindow},c)=>BrowserWindow.getAllWindows()[0].webContents.send('clawd:command',c),{type,value});
    for(const scale of [.75,1,1.25,1.5]){
      await page.evaluate(value=>window.clawd.save({scale:value,paused:true}),scale);
      await command('setting',{scale,paused:true});
      // A hidden window throttles requestAnimationFrame, including its ordinary
      // geometry IPC. Explicitly request that same public operation and wait for
      // the real resize before measuring pixels; do not sample the old canvas.
      await page.evaluate(()=>window.clawd.move(window.clawdDebug.snapshot().position,false));
      await page.waitForFunction(async()=>{
        const env=await window.clawd.init(),canvas=document.querySelector('#stage');
        return canvas.width===Math.round(env.windowBounds.width*devicePixelRatio)&&canvas.height===Math.round(env.windowBounds.height*devicePixelRatio)&&innerWidth===env.windowBounds.width;
      });await sleep(100);
      for(const outfit of ['none',...Object.keys(manifest.outfits).filter(n=>!manifest.outfits[n].hidden)]){
        await page.evaluate(n=>window.clawdDebug.outfit(n),outfit);
        for(const action of ['idle','waving','jumping','held','thrown','landing','turn','sway']){
          await page.evaluate(n=>window.clawdDebug.action(n),action);
          const duration=manifest.animations[action].durations.reduce((a,b)=>a+b,0);
          for(const fraction of [.15,.5,.85]){
            await page.evaluate(t=>window.clawdDebug.time(t),duration*fraction);
            const sample=await page.evaluate(()=>{
              const canvas=document.querySelector('#stage'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
              let left=canvas.width,top=canvas.height,right=-1,bottom=-1,softAlpha=0,opaque=0;
              for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
                const alpha=pixels[(y*canvas.width+x)*4+3];if(alpha>0&&alpha<255)softAlpha++;
                if(alpha>127){opaque++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
              }
              return{width:canvas.width,height:canvas.height,bbox:[left,top,right,bottom],opaque,softAlpha,...window.clawdDebug.snapshot()};
            });
            assert.equal(sample.sourceAvailable,true);assert.ok(sample.opaque>100);assert.equal(sample.softAlpha,0,'sprite edges must remain binary alpha after physical-pixel scaling');
            assert.ok(sample.bbox[0]>0&&sample.bbox[1]>0&&sample.bbox[2]<sample.width-1&&sample.bbox[3]<sample.height-1,`clipped ${dpr}/${scale}/${outfit}/${action}/${fraction}: ${JSON.stringify(sample)}`);
            assert.ok(Number.isInteger(sample.physicalPixelScale));
            profile.cases.push({scale,outfit,action,fraction,dpr:sample.devicePixelRatio,physicalPixelScale:sample.physicalPixelScale,bbox:sample.bbox,canvas:[sample.width,sample.height],opaque:sample.opaque});
          }
        }
      }
    }
    const actualEnv=await page.evaluate(()=>window.clawd.init());
    // Capture inside the injected command callback. The real one-second host refresh
    // otherwise legitimately restores actual display coordinates before a delayed read.
    await page.evaluate(()=>{window.__clawdEnvironmentResult=new Promise(resolve=>window.clawd.onCommand(c=>{if(c.type==='environment'&&c.value.displays[0]?.x===-900)resolve(window.clawdDebug.snapshot());}));});
    await command('environment',{...actualEnv,displays:[{x:-900,y:0,width:800,height:500}],workArea:{x:-900,y:0,width:800,height:500}});
    const relocated=await page.evaluate(()=>window.__clawdEnvironmentResult);assert.equal(relocated.position.y,500);assert.ok(relocated.position.x<0);
    profile.simulatedNegativeWorkArea={position:relocated.position,airborne:relocated.airborne};
    await command('environment',actualEnv);await command('recover',actualEnv.workArea);
    await page.evaluate(()=>{window.clawdDebug.outfit('wizard');window.clawdDebug.action('jumping');window.clawdDebug.time(420);});
    await sleep(100);
    const captured=await page.evaluate(()=>document.querySelector('#stage').toDataURL('image/png'));
    await writeFile(path.join(out,`wizard-jump-dpr-${dpr}.png`),Buffer.from(captured.split(',')[1],'base64'));
    assert.deepEqual(profile.errors,[]);await app.close();app=undefined;
    console.log(JSON.stringify({softwareDPR:dpr,cases:profile.cases.length,passed:true}));
  }
  report.passed=true;
}catch(error){report.failure=error.stack??String(error);process.exitCode=1;}
finally{
  if(app)await app.close();report.endedAt=new Date().toISOString();
  await writeFile(path.join(root,'qa/runtime/layout-qa.json'),JSON.stringify(report,null,2));await retainEvidence(root,report.evidence,report);
  console.log(JSON.stringify({passed:report.passed,profiles:report.profiles.map(p=>({dpr:p.requestedDPR,cases:p.cases.length})),failure:report.failure}));
}
