import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const outputDirectory = resolve(root, process.argv[2] ?? 'release/publish');
const packagingCommit = process.argv[3];
const releaseRoot = resolve(root, 'release');
const relativeOutputDirectory = relative(releaseRoot, outputDirectory);
if (relativeOutputDirectory.startsWith(`..${sep}`) || relativeOutputDirectory === '..') {
  throw new Error('Release assets must be inside the repository release directory.');
}
if (!/^[a-f0-9]{40}$/i.test(packagingCommit ?? '')) {
  throw new Error('A full 40-character packaging commit is required.');
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const manifestPath = join(outputDirectory, `release-manifest-v${version}.json`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== version ||
  manifest.platform !== 'Windows x64' ||
  !/^[a-f0-9]{40}$/i.test(manifest.sourceCommit ?? '')
) {
  throw new Error('Existing release manifest does not match this version and platform.');
}

const assetNames = [
  `Clawd-${version}-windows-x64.exe`,
  `Clawd-${version}-Setup-windows-x64.exe`,
  'Clawd-Codex-V2.zip',
  'Clawd-dark-3840x2160.png',
  'Clawd-light-3840x2160.png',
];
const previousArtifacts = new Map();
for (const artifact of manifest.artifacts ?? []) {
  if (previousArtifacts.has(artifact?.file)) throw new Error(`Duplicate manifest artifact: ${artifact.file}`);
  previousArtifacts.set(artifact?.file, artifact);
}

const artifacts = [];
for (const file of assetNames) {
  const path = join(outputDirectory, file);
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new Error(`Required release asset is missing: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const artifact = { file, bytes: metadata.size, sha256: hash.digest('hex') };

  if (file !== `Clawd-${version}-Setup-windows-x64.exe`) {
    const previous = previousArtifacts.get(file);
    if (!previous || previous.bytes !== artifact.bytes || previous.sha256 !== artifact.sha256) {
      throw new Error(`Existing release asset no longer matches its manifest entry: ${file}`);
    }
  }
  artifacts.push(artifact);
}

manifest.generatedAt = new Date().toISOString();
manifest.packagingCommit = packagingCommit;
manifest.artifacts = artifacts;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Updated ${manifestPath}; package recipe ${packagingCommit}; ${artifacts.length} assets.`);
