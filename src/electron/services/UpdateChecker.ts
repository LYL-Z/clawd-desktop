import https from 'node:https';
import type {IncomingHttpHeaders,IncomingMessage} from 'node:http';
import {compareSemVer} from '../../shared/semver';
import type {UpdateArtifact,UpdateCheckResult,UpdateSource} from '../../shared/types';

const EDGE_URL='https://clawd-updates.chronokalamos.com/v1/latest.json';
const API_URL='https://api.github.com/repos/LYL-Z/clawd-desktop/releases/latest';
const MAX_RESPONSE_BYTES=256*1024;
const MAX_CHECKSUM_BYTES=64*1024;
const REQUEST_TIMEOUT_MS=12_000;
const MAX_REDIRECTS=4;
const MAX_ARTIFACT_BYTES=250*1024*1024;
const ALLOWED_HOSTS=new Set(['clawd-updates.chronokalamos.com','api.github.com','github.com']);

type ReleaseAsset={name?:unknown;size?:unknown;browser_download_url?:unknown;digest?:unknown};
type ReleasePayload={tag_name?:unknown;name?:unknown;body?:unknown;published_at?:unknown;draft?:unknown;prerelease?:unknown;assets?:unknown;artifact?:unknown};
type ReleaseReader=()=>Promise<ReleasePayload>;
type HttpResult={statusCode:number;headers:IncomingHttpHeaders;body:Buffer};

function isAllowedUrl(value:string|URL):URL{
  const url=value instanceof URL?value:new URL(value);
  const hostAllowed=ALLOWED_HOSTS.has(url.hostname)||url.hostname.endsWith('.githubusercontent.com');
  if(url.protocol!=='https:'||!hostAllowed)throw new Error('invalid-response');
  return url;
}

function readResponse(response:IncomingMessage,maxBytes:number):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let total=0;let finished=false;
    const fail=(error:Error)=>{if(finished)return;finished=true;reject(error);};
    response.on('data',(chunk:Buffer)=>{
      total+=chunk.length;
      if(total>maxBytes){response.destroy(new Error('response-too-large'));return;}
      chunks.push(chunk);
    });
    response.on('end',()=>{if(finished)return;finished=true;resolve(Buffer.concat(chunks,total));});
    response.on('error',fail);
    response.on('aborted',()=>fail(new Error('service-unavailable')));
  });
}

function requestBytes(value:string|URL,headers:Record<string,string>,maxBytes=MAX_RESPONSE_BYTES,redirects=0):Promise<HttpResult>{
  const url=isAllowedUrl(value);
  return new Promise((resolve,reject)=>{
    let request:ReturnType<typeof https.get>;
    let settled=false;
    const timer=setTimeout(()=>request.destroy(new Error('timeout')),REQUEST_TIMEOUT_MS);
    const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
    try{
      request=https.get(url,{headers},response=>{
        const statusCode=response.statusCode??0;
        const location=response.headers.location;
        if([301,302,303,307,308].includes(statusCode)&&location){
          response.resume();clearTimeout(timer);
          if(redirects>=MAX_REDIRECTS){fail(new Error('invalid-response'));return;}
          let next:URL;
          try{next=isAllowedUrl(new URL(location,url));}catch(error){fail(error instanceof Error?error:new Error('invalid-response'));return;}
          settled=true;
          void requestBytes(next,headers,maxBytes,redirects+1).then(resolve,reject);
          return;
        }
        void readResponse(response,maxBytes).then(body=>{
          if(settled)return;settled=true;clearTimeout(timer);resolve({statusCode,headers:response.headers,body});
        },fail);
      });
      request.on('error',fail);
    }catch(error){fail(error instanceof Error?error:new Error('service-unavailable'));}
  });
}

async function readJson(url:string,headers:Record<string,string>):Promise<{statusCode:number;value:ReleasePayload}>{
  const response=await requestBytes(url,headers);
  if(response.statusCode!==200){
    if(response.statusCode===404)throw new Error('no-release');
    if(response.statusCode===403||response.statusCode===429)throw new Error('rate-limited');
    throw new Error('service-unavailable');
  }
  try{return{statusCode:response.statusCode,value:JSON.parse(response.body.toString('utf8')) as ReleasePayload};}
  catch{throw new Error('invalid-response');}
}

