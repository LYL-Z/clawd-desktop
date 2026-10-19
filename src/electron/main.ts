import {app,BrowserWindow,dialog,ipcMain,Menu,MenuItemConstructorOptions,nativeImage,nativeTheme,powerMonitor,screen,session,shell,systemPreferences,Tray} from 'electron';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {SettingsStore} from './services/SettingsStore';
import {ForegroundAppMonitor} from './services/ForegroundAppMonitor';
import {UpdateChecker} from './services/UpdateChecker';
import {classifyScene,VisibilityController} from '../shared/visibility';
import {DEFAULTS,OUTFITS,CORE_ACTIONS,EXT_ACTIONS,PERFORMANCES,type Settings,type Point,type HostCommand,type Environment,type VisibilitySnapshot} from '../shared/types';
import type {ForegroundSample} from '../shared/probe';
import {parseStatus} from '../shared/status';
import path from 'node:path';

type WindowKind='pet'|'studio'|'settings';
const studioOnly=process.argv.includes('--studio');
const testDir=process.env.CLAWD_TEST_USER_DATA;
app.setName('Clawd');
app.setPath('userData',testDir&&path.isAbsolute(testDir)?testDir:path.join(app.getPath('appData'),'Clawd'));
Menu.setApplicationMenu(null);

let pet:BrowserWindow|undefined;
let studio:BrowserWindow|undefined;
let settingsWindow:BrowserWindow|undefined;
let tray:Tray|undefined;
let settings:Settings={...DEFAULTS};
let store:SettingsStore|undefined;
let monitor:ForegroundAppMonitor|undefined;
const updateChecker=new UpdateChecker();
let visibility:VisibilityController|undefined;
let latestSample:ForegroundSample|undefined;
let probeHealthy=false;
let dragging=false;
let mouseDown=false;
let lastPoint:Point|undefined;
let expanded=false;
let lastTaskKey='';
let lastReport:unknown;
let menuRequests=0;
let lastMenuWasActions=false;
let manifest:Environment['manifest'];
let shutdownRequested=false;
let lastEnvironmentKey='';
const timers:ReturnType<typeof setInterval>[]=[];

const settingsPath=()=>path.join(app.getPath('userData'),'settings.json');
const statusPath=()=>path.join(app.getPath('userData'),'status.json');
const startupOptions=()=>({path:process.env.PORTABLE_EXECUTABLE_FILE&&path.isAbsolute(process.env.PORTABLE_EXECUTABLE_FILE)?process.env.PORTABLE_EXECUTABLE_FILE:process.execPath,args:[] as string[]});
const currentVisibility=():VisibilitySnapshot=>visibility?.snapshot??{visible:true,reasons:[],scene:'unknown',probeHealthy:false};

function command(value:HostCommand):void{
  for(const win of [pet,studio])if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('clawd:command',value);
}

function environment():Environment{
  const area=screen.getDisplayNearestPoint(lastPoint??screen.getCursorScreenPoint()).workArea;
  return{
    workArea:area,
    displays:screen.getAllDisplays().map(display=>display.workArea),
    settings,
    statusPath:statusPath(),
    systemReducedMotion:!systemPreferences.getAnimationSettings().shouldRenderRichAnimation,
    idleSeconds:powerMonitor.getSystemIdleTime(),
    windowBounds:pet?.getBounds()??area,
    manifest,
    visibility:currentVisibility(),
    startupEnabled:app.isPackaged&&app.getLoginItemSettings(startupOptions()).openAtLogin,
    version:app.getVersion(),
    packaged:app.isPackaged,
    debugMode:!app.isPackaged||Boolean(process.env.CLAWD_AUTOTEST),
  };
}

function reasonLabel(snapshot=currentVisibility()):string{
  const names:Record<string,string>={game:'游戏',fullscreen:'全屏应用',user:'手动',lock:'锁屏',suspend:'系统挂起'};
  return snapshot.reasons.map(reason=>names[reason]??reason).join('、');
}

