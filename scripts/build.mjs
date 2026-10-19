import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

function findCSharpCompiler(){
  const candidates=[];
  if(process.env.CLAWD_CSC)candidates.push(process.env.CLAWD_CSC);
  if(process.platform==='win32'){
    try{candidates.push(...execFileSync('where.exe',['csc.exe'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split(/\r?\n/).filter(Boolean));}catch{}
    const windows=process.env.WINDIR||process.env.SystemRoot||'C:\\Windows';
    candidates.push(path.join(windows,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'));
    candidates.push(path.join(windows,'Microsoft.NET','Framework','v4.0.30319','csc.exe'));
    const installer=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
    if(existsSync(installer)){
      try{candidates.push(...execFileSync(installer,['-latest','-products','*','-find','MSBuild\\**\\Bin\\Roslyn\\csc.exe'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split(/\r?\n/).filter(Boolean));}catch{}
    }
  }
  return candidates.map(candidate=>candidate.trim()).find(candidate=>candidate&&existsSync(candidate));
}

await mkdir('app/assets', {recursive:true});
await Promise.all([
  build({entryPoints:['src/electron/main.ts'],outfile:'app/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],sourcemap:true}),
  build({entryPoints:['src/electron/preload.ts'],outfile:'app/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']}),
  build({entryPoints:['src/renderer/index.ts'],outfile:'app/ui.js',bundle:true,platform:'browser',format:'iife',sourcemap:true}),
  build({entryPoints:['src/renderer/settings.ts'],outfile:'app/settings.js',bundle:true,platform:'browser',format:'iife',sourcemap:true}),
  cp('src/renderer/index.html','app/index.html'),cp('src/renderer/styles.css','app/styles.css'),
  cp('src/renderer/settings.html','app/settings.html'),cp('src/renderer/settings.css','app/settings.css')
]);
try { await cp('assets/runtime','app/assets',{recursive:true}); } catch(error) { if(error.code!=='ENOENT') throw error; }
if(process.platform==='win32'){
  const compiler=findCSharpCompiler();
  if(!compiler)throw new Error('Could not find a C# compiler. Install the .NET Framework developer tools or Visual Studio Build Tools, or set CLAWD_CSC to csc.exe.');
  execFileSync(compiler,['/nologo','/target:exe',`/out:${path.resolve('app/window-probe.exe')}`,path.resolve('src/native/WindowProbe.cs')],{stdio:'inherit'});
}
console.log('Clawd application built. Artwork acceptance remains a separate gate.');
