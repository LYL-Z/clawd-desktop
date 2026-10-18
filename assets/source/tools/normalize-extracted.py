"""Deterministic cleanup of already extracted generated pixels; never draws new anatomy."""
from pathlib import Path
import json
from PIL import Image
root=Path(__file__).resolve().parents[1]/'pet-run'
src=root/'qa/frames-raw'; dst=root/'qa/frames'
scale=.80; ground=184
report={'operation':'uniform nearest-neighbor scale of generated pixels, binary alpha, two-color palette, row-shared ground registration','scale':scale,'anchor':{'x':96,'y':ground},'body':'#DA7758','ink':'#141413','rows':{}}
for d in sorted(src.iterdir()):
    if not d.is_dir(): continue
    frames=[]
    for p in sorted(d.glob('*.png')):
        im=Image.open(p).convert('RGBA')
        out=Image.new('RGBA',im.size)
        out.putdata([(0,0,0,0) if a<128 or (r>150 and b>140 and g<110) else ((20,20,19,255) if max(r,g,b)<95 else (218,119,88,255)) for r,g,b,a in im.getdata()])
        out=out.resize((154,166),Image.Resampling.NEAREST)
        frames.append((p,out))
    baseline=max(im.getbbox()[3] for _,im in frames)
    dy=ground-baseline
    paths=[]
    for p,im in frames:
        frame=Image.new('RGBA',(192,208));frame.alpha_composite(im,(19,dy))
        target=dst/d.name/p.name; target.parent.mkdir(parents=True,exist_ok=True);frame.save(target);paths.append(str(target))
    report['rows'][d.name]={'sourceFrames':len(frames),'scaledMaxBottom':baseline,'translation':{'x':19,'y':dy},'bounds':[list(Image.open(p).getbbox()) for p in paths]}
# Preserve the real bundled extraction manifest with corrected destination paths.
m=json.loads((src/'frames-manifest.json').read_text())
for row in m['rows']:
    row['frames']=[str(dst/row['state']/Path(p).name) for p in row['frames']]
(dst/'frames-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
(root/'qa/normalization.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