function applyVisibility(snapshot:VisibilitySnapshot):void{
  if(pet&&!pet.isDestroyed()){
    if(snapshot.visible){
      if(!pet.isVisible())pet.showInactive();
      pet.setIgnoreMouseEvents(true,{forward:true});
    }else{
      pet.setIgnoreMouseEvents(true,{forward:true});
      if(pet.isVisible())pet.hide();
    }
    if(!pet.webContents.isDestroyed())pet.webContents.send('clawd:command',{type:'visibility',value:snapshot} satisfies HostCommand);
  }
  if(settingsWindow&&!settingsWindow.isDestroyed()&&!settingsWindow.webContents.isDestroyed())settingsWindow.webContents.send('clawd:command',{type:'visibility',value:snapshot} satisfies HostCommand);
  if(tray&&!tray.isDestroyed())tray.setToolTip(snapshot.visible?'Clawd · 正在桌面陪伴你':`Clawd · 因${reasonLabel(snapshot)||'系统场景'}隐藏`);
}

function applyScene(sample:ForegroundSample,immediate=false):void{
  latestSample=sample;
  mouseDown=sample.mouseDown;
  const classification=classifyScene(settings,sample);
  visibility?.setProbeState(probeHealthy,classification.scene,sample.foregroundName??undefined,sample.timestamp);
  visibility?.updateAutomatic(classification.automaticReasons,settings.restoreDelayMs,immediate||!pet);
}

function recoverPosition():void{
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  lastPoint={x:area.x+area.width/2,y:area.y+area.height};
  command({type:'recover',value:area});
  if(pet&&!pet.isDestroyed())moveWindow(lastPoint,false);
}

function showSettings():void{
  if(settingsWindow&&!settingsWindow.isDestroyed()){
    if(settingsWindow.isMinimized())settingsWindow.restore();
    settingsWindow.show();settingsWindow.focus();return;
  }
  settingsWindow=createWindow('settings');
}

function showStudio():void{
  if(studio&&!studio.isDestroyed()){
    if(studio.isMinimized())studio.restore();
    studio.show();studio.focus();return;
  }
  studio=createWindow('studio');
}

function setUserHidden(hidden:boolean):void{visibility?.setUserHidden(hidden);}

function setStartup(enabled:boolean):boolean{
  if(!app.isPackaged)return false;
  try{
    app.setLoginItemSettings({...startupOptions(),openAtLogin:enabled});
    return app.getLoginItemSettings(startupOptions()).openAtLogin===enabled;
  }catch{return false;}
}

function menu(actions=false):void{
  const snapshot=currentVisibility();
  const sceneBlocked=snapshot.reasons.some(reason=>reason!=='user');
  const visibilityLabel=sceneBlocked?`Clawd 已因${reasonLabel(snapshot)}隐藏`:snapshot.visible?'隐藏 Clawd':'显示 Clawd';
  const template:MenuItemConstructorOptions[]=actions
    ?[...CORE_ACTIONS,...EXT_ACTIONS].map(([value,label])=>({label,click:()=>command({type:'action',value})}))
    :[
      {label:visibilityLabel,enabled:!sceneBlocked,click:()=>setUserHidden(snapshot.visible)},
      {label:'唤醒 / 睡眠',click:()=>command({type:'action',value:'sleep-toggle'})},
      {label:'暂停全部动画',type:'checkbox',checked:settings.paused,click:item=>{void updateSettings({paused:item.checked});}},
      {type:'separator'},
      {label:'自动隐藏模式',submenu:[
        {label:'智能模式',type:'radio',checked:settings.autoHideMode==='smart',click:()=>{void updateSettings({autoHideMode:'smart'});}},
        {label:'游戏运行期间隐藏',type:'radio',checked:settings.autoHideMode==='game-running',click:()=>{void updateSettings({autoHideMode:'game-running'});}},
        {label:'手动控制',type:'radio',checked:settings.autoHideMode==='manual',click:()=>{void updateSettings({autoHideMode:'manual'});}},
      ]},
      {label:'衣柜',submenu:OUTFITS.map(outfit=>({label:outfit.label,type:'radio',checked:settings.outfit===outfit.id,click:()=>{void updateSettings({outfit:outfit.id});command({type:'outfit',value:outfit.id});}}))},
      {label:'动作',submenu:[...CORE_ACTIONS,...EXT_ACTIONS].map(([value,label])=>({label,click:()=>command({type:'action',value})}))},
      {label:'主题演出',submenu:PERFORMANCES.map(([value,label])=>({label,click:()=>command({type:'performance',value})}))},
      {label:'设置与游戏规则…',click:showSettings},
      {label:'动作预览与逐帧检查',click:showStudio},
      {type:'separator'},
      {label:'收回当前屏幕',click:recoverPosition},
      {label:'本地任务状态桥',type:'checkbox',checked:settings.bridge,click:item=>{void updateSettings({bridge:item.checked});lastTaskKey='';}},
      {label:'开机启动',type:'checkbox',enabled:app.isPackaged,checked:app.isPackaged&&app.getLoginItemSettings(startupOptions()).openAtLogin,click:item=>setStartup(item.checked)},
      {type:'separator'},
      {label:'关于 Clawd',click:()=>dialog.showMessageBox({type:'info',title:'Clawd',message:'CLAWD：从欢迎屏走出的传奇',detail:'参考 Claude / Clawd 制作的非官方粉丝作品，与 Anthropic、OpenAI 无隶属或背书关系。桌面运行离线，无模型调用，也不读取屏幕、键盘或剪贴板。游戏规则只保存在本机设置文件中。',buttons:['知道了']})},
      {label:'退出',click:()=>app.quit()},
    ];
  const built=Menu.buildFromTemplate(template);
  built.popup();
}

