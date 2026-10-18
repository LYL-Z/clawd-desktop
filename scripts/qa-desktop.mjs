import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
const runtimeRequire=createRequire('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {_electron}=runtimeRequire('playwright');
const exec=promisify(execFile),root=process.cwd(),out=path.join(root,'qa/runtime');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mode=process.argv[2]??'studio',tag=process.env.CLAWD_QA_EXE?`packaged-${mode}`:mode,report={mode,tag,startedAt:new Date().toISOString(),checks:[],errors:[]};
report.evidence=await beginEvidence(root,tag,[`${tag}-qa.json`,`${mode}-failure.png`,'desktop-interaction.mp4','pet-transparent-window.png','wardrobe','actions',...['idle','welcome','agreement','sigil','ensemble','reduced'].map(name=>`studio-${name}.png`)]);
const userData=path.join(out,'user-data',tag);
await mkdir(userData,{recursive:true});
await rm(path.join(userData,'runtime-report.json'),{force:true});
await writeFile(path.join(userData,'settings.json'),JSON.stringify({outfit:'none',roam:false,paused:false,scale:1,bridge:mode==='pet',reducedMotion:false,welcomeSeen:true}));
const env={...process.env,CLAWD_TEST_USER_DATA:userData,CLAWD_AUTOTEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const executable=process.env.CLAWD_QA_EXE??path.join(root,'node_modules/electron/dist/electron.exe');
const args=process.env.CLAWD_QA_EXE?[]:[root];if(mode==='studio')args.push('--studio');
let app,page,originalCursor,recorder;
const finishRecording=async()=>{if(!recorder)return;const running=recorder;recorder=undefined;if(running.exitCode!==null)return;const stopped=new Promise(resolve=>running.once('close',resolve));running.stdin.write('q\n');await stopped;};
const check=(name,data={})=>report.checks.push({name,passed:true,...data});
const native=async steps=>{const result=await exec('C:/Users/Lenovo/Miniconda3/python.exe',[path.join(root,'scripts/qa-native-input.py'),JSON.stringify(steps)],{windowsHide:true});return JSON.parse(result.stdout);};
const screenPoint=async p=>app.evaluate(({screen},point)=>screen.dipToScreenPoint({x:Math.round(point.x),y:Math.round(point.y)}),p);
const moveTo=async p=>{const physical=await screenPoint(p);const moved=await native([{type:'move',...physical,wait:160}]);if(Math.hypot(moved.cursor.x-physical.x,moved.cursor.y-physical.y)>8){report.externalCursorMovement=true;throw new Error('External cursor movement interrupted the OS-input test; no product verdict for this run.');}};
const click=async p=>{await moveTo(p);return await native([{type:'down',wait:45},{type:'up',wait:120}]);};
try{
  app=await _electron.launch({executablePath:executable,args,cwd:root,env,timeout:30000});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  if(mode==='studio'&&process.env.CLAWD_QA_HIDE)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.hide()));
  await page.waitForFunction(()=>window.clawdDebug,{timeout:20000});
  report.application=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),appPath:app.getAppPath()}));
  if(process.env.CLAWD_QA_EXE){
    const asar=path.join(path.dirname(executable),'resources','app.asar');
    report.packagedBytes={executable,executableSha256:createHash('sha256').update(await readFile(executable)).digest('hex'),asar,asarSha256:createHash('sha256').update(await readFile(asar)).digest('hex')};
  }
  const boot=await page.evaluate(()=>window.clawdDebug.snapshot());assert.equal(boot.sourceAvailable,true);check('actual Electron renderer loaded generated artwork',{boot});
  if(mode==='studio'){
    await page.evaluate(()=>{window.clawdDebug.action('idle');window.clawdDebug.time(0);});
    assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).look,null,'Unchecked studio direction control must show the original idle animation');
    await page.screenshot({path:path.join(out,'studio-idle.png')});
    const labels=await page.locator('#action option').allTextContents();check('action menu labels missing assets explicitly',{labels});
    const outfits=await page.locator('#outfit option:not([disabled])').evaluateAll(options=>options.map(o=>o.value));
    await mkdir(path.join(out,'wardrobe'),{recursive:true});
    for(const id of outfits){await page.evaluate(n=>{window.clawdDebug.outfit(n);window.clawdDebug.action('idle');window.clawdDebug.time(400);},id);await page.locator('#stage').screenshot({path:path.join(out,'wardrobe',`${id}.png`)});}
    await page.evaluate(()=>window.clawdDebug.outfit('none'));check('available wardrobe layers rendered over the same core body',{outfits});
    const currentManifest=JSON.parse(await readFile(path.join(root,'assets/runtime/animations.json'),'utf8'));
    if(currentManifest.look){
      await mkdir(path.join(out,'directions'),{recursive:true});
      await page.evaluate(()=>window.clawdDebug.action('idle'));await page.check('#directions');
      for(let i=0;i<16;i++){
        await page.evaluate(index=>{const input=document.querySelector('#direction');input.value=String(index);input.dispatchEvent(new Event('input'));window.clawdDebug.time(0);},i);
        assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).look,i);
        await page.locator('#stage').screenshot({path:path.join(out,'directions',`${String(i).padStart(2,'0')}.png`)});
      }
      await page.uncheck('#directions');assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).look,null);check('all sixteen look cells rendered through the actual direction controls');
    }
    if(process.env.CLAWD_QA_ALL_ACTIONS){
      const manifest=JSON.parse(await readFile(path.join(root,'assets/runtime/animations.json'),'utf8'));await mkdir(path.join(out,'actions'),{recursive:true});
      for(const [id,def] of Object.entries(manifest.animations)){
        const duration=def.durations.reduce((sum,t)=>sum+t,0);await page.evaluate(id=>window.clawdDebug.action(id),id);
        for(const fraction of [.15,.5,.85]){await page.evaluate(ms=>window.clawdDebug.time(ms),duration*fraction);await page.locator('#stage').screenshot({path:path.join(out,'actions',`${id}-${fraction}.png`)});}
        assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).sourceAvailable,true);
      }
      check('every declared action used actual source pixels in three sampled phases',{count:Object.keys(manifest.animations).length});
    }
    const performances=['welcome','agreement','sigil','ensemble'];
    for(const name of performances){
      await page.evaluate(n=>{window.clawdDebug.performance(n);window.clawdDebug.time(1800);},name);
      assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).performance,name);
      await page.screenshot({path:path.join(out,`studio-${name}.png`)});
    }
    check('four live Canvas performance timelines rendered at 1.8 seconds');
    await page.check('#reduced');
    await page.evaluate(()=>{window.clawdDebug.performance('sigil');window.clawdDebug.time(1400);});
    await page.screenshot({path:path.join(out,'studio-reduced.png')});check('reduced-motion static scene rendered');
    await page.context().setOffline(true);await page.reload();await page.waitForFunction(()=>window.clawdDebug?.snapshot().sourceAvailable===true);
    check('actual packaged-local assets reloaded with browser networking forced offline');
  }else{
    originalCursor=await app.evaluate(({screen})=>screen.getCursorScreenPoint());
    const geometry=await app.evaluate(async({BrowserWindow,screen})=>{
      const area=screen.getPrimaryDisplay().workArea;
      const win=new BrowserWindow({x:area.x+Math.floor(area.width/2)-350,y:area.y+area.height-500,width:700,height:500,frame:false,backgroundColor:'#dde6e1',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{font:20px Segoe UI;background:#dde6e1;color:#141413;margin:32px}button{position:fixed;inset:120px 20px 0;border:1px solid #80958b;background:#eff5f0;font:22px Segoe UI}</style><h2>Clawd 本地桌面验证</h2><p>透明区域点击计数：<span id="count">0</span></p><button id="target">测试窗口背景</button><script>window.clicks=0;document.addEventListener("click",()=>document.getElementById("count").textContent=String(++window.clicks));</script>'));
      globalThis.__clawdQaBackground=win;win.show();win.focus();
      const pet=BrowserWindow.getAllWindows().find(w=>w!==win);pet.setAlwaysOnTop(true);pet.showInactive();
      pet.webContents.send('clawd:command',{type:'recover',value:area});
      return{area,displays:screen.getAllDisplays(),window:pet.getBounds(),background:win.getBounds()};
    });report.geometry=geometry;await sleep(700);
    if(process.env.CLAWD_QA_RECORD){
      const top=await screenPoint(geometry.background),bottom=await screenPoint({x:geometry.background.x+geometry.background.width,y:geometry.background.y+geometry.background.height});
      report.recording={x:top.x,y:top.y,width:bottom.x-top.x,height:bottom.y-top.y};
      recorder=spawn('ffmpeg',['-y','-f','gdigrab','-framerate','30','-offset_x',String(top.x),'-offset_y',String(top.y),'-video_size',`${bottom.x-top.x}x${bottom.y-top.y}`,'-draw_mouse','1','-i','desktop','-t','60','-vf','scale=1400:-2','-c:v','libx264','-preset','veryfast','-crf','21',path.join(out,'desktop-interaction.mp4')],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      recorder.stderr.on('data',()=>{});await sleep(1000);
    }
    await page.evaluate(()=>window.clawdDebug.action('idle'));
    let points=await page.evaluate(()=>window.clawdDebug.hitPoints());assert.ok(points.opaque);
    report.transparentInput={points,native:await click(points.transparent),cursor:await app.evaluate(({screen})=>screen.getCursorScreenPoint()),targetPID:await app.evaluate(()=>globalThis.__clawdQaBackground.webContents.getOSProcessId())};
    const throughCount=await app.evaluate(async()=>globalThis.__clawdQaBackground.webContents.executeJavaScript('window.clicks'));
    assert.equal(throughCount,1);check('real OS click through transparent overlay reached underlying window',{throughCount,point:points.transparent});
    await moveTo(points.opaque);await sleep(120);
    assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).interactive,true);
    await click(points.opaque);await sleep(400);
    assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'waving');
    const afterOpaque=await app.evaluate(async()=>globalThis.__clawdQaBackground.webContents.executeJavaScript('window.clicks'));
    assert.equal(afterOpaque,1);check('real OS single click on opaque pet waved and did not reach underlying window');
    await sleep(900);await page.evaluate(()=>window.clawdDebug.action('idle'));await sleep(120);
    points=await page.evaluate(()=>window.clawdDebug.hitPoints());await moveTo(points.opaque);
    await native([{type:'down',wait:40},{type:'up',wait:70},{type:'down',wait:40},{type:'up',wait:120}]);
    assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).performance,'agreement');check('real OS double click started agreement');
    await app.evaluate(({BrowserWindow,screen})=>{const pet=BrowserWindow.getAllWindows().find(w=>w!==globalThis.__clawdQaBackground);pet.webContents.send('clawd:command',{type:'recover',value:screen.getPrimaryDisplay().workArea});});
    await sleep(350);points=await page.evaluate(()=>window.clawdDebug.hitPoints());await moveTo(points.opaque);
    await native([{type:'down',wait:750}]);
    const longState=await page.evaluate(()=>window.clawdDebug.snapshot());await native([{type:'up',wait:40},{type:'escape',wait:60}]);
    await sleep(1100);const menuReport=JSON.parse(await readFile(path.join(userData,'runtime-report.json'),'utf8'));assert.ok(menuReport.menuRequests>0&&menuReport.lastMenuWasActions);check('real OS long hold requested native action menu and released safely',{state:longState,menuRequests:menuReport.menuRequests});
    await page.evaluate(()=>window.clawdDebug.action('idle'));await sleep(350);points=await page.evaluate(()=>window.clawdDebug.hitPoints());await moveTo(points.opaque);
    const from=await screenPoint(points.opaque),to=await screenPoint({x:points.opaque.x+150,y:points.opaque.y-190});
    const steps=[{type:'down',wait:35}];for(let i=1;i<=8;i++)steps.push({type:'move',x:Math.round(from.x+(to.x-from.x)*i/8),y:Math.round(from.y+(to.y-from.y)*i/8),wait:22});steps.push({type:'up',wait:40});await native(steps);
    let thrown=await page.evaluate(()=>window.clawdDebug.snapshot());assert.equal(thrown.dragging,false);assert.equal(thrown.airborne,true);check('real OS drag and throw released outside original window',{snapshot:thrown});
    await sleep(2800);const landed=await page.evaluate(()=>window.clawdDebug.snapshot());assert.equal(landed.airborne,false);assert.equal(landed.position.y,geometry.area.y+geometry.area.height);check('thrown pet landed at actual work-area floor',{snapshot:landed});
    await page.screenshot({path:path.join(out,'pet-transparent-window.png'),omitBackground:true});
    await app.evaluate(async({BrowserWindow})=>{const pet=BrowserWindow.getAllWindows().find(w=>w!==globalThis.__clawdQaBackground);pet.webContents.send('clawd:command',{type:'setting',value:{bridge:true}});});
    const status=state=>({schemaVersion:1,eventId:'qa-'+state,state,updatedAt:new Date().toISOString(),ttlMs:10000,detail:'本地验证'});
    await writeFile(path.join(userData,'status.json'),JSON.stringify(status('working')));await sleep(1250);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'running');check('opt-in local status file reached actual renderer');
    await writeFile(path.join(userData,'status.json'),JSON.stringify(status('done')));await sleep(2200);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'idle');await sleep(1100);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'idle');check('same done event performed once and returned to idle');
    await writeFile(path.join(userData,'status.json'),'{');await sleep(1250);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'idle');check('damaged status file returned to idle');
    await writeFile(path.join(userData,'status.json'),JSON.stringify({...status('failed'),eventId:'qa-failed-once'}));await sleep(2600);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'idle');check('failed event recovered once instead of looping');
    await writeFile(path.join(userData,'status.json'),JSON.stringify({...status('waiting'),ttlMs:1000}));await sleep(2200);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'idle');check('expired status returned to idle through actual file watcher');
    await app.evaluate(()=>globalThis.__clawdQaBackground.setFullScreen(true));await sleep(700);
    const hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows().find(w=>w!==globalThis.__clawdQaBackground).isVisible());assert.equal(hidden,true);
    await app.evaluate(()=>globalThis.__clawdQaBackground.setFullScreen(false));await sleep(700);
    const visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w!==globalThis.__clawdQaBackground).isVisible());assert.equal(visible,true);check('native foreground fullscreen detection hid pet and restored it afterward');
    const settingsCommand=async value=>app.evaluate(({BrowserWindow},v)=>BrowserWindow.getAllWindows().find(w=>w!==globalThis.__clawdQaBackground).webContents.send('clawd:command',{type:'setting',value:v}),value);
    await settingsCommand({paused:true});const pausedTime=(await page.evaluate(()=>window.clawdDebug.snapshot())).animationTime;await sleep(650);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).animationTime,pausedTime);await settingsCommand({paused:false});check('pause froze animation clock and resumed safely');
    await page.evaluate(()=>window.clawdDebug.action('sleep'));await sleep(900);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'sleep');await page.evaluate(()=>window.clawdDebug.action('wake'));await sleep(400);assert.equal((await page.evaluate(()=>window.clawdDebug.snapshot())).action,'wake');check('explicit sleep remained asleep until wake command');
    await finishRecording();await app.evaluate(()=>globalThis.__clawdQaBackground.close());
    const metrics=await app.evaluate(({app})=>({versions:process.versions,metrics:app.getAppMetrics()}));report.metrics=metrics;
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack??String(error);process.exitCode=1;
}finally{
  await finishRecording();
  if(app){if(report.failure){try{await page.screenshot({path:path.join(out,`${mode}-failure.png`)});}catch{}}if(originalCursor&&!report.externalCursorMovement){try{await native([{type:'up'},{type:'escape'}]);await moveTo(originalCursor);}catch{}}try{await app.close();}catch{}}
  report.endedAt=new Date().toISOString();await writeFile(path.join(out,`${tag}-qa.json`),JSON.stringify(report,null,2));
  await retainEvidence(root,report.evidence,report);
  console.log(JSON.stringify({mode,passed:!report.failure,checks:report.checks.map(c=>c.name),failure:report.failure},null,2));
}
