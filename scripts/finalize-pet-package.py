"""Create a local package only from real, matching bundled gate reports."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
run = root / 'assets/source/pet-run'
package = root / 'dist/pet-v2'
atlas = package / 'spritesheet.webp'
digest = hashlib.sha256(atlas.read_bytes()).hexdigest()
paths = {
    'atlas': run / 'final/validation-extended.json',
    'quality': run / 'qa/pet-quality.json',
    'blind': run / 'qa/direction-blind-validation.json',
    'blindKey': run / 'qa/direction-blind-key.json',
    'previews': root / 'exports/previews/codex-v2/preview-report.json',
}
reports = {name: json.loads(path.read_text(encoding='utf-8')) for name, path in paths.items()}
refinement = run / 'qa/exterior-leg-gaps.json'
if json.loads(refinement.read_text(encoding='utf-8')).get('atlasSha256') != digest:
    raise SystemExit('Exterior-leg classification is for different atlas bytes')
for name in ('atlas', 'quality', 'blind'):
    if reports[name].get('ok') is not True:
        raise SystemExit(f'{name} gate has not passed; local package cannot be accepted')
for name, field in (('atlas', 'sha256'), ('quality', 'sha256'), ('blindKey', 'atlas_sha256'), ('previews', 'atlasSha256')):
    if reports[name].get(field) != digest:
        raise SystemExit(f'{name} report is for different atlas bytes')
if Path(reports['atlas']['file']).resolve() != atlas.resolve():
    raise SystemExit('Validation did not target the final local package path')
previews = root / 'exports/previews/codex-v2'
for name in ['all-states.gif', 'all-states.mp4', 'idle-jump-idle.gif', 'look-loop.gif', 'look-loop.mp4', 'four-stills.png']:
    if not (previews / name).is_file():
        raise SystemExit(f'Missing required preview: {name}')
proofs = package / 'qa'
proofs.mkdir(exist_ok=True)
for path in [*paths.values(), refinement, run / 'qa/chroma-despill-extended.json', run / 'qa/direction-semantics.json', run / 'qa/look-continuity.json', run / 'qa/look-continuity-raw.json', run / 'qa/pet-quality-raw-failed.json', run / 'qa/direction-blind-verdicts.json', *[root / f'qa/blind-{name}.json' for name in 'abc']]:
    shutil.copy2(path, proofs / path.name)
pet = {'id': 'clawd', 'displayName': 'Clawd',
       'description': 'A terracotta pixel companion inspired by the supplied Claude references.',
       'spriteVersionNumber': 2, 'spritesheetPath': 'spritesheet.webp'}
(package / 'pet.json').write_text(json.dumps(pet, indent=2) + '\n', encoding='utf-8')
acceptance = {'recordedAt': datetime.now(timezone.utc).isoformat(), 'atlasSha256': digest,
              'atlasBytes': atlas.stat().st_size, 'atlasValidationOk': reports['atlas']['ok'],
              'petQualityOk': reports['quality']['ok'], 'blindDirectionsOk': reports['blind']['ok'],
              'localCodexActuallyLoaded': False, 'installedOrSelected': False,
              'reports': {name: {'path': str(path.relative_to(root)).replace('\\', '/'),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in paths.items()}}
(package / 'acceptance.json').write_text(json.dumps(acceptance, indent=2) + '\n', encoding='utf-8')
(package / 'README.txt').write_text(
    'CLAWD / Codex V2 本地宠物包\n\n'
    '此压缩包只包含 Codex 宠物描述文件与透明 WebP 图集；互动、动作和显示由 Codex 宿主决定。\n\n'
    '安装：将 clawd 目录复制到 CODEX_HOME/pets/clawd（默认位于用户目录下的 .codex/pets/clawd）。\n'
    '如果同名目录已存在，请先备份，再复制文件；随后在 Codex 宠物设置中手动选择 Clawd。\n'
    '此包不会自动安装、切换宠物或设置自启动。\n\n'
    '这是基于用户提供参考制作的本地 Claude / Clawd 粉丝作品，不是 Anthropic 或 OpenAI 官方产品。\n'
    '名称、标识及相关第三方权利仍归各自权利人所有；公开可见不代表获得再分发或商业使用授权。\n',
    encoding='utf-8')

# The QA reports above remain available in the local build tree for review, but
# are intentionally excluded from the user-facing pet archive. Ship only the
# files the host loader needs and a short installation/rights note.
archive_path = root / 'dist/Clawd-Codex-V2.zip'
release_files = {
    'pet.json': package / 'pet.json',
    'spritesheet.webp': atlas,
    'README.txt': package / 'README.txt',
}
with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, path in release_files.items():
        archive.write(path, f'clawd/{name}')

with zipfile.ZipFile(archive_path) as archive:
    actual = set(archive.namelist())
    expected = {f'clawd/{name}' for name in release_files}
    if actual != expected:
        raise SystemExit(f'Unexpected Codex archive members: {sorted(actual ^ expected)}')
print(json.dumps(acceptance, indent=2))
