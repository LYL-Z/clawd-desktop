import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClickArbiter,frameAt,lookIndex,stableLookIndex} from '../src/shared/animation';
import {autonomousActions,autonomyDelayMs,doubleClickIntent,mayAutonomouslyRoam} from '../src/shared/behaviour';
import {integrate,throwVelocity,chooseArea,recover,type Body} from '../src/shared/physics';
import {parseStatus} from '../src/shared/status';
const area={x:-1280,y:0,width:1280,height:1000};
test('throw physics lands at the work-area floor and remains recoverable',()=>{
  const body:Body={position:{x:-500,y:100},velocity:{x:1400,y:-1400},halfWidth:70,airborne:true};let landed=false;
  for(let i=0;i<600;i++){landed=integrate(body,area,1/60).landed||landed;assert.ok(body.position.x>=-1210&&body.position.x<=-70);assert.ok(body.position.y<=1000);}
  assert.ok(landed);assert.equal(body.position.y,1000);assert.equal(body.airborne,false);
});
test('reduced motion cancels a throw instead of bouncing it',()=>{const b:Body={position:{x:9999,y:-9999},velocity:{x:1200,y:-1000},halfWidth:70,airborne:true};integrate(b,area,1/60,true);assert.deepEqual(b.velocity,{x:0,y:0});assert.equal(b.position.y,1000);assert.ok(b.position.x<0);});
test('velocity uses recent samples and is capped in DIP per second',()=>{assert.deepEqual(throwVelocity([{point:{x:0,y:0},time:0},{point:{x:200,y:-400},time:100}]),{x:1400,y:-1400});assert.deepEqual(throwVelocity([{point:{x:0,y:0},time:0}]),{x:0,y:0});});
test('display choice handles negative coordinates and disconnected displays',()=>{const primary={x:0,y:0,width:1920,height:1040};assert.equal(chooseArea({x:-400,y:400},[area,primary]),area);assert.equal(chooseArea({x:-400,y:400},[primary]),primary);const b:Body={position:{x:-400,y:400},velocity:{x:5,y:5},halfWidth:70,airborne:false};recover(b,primary);assert.equal(b.position.x,70);});
test('status bridge rejects stale, oversized, malformed and future events',()=>{
  const now=Date.parse('2026-10-15T10:00:00Z');const base={schemaVersion:1,eventId:'a',state:'working',updatedAt:new Date(now).toISOString(),ttlMs:30000,detail:'x'.repeat(40)};
  assert.equal(parseStatus(JSON.stringify(base),now)?.detail.length,24);
  assert.equal(parseStatus('\uFEFF'+JSON.stringify(base),now)?.state,'working');
  assert.equal(parseStatus(JSON.stringify(base),now+30001),null);assert.equal(parseStatus('{',now),null);assert.equal(parseStatus(' '.repeat(4097),now),null);
  assert.equal(parseStatus(JSON.stringify({...base,updatedAt:new Date(now+60000).toISOString()}),now),null);assert.equal(parseStatus(JSON.stringify({...base,state:'success'}),now),null);
});
test('single and double click arbitration emits exactly one outcome',async()=>{
  const events:string[]=[];const c=new ClickArbiter(()=>events.push('single'),()=>events.push('double'),30);
  c.click(100);c.click(110);await new Promise(r=>setTimeout(r,45));assert.deepEqual(events,['double']);
  c.click(200);await new Promise(r=>setTimeout(r,45));assert.deepEqual(events,['double','single']);
  c.click(300);c.cancel();await new Promise(r=>setTimeout(r,45));assert.deepEqual(events,['double','single']);
});
test('atlas frame timing preserves holds and frame order',()=>{const d={row:0,count:3,durations:[100,200,300]};assert.equal(frameAt(d,99),0);assert.equal(frameAt(d,100),1);assert.equal(frameAt(d,300),2);assert.equal(frameAt(d,600),0);assert.equal(frameAt(d,900,false),2);});
test('look directions use up/right/down/left in screen coordinates',()=>{assert.equal(lookIndex(0,-100),0);assert.equal(lookIndex(100,0),4);assert.equal(lookIndex(0,100),8);assert.equal(lookIndex(-100,0),12);assert.equal(lookIndex(10,10),null);});
test('gaze direction hysteresis prevents flip-flopping near a sector boundary',()=>{
  const at=(degrees:number)=>({x:Math.sin(degrees*Math.PI/180)*100,y:-Math.cos(degrees*Math.PI/180)*100});
  const before=at(14),after=at(17);
  assert.equal(stableLookIndex(before.x,before.y,0),0);
  assert.equal(stableLookIndex(after.x,after.y,0),1);
  assert.equal(stableLookIndex(1,1,1),null);
});
test('quiet mode preserves manual input and low-frequency in-place actions while suppressing roaming',()=>{
  assert.equal(autonomyDelayMs('standard',false,0),20000);assert.equal(autonomyDelayMs('lively',false,1),22000);
  assert.equal(autonomyDelayMs('standard',true,0),60000);assert.equal(autonomyDelayMs('standard',true,1),90000);
  assert.equal(mayAutonomouslyRoam(true,false),true);assert.equal(mayAutonomouslyRoam(true,true),false);
  assert.deepEqual(autonomousActions(['waving','running-right','sway','skate'],true),['waving','sway']);
  assert.deepEqual(doubleClickIntent('performance'),{type:'performance',value:'agreement'});
  assert.deepEqual(doubleClickIntent('sway'),{type:'action',value:'sway'});assert.equal(doubleClickIntent('none'),null);
});
