"""
Decode an unpacked ELDEN RING .fmg text file (e.g. NpcName.fmg) to CSV.

Usage:
  python3 -I scripts/extract_fmg.py <file.fmg> <out.csv>
"""

import csv
import struct
import sys


# Placeholder text in the DLC's files
PLACEHOLDERS = {"dlc dummy", "dummy"}


def read_fmg(path):
    """
    Return a dict of text ID -> string, skipping empty entries and placeholders: the DLC's files
    have one "DLC dummy" (or "dummy") entry each, which would otherwise override the base game's text,
    e.g. ArtsName_dlc02's for skill 10, "No Skill"
    """
    data = open(path, "rb").read()
    big_endian, version = data[1], data[2]
    if big_endian or version != 2:
        raise ValueError(f"Only little endian version 2 FMGs (ELDEN RING) are supported")

    group_count, string_count = struct.unpack_from("<ii", data, 0x0C)
    (string_offsets_offset,) = struct.unpack_from("<q", data, 0x18)

    entries = {}
    for i in range(group_count):
        first_index, first_id, last_id = struct.unpack_from("<iii", data, 0x28 + 16 * i)
        for text_id in range(first_id, last_id + 1):
            index = first_index + text_id - first_id
            (offset,) = struct.unpack_from("<q", data, string_offsets_offset + 8 * index)
            if offset:
                end = offset
                while data[end : end + 2] != b"\0\0":
                    end += 2
                text = data[offset:end].decode("utf-16-le")
                if text.strip().lower() not in PLACEHOLDERS:
                    entries[text_id] = text
    return entries


def main():
    fmg_path, out_path = sys.argv[1:3]
    entries = read_fmg(fmg_path)
    with open(out_path, "w", newline="", encoding="utf-8") as out:
        writer = csv.writer(out)
        writer.writerow(["id", "text"])
        for text_id, text in sorted(entries.items()):
            writer.writerow([text_id, text])
    print(f"{len(entries)} entries -> {out_path}")


if __name__ == "__main__":
    main()
