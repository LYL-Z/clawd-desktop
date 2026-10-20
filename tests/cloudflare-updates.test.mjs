import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker, {handleUpdateRequest, releaseMetadata} from '../cloudflare-updates/worker.mjs';

const digest='a'.repeat(64);
const tag='v1.2.3';
const version='1.2.3';
const assetName=`Clawd-${version}-windows-x64.exe`;
const manifest={
  schemaVersion:1,
  product:'Clawd Desktop',
  version,
  platform:'Windows x64',
  sourceCommit:'b'.repeat(40),
  generatedAt:'2026-10-19T00:00:00.000Z',
  artifacts:[{file:assetName,bytes:42,sha256:digest}],
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

function mockFetch({rangeResponse,latestLocation=`https://github.com/LYL-Z/clawd-desktop/releases/tag/${tag}`,manifestValue=manifest,sumsText=`${digest}  ${assetName}\n`,notesText='## Changes\nRelease notes'}={}){
  const calls=[];
  const fetcher=async(input,init={})=>{
    const url=String(input);calls.push({url,init});
    if(url==='https://github.com/LYL-Z/clawd-desktop/releases/latest')return new Response(null,{status:302,headers:{location:latestLocation}});
    if(url.endsWith(`/release-manifest-${tag}.json`))return new Response(JSON.stringify(manifestValue),{status:200,headers:{'content-type':'application/json'}});
    if(url.endsWith(`/SHA256SUMS.txt`))return new Response(sumsText,{status:200});
    if(url.endsWith(assetName))return rangeResponse??new Response('download bytes',{status:206,headers:{'content-range':'bytes 10-21/42','content-length':'12'}});
    if(url===`https://raw.githubusercontent.com/LYL-Z/clawd-desktop/${tag}/docs/RELEASE-NOTES-v${version}.md`)return new Response(notesText,{status:200});
    throw new Error(`unexpected URL ${url}`);
  };
  return{fetcher,calls};
}

test('module worker entrypoint uses platform fetch instead of treating runtime env as a fetcher',async()=>{
  const {fetcher}=mockFetch();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=fetcher;
  try{
    const response=await worker.fetch(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),{runtimeEnv:'not a fetch function'},{});
    assert.equal(response.status,200);
    assert.equal((await response.json()).tag_name,tag);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('latest metadata is resolved from the fixed release redirect and verified manifest',async()=>{
  const {fetcher,calls}=mockFetch();
  const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.tag_name,tag);
  assert.equal(body.artifact.name,assetName);
  assert.equal(body.artifact.size,42);
  assert.equal(body.artifact.sha256,digest);
  assert.equal(body.artifact.download_url,`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`);
  assert.equal(body.artifact.fallback_url,`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/${assetName}`);
  assert.equal(body.body,'## Changes\nRelease notes');
  assert.equal(body.source_commit,'b'.repeat(40));
  assert.equal(body.generated_at,manifest.generatedAt);
  assert.equal(calls.some(call=>call.url.includes('api.github.com')),false);
});

test('latest redirect is restricted to this repository and a stable semantic version',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
  const badHost=mockFetch({latestLocation:'https://attacker.example/LYL-Z/clawd-desktop/releases/tag/v1.2.3'});
  const denied=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),badHost.fetcher);
  assert.equal(denied.status,503);
  assert.equal(badHost.calls.length,1);

  const prerelease=mockFetch({latestLocation:'https://github.com/LYL-Z/clawd-desktop/releases/tag/v1.2.3-rc.1'});
  const rejected=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),prerelease.fetcher);
  assert.equal(rejected.status,503);
  assert.equal(prerelease.calls.length,1);
  assert.equal(logs.length,2);
  }finally{
    console.error=originalError;
  }
});

test('manifest and executable redirects cannot escape trusted GitHub hosts',async()=>{
  const manifestSource=mockFetch();
  const manifestFetcher=async(input,init={})=>{
    if(String(input).endsWith(`/release-manifest-${tag}.json`))return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}});
    return manifestSource.fetcher(input,init);
  };
  await assert.rejects(()=>releaseMetadata(tag,manifestFetcher),/manifest_unavailable/);
  assert.equal(manifestSource.calls.some(call=>call.url.includes('127.0.0.1')),false);

  const downloadSource=mockFetch();
  const downloadFetcher=async(input,init={})=>{
    if(String(input).endsWith(assetName))return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});
    return downloadSource.fetcher(input,init);
  };
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`),downloadFetcher);
  assert.equal(response.status,502);
  assert.equal(downloadSource.calls.some(call=>call.url.includes('127.0.0.1')),false);
});

test('manifest and checksum disagreement fail closed',async()=>{
  const wrongDigest='c'.repeat(64);
  const {fetcher}=mockFetch({manifestValue:{...manifest,artifacts:[{...manifest.artifacts[0],sha256:wrongDigest}]}});
  await assert.rejects(()=>releaseMetadata(tag,fetcher),/checksum_mismatch/);
  const duplicate=mockFetch({sumsText:`${digest}  ${assetName}\n${digest}  ${assetName}\n`});
  await assert.rejects(()=>releaseMetadata(tag,duplicate.fetcher),/checksum_invalid/);
});

test('metadata failures never log raw exception messages or credentials',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
    const unsafeMessage=String.raw`failed Authorization: Bearer BEARER_SECRET api_token=API_SECRET client_secret=CLIENT_SECRET api_key=API_KEY_SECRET`;
    const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),async()=>{throw Object.assign(new Error(unsafeMessage),{cause:{code:'ECONNRESET'}});});
    assert.equal(response.status,503);
    const responseBody=await response.text();
    for(const secret of ['BEARER_SECRET','API_SECRET','CLIENT_SECRET','API_KEY_SECRET'])assert.equal(responseBody.includes(secret),false);
    assert.deepEqual(logs,[['clawd_update_metadata_failed',{stage:'release_lookup',code:'release_unavailable',errorName:'Error'}]]);
    assert.equal(JSON.stringify(logs).includes(unsafeMessage),false);
  }finally{
    console.error=originalError;
  }
});

test('range downloads are forwarded to the exact manifest-verified versioned asset',async()=>{
  const {fetcher,calls}=mockFetch();
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`,{headers:{range:'bytes=10-21','if-range':'"stable-etag"'}}),fetcher);
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 10-21/42');
  assert.equal(response.headers.get('content-disposition'),`attachment; filename="${assetName}"`);
  assert.equal(calls.at(-1).url,`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/${assetName}`);
  assert.equal(calls.at(-1).init.headers.get('range'),'bytes=10-21');
  assert.equal(calls.at(-1).init.headers.get('if-range'),'"stable-etag"');
});

test('HEAD uses the verified metadata without returning a body',async()=>{
  const {fetcher}=mockFetch();
  const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json',{method:'HEAD'}),fetcher);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'');
});

test('unknown paths, asset names, and methods are rejected',async()=>{
  const {fetcher,calls}=mockFetch();
  assert.equal((await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/not-found'),fetcher)).status,404);
  assert.equal((await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/other.exe`),fetcher)).status,404);
  assert.equal((await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json',{method:'POST'}),fetcher)).status,405);
  assert.equal(calls.length,0);
});
