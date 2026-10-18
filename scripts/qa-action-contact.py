from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
root = Path(__file__).resolve().parent.parent
actions = json.loads((root/'assets/runtime/animations.json').read_text(encoding='utf-8-sig'))['animations']
sheet = Image.new('RGB',(1200,len(actions)*185),'#f0eee6')
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
for row, action in enumerate(actions):
    draw.text((10,row*185+8),action,font=font,fill='#141413')
    for col, phase in enumerate([0.15,0.5,0.85]):
        image=Image.open(root/f'qa/runtime/actions/{action}-{phase}.png').convert('RGB')
        cx=image.width//2
        image=image.crop((cx-350,image.height-520,cx+350,image.height)).resize((350,150),Image.Resampling.NEAREST)
        sheet.paste(image,(130+col*355,row*185+30))
sheet.save(root/'qa/runtime/actions-contact.png')