function githubHeaders():Record<string,string>{
  return{Accept:'application/vnd.github+json','User-Agent':'ClawdDesktop-UpdateCheck','X-GitHub-Api-Version':'2026-03-10','Accept-Encoding':'identity'};
}

function safeTag(value:unknown):string{
  if(typeof value!=='string'||!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw new Error('invalid-response');
  return value.startsWith('v')?value:`v${value}`;
}

function safeArtifactName(tag:string):string{
  const version=tag.replace(/^v/,'');
  return`Clawd-${version}-windows-x64.exe`;
}

function safeGithubAssetUrl(value:unknown,tag:string,name:string):string{
  if(typeof value!=='string')throw new Error('invalid-response');
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('invalid-response');}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith(`/LYL-Z/clawd-desktop/releases/download/${tag}/`))throw new Error('invalid-response');
  if(url.pathname.split('/').at(-1)!==encodeURIComponent(name)&&decodeURIComponent(url.pathname.split('/').at(-1)??'')!==name)throw new Error('invalid-response');
  return url.toString();
}

function checksumFromText(text:string,name:string):string{
  for(const line of text.split(/\r?\n/)){
    const match=/^([a-f0-9]{64})\s+\*?(.+?)\s*$/.exec(line);
    if(match?.[2]===name)return match[1]!;
  }
  throw new Error('checksum-missing');
}

async function artifactFromGitHub(release:ReleasePayload,tag:string):Promise<UpdateArtifact>{
  if(!Array.isArray(release.assets))throw new Error('artifact-missing');
  const name=safeArtifactName(tag);
  const assets=release.assets as ReleaseAsset[];
  const executable=assets.find(asset=>asset?.name===name);
  const checksum=assets.find(asset=>asset?.name==='SHA256SUMS.txt');
  if(!executable||!checksum||!Number.isSafeInteger(executable.size)||Number(executable.size)<1||Number(executable.size)>MAX_ARTIFACT_BYTES)throw new Error('artifact-missing');
  const githubUrl=safeGithubAssetUrl(executable.browser_download_url,tag,name);
  const checksumUrl=safeGithubAssetUrl(checksum.browser_download_url,tag,'SHA256SUMS.txt');
  const checksumResponse=await requestBytes(checksumUrl,{'User-Agent':'ClawdDesktop-UpdateCheck','Accept-Encoding':'identity'},MAX_CHECKSUM_BYTES);
  if(checksumResponse.statusCode!==200)throw new Error('checksum-unavailable');
  const sha256=checksumFromText(checksumResponse.body.toString('utf8'),name);
  if(typeof executable.digest==='string'&&executable.digest.toLowerCase()!==`sha256:${sha256}`)throw new Error('checksum-mismatch');
  return{
    fileName:name,
    size:Number(executable.size),
    sha256,
    sources:[
      {kind:'edge',url:`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${encodeURIComponent(name)}`},
      {kind:'github',url:githubUrl},
    ],
  };
}

function artifactFromEdge(release:ReleasePayload,tag:string):UpdateArtifact{
  if(!release.artifact||typeof release.artifact!=='object')throw new Error('artifact-missing');
  const asset=release.artifact as Record<string,unknown>;
  const name=safeArtifactName(tag);
  if(asset.name!==name||!Number.isSafeInteger(asset.size)||Number(asset.size)<1||Number(asset.size)>MAX_ARTIFACT_BYTES||typeof asset.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(asset.sha256))throw new Error('invalid-response');
  const edgeUrl=`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${encodeURIComponent(name)}`;
  if(asset.download_url!==edgeUrl)throw new Error('invalid-response');
  const fallback=safeGithubAssetUrl(asset.fallback_url,tag,name);
  return{fileName:name,size:Number(asset.size),sha256:asset.sha256.toLowerCase(),sources:[{kind:'edge',url:edgeUrl},{kind:'github',url:fallback}]};
}

