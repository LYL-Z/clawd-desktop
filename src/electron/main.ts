import {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,screen,powerMonitor,nativeTheme,systemPreferences,session,dialog} from 'electron';
import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {writeFileSync,renameSync} from 'node:fs';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import path from 'node:path';
import {DEFAULTS,OUTFITS,CORE_ACTIONS,EXT_ACTIONS,PERFORMANCES,type Settings,type Point,type HostCommand,type Environment} from '../shared/types';
import {parseStatus} from '../shared/status';
const studioOnly=process.argv.includes('--studio');
const testDir=process.env.CLAWD_TEST_USER_DATA;
app.setName('Clawd');
app.setPath('userData',testDir&&path.isAbsolute(testDir)?testDir:path.join(app.getPath('appData'),'Clawd'));
let pet:BrowserWindow|undefined,studio:BrowserWindow|undefined,tray:Tray|undefined,probe:ChildProcessWithoutNullStreams|undefined;
let settings:Settings={...DEFAULTS};let dragging=false,mouseDown=false,fullScreen=false,systemPaused=false,lastPoint:Point|undefined,expanded=false,lastTaskKey='';
let lastReport:unknown;let menuRequests=0,lastMenuWasActions=false;let manifest:Environment['manifest'];const timers:ReturnType<typeof setInterval>[]=[];
const settingsPath=()=>path.join(app.getPath('userData'),'settings.json');
const statusPath=()=>path.join(app.getPath('userData'),'status.json');
const startupOptions=()=>({path:process.env.PORTABLE_EXECUTABLE_FILE&&path.isAbsolute(process.env.PORTABLE_EXECUTABLE_FILE)?process.env.PORTABLE_EXECUTABLE_FILE:process.execPath,args:[]});
function command(c:HostCommand){pet?.webContents.send('clawd:command',c);studio?.webContents.send('clawd:command',c);}
function safeSettings(input:unknown):Partial<Settings>{
  if(!input||typeof input!=='object')return{};const v=input as Record<string,unknown>,s:Partial<Settings>={};
  for(const key of ['roam','reducedMotion','paused','bridge','welcomeSeen'] as const)if(typeof v[key]==='boolean')s[key]=v[key];
  if(OUTFITS.some(o=>o.id===v.outfit))s.outfit=v.outfit as Settings['outfit'];
  if(typeof v.scale==='number'&&[.75,1,1.25,1.5].includes(v.scale))s.scale=v.scale;
  if(v.position&&typeof v.position==='object'){const p=v.position as Point;if(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<50000&&Math.abs(p.y)<50000)s.position={x:p.x,y:p.y};}
  return s;
}
let saveQueue=Promise.resolve();
function saveSettings(input:unknown){settings={...settings,...safeSettings(input)};const text=JSON.stringify(settings,null,2);saveQueue=saveQueue.then(async()=>{await writeFile(settingsPath()+'.tmp',text);await rename(settingsPath()+'.tmp',settingsPath());}).catch(error=>console.error('Settings save failed:',error.message));}
function environment():Environment{const a=screen.getDisplayNearestPoint(lastPoint??screen.getCursorScreenPoint()).workArea;return{workArea:a,displays:screen.getAllDisplays().map(d=>d.workArea),settings,statusPath:statusPath(),systemReducedMotion:!systemPreferences.getAnimationSettings().shouldRenderRichAnimation,idleSeconds:powerMonitor.getSystemIdleTime(),windowBounds:pet?.getBounds()??a,manifest};}
function recover(){const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;lastPoint={x:a.x+a.width/2,y:a.y+a.height};command({type:'recover',value:a});pet?.showInactive();}
function showStudio(){if(studio){studio.show();return;}studio=createWindow(true);studio.on('closed',()=>{studio=undefined;});}
function menu(actions=false){return Menu.buildFromTemplate(actions?[...CORE_ACTIONS,...EXT_ACTIONS].map(([value,label])=>({label,click:()=>command({type:'action',value})})):[
  {label:'唤醒 / 睡眠',click:()=>command({type:'action',value:'sleep-toggle'})},
  {label:'沿边巡游',type:'checkbox',checked:settings.roam,click:item=>{saveSettings({roam:item.checked});command({type:'setting',value:{roam:item.checked}});}},
  {label:'暂停全部动画',type:'checkbox',checked:settings.paused,click:item=>{saveSettings({paused:item.checked});command({type:'setting',value:{paused:item.checked}});}},
  {label:'衣柜',submenu:OUTFITS.map(o=>({label:o.label,type:'radio',checked:settings.outfit===o.id,click:()=>{saveSettings({outfit:o.id});command({type:'outfit',value:o.id});}}))},
  {label:'主题演出',submenu:PERFORMANCES.map(([value,label])=>({label,click:()=>command({type:'performance',value})}))},
  {label:'动作预览与逐帧检查',click:showStudio},
  {label:'减弱动态',type:'checkbox',checked:settings.reducedMotion,click:item=>{saveSettings({reducedMotion:item.checked});command({type:'setting',value:{reducedMotion:item.checked}});}},
  {label:'大小',submenu:[.75,1,1.25,1.5].map(scale=>({label:`${Math.round(scale*100)}%`,type:'radio',checked:settings.scale===scale,click:()=>{saveSettings({scale});command({type:'setting',value:{scale}});}}))},
  {label:'收回当前屏幕',click:recover},
  {label:'本地任务状态桥',type:'checkbox',checked:settings.bridge,click:item=>{saveSettings({bridge:item.checked});lastTaskKey='';command({type:'setting',value:{bridge:item.checked}});}},
  {label:'开机启动',type:'checkbox',enabled:app.isPackaged,checked:app.isPackaged&&app.getLoginItemSettings(startupOptions()).openAtLogin,click:item=>app.setLoginItemSettings({...startupOptions(),openAtLogin:item.checked})},
  {type:'separator'},
  {label:'关于 Clawd',click:()=>dialog.showMessageBox({type:'info',title:'Clawd',message:'CLAWD：从欢迎屏走出的传奇',detail:'这是参考 Claude / Clawd 制作的非官方粉丝作品，与 Anthropic、OpenAI 无隶属或背书关系。\n运行时离线，无模型调用，无屏幕/剪贴板采集。\n\n本地状态文件：'+statusPath(),buttons:['知道了']})},
  {label:'退出',click:()=>app.quit()}
]);}
function createWindow(isStudio=false){
  const win=new BrowserWindow({width:isStudio?1100:240,height:isStudio?800:280,frame:isStudio,transparent:!isStudio,resizable:isStudio,hasShadow:isStudio,skipTaskbar:!isStudio,alwaysOnTop:!isStudio,focusable:isStudio,show:false,backgroundColor:isStudio?'#faf9f5':'#00000000',title:'Clawd · 动作剧场',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('blur',()=>{if(!isStudio&&dragging){dragging=false;command({type:'action',value:'cancel-drag'});}});
  win.on('closed',()=>{if(win===pet)pet=undefined;});
  void win.loadFile(path.join(__dirname,'index.html'),{query:{mode:isStudio?'studio':'pet'}});
  win.once('ready-to-show',()=>isStudio?win.show():win.showInactive());
  if(!isStudio)win.setIgnoreMouseEvents(true,{forward:true});
  return win;
}
function trusted(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent){return event.sender===pet?.webContents||event.sender===studio?.webContents;}
function moveWindow(point:Point,stage:boolean){
  if(!pet||!point||typeof point!=='object'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>50000||Math.abs(point.y)>50000)return;
  lastPoint=point;const display=screen.getDisplayNearestPoint(point),area=display.workArea;
  const pixelScale=Math.max(1,Math.round(settings.scale*display.scaleFactor))/display.scaleFactor;
  const topPadding=Math.ceil(72*pixelScale+24);
  const w=stage?Math.min(640,area.width):Math.ceil(192*pixelScale+48),h=stage?Math.min(420,area.height):Math.ceil(208*pixelScale+topPadding+46);
  const anchor={x:w/2,y:stage?h-80:Math.round(184*pixelScale+topPadding)};
  let x=Math.round(point.x-anchor.x),y=Math.round(point.y-anchor.y);
  if(stage){x=Math.max(area.x,Math.min(x,area.x+area.width-w));y=Math.max(area.y,Math.min(y,area.y+area.height-h));}
  const current=pet.getBounds();if(expanded!==stage||current.width!==w||current.height!==h)pet.setBounds({x,y,width:w,height:h});else if(current.x!==x||current.y!==y)pet.setPosition(x,y,false);
  expanded=stage;
}
function setupIPC(){
  ipcMain.handle('clawd:init',event=>trusted(event)?environment():null);
  ipcMain.on('clawd:move',(event,data)=>{if(event.sender!==pet?.webContents||!data||typeof data.expanded!=='boolean')return;moveWindow(data.point,data.expanded);});
  ipcMain.on('clawd:interactive',(event,data)=>{if(event.sender!==pet?.webContents||!data||typeof data.hit!=='boolean'||typeof data.captured!=='boolean')return;dragging=data.captured;pet?.setIgnoreMouseEvents(!(data.hit||data.captured),{forward:true});});
  ipcMain.on('clawd:menu',(event,actions)=>{if(trusted(event)){menuRequests++;lastMenuWasActions=actions===true;menu(actions===true).popup();}});
  ipcMain.on('clawd:save',(event,data)=>{if(trusted(event))saveSettings(data);});
  ipcMain.on('clawd:ready',event=>{if(event.sender===pet?.webContents){const a=environment().workArea;moveWindow(settings.position??{x:a.x+a.width/2,y:a.y+a.height},false);}});
  ipcMain.on('clawd:report',(event,data)=>{if(!trusted(event))return;try{const encoded=JSON.stringify(data);if(encoded&&encoded.length<65536)lastReport=data;}catch{}});
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>studioOnly?showStudio():recover());
  app.whenReady().then(async()=>{
    await mkdir(app.getPath('userData'),{recursive:true});
    try{settings={...DEFAULTS,...safeSettings(JSON.parse(await readFile(settingsPath(),'utf8')))};}catch{}
    try{manifest=JSON.parse(await readFile(path.join(__dirname,'assets','animations.json'),'utf8'));}catch{}
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')&&!details.url.startsWith('devtools:')}));
    setupIPC();
    if(studioOnly)showStudio();else pet=createWindow();
    const fallback=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
    const icon=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png'));
    tray=new Tray(icon.isEmpty()?fallback:icon);tray.setToolTip('Clawd · 右键菜单，双击找回');tray.on('right-click',()=>menu().popup());tray.on('double-click',recover);
    const refresh=()=>command({type:'environment',value:environment()});
    screen.on('display-added',refresh);screen.on('display-removed',()=>{refresh();recover();});screen.on('display-metrics-changed',refresh);nativeTheme.on('updated',refresh);
    const pause=()=>{systemPaused=true;command({type:'pause-system'});pet?.hide();};const resume=()=>{systemPaused=false;refresh();command({type:fullScreen?'pause-system':'resume-system'});if(fullScreen)pet?.hide();else pet?.showInactive();};
    powerMonitor.on('suspend',pause);powerMonitor.on('lock-screen',pause);powerMonitor.on('resume',resume);powerMonitor.on('unlock-screen',resume);
    timers.push(setInterval(()=>{if(!pet||systemPaused)return;const p=screen.getCursorScreenPoint();pet.webContents.send('clawd:cursor',p,pet.getBounds(),mouseDown);},25));
    timers.push(setInterval(async()=>{
      refresh();if(!settings.bridge){if(lastTaskKey){command({type:'task',value:null});lastTaskKey='';}return;}
      let parsed=null;try{if((await stat(statusPath())).size<=4096)parsed=parseStatus(await readFile(statusPath(),'utf8'));}catch{}
      const key=parsed?`${parsed.eventId}:${parsed.state}`:'expired';if(key!==lastTaskKey){const hadTask=lastTaskKey!==''&&lastTaskKey!=='expired';lastTaskKey=key;if(parsed||hadTask)command({type:'task',value:parsed});}
    },1000));
    if(process.platform==='win32'){
      const probePath=path.join(__dirname.replace(/app\.asar(?=[\\/])/,'app.asar.unpacked'),'window-probe.exe');
      try{probe=spawn(probePath,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        let buffer='';probe.stdout.on('data',data=>{buffer+=data.toString();const lines=buffer.split('\n');buffer=lines.pop()??'';for(const line of lines){const [full,down]=line.trim().split(',');mouseDown=down==='1';const next=full==='1';if(next!==fullScreen){fullScreen=next;if(!systemPaused){command({type:next?'pause-system':'resume-system'});if(next)pet?.hide();else pet?.showInactive();}}}});
        probe.on('error',error=>{console.error('Native full-screen/release probe unavailable:',error.message);probe=undefined;});
        probe.on('exit',()=>{probe=undefined;mouseDown=false;});
      }catch{}
    }
    if(process.env.CLAWD_AUTOTEST){timers.push(setInterval(async()=>{await writeFile(path.join(app.getPath('userData'),'runtime-report.json'),JSON.stringify({settings,lastPoint,expanded,lastReport,menuRequests,lastMenuWasActions,processMetrics:app.getAppMetrics(),window:pet?.getBounds(),fullScreen,nativeProbeAvailable:Boolean(probe),userDataPath:app.getPath('userData'),statusPath:statusPath(),startupExecutable:startupOptions().path},null,2));},1000));}
  }).catch(error=>{console.error(error);app.quit();});
}
app.on('window-all-closed',()=>{if(studioOnly)app.quit();});
app.on('before-quit',()=>{timers.forEach(clearInterval);probe?.kill();tray?.destroy();if(lastPoint)settings.position=lastPoint;try{writeFileSync(settingsPath()+'.closing',JSON.stringify(settings,null,2));renameSync(settingsPath()+'.closing',settingsPath());}catch{}});
