"""Reuse the user-liked generated lean poses; palette/alpha/layout only."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[3]
source = root / 'assets/source/pet-run/qa/cardinals-resume-06/registered'
core_path = root / 'assets/runtime/core-standard.webp'
core = Image.open(core_path).convert('RGBA')
sequence = ['idle-0', '000', '090', '000', '270', '180', '000', 'idle-3']
sheet = Image.new('RGBA', (1536, 208))
records = []
for column, key in enumerate(sequence):
    if key.startswith('idle-'):
        i = int(key.split('-')[1])
        frame = core.crop((i * 192, 0, (i + 1) * 192, 208))
        source_path = core_path
    else:
        source_path = source / f'{key}.png'
        frame = Image.open(source_path).convert('RGBA')
        assert frame.size == (192, 208)
        clean = Image.new('RGBA', frame.size)
        clean.putdata([(0, 0, 0, 0) if a < 128 or (r > 150 and b > 140 and g < 110)
                       else ((20, 20, 19, 255) if max(r, g, b) < 95 else (218, 119, 88, 255))
                       for r, g, b, a in frame.getdata()])
        frame = clean
    assert frame.getchannel('A').getextrema() == (0, 255)
    sheet.alpha_composite(frame, (column * 192, 0))
    records.append({'cell': column, 'pose': key, 'source': str(source_path.relative_to(root)).replace('\\', '/'),
                    'sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'bounds': frame.getbbox()})
output = root / 'assets/runtime/curious.webp'
sheet.save(output, lossless=True, quality=100, method=6, exact=True)
assert Image.open(output).convert('RGBA').tobytes() == sheet.tobytes()
manifest_path = root / 'assets/runtime/animations.json'
m = json.loads(manifest_path.read_text(encoding='utf-8'))
m['animations']['sway'] = {'atlas': 'curious.webp', 'row': 0, 'count': 8,
    'durations': [180, 140, 200, 120, 200, 160, 140, 220], 'loop': False,
    'label': '歪头打量与回稳'}
manifest_path.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
report = {'source': 'Built-in image_gen cardinal resume 06; user explicitly liked this version on 2026-10-16',
          'purpose': 'Independent desktop sway/curiosity; not used as directional-semantic acceptance',
          'processing': 'Existing shared registration; binary alpha and two-color palette; no anatomical edits',
          'output': str(output.relative_to(root)).replace('\\', '/'),
          'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'cells': records}
(source.parent / 'runtime-curious-registration.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
contact = Image.new('RGBA', (1536, 240), '#faf9f5')
contact.alpha_composite(sheet, (0, 24))
draw = ImageDraw.Draw(contact)
for i, key in enumerate(sequence):
    draw.text((i * 192 + 8, 6), key, fill='#141413')
contact.convert('RGB').save(root / 'qa/runtime/curious-contact.png')
print(json.dumps({'file': str(output), 'sha256': report['sha256']}, ensure_ascii=False))
