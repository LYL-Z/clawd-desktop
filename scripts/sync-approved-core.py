"""Share the accepted Codex atlas bytes with the independent desktop runtime."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'dist/pet-v2/spritesheet.webp'
digest = hashlib.sha256(source.read_bytes()).hexdigest()
proof = json.loads((source.parent/'acceptance.json').read_text(encoding='utf-8'))
assert proof['atlasSha256'] == digest and all(proof[k] for k in ('atlasValidationOk','petQualityOk','blindDirectionsOk'))
standard = Image.open(root/'assets/runtime/core-standard.webp').convert('RGBA')
full = Image.open(source).convert('RGBA')
assert full.crop((0,0,1536,1872)).tobytes() == standard.tobytes(), 'Do not alter the approved nine core rows'
target = root/'assets/runtime/core.webp'
target.write_bytes(source.read_bytes())
path = root/'assets/runtime/animations.json'
manifest = json.loads(path.read_text(encoding='utf-8').replace('core-standard.webp','core.webp'))
manifest['version'] = 2
manifest['look'] = {'startRow':9,'count':16}
manifest['productionStatus'] = 'Final V2 atlas accepted locally; intermediate-angle warnings documented; actual Codex loading not tested'
path.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'runtimeCoreSha256':digest,'codexAtlasByteIdentical':True,'nineCoreRowsUnchanged':True,'actions':len(manifest['animations']),'look':manifest['look']},indent=2))
