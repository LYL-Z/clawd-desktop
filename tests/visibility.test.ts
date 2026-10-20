import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,type AppRule} from '../src/shared/types';
import {mergeSettings,normalizeSettings} from '../src/shared/settings';
import {parseProbeSample} from '../src/shared/probe';
import {classifyScene,VisibilityController} from '../src/shared/visibility';

const game:AppRule={id:'game-1',kind:'game',match:'path',exeName:'Example.exe',exePath:'C:\\Games\\Example.exe',enabled:true};
const sample=(overrides:Partial<Parameters<typeof classifyScene>[1]>={})=>({schemaVersion:1 as const,type:'sample' as const,sequence:1,timestamp:1000,foregroundPid:12,foregroundName:'Example.exe',foregroundPath:'C:\\Games\\Example.exe',fullscreen:false,mouseDown:false,runningRuleIds:[],...overrides});
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('smart mode matches an explicitly selected executable path and not a same-name app elsewhere',()=>{
  const settings=normalizeSettings({...DEFAULTS,appRules:[game]});
  assert.deepEqual([...classifyScene(settings,sample()).automaticReasons],['game']);
  assert.equal(classifyScene(settings,sample({foregroundPath:'D:\\Tools\\Example.exe'})).automaticReasons.size,0);
});

test('name matching is used only when the user selected that rule mode',()=>{
  const settings=normalizeSettings({...DEFAULTS,appRules:[{...game,match:'name'}]});
  assert.deepEqual([...classifyScene(settings,sample({foregroundPath:'D:\\Tools\\Example.exe'})).automaticReasons],['game']);
});

test('focus rules hide only their matching foreground app in smart mode and remain visible in manual mode',()=>{
  const focus:AppRule={...game,id:'focus-1',kind:'focus',exeName:'Editor.exe',exePath:'C:\\Tools\\Editor.exe'};
  const smart=normalizeSettings({...DEFAULTS,appRules:[focus]});
  const editor=sample({foregroundName:'Editor.exe',foregroundPath:'C:\\Tools\\Editor.exe'});
  assert.deepEqual([...classifyScene(smart,editor).automaticReasons],['focus']);
  assert.equal(classifyScene(smart,sample({foregroundName:'Editor.exe',foregroundPath:'D:\\Other\\Editor.exe'})).automaticReasons.size,0);
  assert.deepEqual([...classifyScene(normalizeSettings({...smart,autoHideMode:'manual'}),editor).automaticReasons],[]);
  assert.equal(classifyScene(smart,editor).scene,'focus');
});

test('an explicit exception wins over game and fullscreen auto-hide, but cannot override lock or user state',()=>{
  const settings=normalizeSettings({...DEFAULTS,appRules:[game,{...game,id:'allow-1',kind:'exception'}]});
  assert.equal(classifyScene(settings,sample({fullscreen:true})).automaticReasons.size,0);
  const changes:unknown[]=[];const controller=new VisibilityController(state=>changes.push(state));
  controller.setUserHidden(true);controller.setSystemBlocked('lock',true);controller.setUserHidden(false);
  assert.deepEqual(controller.snapshot.reasons,['lock']);
  controller.setSystemBlocked('lock',false);assert.equal(controller.snapshot.visible,true);
  assert.ok(changes.length>=3);
});

test('a foreground exception does not defeat the explicit game-running policy',()=>{
  const settings=normalizeSettings({...DEFAULTS,autoHideMode:'game-running',appRules:[game,{...game,id:'allow-1',kind:'exception'}]});
  assert.deepEqual([...classifyScene(settings,sample({foregroundName:'allowed.exe',foregroundPath:'C:\\Tools\\allowed.exe',runningRuleIds:['game-1']})).automaticReasons],['game']);
});

test('game-running mode waits for a configured game process, independent of foreground window',()=>{
  const settings=normalizeSettings({...DEFAULTS,autoHideMode:'game-running',appRules:[game]});
  assert.equal(classifyScene(settings,sample({foregroundName:'browser.exe',foregroundPath:'C:\\Browser.exe'})).automaticReasons.size,0);
  assert.deepEqual([...classifyScene(settings,sample({foregroundName:'browser.exe',foregroundPath:'C:\\Browser.exe',runningRuleIds:['game-1']})).automaticReasons],['game']);
});

