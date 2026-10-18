"""Four-frame turn choreography from already approved core pixels."""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[3]
source = root / 'assets/runtime/core-standard.webp'
core = Image.open(source).convert('RGBA')
poses = [(1, 0, 'right'), (8, 1, 'front-transition'), (2, 0, 'left'), (0, 3, 'settle')]
sheet = Image.new('RGBA', (1536, 208))
for i, (row, column, _) in enumerate(poses):
    frame = core.crop((column * 192, row * 208, (column + 1) * 192, (row + 1) * 208))
    sheet.alpha_composite(frame, (i * 192, 0))
target = root / 'assets/runtime/turn.webp'
sheet.save(target, lossless=True, quality=100, method=6, exact=True)
assert Image.open(target).convert('RGBA').tobytes() == sheet.tobytes()
manifest = root / 'assets/runtime/animations.json'
m = json.loads(manifest.read_text(encoding='utf-8'))
m['animations']['turn'] = {'atlas': 'turn.webp', 'row': 0, 'count': 4, 'durations': [160, 100, 160, 220], 'loop': False}
manifest.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
report = {'processing': 'Exact cell copy and temporal ordering only, no generated pixels edited',
          'source': str(source.relative_to(root)).replace('\\', '/'), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'outputSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'poses': [{'row': row, 'column': column, 'meaning': name} for row, column, name in poses]}
(root / 'qa/runtime/turn-registration.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('Four-frame turn built from shared approved core cells.')