function createWindow(kind:WindowKind):BrowserWindow{
  const isPet=kind==='pet',isStudio=kind==='studio';
  const win=new BrowserWindow({
    width:isPet?240:kind==='settings'?900:1100,
    height:isPet?280:kind==='settings'?720:800,
    minWidth:kind==='settings'?720:undefined,
    minHeight:kind==='settings'?600:undefined,
    frame:!isPet,
    transparent:isPet,
    resizable:!isPet,
    hasShadow:!isPet,
    skipTaskbar:isPet,
    alwaysOnTop:isPet,
    focusable:!isPet,
    show:false,
    backgroundColor:isPet?'#00000000':'#faf9f5',
    title:isStudio?'Clawd · 动作剧场':kind==='settings'?'Clawd 设置':'Clawd',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('blur',()=>{if(isPet&&dragging){dragging=false;command({type:'action',value:'cancel-drag'});}});
  win.on('closed',()=>{
    if(win===pet)pet=undefined;
    if(win===studio)studio=undefined;
    if(win===settingsWindow)settingsWindow=undefined;
  });
  if(kind==='settings')void win.loadFile(path.join(__dirname,'settings.html'));
  else void win.loadFile(path.join(__dirname,'index.html'),{query:{mode:isStudio?'studio':'pet'}});
  win.once('ready-to-show',()=>{
    if(isPet)applyVisibility(currentVisibility());
    else win.show();
  });
  if(isPet)win.setIgnoreMouseEvents(true,{forward:true});
  return win;
}

function moveWindow(point:Point,stage:boolean):void{
  if(!pet||!point||typeof point!=='object'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>50000||Math.abs(point.y)>50000)return;
  lastPoint=point;
  const display=screen.getDisplayNearestPoint(point),area=display.workArea;
  const pixelScale=Math.max(1,Math.round(settings.scale*display.scaleFactor))/display.scaleFactor;
  const topPadding=Math.ceil(72*pixelScale+24);
  const width=stage?Math.min(640,area.width):Math.ceil(192*pixelScale+48);
  const height=stage?Math.min(420,area.height):Math.ceil(208*pixelScale+topPadding+46);
  const anchor={x:width/2,y:stage?height-80:Math.round(184*pixelScale+topPadding)};
  let x=Math.round(point.x-anchor.x),y=Math.round(point.y-anchor.y);
  if(stage){x=Math.max(area.x,Math.min(x,area.x+area.width-width));y=Math.max(area.y,Math.min(y,area.y+area.height-height));}
  const current=pet.getBounds();
  if(expanded!==stage||current.width!==width||current.height!==height)pet.setBounds({x,y,width,height});
  else if(current.x!==x||current.y!==y)pet.setPosition(x,y,false);
  expanded=stage;
}

function trusted(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent):boolean{
  return event.sender===pet?.webContents||event.sender===studio?.webContents||event.sender===settingsWindow?.webContents;
}

async function updateSettings(input:unknown):Promise<{ok:boolean;settings?:Settings;error?:string}>{
  if(!store)return{ok:false,error:'设置存储尚未就绪。'};
  try{
    settings=await store.update(input);
    monitor?.setRules(settings.appRules);
    if(latestSample)applyScene(latestSample,false);
    command({type:'setting',value:settings});
    if(settingsWindow&&!settingsWindow.isDestroyed()&&!settingsWindow.webContents.isDestroyed())settingsWindow.webContents.send('clawd:command',{type:'setting',value:settings} satisfies HostCommand);
    return{ok:true,settings};
  }catch{
    return{ok:false,error:'设置无法保存。请检查本机设置目录的可用空间和写入权限。'};
  }
}

function setupIPC():void{
  ipcMain.handle('clawd:init',event=>trusted(event)?environment():null);
  ipcMain.handle('clawd:settings:update',async(event,input)=>trusted(event)?updateSettings(input):{ok:false,error:'请求来源无效。'});
  ipcMain.handle('clawd:settings:select-executable',async event=>{
    if(event.sender!==settingsWindow?.webContents)return null;
    const result=await dialog.showOpenDialog(settingsWindow,{title:'选择要添加的 Windows 应用',properties:['openFile'],filters:[{name:'Windows 应用',extensions:['exe']}]});
    return result.canceled?null:result.filePaths[0]??null;
  });
  ipcMain.handle('clawd:settings:set-startup',(event,enabled)=>{
    if(event.sender!==settingsWindow?.webContents||typeof enabled!=='boolean')return false;
    return setStartup(enabled);
  });
  ipcMain.handle('clawd:updates:check',event=>event.sender===settingsWindow?.webContents?updateChecker.check(app.getVersion()):{status:'unavailable',currentVersion:app.getVersion(),message:'请求来源无效。'});
  ipcMain.handle('clawd:updates:open-release',async event=>{
    if(event.sender!==settingsWindow?.webContents)return false;
    try{await shell.openExternal('https://github.com/LYL-Z/clawd-desktop/releases/latest');return true;}catch{return false;}
  });
  ipcMain.handle('clawd:visibility:set-user-hidden',(event,hidden)=>{
    if(!trusted(event)||typeof hidden!=='boolean')return false;
    setUserHidden(hidden);return currentVisibility().visible;
  });
  ipcMain.on('clawd:move',(event,data)=>{
    if(event.sender!==pet?.webContents||!data||typeof data.expanded!=='boolean')return;
    moveWindow(data.point,data.expanded);
  });
  ipcMain.on('clawd:interactive',(event,data)=>{
    if(event.sender!==pet?.webContents||!data||typeof data.hit!=='boolean'||typeof data.captured!=='boolean')return;
    dragging=data.captured;pet?.setIgnoreMouseEvents(!(data.hit||data.captured),{forward:true});
  });
  ipcMain.on('clawd:menu',(event,actions)=>{if(trusted(event)){menuRequests++;lastMenuWasActions=actions===true;menu(actions===true);}});
  ipcMain.on('clawd:save',(event,data)=>{if(trusted(event))void updateSettings(data);});
  ipcMain.on('clawd:ready',event=>{
    if(event.sender!==pet?.webContents)return;
    const area=environment().workArea;
    moveWindow(settings.position??{x:area.x+area.width/2,y:area.y+area.height},false);
    applyVisibility(currentVisibility());
  });
  ipcMain.on('clawd:report',(event,data)=>{
    if(!trusted(event))return;
    try{const encoded=JSON.stringify(data);if(encoded&&encoded.length<65536)lastReport=data;}catch{}
  });
}

async function launchProbe():Promise<void>{
  if(process.platform!=='win32')return;
  const probePath=path.join(__dirname.replace(/app\.asar(?=[\\/])/,'app.asar.unpacked'),'window-probe.exe');
  monitor=new ForegroundAppMonitor(probePath,sample=>applyScene(sample,!pet),healthy=>{
    probeHealthy=healthy;
    if(!healthy&&!latestSample)visibility?.setProbeState(false,'unknown',undefined);
    else if(!healthy)visibility?.setProbeState(false,'unknown',latestSample?.foregroundName??undefined);
  });
  monitor.setRules(settings.appRules);
  const healthy=await monitor.start();
  if(!healthy&&!probeHealthy)visibility?.setProbeState(false,'unknown',latestSample?.foregroundName??undefined);
}

function updateEnvironment():void{
  const env=environment();
  const key=JSON.stringify({displays:env.displays,workArea:env.workArea,systemReducedMotion:env.systemReducedMotion,scale:settings.scale});
  if(key===lastEnvironmentKey)return;
  lastEnvironmentKey=key;command({type:'environment',value:env});
  if(settingsWindow&&!settingsWindow.isDestroyed()&&!settingsWindow.webContents.isDestroyed())settingsWindow.webContents.send('clawd:command',{type:'environment',value:env} satisfies HostCommand);
}

function setupTray():void{
  const fallback=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
  const icon=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png'));
  tray=new Tray(icon.isEmpty()?fallback:icon);
  tray.setToolTip('Clawd · 右键菜单，双击找回');
  tray.on('right-click',()=>menu());
  tray.on('double-click',()=>{setUserHidden(false);recoverPosition();});
}

async function main():Promise<void>{
  store=new SettingsStore(settingsPath(),message=>console.error(message));
  settings=await store.load();
  try{manifest=JSON.parse(await readFile(path.join(__dirname,'assets','animations.json'),'utf8'));}catch{manifest=undefined;}
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')&&!details.url.startsWith('devtools:')}));
  setupIPC();
  visibility=new VisibilityController(applyVisibility);
  if(!settings.startVisible)visibility.setUserHidden(true);
  powerMonitor.on('suspend',()=>{visibility?.setSystemBlocked('suspend',true);studio?.webContents.send('clawd:command',{type:'pause-system'} satisfies HostCommand);});
  powerMonitor.on('resume',()=>{visibility?.setSystemBlocked('suspend',false);studio?.webContents.send('clawd:command',{type:'resume-system'} satisfies HostCommand);});
  powerMonitor.on('lock-screen',()=>{visibility?.setSystemBlocked('lock',true);studio?.webContents.send('clawd:command',{type:'pause-system'} satisfies HostCommand);});
  powerMonitor.on('unlock-screen',()=>{visibility?.setSystemBlocked('lock',false);studio?.webContents.send('clawd:command',{type:'resume-system'} satisfies HostCommand);});
  setupTray();
  await launchProbe();
  if(studioOnly)showStudio();else pet=createWindow('pet');
  screen.on('display-added',updateEnvironment);
  screen.on('display-removed',()=>{updateEnvironment();recoverPosition();});
  screen.on('display-metrics-changed',updateEnvironment);
  nativeTheme.on('updated',updateEnvironment);
  timers.push(setInterval(()=>{
    if(!pet||pet.isDestroyed()||!pet.isVisible()||!visibility?.snapshot.visible)return;
    const point=screen.getCursorScreenPoint();
    pet.webContents.send('clawd:cursor',point,pet.getBounds(),mouseDown);
  },32));
  timers.push(setInterval(async()=>{
    if(settings.bridge){
      let parsed=null;
      try{if((await stat(statusPath())).size<=4096)parsed=parseStatus(await readFile(statusPath(),'utf8'));}catch{}
      const key=parsed?`${parsed.eventId}:${parsed.state}`:'expired';
      if(key!==lastTaskKey){const hadTask=lastTaskKey!==''&&lastTaskKey!=='expired';lastTaskKey=key;if(parsed||hadTask)command({type:'task',value:parsed});}
    }else if(lastTaskKey){command({type:'task',value:null});lastTaskKey='';}
  },1000));
  timers.push(setInterval(updateEnvironment,5000));
  if(process.env.CLAWD_AUTOTEST){
    timers.push(setInterval(async()=>{
      await writeFile(path.join(app.getPath('userData'),'runtime-report.json'),JSON.stringify({settings,lastPoint,expanded,lastReport,menuRequests,lastMenuWasActions,processMetrics:app.getAppMetrics(),window:pet?.getBounds(),visibility:currentVisibility(),nativeProbeAvailable:probeHealthy,userDataPath:app.getPath('userData'),statusPath:statusPath(),startupExecutable:startupOptions().path},null,2));
    },1000));
  }
}

if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{
    if(studioOnly)showStudio();
    else{setUserHidden(false);recoverPosition();}
  });
  app.whenReady().then(main).catch(error=>{console.error('Clawd startup failed:',error instanceof Error?error.name:'unknown');app.quit();});
}

app.on('window-all-closed',()=>{if(studioOnly)app.quit();});
app.on('before-quit',event=>{
  if(shutdownRequested)return;
  event.preventDefault();shutdownRequested=true;
  timers.forEach(clearInterval);monitor?.stop();visibility?.destroy();
  try{tray?.destroy();}catch{}
  void store?.flush().catch(()=>{}).finally(()=>{store?.saveSync();app.quit();});
});
