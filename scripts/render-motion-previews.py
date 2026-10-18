"""Encode captures from the actual renderer; do not generate or redraw artwork."""
import argparse
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

p = argparse.ArgumentParser()
p.add_argument('--report', default='qa/runtime/motion.json')
p.add_argument('--output', default='exports/previews')
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
report = json.loads((root / args.report).read_text(encoding='utf-8'))
if not report.get('passed'):
    raise SystemExit('Capture report did not pass; no previews encoded.')
out = root / args.output
out.mkdir(parents=True, exist_ok=True)
font_path = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 16)
fps = report['fps']
contacts = []
outputs = []
for clip in report['clips']:
    frames = sorted((root / clip['directory']).glob('*.png'))
    if len(frames) != clip['frameCount']:
        raise SystemExit(f'Frame count mismatch: {clip["id"]}')
    rendered = []
    for path in frames:
        im = Image.open(path).convert('RGBA')
        canvas = Image.new('RGBA', (640, 456), '#faf9f5')
        canvas.alpha_composite(im, (0, 0))
        ImageDraw.Draw(canvas).text((18, 430), clip['label'], font=font, fill='#141413')
        rendered.append(canvas.convert('RGB'))
    target = out / clip['id']
    # Local GIF palettes preserve the actual captured colors across changing props.
    rendered[0].save(target.with_suffix('.gif'), save_all=True, append_images=rendered[1:],
                     duration=round(1000 / fps), loop=0, disposal=2, optimize=False)
    contact = Image.new('RGB', (640 * 3, 456), '#faf9f5')
    for x, fraction in enumerate((.2, .5, .8)):
        contact.paste(rendered[min(len(rendered) - 1, round((len(rendered) - 1) * fraction))], (x * 640, 0))
    contact.save(target.with_name(target.name + '-contact').with_suffix('.png'))
    contacts.append((clip['kind'], contact))
    video = target.with_suffix('.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i',
                    str(root / clip['directory'] / '%04d.png'), '-filter_complex',
                    f'color=c=0xfaf9f5:s=640x420:r={fps}[bg];[bg][0:v]overlay=shortest=1,format=yuv420p',
                    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-movflags', '+faststart', str(video)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], check=True)
    outputs.append({'id': clip['id'], 'frames': len(frames), 'fps': fps,
                    'mp4': str(video.relative_to(root)).replace('\\', '/'), 'decoded': True})
performances = [contact for kind, contact in contacts if kind == 'performance']
if performances:
    sheet = Image.new('RGB', (1920, 456 * len(performances)), '#faf9f5')
    for y, contact in enumerate(performances):
        sheet.paste(contact, (0, y * 456))
    sheet.save(out / 'performances-contact.png')
(out / 'encoding-report.json').write_text(json.dumps({'captureEvidence': report['evidence'],
    'sourceReport': args.report, 'outputs': outputs}, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'clips': len(outputs), 'output': str(out)}, ensure_ascii=False))
