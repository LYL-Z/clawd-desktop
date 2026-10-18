"""Normalize encoded colors and alpha only; preserve all source pose geometry."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('source')
p.add_argument('--output', required=True)
p.add_argument('--report', required=True)
a = p.parse_args()
source, output = Path(a.source).resolve(), Path(a.output).resolve()
assert source != output, 'Preserve the raw assembled source'
image = Image.open(source).convert('RGBA')
assert image.size == (1536, 2288)
pixels = list(image.getdata())
cleaned = []
for r, g, b, alpha in pixels:
    if alpha < 128 or (r > 150 and b > 140 and g < 110):
        cleaned.append((0, 0, 0, 0))
    elif max(r, g, b) < 95:
        cleaned.append((20, 20, 19, 255))
    else:
        cleaned.append((218, 119, 88, 255))
result = Image.new('RGBA', image.size)
result.putdata(cleaned)
output.parent.mkdir(parents=True, exist_ok=True)
result.save(output)
report = {
    'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'output': str(output), 'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'operation': 'Palette and binary-alpha normalization only; no spatial edits, eye repositioning or new anatomy',
    'palette': {'terracotta': '#DA7758', 'ink': '#141413', 'transparent': '#00000000'},
    'changedPixels': sum(before != after for before, after in zip(pixels, cleaned)),
    'counts': {str(color): count for color, count in Counter(cleaned).items()},
    'size': list(result.size),
}
Path(a.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
