import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UpdateDownloader} from '../src/electron/services/UpdateDownloader.ts';

const bytes=Buffer.from('Clawd update payload with enough bytes to verify safe continuation.');
const sha256=createHash('sha256').update(bytes).digest('hex');
const fileName='Clawd-1.2.3-windows-x64.exe';
const artifact={fileName,size:bytes.length,sha256,sources:[
  {kind:'edge',url:`https://clawd-updates.chronokalamos.com/v1/download/v1.2.3/${fileName}`},
  {kind:'github',url:`https://github.com/LYL-Z/clawd-desktop/releases/download/v1.2.3/${fileName}`},
]};

function responseFor(data,start,total){
  const response=Readable.from([data]);
  response.statusCode=206;
  response.headers={'content-range':`bytes ${start}-${start+data.length-1}/${total}`,'content-length':String(data.length)};
  return{response,cancel:()=>response.destroy(new Error('cancelled'))};
}

async function tempDirectory(){return mkdtemp(path.join(os.tmpdir(),'clawd-update-'));}

test('resumes from a partial file and verifies the assembled SHA-256 before exposing it',async t=>{
  const root=await tempDirectory();t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'1.2.3');await mkdir(dir,{recursive:true});
  const partial=path.join(dir,`${fileName}.part`);await writeFile(partial,bytes.subarray(0,11));
  const requests=[];
  const downloader=new UpdateDownloader(root,async(source,start,end)=>{
    requests.push({source:source.kind,start,end});
    return responseFor(bytes.subarray(start,end+1),start,bytes.length);
  });
  const result=await downloader.download(artifact,()=>{});
  assert.equal(result.ok,true);
  assert.deepEqual(requests,[{source:'edge',start:11,end:bytes.length-1}]);
  if(result.ok){assert.equal(await readFile(result.filePath,'utf8'),bytes.toString('utf8'));assert.equal(result.sha256,sha256);}
});

test('rejects bad edge bytes, retries the GitHub mirror, and only keeps the verified file',async t=>{
  const root=await tempDirectory();t.after(()=>rm(root,{recursive:true,force:true}));
  const requests=[];
  const downloader=new UpdateDownloader(root,async(source,start,end)=>{
    requests.push(source.kind);
    const payload=source.kind==='edge'?Buffer.from('x'.repeat(bytes.length)):bytes;
    return responseFor(payload.subarray(start,end+1),start,bytes.length);
  });
  const result=await downloader.download(artifact,()=>{});
  assert.equal(result.ok,true);
  assert.deepEqual(requests,['edge','github']);
  if(result.ok)assert.equal((await readFile(result.filePath)).compare(bytes),0);
});

test('cancels without deleting resumable partial data',async t=>{
  const root=await tempDirectory();t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'1.2.3');await mkdir(dir,{recursive:true});
  const partial=path.join(dir,`${fileName}.part`);await writeFile(partial,bytes.subarray(0,11));
  let signalCancel=false,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const downloader=new UpdateDownloader(root,async(source,start,end,signal)=>{
    const response=Object.assign(new Readable({read(){}}),{statusCode:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`}});
    signal.addEventListener('abort',()=>{signalCancel=true;response.destroy(new Error('cancelled'));},{once:true});
    started();
    return{response,cancel:()=>response.destroy(new Error('cancelled'))};
  });
  const promise=downloader.download(artifact,()=>{});
  await waiting;
  downloader.cancel();
  const result=await promise;
  assert.equal(result.ok,false);
  assert.equal(signalCancel,true);
  assert.equal(result.cancelled,true);
  assert.deepEqual(await readFile(partial),bytes.subarray(0,11));
});
