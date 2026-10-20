import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleUpdateRequest, releaseMetadata} from '../cloudflare-updates/worker.mjs';

const digest='a'.repeat(64);
const tag='v1.2.3';
const assetName='Clawd-1.2.3-windows-x64.exe';
const release={
  tag_name:tag,
  name:'Clawd 1.2.3',
  body:'Release notes',
  published_at:'2026-10-19T00:00:00Z',
  draft:false,
  prerelease:false,
  assets:[
    {name:assetName,size:42,browser_download_url:`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/${assetName}`,digest:`sha256:${digest}`},
    {name:'SHA256SUMS.txt',size:100,browser_download_url:`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/SHA256SUMS.txt`},
  ],
};

test('deployment config binds only the isolated Clawd update hostname and worker',async()=>{
  const config=JSON.parse(await readFile(new URL('../cloudflare-updates/wrangler.jsonc',import.meta.url),'utf8'));
  const source=await readFile(new URL('../cloudflare-updates/worker.mjs',import.meta.url),'utf8');
  assert.equal(config.name,'clawd-updates');
  assert.equal(config.workers_dev,false);
  assert.deepEqual(config.routes,[{pattern:'clawd-updates.chronokalamos.com',custom_domain:true}]);
  assert.equal(config.bindings,undefined);
  assert.match(source,/clawd-updates\.chronokalamos\.com/);
});

function mockFetch({rangeResponse}={}){
  const calls=[];
  const fetcher=async(input,init={})=>{
    const url=String(input);calls.push({url,init});
    if(url.endsWith('/releases/latest')||url.endsWith(`/releases/tags/${tag}`))return new Response(JSON.stringify(release),{status:200,headers:{'content-type':'application/json'}});
    if(url.endsWith('/SHA256SUMS.txt'))return new Response(`${digest}  ${assetName}\n`,{status:200});
    if(url.endsWith(assetName))return rangeResponse??new Response('download bytes',{status:206,headers:{'content-range':'bytes 10-21/42','content-length':'12'}});
    throw new Error(`unexpected URL ${url}`);
  };
  return{fetcher,calls};
}

test('latest metadata is bounded to the matching official Windows release and checksum',async()=>{
  const {fetcher}=mockFetch();
  const metadata=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
  assert.equal(metadata.status,200);
  const body=await metadata.json();
  assert.equal(body.tag_name,tag);
  assert.equal(body.artifact.name,assetName);
  assert.equal(body.artifact.size,42);
  assert.equal(body.artifact.sha256,digest);
  assert.equal(body.artifact.download_url,`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`);
  assert.equal(body.artifact.fallback_url,release.assets[0].browser_download_url);
});

test('checksum mismatch and prerelease metadata fail closed',async()=>{
  const {fetcher}=mockFetch();
  const wrongDigest='b'.repeat(64);
  await assert.rejects(()=>releaseMetadata({...release,assets:release.assets.map(asset=>asset.name===assetName?{...asset,digest:`sha256:${wrongDigest}`}:asset)},fetcher),/checksum_mismatch/);
  const originalError=console.error;
  const logs=[];
  let response;
  console.error=(...args)=>logs.push(args);
  try{
    response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),async()=>new Response(JSON.stringify({...release,prerelease:true}),{status:200}));
  }finally{
    console.error=originalError;
  }
  assert.equal(response.status,503);
  assert.deepEqual(logs,[['clawd_update_metadata_failed',{stage:'release_lookup',code:'invalid_release'}]]);
});

test('latest metadata failures log only a bounded diagnostic code',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
    const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),async()=>{throw new Error('private-sentinel');});
    assert.equal(response.status,503);
    assert.equal((await response.text()).includes('private-sentinel'),false);
    assert.deepEqual(logs,[['clawd_update_metadata_failed',{stage:'release_lookup',code:'upstream_error'}]]);
  }finally{
    console.error=originalError;
  }
});

test('range downloads are forwarded to the exact versioned GitHub asset',async()=>{
  const {fetcher,calls}=mockFetch();
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`,{headers:{range:'bytes=10-21','if-range':'"stable-etag"'}}),fetcher);
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 10-21/42');
  assert.equal(response.headers.get('content-disposition'),`attachment; filename="${assetName}"`);
  assert.equal(calls.at(-1).init.headers.get('range'),'bytes=10-21');
  assert.equal(calls.at(-1).init.headers.get('if-range'),'"stable-etag"');
});

test('unknown paths, asset names, and methods are rejected',async()=>{
  const {fetcher,calls}=mockFetch();
  assert.equal((await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/not-found'),fetcher)).status,404);
  assert.equal((await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/other.exe`),fetcher)).status,404);
  assert.equal((await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json',{method:'POST'}),fetcher)).status,405);
  assert.equal(calls.length,0);
});
