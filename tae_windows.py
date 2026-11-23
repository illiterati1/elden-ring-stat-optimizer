"""
Print the TAE hit windows of player animations as JSON, for summarize.mjs.

    python3 -I tae_windows.py 29030000 29030010 ...

Animation IDs are as the game reports them: file * 1000000 + animation (29030000 = a29, 030000).
Output: {"29030000": {"file": 29, "windows": [[start, end], ...], "length": frames}, ...} in 60 fps
frames from the animation's start, with speed changes applied. Uses the stat calculator's TAE reader.
"""
import json
import os
import sys

CALCULATOR = os.path.expanduser("~/elden_ring/stat-calculator/scripts")
GAME = "/mnt/c/Program Files (x86)/Steam/steamapps/common/ELDEN RING/Game"
sys.path.insert(0, CALCULATOR)
from check_animations import Animations  # noqa: E402

animations = Animations(GAME)
out = {}
for arg in sys.argv[1:]:
    full = int(arg)
    file, anim = divmod(full, 1000000)
    # an animation missing from its weapon type's file comes from the common one (a00)
    number, windows = animations.find([file, 0], anim)
    if windows is None:
        out[arg] = None
        continue
    real = lambda t: round(animations.to_real_time(number, anim, t) * 60, 1)
    length = animations.get_length(number, anim)
    out[arg] = {
        "file": number,
        "windows": [[real(start), real(end)] for start, end, *_ in windows],
        "length": real(length) if length else None,
    }
print(json.dumps(out))
