"""Spacing guide for generated supplementary props; no artwork."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent
image = Image.new("RGB", (768, 256), "#f7f7f7")
draw = ImageDraw.Draw(image)
for i in range(3):
    left = i * 256
    draw.rectangle((left, 0, left + 255, 255), outline="#111111", width=2)
    draw.rectangle((left + 20, 20, left + 235, 235), outline="#5276bd", width=1)
image.save(root / "three-slot-guide.png")
