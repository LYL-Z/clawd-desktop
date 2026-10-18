from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
image = Image.open(root / 'assets/runtime/icon.png').convert('RGBA')
image = image.resize((256, 256), Image.Resampling.NEAREST)
image.save(root / 'app/icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