async function readLatestRelease():Promise<ReleasePayload>{
  let edgeFailure:unknown;
  try{
    const result=await readJson(EDGE_URL,{Accept:'application/json','User-Agent':'ClawdDesktop-UpdateCheck','Accept-Encoding':'identity'});
    if(result.value.draft===true||result.value.prerelease===true)throw new Error('invalid-response');
    const tag=safeTag(result.value.tag_name);
    artifactFromEdge(result.value,tag);
    return result.value;
  }catch(error){edgeFailure=error;}

  try{
    const result=await readJson(API_URL,githubHeaders());
    if(result.value.draft===true||result.value.prerelease===true)throw new Error('invalid-response');
    const tag=safeTag(result.value.tag_name);
    const artifact=await artifactFromGitHub(result.value,tag);
    return{...result.value,artifact:{
      name:artifact.fileName,size:artifact.size,sha256:artifact.sha256,
      download_url:artifact.sources[0]!.url,fallback_url:artifact.sources[1]!.url,
    }};
  }catch(error){
    if(error instanceof Error&&error.message==='no-release')throw error;
    if(error instanceof Error&&error.message==='rate-limited')throw error;
    const edgeCode=edgeFailure instanceof Error?edgeFailure.message:'';
    const githubCode=error instanceof Error?error.message:'';
    if(edgeCode==='timeout'||githubCode==='timeout')throw new Error('timeout');
    if(edgeCode==='checksum-mismatch'||githubCode==='checksum-mismatch')throw new Error('checksum-mismatch');
    if(edgeCode==='artifact-missing'||githubCode==='artifact-missing')throw new Error('artifact-missing');
    throw new Error('sources-unavailable');
  }
}

function failureMessage(error:unknown):string{
  const code=error instanceof Error?error.message:'';
  if(code==='no-release')return'GitHub 上暂时没有可供检查的正式版本。';
  if(code==='rate-limited')return'更新源暂时限制了检查请求，请稍后重试或打开 GitHub Release 页面。';
  if(code==='timeout')return'连接更新源超时，请检查网络后重试；也可以打开 GitHub Release 页面。';
  if(code==='checksum-mismatch')return'更新包校验清单与 GitHub 资产摘要不一致，已停止提供下载。';
  if(code==='artifact-missing')return'最新 Release 缺少 Windows x64 程序或 SHA-256 校验清单。';
  if(code==='response-too-large'||code==='invalid-response')return'更新源返回了无法安全处理的版本信息。';
  return'边缘更新入口和 GitHub 暂时都不可用；可稍后重试或打开 GitHub Release 页面。';
}

export class UpdateChecker{
  constructor(private readonly readRelease:ReleaseReader=readLatestRelease){}

  async check(currentVersion:string):Promise<UpdateCheckResult>{
    try{
      const release=await this.readRelease();
      if(release.draft===true||release.prerelease===true||typeof release.tag_name!=='string')throw new Error('invalid-response');
      const tag=safeTag(release.tag_name);
      const latestVersion=tag.replace(/^v/,'');
      const comparison=compareSemVer(latestVersion,currentVersion);
      if(comparison===null)throw new Error('invalid-response');
      const releaseName=typeof release.name==='string'&&release.name.trim()?release.name.trim().slice(0,200):`Clawd ${latestVersion}`;
      const releaseNotes=typeof release.body==='string'?release.body.slice(0,12_000):'';
      const publishedAt=typeof release.published_at==='string'&&Number.isFinite(Date.parse(release.published_at))?release.published_at:'';
      if(comparison>0){
        const artifact=release.artifact&&typeof release.artifact==='object'?release.artifact as Record<string,unknown>:null;
        const validName=safeArtifactName(tag);
        if(!artifact||artifact.name!==validName||!Number.isSafeInteger(artifact.size)||Number(artifact.size)<1||Number(artifact.size)>MAX_ARTIFACT_BYTES||typeof artifact.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(artifact.sha256)||typeof artifact.download_url!=='string'||typeof artifact.fallback_url!=='string')throw new Error('artifact-missing');
        const edgeUrl=`https://clawd-updates.chronokalamos.com/v1/download/${tag}/${encodeURIComponent(validName)}`;
        const download=safeGithubAssetUrl(artifact.fallback_url,tag,validName);
        if(artifact.download_url!==edgeUrl)throw new Error('invalid-response');
        const updateArtifact:UpdateArtifact={fileName:validName,size:Number(artifact.size),sha256:artifact.sha256.toLowerCase(),sources:[{kind:'edge',url:edgeUrl},{kind:'github',url:download}]};
        return{status:'available',currentVersion,latestVersion,releaseName,releaseNotes,publishedAt,artifact:updateArtifact};
      }
      return{status:comparison<0?'ahead':'current',currentVersion,latestVersion,releaseName,releaseNotes,publishedAt};
    }catch(error){return{status:'unavailable',currentVersion,message:failureMessage(error)};}
  }
}
