"""Produce required motion evidence from the exact encoded V2 atlas bytes."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

p = argparse.ArgumentParser()
p.add_argument('atlas')
p.add_argument('--output', default='exports/previews/codex-v2')
p.add_argument('--skill-scripts', required=True, help='Path to the create-pet skill scripts directory')
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
atlas_path = Path(a.atlas).resolve()
out = (root / a.output).resolve()
out.mkdir(parents=True, exist_ok=True)
skill = Path(a.skill_scripts)
sys.path.insert(0, str(skill))
from render_animation_previews import ROW_DURATIONS

atlas = Image.open(atlas_path).convert('RGBA')
assert atlas.size == (1536, 2288)
frames_root = out / 'frames'
state_frames = {}
for row, (state, durations) in enumerate(ROW_DURATIONS.items()):
    directory = frames_root / state
    directory.mkdir(parents=True, exist_ok=True)
    frames = [atlas.crop((column * 192, row * 208, (column + 1) * 192, (row + 1) * 208)) for column in range(len(durations))]
    for i, frame in enumerate(frames):
        frame.save(directory / f'{i:02d}.png')
    state_frames[state] = frames
subprocess.run([sys.executable, str(skill / 'render_animation_previews.py'), '--frames-root', str(frames_root), '--output-dir', str(out / 'states')], check=True, stdout=subprocess.DEVNULL)

def caption(frame, title):
    result = Image.new('RGB', (192, 236), '#faf9f5')
    result.paste(frame, (0, 0), frame.getchannel('A'))
    ImageDraw.Draw(result).text((8, 215), title, fill='#141413')
    return result

def encode_gif(name, frames, durations):
    frames[0].save(out / f'{name}.gif', save_all=True, append_images=frames[1:], duration=durations, disposal=2, loop=0, optimize=False)

def encode_video(name, frames, durations):
    directory = out / name
    directory.mkdir(exist_ok=True)
    lines = []
    for i, (frame, duration) in enumerate(zip(frames, durations)):
        image_path = directory / f'{i:03d}.png'
        frame.save(image_path)
        lines += [f"file '{image_path.as_posix()}'", f'duration {duration / 1000:.3f}']
    lines.append(f"file '{image_path.as_posix()}'")
    listing = directory / 'frames.ffconcat'
    listing.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    video = out / f'{name}.mp4'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), '-vf', 'fps=30,format=yuv420p', '-an', '-c:v', 'libx264', '-crf', '16', '-movflags', '+faststart', str(video)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], check=True)

all_frames, all_durations = [], []
for state, durations in ROW_DURATIONS.items():
    all_frames += [caption(frame, state) for frame in state_frames[state]]
    all_durations += durations
encode_gif('all-states', all_frames, all_durations)
encode_video('all-states', all_frames, all_durations)
transition = state_frames['idle'] + state_frames['jumping'] + state_frames['idle']
encode_gif('idle-jump-idle', transition, ROW_DURATIONS['idle'] + ROW_DURATIONS['jumping'] + ROW_DURATIONS['idle'])
directions = [atlas.crop((i % 8 * 192, (9 + i // 8) * 208, (i % 8 + 1) * 192, (10 + i // 8) * 208)) for i in range(16)]
look_frames = [caption(frame, f'{i * 22.5:g} deg') for i, frame in enumerate(directions)]
encode_gif('look-loop', look_frames, [200] * 16)
encode_video('look-loop', look_frames, [200] * 16)
stills = [('idle', 0, 0), ('waving', 2, 280), ('jumping', 3, 420), ('failed', 6, 840)]
contact = Image.new('RGB', (384, 472), '#faf9f5')
for i, (state, frame, ms) in enumerate(stills):
    still = caption(state_frames[state][frame], f'{state} / {ms} ms')
    still.save(out / f'still-{state}-{ms}ms.png')
    contact.paste(still, ((i % 2) * 192, (i // 2) * 236))
contact.save(out / 'four-stills.png')
report = {'atlas': str(atlas_path), 'atlasSha256': hashlib.sha256(atlas_path.read_bytes()).hexdigest(),
          'source': 'Grid crops of final encoded atlas; no artwork substituted', 'standardStateGifs': 9,
          'allStateMp4FullyDecoded': True, 'lookMp4FullyDecoded': True, 'transitionSize': [192, 208],
          'stills': [{'state': state, 'frame': frame, 'ms': ms} for state, frame, ms in stills]}
(out / 'preview-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
