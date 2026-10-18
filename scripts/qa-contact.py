from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent.parent
files = list((root / 'qa/runtime/wardrobe').glob('*.png'))
sheet = Image.new('RGB', (1200, ((len(files)+3)//4)*260), '#f0eee6')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 18)
for i, file in enumerate(files):
    image = Image.open(file).convert('RGB')
    # Crop the actual stage screenshot; the pet is anchored at bottom center.
    cx, cy = image.width//2, round(image.height*0.76)
    image = image.crop((cx-280, cy-290, cx+280, image.height)).resize((280, 220), Image.Resampling.NEAREST)
    x, y = (i%4)*300+10, (i//4)*260
    sheet.paste(image,(x,y));draw.text((x+8,y+227),file.stem,font=font,fill='#141413')
sheet.save(root / 'qa/runtime/wardrobe-contact.png')
