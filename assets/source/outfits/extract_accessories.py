"""Extract generated accessory pixels only; never draws or synthesizes artwork."""
from __future__ import annotations

from collections import deque
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
source = root / "accessory-strip-01.png"
image = Image.open(source).convert("RGBA")
width, height = image.size
alpha = image.getchannel("A")
mask = bytearray(value >= 128 for value in alpha.get_flattened_data())
components = []
for index in range(width * height):
    if not mask[index]:
        continue
    queue = deque([index])
    mask[index] = 0
    pixels = []
    min_x = max_x = index % width
    min_y = max_y = index // width
    while queue:
        p = queue.popleft()
        pixels.append(p)
        x, y = p % width, p // width
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
        for n in ((p - 1 if x else -1), (p + 1 if x + 1 < width else -1), p - width, p + width):
            if 0 <= n < len(mask) and mask[n]:
                mask[n] = 0
                queue.append(n)
    components.append({"bbox": (min_x, min_y, max_x + 1, max_y + 1), "area": len(pixels), "pixels": pixels})

major = sorted((c for c in components if c["area"] >= 200), key=lambda c: c["bbox"][0])
# The generated monocle rim and chain contain one tiny native transparent gap.
# Preserve their actual pixels in one accessorized group; do not bridge/redraw it.
if len(major) == 11 and major[7]["bbox"] == (1470, 334, 1524, 403) and major[8]["bbox"] == (1524, 347, 1536, 391):
    a, b = major[7], major[8]
    major[7:9] = [{"bbox": (1470, 334, 1536, 403), "area": a["area"] + b["area"], "pixels": a["pixels"] + b["pixels"]}]
    # Three small native-blue chain segments are intended parts of the monocle.
    chain = [c for c in components if 10 <= c["area"] < 200 and 1470 <= c["bbox"][0] <= 1544 and 334 <= c["bbox"][1] <= 448]
    for segment in chain:
        major[7]["pixels"].extend(segment["pixels"])
        major[7]["area"] += segment["area"]
    major[7]["bbox"] = (1470, 334, 1544, 448)
if len(major) != 10:
    print(json.dumps({"ok": False, "expected": 10, "actual": len(major), "components": [{k: v for k, v in c.items() if k != "pixels"} for c in major]}, indent=2))
    raise SystemExit(1)

names = ["headphones", "skateboard", "wizard-hat", "wizard-wand", "safety-helmet", "spanner", "detective-hat", "monocle", "chef-hat", "cowboy-hat"]
output = root / "extracted"
output.mkdir(exist_ok=True)
report = {"ok": True, "source": str(source), "source_size": image.size, "operation": "alpha>=128; connected generated pixels only; monocle retains its three native blue chain segments; no rescale, palette changes, drawing or final registration", "components": []}
report["minor_components"] = [{"bbox": c["bbox"], "area": c["area"]} for c in components if 10 <= c["area"] < 200]
for name, comp in zip(names, major):
    left, top, right, bottom = comp["bbox"]
    crop = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    src, dst = image.load(), crop.load()
    for pixel in comp["pixels"]:
        x, y = pixel % width, pixel // width
        red, green, blue, _ = src[x, y]
        dst[x - left, y - top] = (red, green, blue, 255)
    filename = output / f"{name}.png"
    crop.save(filename)
    report["components"].append({"id": name, "file": str(filename), "source_bbox": comp["bbox"], "size": crop.size, "area": comp["area"], "candidate_anchor": [round(crop.width / 2, 2), crop.height - 1], "anchor_note": "bottom-center candidate only; manually refine by accessory type before final registration"})
(root / "extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
