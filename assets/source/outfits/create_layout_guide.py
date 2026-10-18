"""Deterministic spacing guide only; contains no character or accessory artwork."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
image = Image.new("RGB", (1792, 256), "#f7f7f7")
draw = ImageDraw.Draw(image)
for i in range(7):
    left = i * 256
    draw.rectangle((left, 0, left + 255, 255), outline="#111111", width=2)
    draw.rectangle((left + 20, 20, left + 235, 235), outline="#5276bd", width=1)
    draw.line((left + 128, 20, left + 128, 235), fill="#c4c4c4", width=1)
image.save(root / "seven-slot-guide.png")
