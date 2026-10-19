import {createHash} from 'node:crypto';
import https from 'node:https';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rename,rm,stat} from 'node:fs/promises';
import type {IncomingMessage} from 'node:http';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {UpdateArtifact,UpdateDownloadProgress,UpdateDownloadResult,UpdateSource} from '../../shared/types';

const CHUNK_BYTES=8*1024*1024;
const REQUEST_TIMEOUT_MS=60_000;
const EDGE_TIMEOUT_MS=25_000;
const MAX_SIZE=250*1024*1024;
const EDGE_HOST='clawd-updates.chronokalamos.com';

type RangeResponse={response:IncomingMessage;cancel:()=>void};
type RangeReader=(source:UpdateSource,start:number,end:number,signal?:AbortSignal)=>Promise<RangeResponse>;

function validateArtifact(artifact:UpdateArtifact):{version:string;githubUrl:string;edgeUrl:string}{
  const match=/^Clawd-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-windows-x64\.exe$/.exec(artifact.fileName);
  if(!match||!Number.isSafeInteger(artifact.size)||artifact.size<1||artifact.size>MAX_SIZE||!/^[a-f0-9]{64}$/i.test(artifact.sha256)||!Array.isArray(artifact.sources))throw new Error('invalid-update-metadata');
  const version=`${match[1]}.${match[2]}.${match[3]}`;
  const edgeUrl=`https://${EDGE_HOST}/v1/download/v${version}/${encodeURIComponent(artifact.fileName)}`;
  let githubUrl='';
  for(const source of artifact.sources){
    const url=new URL(source.url);
    if(url.protocol!=='https:')throw new Error('invalid-update-metadata');
    if(source.kind==='edge'){
      if(url.hostname!==EDGE_HOST||url.toString()!==edgeUrl)throw new Error('invalid-update-metadata');
    }else if(source.kind==='github'){
      if(url.hostname!=='github.com'||url.pathname!==`/LYL-Z/clawd-desktop/releases/download/v${version}/${artifact.fileName}`)throw new Error('invalid-update-metadata');
      githubUrl=url.toString();
    }else throw new Error('invalid-update-metadata');
  }
  if(!artifact.sources.some(source=>source.kind==='edge'&&source.url===edgeUrl)||!githubUrl)throw new Error('invalid-update-metadata');
  return{version,githubUrl,edgeUrl};
}

function allowedHost(hostname:string):boolean{
  return hostname==='github.com'||hostname===EDGE_HOST||hostname.endsWith('.githubusercontent.com');
}

function openRange(source:UpdateSource,start:number,end:number,signal?:AbortSignal,redirects=0):Promise<RangeResponse>{
  let url:URL;
  try{url=new URL(source.url);}catch{return Promise.reject(new Error('invalid-update-source'));}
  if(url.protocol!=='https:'||!allowedHost(url.hostname))return Promise.reject(new Error('invalid-update-source'));
  return new Promise((resolve,reject)=>{
    let request:ReturnType<typeof https.get>;
    let settled=false;
    const timeout=source.kind==='edge'?EDGE_TIMEOUT_MS:REQUEST_TIMEOUT_MS;
    const headers:Record<string,string>={
      Accept:'application/octet-stream',
      'Accept-Encoding':'identity',
      Range:`bytes=${start}-${end}`,
      'User-Agent':'ClawdDesktop-UpdateDownload',
    };
    const timer=setTimeout(()=>request.destroy(new Error('timeout')),timeout);
    const abort=()=>request.destroy(new Error('cancelled'));
    const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);};
    if(signal?.aborted){clearTimeout(timer);reject(new Error('cancelled'));return;}
    signal?.addEventListener('abort',abort,{once:true});
    try{
      request=https.get(url,{headers},response=>{
        const status=response.statusCode??0;
        const location=response.headers.location;
        if([301,302,303,307,308].includes(status)&&location){
          response.resume();clearTimeout(timer);signal?.removeEventListener('abort',abort);
          if(redirects>=4){fail(new Error('redirect-limit'));return;}
          let next:URL;
          try{next=new URL(location,url);}catch{fail(new Error('invalid-update-source'));return;}
          if(next.protocol!=='https:'||!allowedHost(next.hostname)){fail(new Error('invalid-update-source'));return;}
          settled=true;
          const redirected={...source,url:next.toString()};
          void openRange(redirected,start,end,signal,redirects+1).then(resolve,reject);
          return;
        }
        settled=true;clearTimeout(timer);
        request.setTimeout(timeout,()=>request.destroy(new Error('timeout')));
        const cleanup=()=>signal?.removeEventListener('abort',abort);
        response.once('end',cleanup);response.once('close',cleanup);
        resolve({response,cancel:()=>request.destroy(new Error('cancelled'))});
      });
      request.on('error',fail);
    }catch(error){fail(error instanceof Error?error:new Error('network-error'));}
  });
}

async function hashFile(filePath:string):Promise<string>{
  const hash=createHash('sha256');
  await new Promise<void>((resolve,reject)=>{
    const stream=createReadStream(filePath);
    stream.on('data',chunk=>hash.update(chunk));
    stream.on('error',reject);
    stream.on('end',resolve);
  });
  return hash.digest('hex');
}

async function currentSize(filePath:string):Promise<number>{
  try{return(await stat(filePath)).size;}catch{return 0;}
}

function delay(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}

export class UpdateDownloader{
  private cancelled=false;
  private running=false;
  private cancelRequest:(()=>void)|undefined;

  constructor(private readonly updatesDirectory:string,private readonly rangeReader:RangeReader=openRange){}

  cancel():boolean{
    if(!this.running)return false;
    this.cancelled=true;
    this.cancelRequest?.();
    return true;
  }

