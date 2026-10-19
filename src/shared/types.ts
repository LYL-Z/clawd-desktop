export type Point={x:number;y:number};
export type Rect=Point&{width:number;height:number};
export type Outfit='none'|'headphones'|'skateboard'|'wizard'|'hardhat'|'detective'|'chef'|'cowboy'|'football';
export type TaskState='idle'|'thinking'|'working'|'waiting'|'done'|'failed';
export type AutoHideMode='smart'|'game-running'|'manual';
export type AppRule={id:string;kind:'game'|'exception';match:'path'|'name';exeName:string;exePath:string;enabled:boolean};
export type VisibilityReason='game'|'fullscreen'|'user'|'lock'|'suspend';
export type SceneKind='desktop'|'game'|'fullscreen'|'unknown';
export type VisibilitySnapshot={visible:boolean;reasons:VisibilityReason[];scene:SceneKind;foregroundName?:string;probeHealthy:boolean;updatedAt?:number};
export type UpdateSource={kind:'edge'|'github';url:string};
export type UpdateArtifact={fileName:string;size:number;sha256:string;sources:UpdateSource[]};
export type UpdateCheckResult=
  |{status:'available';currentVersion:string;latestVersion:string;releaseName:string;releaseNotes:string;publishedAt:string;artifact:UpdateArtifact}
  |{status:'current'|'ahead';currentVersion:string;latestVersion:string;releaseName:string;releaseNotes:string;publishedAt:string}
  |{status:'unavailable';currentVersion:string;message:string};
export type UpdateDownloadProgress={completedBytes:number;totalBytes:number;source:'edge'|'github'};
export type UpdateDownloadResult={ok:true;filePath:string;sha256:string}|{ok:false;message:string;cancelled?:boolean};
export type ActionDef={row:number;startFrame?:number;count:number;durations:number[];atlas?:string;loop?:boolean;label?:string;outfit?:Outfit};
export type OutfitDef={atlas:string;overlay?:boolean;hidden?:boolean;bodyOffsetY?:number;followHead?:boolean;groundRegionY?:number;row?:number;count?:number;durations?:number[];animations?:Record<string,ActionDef>};
export type Manifest={version:number;cellWidth:number;cellHeight:number;atlas:string;anchor?:Point;animations:Record<string,ActionDef>;look?:{startRow:number;count:number};outfits?:Partial<Record<Outfit,OutfitDef>>};
export type Settings={schemaVersion:1;outfit:Outfit;roam:boolean;reducedMotion:boolean;paused:boolean;scale:number;bridge:boolean;welcomeSeen:boolean;startVisible:boolean;position?:Point;autoHideMode:AutoHideMode;hideFullscreen:boolean;restoreDelayMs:number;appRules:AppRule[]};
export type TaskEvent={schemaVersion:1;eventId:string;state:TaskState;updatedAt:string;ttlMs:number;detail:string};
export type Environment={workArea:Rect;displays:Rect[];settings:Settings;statusPath:string;systemReducedMotion:boolean;idleSeconds:number;windowBounds:Rect;manifest?:Manifest;visibility?:VisibilitySnapshot;startupEnabled?:boolean;version:string;packaged:boolean;debugMode:boolean};
export type HostCommand={type:'action'|'performance'|'outfit'|'setting'|'recover'|'pause-system'|'resume-system'|'task'|'environment'|'visibility';value?:unknown};
export interface ClawdBridge {
  init():Promise<Environment|null>;
  move(point:Point,expanded:boolean):void;
  interactive(hit:boolean,captured:boolean):void;
  menu(actions?:boolean):void;
  save(settings:Partial<Settings>):void;
  updateSettings(settings:Partial<Settings>):Promise<{ok:boolean;settings?:Settings;error?:string}>;
  selectExecutable():Promise<string|null>;
  setStartup(enabled:boolean):Promise<boolean>;
  setUserHidden(hidden:boolean):Promise<boolean>;
  checkForUpdates():Promise<UpdateCheckResult>;
  downloadUpdate():Promise<UpdateDownloadResult>;
  cancelUpdateDownload():Promise<boolean>;
  showDownloadedUpdate():Promise<boolean>;
  onUpdateDownloadProgress(callback:(progress:UpdateDownloadProgress)=>void):()=>void;
  openReleasePage():Promise<boolean>;
  ready():void;
  report(data:unknown):void;
  onCommand(callback:(command:HostCommand)=>void):()=>void;
  onCursor(callback:(point:Point,bounds:Rect,down:boolean)=>void):()=>void;
}
export const OUTFITS: {id:Outfit;label:string}[]=[{id:'none',label:'欢迎蟹'},{id:'headphones',label:'耳机'},{id:'skateboard',label:'滑板'},{id:'wizard',label:'巫师'},{id:'hardhat',label:'安全帽'},{id:'detective',label:'侦探'},{id:'chef',label:'厨师'},{id:'cowboy',label:'牛仔'}];
export const CORE_ACTIONS=[['idle','呼吸与眨眼'],['running-right','向右蟹行'],['running-left','向左蟹行'],['waving','挥手'],['jumping','跳跃'],['failed','失落与恢复'],['waiting','等待回应'],['running','专注工作'],['review','认真检查']] as const;
export const EXT_ACTIONS=[['held','被提起'],['thrown','甩出'],['landing','落地回弹'],['peek-left','左侧探头'],['peek-right','右侧探头'],['turn','转身'],['sway','歪头打量与回稳'],['sleep','入睡'],['wake','醒来'],['headphone-groove','耳机律动'],['skate','滑板巡游'],['skate-jump','滑板小跃'],['wizard-charge','巫师蓄力'],['wizard-cast','巫师挥杖'],['hardhat-work','安全帽作业'],['detective-inspect','侦探观察'],['chef-prepare','厨师准备'],['cowboy-tip','牛仔致意'],['football','足球轻颠']] as const;
export const PERFORMANCES=[['welcome','欢迎屏裂开一条缝',3200],['agreement','You’re Absolutely Right!',4800],['sigil','陶土星印',4000],['ensemble','小蟹合奏',5500]] as const;
export const DEFAULTS:Settings={schemaVersion:1,outfit:'none',roam:false,reducedMotion:false,paused:false,scale:1,bridge:false,welcomeSeen:false,startVisible:true,autoHideMode:'smart',hideFullscreen:true,restoreDelayMs:900,appRules:[]};
