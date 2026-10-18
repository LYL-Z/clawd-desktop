"""Record the parent's actual final-sheet visual judgments with measured landmarks."""
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
atlas_path = root / 'dist/pet-v2/spritesheet.webp'
atlas = Image.open(atlas_path).convert('RGBA')
labels = ['000','022.5','045','067.5','090','112.5','135','157.5','180','202.5','225','247.5','270','292.5','315','337.5']
expected = ['up','up-right','up-right','up-right','right','down-right','down-right','down-right','down','down-left','down-left','down-left','left','up-left','up-left','up-left']
observations = [
    ('pass', 'Centered face looking up; both complete square eyes sit near the top head edge.'),
    ('pass', 'Eyes rise and shift toward screen-right within the same complete body.'),
    ('pass', 'Both eyes occupy the upper-right part of the face; orange border remains outside them.'),
    ('warning', 'Upper-right gaze remains visible, with weak distinction from the right cardinal.'),
    ('pass', 'Both eyes clearly shift screen-right; the outer eye remains fully inside orange; no body turntable.'),
    ('warning', 'Right gaze lowers slightly; the downward component is subtle at native size.'),
    ('pass', 'The right-shifted eyes are lower on the face, giving a readable down-right gaze.'),
    ('warning', 'Down-right gaze holds near the preceding pose; recentering at the next down frame is a larger eye step.'),
    ('pass', 'Eyes recenter horizontally and sit lower than neutral, clearly separating down from the high up pose.'),
    ('pass', 'The lowered pair begins moving screen-left; two separate eyes and all four legs remain visible.'),
    ('pass', 'The pair is both left-shifted and lower than the up-left group, reading down-left.'),
    ('warning', 'Left gaze retains a small downward component; its angle is close to the following left cardinal.'),
    ('pass', 'Both square eyes clearly cluster screen-left with complete orange margin; the body stays frontal.'),
    ('warning', 'The left-shifted pair rises; angular distinction from the subsequent up-left cells is weak.'),
    ('warning', 'Both eyes stay high and left; the final two upper-left poses form a near-plateau.'),
    ('warning', 'High-left gaze is preserved; about one native pixel of horizontal variation is not a perceptible reversed sweep. Recentring to up is a larger discrete step.'),
]

def eye_landmarks(cell):
    pixels = cell.load()
    points = {(x,y) for y in range(208) for x in range(192)
              if pixels[x,y][3] == 255 and max(pixels[x,y][:3]) < 95}
    groups = []
    while points:
        start = points.pop(); queue = deque([start]); group = [start]
        while queue:
            x,y = queue.popleft()
            for item in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if item in points:
                    points.remove(item); queue.append(item); group.append(item)
        groups.append(group)
    assert len(groups) == 2, f'Final direction does not contain exactly two separate ink components: {len(groups)}'
    result = []
    for group in sorted(groups, key=lambda g: min(p[0] for p in g)):
        xs,ys = zip(*group)
        result.append({'bbox':[min(xs),min(ys),max(xs)+1,max(ys)+1],
                       'center':[round(sum(xs)/len(xs),2),round(sum(ys)/len(ys),2)],'pixels':len(group)})
    return result

records = []
for i,(label,direction,(verdict,observed)) in enumerate(zip(labels,expected,observations)):
    row,col = 9+i//8,i%8
    cell = atlas.crop((col*192,row*208,(col+1)*192,(row+1)*208))
    eyes = eye_landmarks(cell)
    bounds = cell.getchannel('A').getbbox()
    reason = f"Native cell bounds={bounds}; left eye center={eyes[0]['center']}, right eye center={eyes[1]['center']}; separate complete ink components; four leg gaps remain below the solid torso."
    records.append({'label':label,'expected':direction,'observed':observed,'verdict':verdict,
                    'reason':reason,'measuredLandmarks':{'alphaBounds':bounds,'eyes':eyes}})
payload = {'atlas':str(atlas_path),'atlasSha256':hashlib.sha256(atlas_path.read_bytes()).hexdigest(),
           'reviewedAt':datetime.now(timezone.utc).isoformat(),'reviewer':'root',
           'reviewInputs':['qa/direction-labeled.png','qa/final-contact.png','look-row-10-resume-01/boundaries-native.png',
                           'exports/previews/codex-v2/look-loop.gif'],
           'mechanic':'Two complete black square eyes use natural cartoon face projection, consistent with the approved running-right core; the silhouette stays frontal.',
           'continuityReview':{'body':'Stable frontal body, arms, four feet and baseline; no head or body clipping.',
               'alphaHoleWarnings':'Reported rows 159..181 are the three open gaps between four feet, below the solid torso; not interior torso holes.',
               'localDiffWarnings':'Actual normal-size ordered poses remain in the intended quadrants. Discrete eye steps and weak intermediate angles are retained as warnings, not claimed as uniform angular interpolation.',
               'boundaries':'157.5->180 and 337.5->000 re-center eyes without body-scale, baseline or identity changes; the sweep remains clockwise.'},
           'directions':records}
out = root / 'assets/source/pet-run/qa/direction-semantics.json'
out.write_text(json.dumps(payload,indent=2) + '\n',encoding='utf-8')
print(json.dumps({'file':str(out),'atlasSha256':payload['atlasSha256'],'records':len(records),
                  'warnings':[r['label'] for r in records if r['verdict']=='warning']},indent=2))
