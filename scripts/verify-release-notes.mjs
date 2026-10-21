import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const notesPath = resolve(root, 'docs', `RELEASE-NOTES-v${version}.md`);
const changelogPath = resolve(root, 'CHANGELOG.md');
const [notes, changelog] = await Promise.all([
  readFile(notesPath, 'utf8').catch(() => null),
  readFile(changelogPath, 'utf8'),
]);

if (!notes) {
  throw new Error(`Missing version-specific release notes: docs/RELEASE-NOTES-v${version}.md`);
}

const normalizedNotes = notes.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
if (!normalizedNotes.startsWith(`# Clawd Desktop ${version}\n`)) {
  throw new Error(`Release notes title must match package version ${version}`);
}

const requiredHeadings = [
  '## 新增',
  '## 调整',
  '## 修复与回归保护',
  '## 安全与隐私',
  '## 兼容性与升级',
  '## 验证范围',
  '## 已知限制',
  '## 构建溯源',
  '## 发布文件与校验',
  '## 分发与地域范围',
];
const noteLines = normalizedNotes.split('\n');
const missingHeadings = requiredHeadings.filter((heading) => !noteLines.includes(heading));
if (missingHeadings.length > 0) {
  throw new Error(`Release notes for ${version} are missing required sections: ${missingHeadings.join(', ')}`);
}
for (const heading of requiredHeadings) {
  const start = noteLines.indexOf(heading) + 1;
  const end = noteLines.findIndex((line, index) => index >= start && line.startsWith('## '));
  const body = noteLines.slice(start, end < 0 ? undefined : end).join('\n').trim();
  if (!body) throw new Error(`Release notes section is empty: ${heading}`);
}

if (!noteLines.some((line) => line.includes(`release-manifest-v${version}.json`))) {
  throw new Error(`Release notes must identify the generated source-and-asset manifest for ${version}`);
}

const assetStart = noteLines.indexOf('## 发布文件与校验') + 1;
const nextHeading = noteLines.findIndex((line, index) => index >= assetStart && line.startsWith('## '));
const assetSection = noteLines.slice(assetStart, nextHeading < 0 ? undefined : nextHeading);
const assetSectionText = assetSection.join('\n');
for (const requiredAsset of [
  `Clawd-${version}-windows-x64.exe`,
  `Clawd-${version}-Setup-windows-x64.exe`,
  'Clawd-Codex-V2.zip',
  'Clawd-dark-3840x2160.png',
  'Clawd-light-3840x2160.png',
  `release-manifest-v${version}.json`,
  'SHA256SUMS.txt',
]) {
  if (!assetSectionText.includes(requiredAsset)) {
    throw new Error(`Release asset section must identify ${requiredAsset}`);
  }
}
if (!/manifest|清单/i.test(assetSectionText) || !/SHA-?256/i.test(assetSectionText)) {
  throw new Error('Release asset section must explain that generated manifest/checksum files are authoritative.');
}

const changelogHasVersion = changelog.replaceAll('\r\n', '\n').split('\n')
  .some((line) => line.startsWith(`## [${version}]`));
if (!changelogHasVersion) {
  throw new Error(`CHANGELOG.md has no entry for package version ${version}`);
}

for (const scriptName of ['pack', 'release']) {
  if (!packageJson.scripts[scriptName]?.includes('verify:release-notes')) {
    throw new Error(`npm run ${scriptName} must run the version-documentation gate`);
  }
}
for (const requiredCommand of [
  'stage-release-assets.mjs',
  'create-release-manifest.mjs',
  'create-checksums.mjs',
]) {
  if (!packageJson.scripts.release.includes(requiredCommand)) {
    throw new Error(`npm run release must run ${requiredCommand}`);
  }
}

console.log(`Release documentation gate passed for ${version}.`);