  async download(artifact:UpdateArtifact,onProgress:(progress:UpdateDownloadProgress)=>void):Promise<UpdateDownloadResult>{
    if(this.running)return{ok:false,message:'已有一个更新下载正在进行。'};
    this.running=true;this.cancelled=false;this.cancelRequest=undefined;
    let partialPath='';
    try{
      const {version}=validateArtifact(artifact);
      await mkdir(this.updatesDirectory,{recursive:true});
      const versionDirectory=path.join(this.updatesDirectory,version);
      await mkdir(versionDirectory,{recursive:true});
      const targetPath=path.join(versionDirectory,artifact.fileName);
      partialPath=`${targetPath}.part`;
      const existingFinal=await currentSize(targetPath);
      if(existingFinal===artifact.size&&await hashFile(targetPath)===artifact.sha256.toLowerCase())return{ok:true,filePath:targetPath,sha256:artifact.sha256.toLowerCase()};
      if(existingFinal>0)await rm(targetPath,{force:true});
      let lastError:unknown;
      for(const source of artifact.sources){
        if(this.cancelled)return{ok:false,message:'下载已取消；已下载部分会保留，下次可以续传。',cancelled:true};
        try{
          await this.downloadFromSource(source,artifact,partialPath,onProgress);
          const size=await currentSize(partialPath);
          if(size!==artifact.size)throw new Error('size-mismatch');
          const actual=await hashFile(partialPath);
          if(actual!==artifact.sha256.toLowerCase()){
            await rm(partialPath,{force:true});
            lastError=new Error('checksum-mismatch');
            continue;
          }
          await rename(partialPath,targetPath);
          return{ok:true,filePath:targetPath,sha256:actual};
        }catch(error){
          lastError=error;
          if(this.cancelled)return{ok:false,message:'下载已取消；已下载部分会保留，下次可以续传。',cancelled:true};
        }
      }
      if(lastError)throw lastError;
      throw new Error('download-unavailable');
    }catch(error){
      if(this.cancelled)return{ok:false,message:'下载已取消；已下载部分会保留，下次可以续传。',cancelled:true};
      const code=error instanceof Error?error.message:'';
      if(code==='checksum-mismatch')return{ok:false,message:'SHA-256 校验失败，已删除损坏文件；请重新下载。'};
      if(code==='invalid-update-metadata'||code==='invalid-update-source')return{ok:false,message:'更新信息未通过安全校验，已停止下载。'};
      if(code==='size-mismatch')return{ok:false,message:'下载文件长度不完整；已保留已下载部分，可稍后重试。'};
      return{ok:false,message:'下载暂时中断；已保留进度，点击重试可从断点继续。'};
    }finally{
      this.running=false;this.cancelRequest=undefined;
    }
  }

  private async downloadFromSource(source:UpdateSource,artifact:UpdateArtifact,partialPath:string,onProgress:(progress:UpdateDownloadProgress)=>void):Promise<void>{
    let retries=0;
    while(true){
      if(this.cancelled)throw new Error('cancelled');
      let offset=await currentSize(partialPath);
      if(offset>artifact.size){await rm(partialPath,{force:true});offset=0;}
      if(offset===artifact.size)return;
      const end=Math.min(artifact.size-1,Math.ceil((offset+1)/CHUNK_BYTES)*CHUNK_BYTES-1);
      try{
        const controller=new AbortController();
        this.cancelRequest=()=>controller.abort();
        const {response,cancel}=await this.rangeReader(source,offset,end,controller.signal);
        this.cancelRequest=()=>{controller.abort();cancel();};
        const status=response.statusCode??0;
        if(status===200&&offset>0){response.resume();await rm(partialPath,{force:true});throw new Error('range-unsupported');}
        if(status!==206&&!(status===200&&offset===0)){response.resume();throw new Error(status===404?'asset-not-found':status===403?'rate-limited':'download-http-error');}
        if(status===206){
          const contentRange=response.headers['content-range'];
          const match=typeof contentRange==='string'?/^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange):null;
          if(!match||Number(match[1])!==offset||Number(match[2])>end||Number(match[3])!==artifact.size){response.resume();throw new Error('range-invalid');}
        }
        let received=0;
        response.on('data',(chunk:Buffer)=>{
          received+=chunk.length;
          if(offset+received>artifact.size){response.destroy(new Error('size-mismatch'));return;}
          onProgress({completedBytes:Math.min(offset+received,artifact.size),totalBytes:artifact.size,source:source.kind});
        });
        await pipeline(response,createWriteStream(partialPath,{flags:offset===0?'w':'a'}));
        this.cancelRequest=undefined;
        const after=await currentSize(partialPath);
        if(status===200&&after!==artifact.size)throw new Error('size-mismatch');
        if(status===206&&after!==Number(response.headers['content-range']?.toString().split('/')[0]?.split('-')[1])+1)throw new Error('size-mismatch');
        if(after>artifact.size){await rm(partialPath,{force:true});throw new Error('size-mismatch');}
        if(after<artifact.size)retries=0;
        else return;
      }catch(error){
        this.cancelRequest=undefined;
        if(this.cancelled)throw new Error('cancelled');
        const code=error instanceof Error?error.message:'';
        if(code==='range-unsupported'&&source.kind==='edge')throw error;
        if(code==='timeout'&&source.kind==='edge')throw error;
        if(code==='asset-not-found'||code==='rate-limited')throw error;
        if(code==='size-mismatch'||code==='range-invalid'){
          retries++;
          if(retries>2)throw error;
          await delay(400*retries);continue;
        }
        retries++;
        if(retries>2)throw error;
        await delay(400*retries);
      }
    }
  }
}
