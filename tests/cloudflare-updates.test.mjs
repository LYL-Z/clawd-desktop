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
const apiBase='https://api.github.com/repos/LYL-Z/clawd-desktop';
const executableAssetId=101;
const manifestAssetId=202;
const manifestAssetName=`release-manifest-${tag}.json`;
const releaseAssetUrl=name=>`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/${name}`;
const manifestDownloadUrl=releaseAssetUrl(manifestAssetName);
const executableDownloadUrl=releaseAssetUrl(assetName);
const manifestCdnUrl='https://release-assets.githubusercontent.com/clawd-test/manifest?token=fixture-signature';
const executableCdnUrl='https://release-assets.githubusercontent.com/clawd-test/executable?token=fixture-signature';

test('deployment config binds only the isolated Clawd update hostname and worker',async()=>{
  const config=JSON.parse(await readFile(new URL('../cloudflare-updates/wrangler.jsonc',import.meta.url),'utf8'));
  const source=await readFile(new URL('../cloudflare-updates/worker.mjs',import.meta.url),'utf8');
  assert.equal(config.name,'clawd-updates');
  assert.equal(config.workers_dev,true);
  assert.equal(config.preview_urls,false);
  assert.deepEqual(config.routes,[{pattern:'clawd-updates.chronokalamos.com',custom_domain:true}]);
  assert.equal(config.bindings,undefined);
  assert.equal(config.observability.enabled,true);
  assert.equal(config.observability.redact_query_string,true);
  assert.equal(config.observability.logs.invocation_logs,false);
  assert.equal(config.observability.logs.head_sampling_rate,1);
  assert.match(source,/clawd-updates\.3507103376\.workers\.dev/);
});

function releaseDescriptor({manifestValue=manifest,releaseTag=tag,draft=false,prerelease=false,executableDigest=`sha256:${digest}`,executableSize=42,manifestUrl=manifestDownloadUrl,executableUrl=executableDownloadUrl,body='## Changes\nRelease notes'}={}){
  const manifestText=JSON.stringify(manifestValue);
  return {
    tag_name:releaseTag,
    body,
    published_at:'2026-10-20T13:26:02Z',
    draft,
    prerelease,
    assets:[
      {id:executableAssetId,name:assetName,state:'uploaded',size:executableSize,digest:executableDigest,browser_download_url:executableUrl},
      {id:manifestAssetId,name:manifestAssetName,state:'uploaded',size:Buffer.byteLength(manifestText),digest:`sha256:${'c'.repeat(64)}`,browser_download_url:manifestUrl},
    ],
  };
}

function mockFetch({rangeResponse,latestStatus=200,releaseStatus=200,latestRelease=releaseDescriptor(),release=latestRelease,manifestValue=manifest,manifestStatus=200,executableResponse}={}){
  const calls=[];
  const fetcher=async(input,init={})=>{
    const url=String(input);calls.push({url,init});
    if(url===`${apiBase}/releases/latest`)return new Response(JSON.stringify(latestRelease),{status:latestStatus,headers:{'content-type':'application/json'}});
    if(url===`${apiBase}/releases/tags/${tag}`)return new Response(JSON.stringify(release),{status:releaseStatus,headers:{'content-type':'application/json'}});
    if(url===manifestDownloadUrl)return new Response(null,{status:302,headers:{location:manifestCdnUrl}});
    if(url===manifestCdnUrl)return new Response(JSON.stringify(manifestValue),{status:manifestStatus,headers:{'content-type':'application/octet-stream'}});
    if(url===executableDownloadUrl)return new Response(null,{status:302,headers:{location:executableCdnUrl}});
    if(url===executableCdnUrl)return executableResponse??rangeResponse??new Response('download bytes',{status:206,headers:{'content-range':'bytes 10-21/42','content-length':'12'}});
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

test('latest metadata uses the fixed GitHub release API and verifies its asset digest against the manifest',async()=>{
  const {fetcher,calls}=mockFetch();
  const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.tag_name,tag);
  assert.equal(body.artifact.name,assetName);
  assert.equal(body.artifact.size,42);
  assert.equal(body.artifact.sha256,digest);
  assert.equal(body.artifact.download_url,`https://clawd-updates.3507103376.workers.dev/v1/download/${tag}/${assetName}`);
  assert.equal(body.artifact.fallback_url,`https://github.com/LYL-Z/clawd-desktop/releases/download/${tag}/${assetName}`);
  assert.equal(body.body,'## Changes\nRelease notes');
  assert.equal(body.source_commit,'b'.repeat(40));
  assert.equal(body.generated_at,manifest.generatedAt);
  assert.equal(body.published_at,'2026-10-20T13:26:02Z');
  assert.equal(calls.some(call=>call.url===`${apiBase}/releases/latest`),true);
  assert.equal(calls.some(call=>call.url.includes('github.com/LYL-Z/clawd-desktop/releases/latest')),false);
  assert.equal(calls.some(call=>call.url.includes('/releases/assets/')),false);
});

test('latest lookup accepts a stable release returned by the fixed GitHub API endpoint',async()=>{
  const {fetcher}=mockFetch();
  const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
  assert.equal(response.status,200);
  assert.equal((await response.json()).tag_name,tag);
});

test('latest release rejects prereleases and non-semver tags',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
  const prerelease=mockFetch({latestRelease:releaseDescriptor({prerelease:true})});
  const rejected=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),prerelease.fetcher);
  assert.equal(rejected.status,503);
  assert.equal(prerelease.calls.length,1);

  const malformed=mockFetch({latestRelease:releaseDescriptor({releaseTag:'v1.2.3-rc.1'})});
  const invalid=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),malformed.fetcher);
  assert.equal(invalid.status,503);
  assert.equal(malformed.calls.length,1);
  assert.equal(logs.length,2);
  }finally{
    console.error=originalError;
  }
});

