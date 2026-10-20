import {Assets} from './assets';
import {frameAt,durationOf} from '../shared/animation';
import {OUTFITS,type AppRule,type ClawdBridge,type Environment,type HostCommand,type Settings,type UpdateCheckResult,type UpdateDownloadProgress,type VisibilitySnapshot} from '../shared/types';

declare global{interface Window{clawd:ClawdBridge;}}

const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const text=(selector:string,value:string)=>{$(selector).textContent=value;};
const toast=(message:string)=>{
  const element=$<HTMLDivElement>('#toast');element.textContent=message;element.classList.add('visible');
  window.setTimeout(()=>element.classList.remove('visible'),2600);
};

let environment:Environment;
let settings:Settings;
let visibility:VisibilitySnapshot={visible:true,reasons:[],scene:'unknown',probeHealthy:false};
let assets:Assets|undefined;
let manifest:NonNullable<Environment['manifest']>|undefined;
let previewStart=performance.now();
let frameRequest=0;
let saveQueue:Promise<void>=Promise.resolve();

function setPage(name:string):void{
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button=>{
    const active=button.dataset.page===name;
    button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  });
  document.querySelectorAll<HTMLElement>('.page').forEach(page=>{
    const active=page.id===`page-${name}`;page.classList.toggle('active',active);page.hidden=!active;
  });
}

function describeVisibility():void{
  const pill=$<HTMLDivElement>('#scene-pill');
  const title=$<HTMLSpanElement>('#scene-pill span');
  const button=$<HTMLButtonElement>('#show-pet');
  pill.classList.toggle('hidden',!visibility.visible);
  pill.classList.toggle('unknown',!visibility.probeHealthy);
  const reasons:Record<string,string>={game:'游戏进行中',focus:'专注应用',fullscreen:'全屏应用',user:'你手动隐藏',lock:'Windows 锁屏',suspend:'系统挂起',renderer:'显示进程异常'};
  const why=visibility.reasons.map(reason=>reasons[reason]??reason).join('、');
  title.textContent=visibility.visible?(visibility.probeHealthy?'桌面陪伴中':'桌面陪伴中 · 场景检测不可用'):`因${why||'系统场景'}隐藏`;
  text('#visibility-title',visibility.visible?'Clawd 正在桌边':'Clawd 已暂时退场');
  text('#visibility-detail',visibility.visible
    ?visibility.probeHealthy?`当前场景：${sceneName(visibility.scene)}。离开触发隐藏的应用或全屏场景后会自动恢复。`:'场景探针不可用；当前没有可靠的自动隐藏判断。'
    :`触发原因：${why||'未知'}。你可以从托盘检查当前场景或调整规则。`);
  const tag=$<HTMLSpanElement>('#visibility-tag');tag.textContent=visibility.visible?'在线':'已隐藏';tag.classList.toggle('hidden',!visibility.visible);
  const manuallyHidden=visibility.reasons.includes('user');
  const blockedByScene=visibility.reasons.some(reason=>reason!=='user');
  button.textContent=visibility.visible?'隐藏 Clawd':manuallyHidden&&!blockedByScene?'显示 Clawd':'场景隐藏中';
  button.disabled=!visibility.visible&&(!manuallyHidden||blockedByScene);
  button.setAttribute('aria-label',visibility.visible?'手动隐藏 Clawd':manuallyHidden&&!blockedByScene?'显示 Clawd':'Clawd 正在由场景规则隐藏');
}

function sceneName(scene:VisibilitySnapshot['scene']):string{
  return({desktop:'普通桌面',game:'已配置的游戏',focus:'专注应用',fullscreen:'全屏应用',unknown:'未能识别'})[scene];
}

function updateSettingsControls():void{
  if(!settings)return;
  $<HTMLInputElement>('#start-visible').checked=settings.startVisible;
  $<HTMLInputElement>('#scale').value=String(settings.scale);
  text('#scale-value',`${Math.round(settings.scale*100)}%`);
  $<HTMLInputElement>('#hide-fullscreen').checked=settings.hideFullscreen;
  $<HTMLInputElement>('#restore-delay').value=String(settings.restoreDelayMs);
  text('#restore-delay-value',`${(settings.restoreDelayMs/1000).toFixed(1)} 秒`);
  document.querySelectorAll<HTMLInputElement>('input[name="hide-mode"]').forEach(input=>input.checked=input.value===settings.autoHideMode);
  $<HTMLSelectElement>('#autonomy-frequency').value=settings.autonomyFrequency;
  $<HTMLSelectElement>('#double-click-action').value=settings.doubleClickAction;
  document.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input=>{
    const key=input.dataset.setting as keyof Settings|undefined;if(!key)return;
    input.checked=Boolean(settings[key]);
  });
  updateOutfitCards();
  renderRules();
  updatePreviewCaption();
}

