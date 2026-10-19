import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {parseProbeSample,type ForegroundSample} from '../../shared/probe';
import type {AppRule} from '../../shared/types';

const MAX_LINE_BYTES=8192;
const STARTUP_WAIT_MS=1500;
const MAX_RULE_PAYLOAD_BYTES=128*1024;

/** Owns the read-only native probe, its bounded JSON protocol, and restart policy. */
export class ForegroundAppMonitor{
  private child:ChildProcessWithoutNullStreams|undefined;
  private healthTimer:ReturnType<typeof setInterval>|undefined;
  private restartTimer:ReturnType<typeof setTimeout>|undefined;
  private lastSampleAt=0;
  private backoffMs=1000;
  private stopped=false;
  private firstSample:((value:boolean)=>void)|undefined;
  private firstSampleTimer:ReturnType<typeof setTimeout>|undefined;
  private rules:AppRule[]=[];
  private rulesFingerprint='';
  private healthy=false;

  constructor(
    private readonly executable:string,
    private readonly onSample:(sample:ForegroundSample)=>void,
    private readonly onHealth:(healthy:boolean,error?:string)=>void,
  ){}

  async start():Promise<boolean>{
    if(process.platform!=='win32')return false;
    this.stopped=false;
    const firstSample=new Promise<boolean>(resolve=>{
      this.firstSample=resolve;
      this.firstSampleTimer=setTimeout(()=>{this.firstSample=undefined;this.firstSampleTimer=undefined;resolve(false);},STARTUP_WAIT_MS);
    });
    this.startChild();
    this.healthTimer=setInterval(()=>this.checkHealth(),1000);
    return firstSample;
  }

  setRules(rules:AppRule[]):void{
    const next=rules.filter(rule=>rule.enabled&&rule.kind==='game').map(rule=>({id:rule.id,match:rule.match,exeName:rule.exeName,exePath:rule.exePath}));
    const fingerprint=JSON.stringify(next);
    if(fingerprint===this.rulesFingerprint)return;
    this.rulesFingerprint=fingerprint;this.rules=rules;
    if(this.stopped||process.platform!=='win32')return;
    if(this.child)this.sendRules(this.child);
  }

  stop():void{
    this.stopped=true;
    if(this.healthTimer)clearInterval(this.healthTimer);
    if(this.restartTimer)clearTimeout(this.restartTimer);
    if(this.firstSampleTimer)clearTimeout(this.firstSampleTimer);
    this.healthTimer=undefined;this.restartTimer=undefined;this.firstSampleTimer=undefined;this.firstSample=undefined;
    const child=this.child;this.child=undefined;
    if(child)try{child.kill();}catch{}
  }

  private startChild():void{
    if(this.stopped||process.platform!=='win32'||this.child)return;
    try{
      const child=spawn(this.executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      this.child=child;
      this.lastSampleAt=Date.now();
      this.sendRules(child);
      let buffered=Buffer.alloc(0);
      child.stdout.on('data',(chunk:Buffer)=>{
        buffered=Buffer.concat([buffered,chunk]);
        if(buffered.length>MAX_LINE_BYTES&&!buffered.includes(10)){
          buffered=Buffer.alloc(0);return;
        }
        let newline=buffered.indexOf(10);
        while(newline>=0){
          const line=buffered.subarray(0,newline).toString('utf8').trim();
          buffered=buffered.subarray(newline+1);
          if(line.length<=MAX_LINE_BYTES)this.acceptLine(line);
          newline=buffered.indexOf(10);
        }
        if(buffered.length>MAX_LINE_BYTES)buffered=Buffer.alloc(0);
      });
      // Drain stderr to prevent the child from blocking; diagnostics intentionally omit raw process paths.
      child.stderr.on('data',()=>{});
      child.on('error',error=>this.handleFailure(child,`native probe could not start (${(error as NodeJS.ErrnoException).code??error.name})`));
      child.on('exit',(code,signal)=>this.handleFailure(child,`native probe exited (${code??signal??'unknown'})`));
    }catch(error){
      this.setHealthy(false,error instanceof Error?error.message:'native probe start failed');
      this.scheduleRestart();
    }
  }

  private sendRules(child:ChildProcessWithoutNullStreams):void{
    const rules=this.rules.filter(rule=>rule.enabled&&rule.kind==='game').map(rule=>`${rule.id}|${rule.match}|${rule.exeName}|${rule.exePath}`).join('\n');
    const encoded=Buffer.from(rules,'utf8').toString('base64');
    if(Buffer.byteLength(encoded,'ascii')>MAX_RULE_PAYLOAD_BYTES){this.setHealthy(false,'configured game rules exceed the native probe limit');return;}
    try{child.stdin.write(`rules:${encoded}\n`);}catch{this.setHealthy(false,'native probe configuration could not be sent');}
  }

  private acceptLine(line:string):void{
    const sample=parseProbeSample(line);if(!sample)return;
    this.lastSampleAt=Date.now();this.backoffMs=1000;this.setHealthy(true);this.firstSample?.(true);this.firstSample=undefined;
    if(this.firstSampleTimer)clearTimeout(this.firstSampleTimer);this.firstSampleTimer=undefined;
    this.onSample(sample);
  }

  private checkHealth():void{
    if(this.stopped)return;
    if(!this.child){this.scheduleRestart();return;}
    if(this.lastSampleAt&&Date.now()-this.lastSampleAt>3000){
      const child=this.child;this.child=undefined;
      try{child.kill();}catch{}
      this.setHealthy(false,'native probe heartbeat timed out');
      this.scheduleRestart();
    }
  }

  private handleFailure(child:ChildProcessWithoutNullStreams,error:string):void{
    if(this.child!==child||this.stopped)return;
    this.child=undefined;this.setHealthy(false,error);this.scheduleRestart();
  }

  private scheduleRestart():void{
    if(this.stopped||this.restartTimer)return;
    const delay=this.backoffMs;this.backoffMs=Math.min(30000,this.backoffMs*2);
    this.restartTimer=setTimeout(()=>{this.restartTimer=undefined;this.startChild();},delay);
  }

  private setHealthy(healthy:boolean,error?:string):void{
    if(this.healthy===healthy)return;
    this.healthy=healthy;this.onHealth(healthy,error);
  }
}
