import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {beginEvidence,retainEvidence} from './qa-evidence.mjs';
import {loadElectronDriver} from './qa-support.mjs';

const electron=loadElectronDriver(),root=process.cwd(),out=path.join(root,'qa/runtime');
const userData=path.join(out,'user-data','settings-ui');
await mkdir(userData,{recursive:true});
await writeFile(path.join(userData,'settings.json'),JSON.stringify({welcomeSeen:true,bridge:false,roam:false}));
const env={...process.env,CLAWD_TEST_USER_DATA:userData,CLAWD_AUTOTEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env});
const report={startedAt:new Date().toISOString(),scope:'Real Electron main process and settings renderer. Native menu popup is suppressed after capturing the real menu template; no OS mouse/keyboard input or external files.',checks:[]};
report.evidence=await beginEvidence(root,'settings-ui',['settings-ui-qa.json','settings-general.png','settings-appearance.png','settings-behavior.png','settings-scenes.png','settings-advanced.png']);
const check=(name,details={})=>report.checks.push({name,passed:true,...details});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const pet=await app.firstWindow();await pet.waitForFunction(()=>window.clawdDebug&&window.clawd);
  await app.evaluate(({Menu})=>{
    const build=Menu.buildFromTemplate.bind(Menu),popup=Menu.prototype.popup;
    Menu.buildFromTemplate=template=>{const menu=build(template);globalThis.__clawdQaMenu=menu;return menu;};
    Menu.prototype.popup=function(){};
    globalThis.__clawdQaRestoreMenu=()=>{Menu.buildFromTemplate=build;Menu.prototype.popup=popup;};
  });
  await pet.evaluate(()=>window.clawd.menu());
  let menuItems;
  for(let attempt=0;attempt<30;attempt++){
    menuItems=await app.evaluate(()=>globalThis.__clawdQaMenu?.items?.map(item=>item.label).filter(Boolean));
    if(menuItems?.length)break;
    await sleep(100);
  }
  assert.ok(menuItems?.length,'The real tray menu was not captured.');
  assert.ok(menuItems.some(label=>label.startsWith('设置与游戏规则')));assert.ok(menuItems.includes('安静模式'));check('captured real tray template includes settings and quiet mode',{menuItems});
  await app.evaluate(()=>{const item=globalThis.__clawdQaMenu.items.find(entry=>entry.label.startsWith('设置与游戏规则'));if(typeof item?.click!=='function')throw new Error('Settings tray item has no click callback');item.click();});
  let settingsPage;
  for(let attempt=0;attempt<60&&!settingsPage;attempt++){
    settingsPage=app.windows().find(page=>page.url().includes('settings.html'));
    if(!settingsPage)await sleep(100);
  }
  assert.ok(settingsPage,'Settings window was not opened by the actual menu item');
  await settingsPage.waitForFunction(()=>document.querySelector('#page-general')&&!document.querySelector('#page-general')?.hidden);
  await settingsPage.screenshot({path:path.join(out,'settings-general.png')});
  assert.equal(await settingsPage.locator('#visibility-title').innerText(),'Clawd 正在桌边');
  check('settings window opened through the actual tray callback and rendered current scene');

  await settingsPage.locator('#tab-appearance').click();
  await settingsPage.waitForFunction(()=>!document.querySelector('#page-appearance')?.hidden);
  assert.ok(await settingsPage.locator('#outfit-grid .outfit-tile').count()>=7);
  await settingsPage.screenshot({path:path.join(out,'settings-appearance.png')});
  check('wardrobe preview rendered all available local outfits');

  await settingsPage.locator('#tab-behavior').click();
  await settingsPage.waitForFunction(()=>!document.querySelector('#page-behavior')?.hidden);
  await settingsPage.locator('[data-setting="quietMode"]').evaluate(element=>element.click());
  await settingsPage.locator('#autonomy-frequency').selectOption('calm');
  await settingsPage.locator('#double-click-action').selectOption('sway');
  await settingsPage.waitForFunction(async()=>{const value=await window.clawd.init();return value?.settings.quietMode===true&&value.settings.autonomyFrequency==='calm'&&value.settings.doubleClickAction==='sway';});
  let saved;
  for(let attempt=0;attempt<50;attempt++){
    saved=JSON.parse(await readFile(path.join(userData,'settings.json'),'utf8'));
    if(saved.doubleClickAction==='sway')break;
    await sleep(100);
  }
  assert.equal(saved.schemaVersion,2);assert.equal(saved.quietMode,true);assert.equal(saved.autonomyFrequency,'calm');assert.equal(saved.doubleClickAction,'sway');
  await settingsPage.screenshot({path:path.join(out,'settings-behavior.png')});
  check('quiet mode, autonomy frequency and double-click choice persisted through main-process settings store');

  await settingsPage.locator('#tab-scenes').click();
  await settingsPage.waitForFunction(()=>!document.querySelector('#page-scenes')?.hidden);
  assert.equal(await settingsPage.locator('[data-add-rule]').count(),3);
  assert.ok((await settingsPage.locator('#page-scenes').innerText()).includes('专注时隐藏的应用'));
  await settingsPage.screenshot({path:path.join(out,'settings-scenes.png')});
  check('scene settings expose game, focus-hide and exception rule entry points');

  const sentinel='QA_PRIVATE_RULE_DO_NOT_EXPORT';
  const result=await settingsPage.evaluate(async value=>window.clawd.updateSettings({appRules:[{id:'qa-focus-rule',kind:'focus',match:'path',exeName:'QA-Sentinel.exe',exePath:`C:\\Users\\Example\\${value}\\QA-Sentinel.exe`,enabled:true}]}),sentinel);
  assert.equal(result.ok,true);
  await settingsPage.locator('#tab-advanced').click();
  await settingsPage.waitForFunction(()=>!document.querySelector('#page-advanced')?.hidden);
  await settingsPage.locator('#preview-diagnostics').click();
  await settingsPage.waitForFunction(()=>!document.querySelector('#diagnostics-preview')?.hidden);
  const preview=await settingsPage.locator('#diagnostics-preview').innerText();
  assert.ok(preview.includes('"appRuleCount": 1'));assert.ok(!preview.includes(sentinel));assert.ok(!preview.includes('QA-Sentinel.exe'));
  assert.equal(await settingsPage.locator('#export-diagnostics').isEnabled(),true);
  await settingsPage.screenshot({path:path.join(out,'settings-advanced.png')});
  check('diagnostics preview is inspectable, excludes a sentinel rule path/name and enables deliberate export');
  await app.evaluate(()=>globalThis.__clawdQaRestoreMenu?.());
  report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack??String(error);process.exitCode=1;}
finally{
  report.endedAt=new Date().toISOString();
  try{await app.close();}catch{}
  await writeFile(path.join(out,'settings-ui-qa.json'),JSON.stringify(report,null,2));
  await retainEvidence(root,report.evidence,report);
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(entry=>entry.name),failure:report.failure},null,2));
}
