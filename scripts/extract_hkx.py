"""
Read Elden Ring animations' (.hkx) lengths.

Usage:
  python3 -I scripts/extract_hkx.py <file.hkx> ...

The .hkx files are Havok 2018 tagfiles (TAG0, SDKV 20180100) from the .anibnd.dcx files, unpacked
with WitchyBND (the player's: see extract_game_files.py; enemies' are in cXXXX_divNN.anibnd.dcx).
Their types are in a separate compendium file, so instead of parsing the type info, this finds the
animation's hkaSplineCompressedAnimation fields by their layout: its type (3, spline compressed),
duration, ..., numFrames at +0x28, ..., frameDuration at +0x40, checking that the duration is
(numFrames - 1) × frameDuration. Most are 30 frames a second, some 60.
"""

import re
import struct
import sys

SPLINE_COMPRESSED = struct.pack("<i", 3)


def read_hkx_length(path):
    """@returns (duration in seconds, frames per second) of an animation, or None if not found"""
    data = open(path, "rb").read()
    for match in re.finditer(re.escape(SPLINE_COMPRESSED), data):
        offset = match.start()
        if offset % 4 or offset + 0x44 > len(data):
            continue
        duration = struct.unpack_from("<f", data, offset + 4)[0]
        frames = struct.unpack_from("<i", data, offset + 0x28)[0]
        frame_duration = struct.unpack_from("<f", data, offset + 0x40)[0]
        if frames > 0 and 0.01 < frame_duration < 0.05 and abs((frames - 1) * frame_duration - duration) < 1e-3:
            return duration, round(1 / frame_duration)
    return None


if __name__ == "__main__":
    for path in sys.argv[1:]:
        length = read_hkx_length(path)
        print(path, f"{length[0]:.4f}s at {length[1]} fps" if length else "no length found")
