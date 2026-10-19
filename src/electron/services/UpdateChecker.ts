import https from 'node:https';
import type {IncomingMessage} from 'node:http';
import {compareSemVer} from '../../shared/semver';
import type {UpdateCheckResult} from '../../shared/types';

const API_URL='https://api.github.com/repos/LYL-Z/clawd-desktop/releases/latest';
const MAX_RESPONSE_BYTES=256*1024;
const REQUEST_TIMEOUT_MS=8000;

type ReleasePayload={tag_name?:unknown;name?:unknown;body?:unknown;published_at?:unknown;draft?:unknown;prerelease?:unknown};
type ReleaseReader=()=>Promise<ReleasePayload>;

function readResponse(response:IncomingMessage):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let total=0;
    response.on('data',(chunk:Buffer)=>{
      total+=chunk.length;
      if(total>MAX_RESPONSE_BYTES){response.destroy(new Error('response-too-large'));return;}
      chunks.push(chunk);
    });
    response.on('end',()=>resolve(Buffer.concat(chunks,total)));
    response.on('error',reject);
  });
}

async function readLatestRelease():Promise<ReleasePayload>{
  return new Promise((resolve,reject)=>{
    let request:ReturnType<typeof https.get>;
    const timeout=setTimeout(()=>request.destroy(new Error('timeout')),REQUEST_TIMEOUT_MS);
    const fail=(error:Error)=>{clearTimeout(timeout);reject(error);};
    request=https.get(API_URL,{headers:{Accept:'application/vnd.github+json','User-Agent':'ClawdDesktop-UpdateCheck','X-GitHub-Api-Version':'2026-03-10'}},response=>{
      void readResponse(response).then(body=>{
        if(response.statusCode===404){fail(new Error('no-release'));return;}
        if(response.statusCode===403){fail(new Error('rate-limited'));return;}
        if(response.statusCode!==200){fail(new Error('service-unavailable'));return;}
        try{clearTimeout(timeout);resolve(JSON.parse(body.toString('utf8')) as ReleasePayload);}
        catch{fail(new Error('invalid-response'));}
      },fail);
    });
    request.on('error',fail);
  });
}

function failureMessage(error:unknown):string{
  const code=error instanceof Error?error.message:'';
  if(code==='no-release')return'GitHub 上暂时没有可供检查的正式版本。';
  if(code==='rate-limited')return'GitHub 暂时限制了检查请求，请稍后再试。';
  if(code==='timeout')return'连接 GitHub 超时，请检查网络后重试。';
  if(code==='response-too-large'||code==='invalid-response')return'GitHub 返回了无法安全处理的版本信息。';
  return'暂时无法连接 GitHub。你仍可稍后手动查看项目 Release 页面。';
}

export class UpdateChecker{
  constructor(private readonly readRelease:ReleaseReader=readLatestRelease){}

  async check(currentVersion:string):Promise<UpdateCheckResult>{
    try{
      const release=await this.readRelease();
      if(release.draft===true||release.prerelease===true||typeof release.tag_name!=='string')throw new Error('invalid-response');
      const latestVersion=release.tag_name.replace(/^v/i,'');
      const comparison=compareSemVer(latestVersion,currentVersion);
      if(comparison===null)throw new Error('invalid-response');
      const releaseName=typeof release.name==='string'&&release.name.trim()?release.name.trim().slice(0,200):`Clawd ${latestVersion}`;
      const releaseNotes=typeof release.body==='string'?release.body.slice(0,12000):'';
      const publishedAt=typeof release.published_at==='string'&&Number.isFinite(Date.parse(release.published_at))?release.published_at:'';
      return{status:comparison>0?'available':comparison<0?'ahead':'current',currentVersion,latestVersion,releaseName,releaseNotes,publishedAt};
    }catch(error){return{status:'unavailable',currentVersion,message:failureMessage(error)};}
  }
}
