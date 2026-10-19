import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../src/electron/services/SettingsStore';

async function withSettingsStore(run:(filePath:string)=>Promise<void>):Promise<void>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clawd-settings-'));
  try{await run(path.join(directory,'settings.json'));}
  finally{await rm(directory,{recursive:true,force:true});}
}

test('settings updates serialize, preserve existing values and atomically persist merged state',async()=>{
  await withSettingsStore(async filePath=>{
    const store=new SettingsStore(filePath);
    await store.load();
    await Promise.all([store.update({outfit:'wizard'}),store.update({roam:true}),store.update({paused:true})]);
    const saved=JSON.parse(await readFile(filePath,'utf8'));
    assert.equal(saved.outfit,'wizard');assert.equal(saved.roam,true);assert.equal(saved.paused,true);
    assert.equal(store.current.outfit,'wizard');assert.equal(store.current.paused,true);
    await store.flush();
  });
});

test('corrupt settings are backed up before safe defaults are returned',async()=>{
  await withSettingsStore(async filePath=>{
    await writeFile(filePath,'{broken','utf8');
    const diagnostics:string[]=[];
    const store=new SettingsStore(filePath,message=>diagnostics.push(message));
    const loaded=await store.load();
    assert.equal(loaded.outfit,'none');
    assert.equal(diagnostics.length,1);
    const names=await (await import('node:fs/promises')).readdir(path.dirname(filePath));
    assert.ok(names.some(name=>name.startsWith('settings.json.corrupt-')));
    assert.equal(await readFile(filePath,'utf8'),'{broken');
  });
});

test('oversized settings files are not parsed or trusted',async()=>{
  await withSettingsStore(async filePath=>{
    await writeFile(filePath,JSON.stringify({outfit:'wizard'}).padEnd(256*1024+1,' '),'utf8');
    const diagnostics:string[]=[];
    const store=new SettingsStore(filePath,message=>diagnostics.push(message));
    const loaded=await store.load();
    assert.equal(loaded.outfit,'none');assert.equal(diagnostics.length,1);
  });
});
