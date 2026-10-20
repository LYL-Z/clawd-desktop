import { copyFile, mkdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = process.cwd();
const releaseRoot = resolve(root, 'release');
const outputDirectory = resolve(root, process.argv[2] ?? 'release');
const relativeOutput = relative(releaseRoot, outputDirectory);
if (relativeOutput.startsWith(`..${sep}`) || relativeOutput === '..') {
  throw new Error('Release assets must be staged inside the repository release directory.');
}

const assets = [
  ['dist/Clawd-Codex-V2.zip', 'Clawd-Codex-V2.zip'],
  ['exports/wallpapers/Clawd-dark-3840x2160.png', 'Clawd-dark-3840x2160.png'],
  ['exports/wallpapers/Clawd-light-3840x2160.png', 'Clawd-light-3840x2160.png'],
];
await mkdir(outputDirectory, { recursive: true });
for (const [sourceRelative, targetName] of assets) {
  const source = resolve(root, sourceRelative);
  const metadata = await stat(source).catch(() => null);
  if (!metadata?.isFile()) throw new Error(`Required release asset is missing: ${sourceRelative}`);
  await copyFile(source, resolve(outputDirectory, targetName));
}
console.log(`Staged ${assets.length} Codex and wallpaper assets in ${outputDirectory}.`);