function updateOutfitCards():void{
  const grid=$<HTMLDivElement>('#outfit-grid');grid.replaceChildren();
  const available=OUTFITS.filter(outfit=>outfit.id==='none'||Boolean(manifest?.outfits?.[outfit.id]&&!manifest.outfits[outfit.id]?.hidden));
  for(const outfit of available){
    const button=document.createElement('button');button.type='button';button.className='outfit-tile';button.setAttribute('aria-pressed',String(settings.outfit===outfit.id));
    const color=document.createElement('span');color.className=`outfit-swatch swatch-${outfit.id}`;color.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent=outfit.label;button.append(color,label);
    button.onclick=()=>{void save({outfit:outfit.id});};grid.append(button);
  }
  text('#outfit-caption',available.find(outfit=>outfit.id===settings.outfit)?.label??'基础造型');
}

function updatePreviewCaption():void{
  const label=OUTFITS.find(outfit=>outfit.id===settings.outfit)?.label??'Clawd';
  text('#preview-caption',`${label} · 待机预览`);
}

function renderUpdateResult(result:UpdateCheckResult):void{
  const status=$<HTMLDivElement>('#update-result'),notes=$<HTMLPreElement>('#release-notes'),open=$<HTMLButtonElement>('#open-release'),download=$<HTMLButtonElement>('#download-update'),show=$<HTMLButtonElement>('#show-downloaded'),bar=$<HTMLProgressElement>('#update-progress'),label=$<HTMLDivElement>('#update-progress-label');
  notes.hidden=true;notes.textContent='';download.hidden=true;show.hidden=true;bar.hidden=true;bar.value=0;label.hidden=true;
  if(result.status==='unavailable'){
    status.textContent=result.message;status.className='update-result warning';open.hidden=false;open.textContent='查看 Release 页面';return;
  }
  const date=result.publishedAt?new Date(result.publishedAt).toLocaleDateString():'日期未知';
  if(result.status==='available')status.textContent=`发现新版本 ${result.latestVersion} · ${result.releaseName} · 发布于 ${date}`;
  else if(result.status==='ahead')status.textContent=`本机版本 ${result.currentVersion} 高于最新公开正式版 ${result.latestVersion}；这可能是尚未发布的构建。`;
  else status.textContent=`当前已是最新公开正式版 ${result.latestVersion}。`;
  status.className=`update-result ${result.status}`;
  if(result.releaseNotes){notes.textContent=result.releaseNotes;notes.hidden=false;}
  open.hidden=false;open.textContent=result.status==='available'?'GitHub 备用下载页':'查看 Release 页面';
  download.hidden=result.status!=='available';
}

function renderDownloadProgress(progress:UpdateDownloadProgress):void{
  const bar=$<HTMLProgressElement>('#update-progress'),label=$<HTMLDivElement>('#update-progress-label'),status=$<HTMLDivElement>('#update-result');
  const percent=progress.totalBytes>0?Math.min(100,Math.floor(progress.completedBytes/progress.totalBytes*100)):0;
  bar.value=percent;bar.hidden=false;label.hidden=false;
  const source=progress.source==='edge'?'Clawd 边缘入口':'GitHub 备用源';
  const received=(progress.completedBytes/1024/1024).toFixed(1),total=(progress.totalBytes/1024/1024).toFixed(1);
  label.textContent=`${source} · ${received} / ${total} MiB · ${percent}%`;
  status.textContent='正在下载更新；可以取消后稍后从已下载位置继续。';status.className='update-result';
}

