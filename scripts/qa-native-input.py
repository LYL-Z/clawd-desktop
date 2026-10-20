"""Bounded OS input for the local Clawd QA window; no hooks or input recording."""
import ctypes
import json
import sys
import time

user32 = ctypes.windll.user32
try:
    set_thread_dpi = user32.SetThreadDpiAwarenessContext
    set_thread_dpi.argtypes = [ctypes.c_void_p]
    set_thread_dpi.restype = ctypes.c_void_p
    if not set_thread_dpi(ctypes.c_void_p(-4)):
        raise OSError('Unable to set Per-Monitor V2 DPI awareness for QA input')
except AttributeError:
    # Older Windows builds do not expose the per-thread API.
    user32.SetProcessDPIAware()
class POINT(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]
user32.WindowFromPoint.argtypes = [POINT]
user32.WindowFromPoint.restype = ctypes.c_void_p
get_physical_cursor = user32.GetPhysicalCursorPos
get_physical_cursor.argtypes = [ctypes.POINTER(POINT)]
set_physical_cursor = user32.SetPhysicalCursorPos
set_physical_cursor.argtypes = [ctypes.c_int, ctypes.c_int]
for action in json.loads(sys.argv[1]):
    kind = action['type']
    if kind == 'move':
        if not set_physical_cursor(int(action['x']), int(action['y'])):
            raise OSError('Unable to place the QA cursor at a physical-pixel coordinate')
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
if not get_physical_cursor(ctypes.byref(point)):
    raise OSError('Unable to read the QA cursor physical-pixel coordinate')
pid = ctypes.c_ulong()
handle = user32.WindowFromPoint(point)
user32.GetWindowThreadProcessId(ctypes.c_void_p(handle), ctypes.byref(pid))
print(json.dumps({'cursor': {'x': point.x, 'y': point.y}, 'windowProcessId': pid.value}))
