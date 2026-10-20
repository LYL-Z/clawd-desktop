import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const mode = process.argv[2] === '--preflight' ? 'preflight' : 'finalize';
const requestedDirectory = mode === 'preflight' ? process.argv[3] : process.argv[2];
const outputDirectory = resolve(root, requestedDirectory ?? 'release');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;

const releaseRoot = resolve(root, 'release');
const relativeOutputDirectory = relative(releaseRoot, outputDirectory);
if (relativeOutputDirectory.startsWith(`..${sep}`) || relativeOutputDirectory === '..') {
  throw new Error('Release assets must be written inside the repository release directory.');
}
await mkdir(outputDirectory, { recursive: true });

const sourceMarker = join(outputDirectory, `.clawd-release-source-v${version}.json`);
if (mode === 'preflight') {
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (changes) {
    throw new Error('Refusing to package from a dirty worktree. Commit or remove local changes first.');
  }
  const sourceCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error('Could not resolve the exact 40-character Git source commit.');
  }
  await writeFile(sourceMarker, `${JSON.stringify({ version, sourceCommit }, null, 2)}\n`);
  console.log(`Release source locked to ${sourceCommit} for ${version}.`);
  process.exit(0);
}

const { version: markerVersion, sourceCommit } = JSON.parse(await readFile(sourceMarker, 'utf8'));
if (markerVersion !== version || !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
  throw new Error('Release source marker is invalid or does not match package.json.');
}
const currentCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const changesDuringBuild = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (currentCommit !== sourceCommit || changesDuringBuild) {
  throw new Error('Source changed after release preflight; refusing to write a misleading manifest.');
}

const expectedNames = [
  `Clawd-${version}-windows-x64.exe`,
  'Clawd-Codex-V2.zip',
  'Clawd-dark-3840x2160.png',
  'Clawd-light-3840x2160.png',
];
const entries = await readdir(outputDirectory, { withFileTypes: true });
const artifactNames = expectedNames.filter((name) => entries.some((entry) => entry.isFile() && entry.name === name));
if (!artifactNames.includes(`Clawd-${version}-windows-x64.exe`)) {
  throw new Error(`Windows portable asset not found in ${outputDirectory}.`);
}

const artifacts = [];
for (const file of artifactNames) {
  const path = join(outputDirectory, file);
  const metadata = await stat(path);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  artifacts.push({
    file: basename(file),
    bytes: metadata.size,
    sha256: hash.digest('hex'),
  });
}

const manifest = {
  schemaVersion: 1,
  product: 'Clawd Desktop',
  version,
  platform: 'Windows x64',
  sourceCommit,
  generatedAt: new Date().toISOString(),
  artifacts,
};
const output = join(outputDirectory, `release-manifest-v${version}.json`);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
await rm(sourceMarker, { force: true });
console.log(`Wrote ${output} for source ${sourceCommit} with ${artifacts.length} asset(s).`);
