import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const outputDirectory=path.resolve(process.argv[2]??'release');
const files=(await readdir(outputDirectory,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&/^Clawd-\d+\.\d+\.\d+-windows-x64\.exe$/i.test(entry.name))
  .map(entry=>entry.name);
if(files.length!==1)throw new Error(`Expected exactly one Clawd Windows x64 portable EXE in ${outputDirectory}; found ${files.length}.`);
const name=files[0];
const bytes=await readFile(path.join(outputDirectory,name));
const digest=createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(outputDirectory,'SHA256SUMS.txt'),`${digest}  ${name}\n`,'utf8');
console.log(`SHA-256 ${digest}  ${name}`);
