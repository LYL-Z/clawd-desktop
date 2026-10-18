"""Refine scanline-hole measurements using exact exterior connectivity and four-foot geometry.

The bundled measurement calls any transparent span between row endpoints a hole.
It therefore also reports the three intentional open slots between Clawd's feet.
Keep the original report and reject this classification unless every claimed slot
has four real feet, agrees with the bottom-foot geometry, and reaches the exterior.
No atlas pixels, bundled scripts, acceptance thresholds or true holes are changed.
"""
import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
from PIL import Image

def occupied_runs(alpha, y):
    runs = []; start = None
    for x in range(alpha.width + 1):
        on = x < alpha.width and alpha.getpixel((x,y)) > 16
        if on and start is None: start = x
        if not on and start is not None: runs.append((start,x)); start = None
    return runs

def bottom_exterior(alpha):
    exterior = {(x,alpha.height-1) for x in range(alpha.width) if alpha.getpixel((x,alpha.height-1)) <= 16}
    queue = deque(exterior)
    while queue:
        x,y = queue.popleft()
        for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0 <= nx < alpha.width and 0 <= ny < alpha.height and (nx,ny) not in exterior and alpha.getpixel((nx,ny)) <= 16:
                exterior.add((nx,ny)); queue.append((nx,ny))
    return exterior

def leg_slot_proof(alpha, y, exterior):
    bounds = alpha.getbbox()
    if bounds is None or y < bounds[1] + .65*(bounds[3]-bounds[1]): return None
    runs = occupied_runs(alpha,y)
    reference = occupied_runs(alpha,bounds[3]-3)
    if len(runs) != 4 or len(reference) != 4: return None
    if any(not 7 <= end-start <= .28*(bounds[2]-bounds[0]) for start,end in runs): return None
    gaps = [(runs[i][1],runs[i+1][0]) for i in range(3)]
    foot_gaps = [(reference[i][1],reference[i+1][0]) for i in range(3)]
    if any(end-start < 5 for start,end in gaps): return None
    for (start,end),(ref_start,ref_end) in zip(gaps,foot_gaps):
        overlap = max(0,min(end,ref_end)-max(start,ref_start))
        if overlap < .7*(end-start): return None
        if any((x,y) not in exterior for x in range(start,end)): return None
    return {'row':y,'fourOpaqueFootRuns':runs,'threeExteriorSlots':gaps,
            'bottomReferenceRuns':reference,'allSlotPixelsReachBottomExterior':True}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('atlas');p.add_argument('--raw',required=True);p.add_argument('--output',required=True);p.add_argument('--evidence',required=True)
    a = p.parse_args()
    source,output = Path(a.raw).resolve(),Path(a.output).resolve()
    assert source != output, 'Raw bundled report must remain unchanged'
    payload = json.loads(source.read_text(encoding='utf-8'))
    atlas_path = Path(a.atlas).resolve();atlas = Image.open(atlas_path).convert('RGBA')
    assert atlas.size == (1536,2288)
    labels = ['000','022.5','045','067.5','090','112.5','135','157.5','180','202.5','225','247.5','270','292.5','315','337.5']
    audit = []
    for item in payload.get('alphaHoles',[]):
        index = labels.index(item['direction']);row,col = 9+index//8,index%8
        alpha = atlas.crop((col*192,row*208,(col+1)*192,(row+1)*208)).getchannel('A')
        exterior = bottom_exterior(alpha);kept = [];excluded = []
        for hole in item.get('holes',[]):
            proof = leg_slot_proof(alpha,hole['row'],exterior)
            if proof: excluded.append(proof)
            else: kept.append(hole)
        item['holes'] = kept
        audit.append({'direction':item['direction'],'exteriorLegSlotRows':excluded,'retainedUnclassifiedHoleRows':kept})
    evidence = {'atlas':str(atlas_path),'atlasSha256':hashlib.sha256(atlas_path.read_bytes()).hexdigest(),
                'rawMeasurement':str(source),'rawMeasurementSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                'operation':'Measurement classification only; exact opaque four-foot runs and bottom-exterior flood fill required. True holes, seams and unmatched gaps are retained.',
                'directions':audit}
    payload['measurementRefinement'] = {'evidence':str(Path(a.evidence).resolve()),'atlasSha256':evidence['atlasSha256'],
        'excludedRows':sum(len(d['exteriorLegSlotRows']) for d in audit),
        'retainedRows':sum(len(d['retainedUnclassifiedHoleRows']) for d in audit)}
    # Preserve every raw warning. The audit explains which scanline warnings are intentional external foot slots.
    Path(a.evidence).write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    output.write_text(json.dumps(payload,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(payload['measurementRefinement'],indent=2))

if __name__ == '__main__': main()
