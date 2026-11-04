"""
Read Elden Ring TimeAct (.tae) files: each animation's timed events (attack windows, SpEffects,
cancel windows, etc.).

Usage:
  TAE_TEMPLATE=<WitchyBND>/Assets/Templates/TAE.Template.ER.xml \
    python3 -I scripts/extract_tae.py <file.tae> [animation id]

The .tae files come from chr/c0000.anibnd.dcx (the player), unpacked with WitchyBND into
chr/c0000-anibnd-dcx-wanibnd/INTERROOT_win64/chr/c0000/tae. The format is SoulsFormats' TAE3 (64
bit, version 0x1000D). Event types and their parameters are named in WitchyBND's
Assets/Templates/TAE.Template.ER.xml (bank 35).
"""

import struct
import sys
import xml.etree.ElementTree as ET

# Template field types: struct format and size
FIELD_TYPES = {
    "s8": "b", "u8": "B", "s16": "h", "u16": "H", "s32": "i", "u32": "I", "f32": "f",
    "b": "?", "x8": "B", "x16": "H", "x32": "I", "s64": "q", "u64": "Q", "f64": "d",
}


def read_template(path, bank_id=35):
    """@returns {event type: (name, [(field name, type)])} for a template bank"""
    events = {}
    for bank in ET.parse(path).getroot().iter("bank"):
        if int(bank.get("id")) != bank_id:
            continue
        for event in bank.iter("event"):
            # Unnamed fields are padding, but still take up space
            fields = [(field.get("name"), field.tag) for field in event if field.tag in FIELD_TYPES]
            events[int(event.get("id"))] = (event.get("name"), fields)
    return events


def read_tae(path):
    """
    @returns (TAE ID, {animation id: [(start, end, event type, params offset)]}, data, imports);
    times are in seconds, and imports are {animation id: (TAE ID, animation id)} for animations
    that use another's (e.g. Moonveil's stance, a778_040050, is Unsheathe's, a614_040050)
    """
    data = open(path, "rb").read()
    if data[:4] != b"TAE ":
        raise ValueError(f"{path} isn't a TAE file")
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    u64 = lambda offset: struct.unpack_from("<Q", data, offset)[0]
    f32 = lambda offset: struct.unpack_from("<f", data, offset)[0]
    tae_id = u32(0x50)
    anim_count = u32(0x54)
    anims_offset = u64(0x58)
    animations = {}
    imports = {}
    for i in range(anim_count):
        anim_id = u64(anims_offset + i * 16)
        anim_offset = u64(anims_offset + i * 16 + 8)
        headers_offset = u64(anim_offset)
        event_count = u32(anim_offset + 0x20)
        # The animation file header: type 1 imports another animation, by TAE ID × 1000000 + ID
        file_offset = u64(anim_offset + 0x18)
        if u64(file_offset) == 1:
            imported = u32(file_offset + 0x18)
            imports[anim_id] = (imported // 1_000_000, imported % 1_000_000)
        events = []
        for j in range(event_count):
            header = headers_offset + j * 0x18
            start = f32(u64(header))
            end = f32(u64(header + 8))
            event_offset = u64(header + 16)
            event_type = u32(event_offset)
            params_offset = u64(event_offset + 8)
            events.append((start, end, event_type, params_offset))
        animations[anim_id] = events
    # Parameters are read with read_params
    return tae_id, animations, data, imports


def read_params(data, params_offset, fields):
    """@returns {field name: value} for an event's parameters"""
    params = {}
    offset = params_offset
    for name, kind in fields:
        fmt = FIELD_TYPES[kind]
        size = struct.calcsize(fmt)
        if name:
            params[name] = struct.unpack_from("<" + fmt, data, offset)[0]
        offset += size
    return params


if __name__ == "__main__":
    import os

    # WitchyBND's Assets/Templates/TAE.Template.ER.xml, for event names and parameters
    if "TAE_TEMPLATE" not in os.environ:
        sys.exit("Set TAE_TEMPLATE to WitchyBND's Assets/Templates/TAE.Template.ER.xml")
    template = read_template(os.environ["TAE_TEMPLATE"])
    tae_id, animations, data, imports = read_tae(sys.argv[1])
    wanted = int(sys.argv[2]) if len(sys.argv) > 2 else None
    print(f"TAE {tae_id}: {len(animations)} animations")
    for anim_id, events in animations.items():
        if wanted is not None and anim_id != wanted:
            continue
        print(f"a{anim_id:06d}" + (f" (imports a{imports[anim_id][0]}_{imports[anim_id][1]:06d})" if anim_id in imports else ""))
        for start, end, event_type, params_offset in sorted(events):
            name, fields = template.get(event_type, (f"#{event_type}", []))
            print(f"  {start:7.3f}-{end:7.3f} {event_type:4d} {name} {read_params(data, params_offset, fields)}")
