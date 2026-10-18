import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
await mkdir('app/assets', {recursive:true});
await Promise.all([
  build({entryPoints:['src/electron/main.ts'],outfile:'app/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],sourcemap:true}),
  build({entryPoints:['src/electron/preload.ts'],outfile:'app/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']}),
  build({entryPoints:['src/renderer/index.ts'],outfile:'app/ui.js',bundle:true,platform:'browser',format:'iife',sourcemap:true}),
  cp('src/renderer/index.html','app/index.html'),cp('src/renderer/styles.css','app/styles.css')
]);
try { await cp('assets/runtime','app/assets',{recursive:true}); } catch(error) { if(error.code!=='ENOENT') throw error; }
if(process.platform==='win32')execFileSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',['/nologo','/target:exe',`/out:${path.resolve('app/window-probe.exe')}`,path.resolve('src/native/WindowProbe.cs')],{stdio:'inherit'});
console.log('Clawd application built. Artwork acceptance remains a separate gate.');
