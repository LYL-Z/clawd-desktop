export type ForegroundSample={schemaVersion:1;type:'sample';sequence:number;timestamp:number;foregroundPid:number|null;foregroundName:string|null;foregroundPath:string|null;fullscreen:boolean;mouseDown:boolean;runningRuleIds:string[]};

const MAX_LINE_LENGTH=8192;

export function parseProbeSample(line:string):ForegroundSample|null{
  if(line.length===0||line.length>MAX_LINE_LENGTH)return null;
  try{
    const value=JSON.parse(line) as Record<string,unknown>;
    if(value.schemaVersion!==1||value.type!=='sample'||!Number.isSafeInteger(value.sequence)||typeof value.timestamp!=='number'||!Number.isFinite(value.timestamp))return null;
    if(value.foregroundPid!==null&&(!Number.isSafeInteger(value.foregroundPid)||Number(value.foregroundPid)<0))return null;
    const boundedText=(item:unknown,max:number):item is string|null=>item===null||(typeof item==='string'&&item.length<=max&&!/[\0\r\n]/.test(item));
    if(!boundedText(value.foregroundName,260)||!boundedText(value.foregroundPath,32760)||typeof value.fullscreen!=='boolean'||typeof value.mouseDown!=='boolean'||!Array.isArray(value.runningRuleIds)||value.runningRuleIds.length>64)return null;
    if(!value.runningRuleIds.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(id)))return null;
    return{schemaVersion:1,type:'sample',sequence:Number(value.sequence),timestamp:Number(value.timestamp),foregroundPid:value.foregroundPid as number|null,foregroundName:value.foregroundName as string|null,foregroundPath:value.foregroundPath as string|null,fullscreen:value.fullscreen,mouseDown:value.mouseDown,runningRuleIds:[...new Set(value.runningRuleIds as string[])]};
  }catch{return null;}
}
