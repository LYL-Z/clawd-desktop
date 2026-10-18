"""Fit only generated extension and chorus pixels to the shared canvas."""
from pathlib import Path
import argparse, json, sys, importlib.util
from PIL import Image
argparse_parser=argparse.ArgumentParser()
argparse_parser.add_argument('--skill-scripts', required=True, help='Path to the create-pet skill scripts directory')
skill=Path(argparse_parser.parse_args().skill_scripts)
spec=importlib.util.spec_from_file_location('bundled_extract',skill/'extract_strip_frames.py'); ex=importlib.util.module_from_spec(spec);spec.loader.exec_module(ex)
root=Path('assets/source'); runtime=Path('assets/runtime');run=root/'pet-run'
body=(218,119,88);ink=(20,20,19)
pal=[ink,body,(250,249,245),(106,155,204),(247,202,99),(165,119,47),(188,78,60),(75,63,161),(85,85,82),(145,145,140)]
def clean(im,core=False):
 im=im.convert('RGBA');out=Image.new('RGBA',im.size)
 def col(p):
  r,g,b,a=p
  if a<128 or (r>150 and b>140 and g<110):return (0,0,0,0)
  if core:return (*ink,255) if max(r,g,b)<95 else (*body,255)
  c=min(pal,key=lambda c:sum((c[i]-p[i])**2 for i in range(3)));return (*c,255)
 out.putdata([col(p) for p in im.getdata()]);return out
report={'anchor':{'x':96,'y':184},'source':'built-in image_gen; actual generated components only','items':{}}
extatlas=Image.new('RGBA',(1536,416))
for row,(fn,sc) in enumerate([('rest-strip.png',142/310),('interaction-strip.png',142/282)]):
 im=Image.open(root/'extensions'/fn).convert('RGBA');im=ex.remove_chroma_background(im,(255,0,255),96)
 groups=ex.component_frame_groups(im,6);bbs=[ex.component_bounds(g) for g in groups];baseline=max(b[3] for b in bbs)
 paths=[]
 for i,(g,bb) in enumerate(zip(groups,bbs)):
  # Component crop, uniform row-wide scale, preserve true vertical offset to common ground.
  part=clean(ex.component_group_image(im,g,padding=0),True);part=part.resize((round(part.width*sc),round(part.height*sc)),Image.Resampling.NEAREST)
  cell=Image.new('RGBA',(192,208));left=round(96-part.width/2);top=round(184-(baseline-bb[1])*sc);cell.alpha_composite(part,(left,top));extatlas.alpha_composite(cell,(i*192,row*208))
  d=run/'qa/extensions-frames'/fn.removesuffix('-strip.png');d.mkdir(parents=True,exist_ok=True);p=d/f'{i:02d}.png';cell.save(p);paths.append(str(p))
 report['items'][fn]={'row':row,'scale':sc,'sourceBounds':bbs,'framePaths':paths,'bounds':[list(Image.open(p).getbbox()) for p in paths]}
extatlas.save(runtime/'extensions.webp',lossless=True,quality=100,method=6,exact=True)
# Chorus: four body+prop source groups, no invented pixels.
im=Image.open(root/'theatre/chorus-raw.png').convert('RGBA');groups=ex.component_frame_groups(im,4);bbs=[ex.component_bounds(g) for g in groups];sc=142/max(b[2]-b[0] for b in bbs);baseline=max(b[3] for b in bbs)
chorus=Image.new('RGBA',(768,208))
for i,(g,bb) in enumerate(zip(groups,bbs)):
 part=clean(ex.component_group_image(im,g,padding=0));part=part.resize((round(part.width*sc),round(part.height*sc)),Image.Resampling.NEAREST)
 cell=Image.new('RGBA',(192,208));cell.alpha_composite(part,((192-part.width)//2,round(184-(baseline-bb[1])*sc)));chorus.alpha_composite(cell,(i*192,0))
chorus.save(runtime/'chorus.webp',lossless=True,quality=100,method=6,exact=True)
report['items']['chorus']={'count':4,'sourceBounds':bbs,'scale':sc,'order':['camera','bulb','heart','bubble']}
(root/'extensions/runtime-registration.json').write_text(json.dumps(report,indent=2)+'\n')
p=runtime/'animations.json';m=json.loads(p.read_text())
# Distinct new generated sleep and interaction poses are separate from core states.
def anim(row,start,count,durations):return {'atlas':'extensions.webp','row':row,'startFrame':start,'count':count,'durations':durations}
m['animations'].update({'sleep':anim(0,0,3,[260,400,1200]),'wake':anim(0,3,3,[220,180,260]),'held':anim(1,0,2,[240,280]),'thrown':anim(1,2,2,[180,180]),'landing':anim(1,4,2,[120,240])})
# Explicit body descriptors for the other independent runtime actions; host supplies movement/masking/props.
refs={'peek-left':(0,6,[140,140,140,140,140,280]),'peek-right':(0,6,[140,140,140,140,140,280]),'turn':(0,6,[100]*6),'sway':(0,6,[120]*6),'headphone-groove':(0,6,[140]*6),'skate':(1,8,[120]*7+[220]),'skate-jump':(4,5,[140]*4+[280]),'wizard-charge':(6,6,[150]*5+[260]),'wizard-cast':(3,4,[140]*3+[280]),'hardhat-work':(7,6,[120]*5+[220]),'detective-inspect':(8,6,[150]*5+[280]),'chef-prepare':(7,6,[120]*5+[220]),'cowboy-tip':(3,4,[140]*3+[280]),'football':(0,6,[140]*6)}
for k,(row,count,dur) in refs.items():m['animations'][k]={'atlas':'core-standard.webp','row':row,'count':count,'durations':dur}
m['chorus']={'atlas':'chorus.webp','cellWidth':192,'cellHeight':208,'count':4,'anchor':{'x':96,'y':184}}
m['headReferenceY']=90
p.write_text(json.dumps(m,indent=2)+'\n')
print('Saved extensions.webp, chorus.webp, 19 extension action descriptors, shared registration report.')