test('manifest and executable redirects cannot escape trusted GitHub hosts',async()=>{
  const manifestSource=mockFetch();
  const manifestFetcher=async(input,init={})=>{
    if(String(input)===manifestDownloadUrl)return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}});
    return manifestSource.fetcher(input,init);
  };
  await assert.rejects(()=>releaseMetadata(tag,manifestFetcher),/manifest_unavailable/);
  assert.equal(manifestSource.calls.some(call=>call.url.includes('127.0.0.1')),false);

  const downloadSource=mockFetch();
  const downloadFetcher=async(input,init={})=>{
    if(String(input)===executableDownloadUrl)return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});
    return downloadSource.fetcher(input,init);
  };
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`),downloadFetcher);
  assert.equal(response.status,502);
  assert.equal(downloadSource.calls.some(call=>call.url.includes('127.0.0.1')),false);
});

test('release metadata redirects cannot leave the fixed GitHub API host and repository path',async()=>{
  const source=mockFetch();
  const fetcher=async(input,init={})=>{
    if(String(input)===`${apiBase}/releases/latest`)return new Response(null,{status:302,headers:{location:'https://github.com/LYL-Z/clawd-desktop/releases/latest'}});
    return source.fetcher(input,init);
  };
  const originalError=console.error;console.error=()=>{};
  try{
    const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
    assert.equal(response.status,503);
    assert.equal(source.calls.some(call=>call.url.includes('github.com/LYL-Z')),false);
  }finally{console.error=originalError;}
});

test('release asset browser URLs must exactly match the fixed repository, tag, and asset name',async()=>{
  const hostileUrls=[
    'https://attacker.example/Clawd-1.2.3-windows-x64.exe',
    'https://github.com/attacker/clawd-desktop/releases/download/v1.2.3/Clawd-1.2.3-windows-x64.exe',
    'https://github.com/LYL-Z/clawd-desktop/releases/download/v9.9.9/Clawd-1.2.3-windows-x64.exe',
  ];
  for(const executableUrl of hostileUrls){
    const {fetcher,calls}=mockFetch({release:releaseDescriptor({executableUrl})});
    await assert.rejects(()=>releaseMetadata(tag,fetcher),/upstream_redirect_rejected/);
    assert.equal(calls.some(call=>call.url===executableUrl),false);
  }
  const {fetcher,calls}=mockFetch({release:releaseDescriptor({manifestUrl:'https://github.com/LYL-Z/clawd-desktop/releases/download/v1.2.3/wrong.json'})});
  await assert.rejects(()=>releaseMetadata(tag,fetcher),/upstream_redirect_rejected/);
  assert.equal(calls.some(call=>call.url.includes('/wrong.json')),false);
});

test('manifest and GitHub asset digest disagreement fails closed',async()=>{
  const wrongDigest='c'.repeat(64);
  const {fetcher}=mockFetch({manifestValue:{...manifest,artifacts:[{...manifest.artifacts[0],sha256:wrongDigest}]}});
  await assert.rejects(()=>releaseMetadata(tag,fetcher),/checksum_mismatch/);
  const malformedAsset=mockFetch({release:releaseDescriptor({executableDigest:'not-a-sha256'})});
  await assert.rejects(()=>releaseMetadata(tag,malformedAsset.fetcher),/manifest_invalid/);
});

test('metadata failures never log bearer-token tails, API tokens, or raw exception messages',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
    const bearerTail='ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const apiToken='api-token-value-that-must-not-appear';
    const unsafeMessage=String.raw`failed Authorization: Bearer ${bearerTail} api_token=${apiToken} client_secret=CLIENT_SECRET api_key=API_KEY_SECRET`;
    const request=new Request('https://clawd-updates.chronokalamos.com/v1/latest.json',{headers:{authorization:`Bearer ${bearerTail}`}});
    const response=await handleUpdateRequest(request,async()=>{throw Object.assign(new Error(unsafeMessage),{cause:{code:bearerTail}});});
    assert.equal(response.status,503);
    const responseBody=await response.text();
    for(const secret of [bearerTail,apiToken,'CLIENT_SECRET','API_KEY_SECRET'])assert.equal(responseBody.includes(secret),false);
    assert.deepEqual(logs,[['clawd_update_metadata_failed',{stage:'release_lookup',code:'release_unavailable',errorName:'Error'}]]);
    assert.equal(JSON.stringify(logs).includes(unsafeMessage),false);
    assert.equal(JSON.stringify(logs).includes(bearerTail),false);
    assert.equal(JSON.stringify(logs).includes(apiToken),false);
    assert.equal(JSON.stringify(logs).includes('Authorization'),false);
  }finally{
    console.error=originalError;
  }
});

test('upstream HTTP status is logged without recording response content',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
    const {fetcher}=mockFetch({latestStatus:429});
    const response=await handleUpdateRequest(new Request('https://clawd-updates.chronokalamos.com/v1/latest.json'),fetcher);
    assert.equal(response.status,503);
    assert.deepEqual(logs,[['clawd_update_metadata_failed',{stage:'release_lookup',code:'release_unavailable',errorName:'Error',upstreamStatus:429}]]);
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
  assert.equal(response.headers.get('content-type'),'application/octet-stream');
  assert.equal(calls.at(-1).url,executableCdnUrl);
  assert.equal(calls.at(-1).init.headers.get('range'),'bytes=10-21');
  assert.equal(calls.at(-1).init.headers.get('if-range'),'"stable-etag"');
  assert.equal(calls.at(-1).init.headers.get('accept'),'application/octet-stream');
  assert.equal(calls.some(call=>call.url.includes('/releases/assets/')),false);
});

test('multipart range responses preserve their content type and boundary',async()=>{
  const body='--clawd-boundary\r\nContent-Range: bytes 0-0/42\r\n\r\na\r\n--clawd-boundary--';
  const {fetcher}=mockFetch({executableResponse:new Response(body,{status:206,headers:{'content-type':'multipart/byteranges; boundary=clawd-boundary'}})});
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`,{headers:{range:'bytes=0-0,2-2'}}),fetcher);
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-type'),'multipart/byteranges; boundary=clawd-boundary');
  assert.equal(await response.text(),body);
});

