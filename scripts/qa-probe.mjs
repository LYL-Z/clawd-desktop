import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {parseProbeSample} from '../src/shared/probe.ts';

if(process.platform!=='win32')throw new Error('The native foreground probe smoke test requires Windows.');
const executable=path.resolve(process.argv[2]??'app/window-probe.exe');
await access(executable);
const child=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const ruleId='qa-node-exact-path';
const rule=Buffer.from(`${ruleId}|path|node.exe|${process.execPath}`,'utf8').toString('base64');
child.stdin.write(`rules:${rule}\n`);
const lines=[];let buffer='';let stderrBytes=0;let done=false;let ruleMatched=false;let failure;
child.stderr.on('data',chunk=>{stderrBytes=Math.min(1000000,stderrBytes+chunk.length);});
child.stdout.on('data',chunk=>{
  buffer+=chunk.toString('utf8');
  if(buffer.length>8192&&!buffer.includes('\n')){child.kill();return;}
  const complete=buffer.split('\n');buffer=complete.pop()??'';
  for(const line of complete){
    const sample=parseProbeSample(line.trim());
    if(!sample){failure=new Error('Native probe emitted an invalid sample.');child.kill();return;}
    lines.push(sample);
    if(sample.runningRuleIds.includes(ruleId))ruleMatched=true;
    if(ruleMatched&&lines.length>=4){done=true;child.kill();}
  }
});
const result=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Native probe did not match the QA Node process by exact path within 5 seconds.'));},5000);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',(code,signal)=>{
    clearTimeout(timeout);
    if(done&&!failure)resolve({code,signal});
    else if(failure)reject(failure);
    else reject(new Error(`Native probe exited before the smoke test completed (code=${code}, signal=${signal}).`));
  });
});
assert.ok(lines.length>=4,'Expected continuing native probe samples while the one-second game scan completed.');
for(let i=1;i<lines.length;i++)assert.ok(lines[i].sequence>lines[i-1].sequence&&lines[i].timestamp>=lines[i-1].timestamp);
assert.ok(lines.at(-1)?.runningRuleIds.includes(ruleId),'Native probe did not report the exact-path QA process rule.');
console.log(JSON.stringify({passed:true,samples:lines.length,exactPathRuleMatched:true,foregroundName:lines.at(-1)?.foregroundName??null,stderrBytes,exit:result},null,2));
