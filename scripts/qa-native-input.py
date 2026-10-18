"""Bounded OS input for the local Clawd QA window; no hooks or input recording."""
import ctypes
import json
import sys
import time

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()
class POINT(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]
user32.WindowFromPoint.argtypes = [POINT]
user32.WindowFromPoint.restype = ctypes.c_void_p
for action in json.loads(sys.argv[1]):
    kind = action['type']
    if kind == 'move':
        user32.SetCursorPos(int(action['x']), int(action['y']))
    elif kind == 'down':
        user32.mouse_event(0x0002, 0, 0, 0, 0)
    elif kind == 'up':
        user32.mouse_event(0x0004, 0, 0, 0, 0)
    elif kind == 'escape':
        user32.keybd_event(0x1B, 0, 0, 0)
        user32.keybd_event(0x1B, 0, 2, 0)
    else:
        raise ValueError('Unsupported QA input')
    time.sleep(min(max(action.get('wait', 30), 0), 2000) / 1000)
point = POINT()
user32.GetCursorPos(ctypes.byref(point))
pid = ctypes.c_ulong()
handle = user32.WindowFromPoint(point)
user32.GetWindowThreadProcessId(ctypes.c_void_p(handle), ctypes.byref(pid))
print(json.dumps({'cursor': {'x': point.x, 'y': point.y}, 'windowProcessId': pid.value}))