test('unsatisfiable ranges return 416 with the manifest-verified asset length',async()=>{
  const {fetcher}=mockFetch({executableResponse:new Response(null,{status:416,headers:{'content-range':'bytes */999'}})});
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`,{headers:{range:'bytes=999-'}}),fetcher);
  assert.equal(response.status,416);
  assert.equal(response.headers.get('content-range'),'bytes */42');
  assert.deepEqual(await response.json(),{code:'range_not_satisfiable'});
});

test('conditional asset requests preserve a safe 304 response and validator',async()=>{
  const {fetcher,calls}=mockFetch({executableResponse:new Response(null,{status:304,headers:{etag:'"asset-validator"'}})});
  const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${assetName}`,{headers:{'if-none-match':'"asset-validator"'}}),fetcher);
  assert.equal(response.status,304);
  assert.equal(response.headers.get('etag'),'"asset-validator"');
  assert.equal(await response.text(),'');
  assert.equal(calls.at(-1).init.headers.get('if-none-match'),'"asset-validator"');
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

test('query parameters are rejected before upstream access or credential-bearing logs',async()=>{
  const originalError=console.error;
  const logs=[];
  console.error=(...args)=>logs.push(args);
  try{
    const {fetcher,calls}=mockFetch();
    for(const method of ['GET','OPTIONS']){
      const response=await handleUpdateRequest(new Request(`https://clawd-updates.chronokalamos.com/v1/latest.json?api_token=QUERY_SECRET`,{method,headers:{authorization:'Bearer QUERY_HEADER_SECRET'}}),fetcher);
      assert.equal(response.status,400);
      assert.deepEqual(await response.json(),{code:'query_not_supported'});
    }
    assert.equal(calls.length,0);
    assert.deepEqual(logs,[]);
    assert.equal(JSON.stringify(logs).includes('QUERY_SECRET'),false);
    assert.equal(JSON.stringify(logs).includes('QUERY_HEADER_SECRET'),false);
  }finally{
    console.error=originalError;
  }
});
