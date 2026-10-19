import {contextBridge,ipcRenderer} from 'electron';
import type {ClawdBridge,HostCommand,Point,Rect} from '../shared/types';
const bridge:ClawdBridge={
  init:()=>ipcRenderer.invoke('clawd:init'),
  move:(point,expanded)=>ipcRenderer.send('clawd:move',{point,expanded}),
  interactive:(hit,captured)=>ipcRenderer.send('clawd:interactive',{hit,captured}),
  menu:(actions)=>ipcRenderer.send('clawd:menu',Boolean(actions)),
  save:settings=>ipcRenderer.send('clawd:save',settings),
  updateSettings:settings=>ipcRenderer.invoke('clawd:settings:update',settings),
  selectExecutable:()=>ipcRenderer.invoke('clawd:settings:select-executable'),
  setStartup:enabled=>ipcRenderer.invoke('clawd:settings:set-startup',Boolean(enabled)),
  setUserHidden:hidden=>ipcRenderer.invoke('clawd:visibility:set-user-hidden',Boolean(hidden)),
  checkForUpdates:()=>ipcRenderer.invoke('clawd:updates:check'),
  openReleasePage:()=>ipcRenderer.invoke('clawd:updates:open-release'),
  ready:()=>ipcRenderer.send('clawd:ready'),
  report:data=>ipcRenderer.send('clawd:report',data),
  onCommand:callback=>{const listener=(_:unknown,c:HostCommand)=>callback(c);ipcRenderer.on('clawd:command',listener);return()=>ipcRenderer.removeListener('clawd:command',listener);},
  onCursor:callback=>{const listener=(_:unknown,p:Point,b:Rect,down:boolean)=>callback(p,b,down);ipcRenderer.on('clawd:cursor',listener);return()=>ipcRenderer.removeListener('clawd:cursor',listener);}
};
contextBridge.exposeInMainWorld('clawd',bridge);
