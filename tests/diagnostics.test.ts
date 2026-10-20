import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalDiagnostics} from '../src/electron/services/LocalDiagnostics';

test('diagnostic log is local, bounded, parseable, and redacts absolute paths',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clawd-diagnostics-')),file=path.join(root,'logs','clawd.jsonl');
  try{
    const log=new LocalDiagnostics(file);
    await Promise.all(Array.from({length:8},(_,index)=>log.record('visibility',{visible:index%2===0,scene:'desktop',path:'C:\\Users\\Private\\game.exe'})));
    const entries=await log.recentEntries(8),raw=await readFile(file,'utf8');
    assert.equal(entries.length,8);assert.ok(raw.includes('[path]'));assert.ok(!raw.includes('Private'));
    assert.ok((await stat(file)).size<256*1024);
    await log.record('invalid event name',{data:'ignored'});
    assert.equal((await log.recentEntries()).length,8);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('diagnostic log rotates instead of growing without a bound',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clawd-diagnostics-')),file=path.join(root,'clawd.jsonl');
  try{
    const log=new LocalDiagnostics(file);
    for(let index=0;index<1800;index++)await log.record('probe-health',{healthy:index%2===0,reason:'x'.repeat(100)});
    assert.ok((await stat(file)).size<=256*1024);assert.ok((await stat(`${file}.1`)).size>0);
    assert.ok((await log.recentEntries(100)).length<=100);
  }finally{await rm(root,{recursive:true,force:true});}
});
