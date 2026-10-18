"""Deterministically register generated accessory pixels; never draws pet/prop art.

This atlas is a transparent accessory layer. The renderer supplies approved body
frames separately. Source art is never overwritten. Contact-sheet rectangles and
labels are QA furniture only and are never put into the runtime atlas.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).resolve().parent
WIDTH, HEIGHT, COLS, ROWS, COUNT = 192, 208, 8, 15, 6
GROUND = 184

PALETTES = {
    "headphones": ["#0a527d", "#f6f5e9"],
    "skateboard": ["#482139", "#f0c56a", "#30241b"],
    "wizard-hat": ["#5345a4", "#242788", "#f7f4de"],
    "wizard-wand": ["#141413", "#f4d25b", "#faf8e5"],
    "safety-helmet": ["#f4c65c", "#bd903c"],
    "spanner": ["#696965", "#3a3a38"],
    "detective-hat": ["#191813", "#704a19"],
    "monocle": ["#20208e"],
    "chef-hat": ["#f9f8eb", "#e4e4da", "#f0f0e5"],
    "cowboy-hat": ["#75470c", "#482c08"],
    "workbench": ["#b6b6b0", "#545450", "#f7f5e7"],
    "football": ["#141413", "#faf9ee"],
    "wand-tip-light": ["#141413", "#f6d877", "#faf5d6"],
}

PART_SPECS = {
    "headphones": ("extracted", .55, (119.5, 53)),
    "skateboard": ("extracted", 154 / 254, (127, 16)),
    "wizard-hat": ("extracted", .52, (121.5, 157)),
    "wizard-wand": ("extracted", .55, (24, 114)),
    "safety-helmet": ("extracted", .60, (96.5, 96)),
    "spanner": ("extracted", .60, (26.5, 87)),
    "detective-hat": ("extracted", .60, (95.5, 91)),
    "monocle": ("extracted", .48, (27, 34)),
    "chef-hat": ("extracted", .60, (93, 123)),
    "cowboy-hat": ("extracted", .53, (133.5, 106)),
    "workbench": ("extra-extracted", .30, (195, 218)),
    "football": ("extra-extracted", 26 / 230, (115, 115)),
    "wand-tip-light": ("extra-extracted", .285, (66.5, 224)),
}


def rgb(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def quantize_existing(image: Image.Image, palette: list[str]) -> Image.Image:
    """Map existing opaque generated colors, without changing silhouette."""
    colors = [rgb(color) for color in palette]
    result = Image.new("RGBA", image.size, (0, 0, 0, 0))
    source_pixels, target_pixels = image.load(), result.load()
    cache = {}
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = source_pixels[x, y]
            if alpha < 128:
                continue
            key = (red, green, blue)
            if key not in cache:
                cache[key] = min(colors, key=lambda color: sum((a - b) ** 2 for a, b in zip(key, color)))
            target_pixels[x, y] = (*cache[key], 255)
    return result


parts = {}
part_report = {}
for part, (directory, scale, anchor) in PART_SPECS.items():
    filename = SOURCE / directory / f"{part}.png"
    image = Image.open(filename).convert("RGBA")
    dimensions = (round(image.width * scale), round(image.height * scale))
    normalized = quantize_existing(image, PALETTES[part]).resize(dimensions, Image.Resampling.NEAREST)
    # Aspect ratio differs only by integer output rounding; the art is not warped.
    scale_x, scale_y = dimensions[0] / image.width, dimensions[1] / image.height
    actual_anchor = (anchor[0] * scale_x, anchor[1] * scale_y)
    parts[part] = (normalized, actual_anchor)
    part_report[part] = {
        "source": str(filename.relative_to(ROOT)).replace("\\", "/"),
        "sourceSha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
        "sourceSize": list(image.size), "sourceAnchor": list(anchor),
        "requestedScale": scale, "actualSize": list(dimensions),
        "actualScale": [scale_x, scale_y],
        "actualAnchor": list(actual_anchor), "palette": PALETTES[part],
    }


def place(cell: Image.Image, part: str, target: tuple[float, float], follow="head") -> dict:
    image, anchor = parts[part]
    position = (round(target[0] - anchor[0]), round(target[1] - anchor[1]))
    bbox = image.getbbox()
    assert bbox is not None
    bounds = (position[0] + bbox[0], position[1] + bbox[1], position[0] + bbox[2], position[1] + bbox[3])
    if bounds[0] < 2 or bounds[1] < 2 or bounds[2] > WIDTH - 2 or bounds[3] > HEIGHT - 2:
        raise ValueError(f"Accessory would clip/squeeze safe padding: {part}, target={target}, bounds={bounds}")
    cell.alpha_composite(image, position)
    return {"part": part, "target": list(target), "position": list(position), "bounds": list(bounds), "follow": follow}


outfits = ["headphones", "skateboard", "wizard", "hardhat", "detective", "chef", "cowboy"]
row_metadata = []
atlas = Image.new("RGBA", (WIDTH * COLS, HEIGHT * ROWS), (0, 0, 0, 0))
cells = {}
small_dx = [0, 0, 1, 0, -1, 0]
small_dy = [0, -1, 0, 1, 0, 0]
sig_dx = [0, -2, -3, 2, 3, 0]
sig_dy = [0, -2, 0, 2, 0, 0]
head = (96, 90)
eye = (125, 107)  # Measured center of neutral idle00 right square eye.
grip = (164, 124)


def wardrobe_cell(outfit: str, signature: bool, index: int):
    cell = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    transforms = []
    dx = sig_dx[index] if signature else small_dx[index]
    dy = sig_dy[index] if signature else small_dy[index]
    if outfit == "headphones":
        transforms.append(place(cell, "headphones", (head[0] + dx, head[1] + dy)))
    elif outfit == "skateboard":
        image, _ = parts["skateboard"]
        # Both base and signature keep the actual last wheel pixel at y=183.
        transforms.append(place(cell, "skateboard", (96 + (dx if signature else 0), GROUND - image.height + parts["skateboard"][1][1]), "ground"))
    elif outfit == "wizard":
        transforms.append(place(cell, "wizard-hat", (head[0] + (dx // 2 if signature else 0), head[1] + (dy // 2 if signature else 0))))
        if signature:
            tool = "wand-tip-light" if index in (2, 3) else "wizard-wand"
            transforms.append(place(cell, tool, (grip[0] + [0, -1, 0, 0, 1, 0][index], grip[1] + [3, 0, -3, -3, 0, 3][index])))
    elif outfit == "hardhat":
        transforms.append(place(cell, "safety-helmet", (head[0] + (dx // 2 if signature else 0), head[1] + (dy // 2 if signature else 0))))
        if signature:
            transforms.append(place(cell, "spanner", (grip[0] + [0, 0, -2, 0, 2, 0][index], grip[1] + [0, -3, 0, 3, 0, 0][index])))
    elif outfit == "detective":
        transforms.append(place(cell, "detective-hat", (head[0] + (dx // 2 if signature else 0), head[1] + (dy // 2 if signature else 0))))
        transforms.append(place(cell, "monocle", (eye[0] + ([-1, 0, 1, 1, 0, -1][index] if signature else 0), eye[1] + ([0, -1, -1, 0, 1, 0][index] if signature else 0))))
    elif outfit == "chef":
        transforms.append(place(cell, "chef-hat", (head[0] + (dx // 2 if signature else 0), head[1] + (dy // 2 if signature else 0))))
        if signature:
            transforms.append(place(cell, "workbench", (96, GROUND), "ground"))
    elif outfit == "cowboy":
        transforms.append(place(cell, "cowboy-hat", (head[0] + ([0, 1, 2, 1, 0, 0][index] if signature else 0), head[1] + ([0, 2, 4, 3, 1, 0][index] if signature else 0))))
    return cell, transforms


for signature in (False, True):
    for outfit_index, outfit in enumerate(outfits):
        row = outfit_index + (7 if signature else 0)
        frames = []
        for frame in range(COUNT):
            cell, transforms = wardrobe_cell(outfit, signature, frame)
            atlas.alpha_composite(cell, (frame * WIDTH, row * HEIGHT))
            frames.append({"index": frame, "transforms": transforms})
            cells[(row, frame)] = cell
        row_metadata.append({"row": row, "id": outfit, "kind": "signature" if signature else "base", "count": COUNT, "bodyOffsetY": -42 if outfit == "skateboard" else 0, "frames": frames})

football_positions = [(170, 142), (163, 120), (150, 101), (138, 120), (160, 146), (170, 142)]
football_frames = []
for frame, target in enumerate(football_positions):
    cell = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    transform = place(cell, "football", target, "trajectory")
    atlas.alpha_composite(cell, (frame * WIDTH, 14 * HEIGHT))
    cells[(14, frame)] = cell
    football_frames.append({"index": frame, "transforms": [transform]})
row_metadata.append({"row": 14, "id": "football", "kind": "trajectory", "count": COUNT, "bodyOffsetY": 0, "frames": football_frames})

runtime = ROOT / "assets/runtime/wardrobe.webp"
runtime.parent.mkdir(parents=True, exist_ok=True)
atlas.save(runtime, format="WEBP", lossless=True, quality=100, method=6, exact=True)
encoded = Image.open(runtime).convert("RGBA")
assert encoded.size == (1536, 3120)
assert encoded.tobytes() == atlas.tobytes(), "WebP round-trip changed exact RGBA"
alpha_values = sorted(set(encoded.getchannel("A").get_flattened_data()))
assert alpha_values == [0, 255]
for row in range(ROWS):
    for col in range(COLS):
        bbox = encoded.crop((col * WIDTH, row * HEIGHT, (col + 1) * WIDTH, (row + 1) * HEIGHT)).getbbox()
        assert bool(bbox) == (col < COUNT), (row, col, bbox)

# QA compares the exact encoded accessory layer against one approved neutral pet.
neutral = Image.open(ROOT / "assets/source/pet-run/qa/frames/idle/00.png").convert("RGBA")
font_path = Path("C:/Windows/Fonts/segoeui.ttf")
font = ImageFont.truetype(str(font_path), 14) if font_path.exists() else ImageFont.load_default()
label_height = 24
contact = Image.new("RGB", (WIDTH * COUNT, (HEIGHT + label_height) * ROWS), "#efeee7")
draw = ImageDraw.Draw(contact)
eye_pixels = [(x, y) for y in range(90, 125) for x in range(50, 145) if neutral.getpixel((x, y))[3] and max(neutral.getpixel((x, y))[:3]) < 60]
occlusions = []
for metadata in sorted(row_metadata, key=lambda item: item["row"]):
    row = metadata["row"]
    top = row * (HEIGHT + label_height)
    draw.rectangle((0, top, WIDTH * COUNT, top + label_height), fill="#242421")
    label = f"{row:02d}  {metadata['id']} / {metadata['kind']}  | neutral body; exact encoded accessory pixels"
    if metadata["bodyOffsetY"]:
        label += f"; body dy {metadata['bodyOffsetY']}"
    draw.text((8, top + 3), label, font=font, fill="#faf9f5")
    for frame in range(COUNT):
        x, y = frame * WIDTH, top + label_height
        panel = Image.new("RGBA", (WIDTH, HEIGHT), "#efeee7" if frame % 2 == 0 else "#e2e1db")
        panel.alpha_composite(neutral, (0, metadata["bodyOffsetY"]))
        overlay = encoded.crop((frame * WIDTH, row * HEIGHT, (frame + 1) * WIDTH, (row + 1) * HEIGHT))
        panel.alpha_composite(overlay)
        contact.paste(panel.convert("RGB"), (x, y))
        if metadata["id"] not in ("skateboard", "football"):
            covered = [(px, py) for px, py in eye_pixels if overlay.getpixel((px, py))[3]]
            if covered:
                occlusions.append({"row": row, "frame": frame, "coveredEyePixels": len(covered)})

qa = ROOT / "qa/pet/wardrobe-contact.png"
qa.parent.mkdir(parents=True, exist_ok=True)
contact.save(qa)
report = {
    "schemaVersion": 1, "atlas": "assets/runtime/wardrobe.webp",
    "atlasSha256": hashlib.sha256(runtime.read_bytes()).hexdigest(),
    "atlasSize": list(encoded.size), "cellSize": [WIDTH, HEIGHT],
    "columns": COLS, "rows": ROWS, "validCells": ROWS * COUNT,
    "transparentUnusedCells": ROWS * (COLS - COUNT), "alphaValues": alpha_values,
    "exactLosslessRoundtrip": True,
    "sourceOperations": ["existing generated pixels only", "binary alpha", "limited-palette nearest-color mapping", "nearest-neighbor uniform scale with integer dimension rounding", "integer translation", "lossless WebP encoding"],
    "neutralLandmarks": {"headTopCenter": [96, 90], "rightEyeCenter": list(eye), "rightArmGrip": list(grip), "ground": GROUND},
    "runtimeRules": [
        "No idle body y displacement is baked into these cells. Apply actual core head offset once in the renderer.",
        "Transforms marked follow=head may follow body head offset; ground/trajectory pieces must retain their registered world baseline/trajectory.",
        "Skateboard rows 1 and 8 hold wheel bottom at y184; bodyOffsetY=-42 puts neutral feet on deck.",
        "Chef signature row 12 combines hat above y95 and table starting y119; if body moves, crop the headpiece and groundpiece separately so the table stays planted.",
        "Wizard/hardhat base rows intentionally have no held tool. Signature row9 has light replacement in frames2 and3.",
        "Only the neutral contact is verified here. Actual moving-body wardrobe attachment, walking, interruption and recovery remain runtime checks."
    ],
    "parts": part_report, "rowsDefinition": sorted(row_metadata, key=lambda item: item["row"]),
    "contact": str(qa.relative_to(ROOT)).replace("\\", "/"),
    "neutralEyeOcclusion": occlusions,
    "structuralValidation": "pass",
    "visualReview": "pending native contact inspection"
}
(SOURCE / "runtime-registration.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"ok": True, "atlas": str(runtime), "atlasSize": list(encoded.size), "validCells": ROWS * COUNT, "unusedCells": ROWS * (COLS-COUNT), "neutralEyeOcclusion": occlusions, "contact": str(qa)}, indent=2))
