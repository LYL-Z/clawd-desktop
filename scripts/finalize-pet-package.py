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
(package / 'README.txt').write_text('CLAWD / Codex V2 本地宠物包\n\n复制pet.json与spritesheet.webp到CODEX_HOME/pets/clawd（默认用户.codex/pets/clawd）。\n请先备份同名目录，再在Codex宠物设置手动选择。当前未自动安装或选中。\n最终图集已通过本地bundled结构、质量与三份隔离方向盲审；尚未在Codex实际加载。\n连续性原始扫描把外部腿缝也列作内部孔；保留原始失败记录，并以四足形状与向下外部连通性分类后重跑原质量脚本。没有改图、修改bundled脚本或放宽阈值。\n部分中间角度及离散眼位步进保留为视觉警告，未宣称匀速角度插值。\nGIF、MP4和完整源文件见项目exports/previews/codex-v2与assets/source。\n本地粉丝作品，非官方发布。\n', encoding='utf-8')
with zipfile.ZipFile(root / 'dist/Clawd-Codex-V2.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(package.rglob('*')):
        if path.is_file():
            archive.write(path, str(Path('clawd') / path.relative_to(package)))
print(json.dumps(acceptance, indent=2))
