import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const outputDirectory=path.resolve(process.argv[2]??'release');
const pkg=JSON.parse(await readFile(path.resolve('package.json'),'utf8'));
const version=pkg.version;
const currentExecutable=`Clawd-${version}-windows-x64.exe`;
const approved=new Set([
  currentExecutable,
  'Clawd-Codex-V2.zip',
  'Clawd-dark-3840x2160.png',
  'Clawd-light-3840x2160.png',
  `release-manifest-v${version}.json`,
]);
const files=(await readdir(outputDirectory,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&approved.has(entry.name))
  .map(entry=>entry.name)
  .sort((a,b)=>a.localeCompare(b,'en'));
for(const required of approved){
  if(!files.includes(required))throw new Error(`Required ${version} release asset is missing: ${required}`);
}
if(files.filter(name=>name===currentExecutable).length!==1)throw new Error(`Expected exactly one ${currentExecutable} in ${outputDirectory}.`);
const lines=[];
for(const name of files){
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path.join(outputDirectory,name)))hash.update(chunk);
  const digest=hash.digest('hex');
  lines.push(`${digest}  ${name}`);
  console.log(`SHA-256 ${digest}  ${name}`);
}
await writeFile(path.join(outputDirectory,'SHA256SUMS.txt'),`${lines.join('\n')}\n`,'utf8');
