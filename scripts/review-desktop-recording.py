"""Decode the current release's own-window recording and make review contact frames."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[1]
video = root/'qa/runtime/desktop-interaction.mp4'
info = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
subprocess.run(['ffmpeg','-v','error','-i',str(video),'-f','null','-'],check=True)
contact = root/'qa/runtime/desktop-interaction-review.jpg'
subprocess.run(['ffmpeg','-y','-v','error','-i',str(video),'-vf','fps=1/3,scale=700:-1,tile=3x3:color=0xfaf9f5','-frames:v','1',str(contact)],check=True)
stream = next(s for s in info['streams'] if s['codec_type']=='video')
report = {'recordedAtUtc':datetime.now(timezone.utc).isoformat(),'video':'qa/runtime/desktop-interaction.mp4',
 'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'durationSeconds':float(info['format']['duration']),
 'width':stream['width'],'height':stream['height'],'fullDecodePassed':True,
 'contact':'qa/runtime/desktop-interaction-review.jpg','visualReview':'pending',
 'scope':'Only this project test background area; throws may leave the recorded area.'}
(root/'qa/runtime/desktop-recording-review.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
