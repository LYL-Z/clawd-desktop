import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const outputDirectory=path.resolve(process.argv[2]??'release');
const approved=/^(?:Clawd-(?:\d+\.\d+\.\d+-windows-x64\.exe|Codex-V2\.zip|(?:light|dark)-3840x2160\.png)|release-manifest-v\d+\.\d+\.\d+\.json)$/i;
const files=(await readdir(outputDirectory,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&approved.test(entry.name))
  .map(entry=>entry.name)
  .sort((a,b)=>a.localeCompare(b,'en'));
if(files.filter(name=>/^Clawd-\d+\.\d+\.\d+-windows-x64\.exe$/i.test(name)).length!==1)throw new Error(`Expected exactly one Clawd Windows x64 portable EXE in ${outputDirectory}.`);
const lines=[];
for(const name of files){
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path.join(outputDirectory,name)))hash.update(chunk);
  const digest=hash.digest('hex');
  lines.push(`${digest}  ${name}`);
  console.log(`SHA-256 ${digest}  ${name}`);
}
await writeFile(path.join(outputDirectory,'SHA256SUMS.txt'),`${lines.join('\n')}\n`,'utf8');