test('visibility entry and exit debounce survive repeated foreground samples',async()=>{
  const controller=new VisibilityController(()=>{});
  controller.updateAutomatic(['game'],900);
  await pause(260);controller.updateAutomatic(['game'],900);
  await pause(220);assert.equal(controller.snapshot.visible,false);
  controller.updateAutomatic([],900);await pause(480);
  assert.equal(controller.snapshot.visible,false);
  await pause(480);assert.equal(controller.snapshot.visible,true);
  controller.destroy();
});

test('manual show does not clear a game blocker and resume does not clear a separate user blocker',()=>{
  const controller=new VisibilityController(()=>{});
  controller.setUserHidden(true);controller.updateAutomatic(['game'],900,true);controller.setUserHidden(false);
  assert.deepEqual(controller.snapshot.reasons,['game']);
  controller.setUserHidden(true);controller.updateAutomatic([],900,true);
  assert.deepEqual(controller.snapshot.reasons,['user']);
  controller.destroy();
});

test('a repeated renderer crash stays hidden through later automatic and user visibility changes',()=>{
  const controller=new VisibilityController(()=>{});
  controller.setSystemBlocked('renderer',true);
  controller.updateAutomatic([],900,true);
  controller.setUserHidden(false);
  assert.equal(controller.snapshot.visible,false);
  assert.deepEqual(controller.snapshot.reasons,['renderer']);
  controller.destroy();
});

test('settings migration preserves valid v1 choices and bounds malformed new values',()=>{
  const migrated=normalizeSettings({outfit:'wizard',scale:1.25,roam:true,position:{x:-300,y:900},appRules:[game,{...game,id:'bad|id'}],restoreDelayMs:9000});
  assert.equal(migrated.outfit,'wizard');assert.equal(migrated.roam,true);assert.equal(migrated.position?.x,-300);
  assert.equal(migrated.schemaVersion,2);assert.equal(migrated.quietMode,false);assert.equal(migrated.autonomyFrequency,'standard');
  assert.equal(migrated.restoreDelayMs,5000);assert.deepEqual(migrated.appRules,[{...game,exePath:'c:\\games\\example.exe'}]);
  const patched=mergeSettings(migrated,{outfit:'invalid',scale:999,paused:true});
  assert.equal(patched.outfit,'wizard');assert.equal(patched.scale,1.25);assert.equal(patched.paused,true);
  const v2=normalizeSettings({...migrated,quietMode:true,autonomyFrequency:'calm',doubleClickAction:'sway',appRules:[{...game,id:'focus-new',kind:'focus'}]});
  assert.equal(v2.quietMode,true);assert.equal(v2.autonomyFrequency,'calm');assert.equal(v2.doubleClickAction,'sway');assert.equal(v2.appRules[0]?.kind,'focus');
});

test('oversized game-rule payloads cannot exceed the native probe protocol limit',()=>{
  const rules=Array.from({length:12},(_,index)=>({...game,id:`game-${index}`,exePath:`C:\\Games\\${'界'.repeat(3000)}-${index}.exe`}));
  const settings=normalizeSettings({...DEFAULTS,appRules:rules});
  const bytes=new TextEncoder().encode(settings.appRules.map(rule=>`${rule.id}|${rule.match}|${rule.exeName}|${rule.exePath}`).join('\n')).byteLength;
  assert.ok(settings.appRules.length<rules.length);assert.ok(bytes<=96*1024);
});

test('native probe parser accepts bounded versioned samples and rejects malformed or oversized lines',()=>{
  const valid=JSON.stringify({schemaVersion:1,type:'sample',sequence:7,timestamp:1700000000000,foregroundPid:22,foregroundName:'game.exe',foregroundPath:'C:\\Games\\game.exe',fullscreen:true,mouseDown:false,runningRuleIds:['game-1','game-1']});
  const parsed=parseProbeSample(valid);
  assert.deepEqual(parsed?.runningRuleIds,['game-1']);assert.equal(parsed?.fullscreen,true);
  assert.equal(parseProbeSample('{"schemaVersion":2}'),null);assert.equal(parseProbeSample('x'.repeat(9000)),null);
  assert.equal(parseProbeSample(JSON.stringify({schemaVersion:1,type:'sample',sequence:1,timestamp:1,foregroundPid:1,foregroundName:'x',foregroundPath:null,fullscreen:false,mouseDown:false,runningRuleIds:['not valid!']})),null);
});
