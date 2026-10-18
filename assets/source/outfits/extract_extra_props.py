"""Extract supplementary generated props; no drawing or synthesized pixels."""
from collections import deque
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
source = root / "extra-props-strip.png"
image = Image.open(source).convert("RGBA")
width, height = image.size
mask = bytearray(a >= 128 for a in image.getchannel("A").get_flattened_data())
components = []
for index in range(width * height):
    if not mask[index]:
        continue
    queue, pixels = deque([index]), []
    mask[index] = 0
    while queue:
        p = queue.popleft()
        pixels.append(p)
        x, y = p % width, p // width
        for n in ((p - 1 if x else -1), (p + 1 if x + 1 < width else -1), p - width, p + width):
            if 0 <= n < len(mask) and mask[n]:
                mask[n] = 0
                queue.append(n)
    if len(pixels) >= 200:
        bounds = (min(p % width for p in pixels), min(p // width for p in pixels), max(p % width for p in pixels) + 1, max(p // width for p in pixels) + 1)
        components.append((bounds, pixels))
components.sort(key=lambda c: c[0][0])
if len(components) != 3:
    failure = {"ok":False,"expected":3,"actual":len(components),"major_components":[{"bbox":b,"area":len(p)} for b,p in components]}
    (root / "extra-extraction-failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
    print(json.dumps(failure, indent=2))
    raise SystemExit(1)

output = root / "extra-extracted"
output.mkdir(exist_ok=True)
report = {"ok":True,"source":str(source),"source_size":image.size,"operation":"Connected generated pixels only; alpha>=128, hidden RGB zero, no rescale or redrawing","pieces":[]}
for name, (bounds, pixels) in zip(("workbench", "football", "wand-tip-light"), components):
    left, top, right, bottom = bounds
    crop = Image.new("RGBA", (right-left, bottom-top), (0,0,0,0))
    src, dst = image.load(), crop.load()
    for p in pixels:
        x, y = p % width, p // width
        r,g,b,_ = src[x,y]
        dst[x-left,y-top] = (r,g,b,255)
    filename = output / f"{name}.png"
    crop.save(filename)
    report["pieces"].append({"id":name,"file":str(filename),"source_bbox":bounds,"size":crop.size,"opaque_pixels":len(pixels)})
(root / "extra-extraction-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