function drawPreview(now:number):void{
  const canvas=$<HTMLCanvasElement>('#outfit-preview'),context=canvas.getContext('2d');
  if(!context){frameRequest=requestAnimationFrame(drawPreview);return;}
  const dpr=window.devicePixelRatio||1;
  const width=canvas.clientWidth||240,height=canvas.clientHeight||250;
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,width,height);
  if(assets&&manifest){
    const action=assets.definition('idle',settings.outfit)?'idle':'waving';
    const def=assets.definition(action,settings.outfit)??manifest.animations.idle;
    const phase=now-previewStart,frame=frameAt(def!,phase,def!.loop!==false);
    assets.draw(context,action,frame,width/2,height-22,1,settings.outfit,null,phase%durationOf(def!));
  }
  frameRequest=requestAnimationFrame(drawPreview);
}

function renderRules():void{
  const list=$<HTMLDivElement>('#rule-list');list.replaceChildren();
  if(settings.appRules.length===0){
    const empty=document.createElement('div');empty.className='empty-rules';empty.innerHTML='<span>⌁</span><strong>还没有应用规则</strong><p>添加游戏 EXE 后，Clawd 才会按游戏规则自动隐藏。</p>';list.append(empty);return;
  }
  for(const rule of settings.appRules){
    const card=document.createElement('article');card.className='rule-card';
    const copy=document.createElement('div');copy.className='rule-copy';
    const heading=document.createElement('div');heading.className='rule-title';
    const badge=document.createElement('span');badge.className=`rule-badge ${rule.kind}`;badge.textContent=rule.kind==='game'?'游戏':rule.kind==='focus'?'专注隐藏':'例外';
    const name=document.createElement('strong');name.textContent=rule.exeName;
    heading.append(badge,name);
    const pathLabel=document.createElement('code');pathLabel.textContent=rule.exePath;
    copy.append(heading,pathLabel);
    const controls=document.createElement('div');controls.className='rule-controls';
    const enabled=document.createElement('label');enabled.className='mini-switch';
    const enabledInput=document.createElement('input');enabledInput.type='checkbox';enabledInput.checked=rule.enabled;enabledInput.setAttribute('aria-label',`启用规则：${rule.exeName}`);
    enabledInput.onchange=()=>replaceRule(rule,{enabled:enabledInput.checked});
    const switchTrack=document.createElement('span');switchTrack.setAttribute('aria-hidden','true');enabled.append(enabledInput,switchTrack);
    const match=document.createElement('select');match.className='match-select';match.setAttribute('aria-label',`匹配方式：${rule.exeName}`);
    for(const [value,label] of [['path','完整路径'],['name','文件名']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;match.append(option);}
    match.value=rule.match;match.onchange=()=>replaceRule(rule,{match:match.value as AppRule['match']});
    const remove=document.createElement('button');remove.type='button';remove.className='remove-rule';remove.textContent='移除';remove.setAttribute('aria-label',`移除规则：${rule.exeName}`);remove.onclick=()=>{void save({appRules:settings.appRules.filter(entry=>entry.id!==rule.id)});};
    controls.append(enabled,match,remove);card.append(copy,controls);list.append(card);
  }
}

function replaceRule(rule:AppRule,patch:Partial<AppRule>):void{
  const appRules=settings.appRules.map(entry=>entry.id===rule.id?{...entry,...patch}:entry);
  void save({appRules});
}

async function addRule(kind:AppRule['kind']):Promise<void>{
  const chosen=await window.clawd.selectExecutable();if(!chosen)return;
  const exeName=chosen.split(/[\\/]/).pop()??'';
  const canonical=chosen.replaceAll('/','\\').toLocaleLowerCase('en-US');
  if(settings.appRules.some(rule=>rule.kind===kind&&rule.exePath===canonical)){toast('这条规则已经存在。');return;}
  const rule:AppRule={id:crypto.randomUUID().replaceAll('-',''),kind,match:'path',exeName,exePath:canonical,enabled:true};
  await save({appRules:[...settings.appRules,rule]});
}

async function save(patch:Partial<Settings>):Promise<boolean>{
  let succeeded=false;
  const task=saveQueue.then(async()=>{
    const result=await window.clawd.updateSettings(patch);
    if(!result.ok||!result.settings){toast(result.error??'设置没有保存。');return;}
    settings=result.settings;updateSettingsControls();
    const key=Object.keys(patch)[0]??'';
    const messages:Record<string,string>={appRules:'应用规则已保存到本机。',outfit:'造型已更换。',scale:'桌面尺寸已更新。',autoHideMode:'自动隐藏模式已更新。',hideFullscreen:'全屏规则已更新。',restoreDelayMs:'恢复延迟已更新。'};
    toast(messages[key]??'更改已保存。');succeeded=true;
  }).catch(()=>{toast('设置无法保存。请检查本机设置目录的可用空间和写入权限。');});
  saveQueue=task.then(()=>undefined,()=>undefined);
  await task;return succeeded;
}

function bindControls():void{
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button,index,buttons)=>{
    button.onclick=()=>setPage(button.dataset.page??'general');
    button.onkeydown=event=>{
      if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
      event.preventDefault();const delta=event.key==='ArrowDown'?1:-1;const next=buttons[(index+delta+buttons.length)%buttons.length];if(next){next.focus();next.click();}
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-add-rule]').forEach(button=>button.onclick=()=>void addRule(button.dataset.addRule as AppRule['kind']));
  $<HTMLButtonElement>('#show-pet').onclick=async()=>{
    const manuallyHidden=visibility.reasons.includes('user');
    const shown=await window.clawd.setUserHidden(!manuallyHidden);
    if(!shown&&!manuallyHidden)toast('Clawd 正在遵循游戏或系统场景规则隐藏。');
  };
  $<HTMLButtonElement>('#preview-diagnostics').onclick=async event=>{
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;button.textContent='正在读取…';
    try{
      const preview=await window.clawd.getDiagnosticsPreview();
      if(!preview){toast('暂时无法读取本地诊断信息。');return;}
      $<HTMLPreElement>('#diagnostics-preview').textContent=preview;$<HTMLPreElement>('#diagnostics-preview').hidden=false;
      $<HTMLButtonElement>('#export-diagnostics').disabled=false;button.textContent='刷新预览';
    }catch{toast('读取本地诊断信息失败。');}
    finally{button.disabled=false;}
  };
  $<HTMLButtonElement>('#export-diagnostics').onclick=async event=>{
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
    try{const result=await window.clawd.exportDiagnostics();if(result.ok)toast('诊断信息已保存到你选择的位置。');else if(!result.cancelled)toast(result.message??'无法导出诊断信息。');}
    catch{toast('无法导出诊断信息。');}
    finally{button.disabled=false;}
  };
  $<HTMLInputElement>('#startup').onchange=async event=>{
    const input=event.currentTarget as HTMLInputElement;
    const result=await window.clawd.setStartup(input.checked);
    if(!result){input.checked=Boolean(environment.startupEnabled);toast('此运行方式无法更改 Windows 登录启动项。');return;}
    environment.startupEnabled=input.checked;toast(input.checked?'已启用登录启动。':'已关闭登录启动。');
  };
  $<HTMLButtonElement>('#check-updates').onclick=async event=>{
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;button.textContent='正在查询…';
    $<HTMLButtonElement>('#download-update').hidden=true;$<HTMLButtonElement>('#show-downloaded').hidden=true;
    try{renderUpdateResult(await window.clawd.checkForUpdates());}
    catch{const status=$<HTMLDivElement>('#update-result');status.textContent='暂时无法检查版本，请稍后重试。';status.className='update-result warning';}
    finally{button.disabled=false;button.textContent='重新检查';}
  };
  $<HTMLButtonElement>('#download-update').onclick=async event=>{
    const button=event.currentTarget as HTMLButtonElement,cancel=$<HTMLButtonElement>('#cancel-update'),show=$<HTMLButtonElement>('#show-downloaded'),bar=$<HTMLProgressElement>('#update-progress'),label=$<HTMLDivElement>('#update-progress-label'),check=$<HTMLButtonElement>('#check-updates');
    button.disabled=true;check.disabled=true;cancel.hidden=false;bar.value=0;bar.hidden=false;label.textContent='正在连接更新源…';label.hidden=false;
    try{
      const result=await window.clawd.downloadUpdate();
      if(result.ok){
        $<HTMLDivElement>('#update-result').textContent='下载完成，SHA-256 校验通过。请关闭 Clawd 后手动运行新文件完成更新。';
        $<HTMLDivElement>('#update-result').className='update-result current';label.textContent=`已保存：${result.filePath}`;bar.value=100;show.hidden=false;
      }else{
        $<HTMLDivElement>('#update-result').textContent=result.message;$<HTMLDivElement>('#update-result').className='update-result warning';
      }
    }catch{
      $<HTMLDivElement>('#update-result').textContent='更新下载失败；已下载部分会保留，可稍后重试。';$<HTMLDivElement>('#update-result').className='update-result warning';
    }finally{button.disabled=false;check.disabled=false;cancel.hidden=true;}
  };
  $<HTMLButtonElement>('#cancel-update').onclick=async()=>{await window.clawd.cancelUpdateDownload();};
  $<HTMLButtonElement>('#show-downloaded').onclick=async()=>{const opened=await window.clawd.showDownloadedUpdate();if(!opened)toast('找不到已校验的更新文件，请重新检查版本。');};
  window.clawd.onUpdateDownloadProgress(renderDownloadProgress);
  $<HTMLButtonElement>('#open-release').onclick=async()=>{
    const opened=await window.clawd.openReleasePage();toast(opened?'已在浏览器打开 GitHub Release 页面。':'无法打开浏览器，请稍后重试。');
  };
  $<HTMLInputElement>('#start-visible').onchange=event=>void save({startVisible:(event.currentTarget as HTMLInputElement).checked});
  document.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input=>input.onchange=()=>void save({[input.dataset.setting!]:input.checked}));
  $<HTMLSelectElement>('#autonomy-frequency').onchange=event=>void save({autonomyFrequency:(event.currentTarget as HTMLSelectElement).value as Settings['autonomyFrequency']});
  $<HTMLSelectElement>('#double-click-action').onchange=event=>void save({doubleClickAction:(event.currentTarget as HTMLSelectElement).value as Settings['doubleClickAction']});
  document.querySelectorAll<HTMLInputElement>('input[name="hide-mode"]').forEach(input=>input.onchange=()=>{if(input.checked)void save({autoHideMode:input.value as Settings['autoHideMode']});});
  $<HTMLInputElement>('#hide-fullscreen').onchange=event=>void save({hideFullscreen:(event.currentTarget as HTMLInputElement).checked});
  const scale=$<HTMLInputElement>('#scale');
  scale.oninput=()=>text('#scale-value',`${Math.round(Number(scale.value)*100)}%`);
  scale.onchange=()=>void save({scale:Number(scale.value)});
  const delay=$<HTMLInputElement>('#restore-delay');
  delay.oninput=()=>text('#restore-delay-value',`${(Number(delay.value)/1000).toFixed(1)} 秒`);
  delay.onchange=()=>void save({restoreDelayMs:Number(delay.value)});
  window.clawd.onCommand((command:HostCommand)=>{
    if(command.type==='visibility'&&command.value&&typeof command.value==='object'){
      visibility=command.value as VisibilitySnapshot;describeVisibility();
    }
    if(command.type==='setting'&&command.value&&typeof command.value==='object'){
      settings={...settings,...command.value as Partial<Settings>};updateSettingsControls();
    }
    if(command.type==='environment'&&command.value&&typeof command.value==='object'){
      const update=command.value as Environment;environment=update;settings=update.settings;visibility=update.visibility??visibility;describeVisibility();updateSettingsControls();
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){cancelAnimationFrame(frameRequest);frameRequest=0;}
    else if(!frameRequest)frameRequest=requestAnimationFrame(drawPreview);
  });
}

async function boot():Promise<void>{
  const loaded=await window.clawd.init();
  if(!loaded)throw new Error('无法连接 Clawd 主进程。');
  environment=loaded;settings=loaded.settings;visibility=loaded.visibility??visibility;manifest=loaded.manifest;
  text('#version-line',`版本 ${loaded.version} · Windows 桌面版`);
  $<HTMLInputElement>('#startup').checked=Boolean(loaded.startupEnabled);
  $<HTMLInputElement>('#startup').disabled=!loaded.packaged;
  updateSettingsControls();describeVisibility();bindControls();
  if(manifest){assets=new Assets(manifest);await assets.load();}
  cancelAnimationFrame(frameRequest);frameRequest=requestAnimationFrame(drawPreview);
}

void boot().catch(error=>{toast(error instanceof Error?error.message:'设置窗口初始化失败。');text('#visibility-detail','Clawd 设置暂时无法载入，请重新打开设置窗口。');});
