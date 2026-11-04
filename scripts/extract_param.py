"""
Decode an unpacked ELDEN RING .param file to CSV using a Paramdex definition.

Usage:
  python3 -I scripts/extract_param.py <file.param> <ParamdexDef.xml> <regulation version> <out.csv>

The regulation version (e.g. 11711000, from _witchy-bnd4.xml) decides which version-specific fields
in the definition are present. Padding fields are omitted from the output.
"""

import csv
import re
import struct
import sys
import xml.etree.ElementTree as ET

TYPES = {
    "s8": ("b", 1),
    "u8": ("B", 1),
    "dummy8": ("B", 1),
    "s16": ("h", 2),
    "u16": ("H", 2),
    "s32": ("i", 4),
    "u32": ("I", 4),
    "b32": ("I", 4),
    "f32": ("f", 4),
    "angle32": ("f", 4),
    "f64": ("d", 8),
}

FIELD_RE = re.compile(r"^(\w+)\s+(\w+)(?::(\d+))?(?:\[(\d+)\])?(?:\s*=\s*\S+)?$")


def read_fields(def_path, version):
    """Return (name, type, byte offset, bit offset or None, bit width or None, count) per field"""
    root = ET.parse(def_path).getroot()
    fields = []
    offset = 0
    # The current bitfield storage unit: (type size, unit start offset, bits used)
    unit = None
    for field in root.iter("Field"):
        first = field.get("FirstVersion")
        removed = field.get("RemovedVersion")
        if (first and int(first) > version) or (removed and int(removed) <= version):
            continue

        match = FIELD_RE.match(field.get("Def").strip())
        if not match:
            raise ValueError(f"Can't parse field definition: {field.get('Def')}")
        type_name, name, bits, count = match.groups()
        if type_name.startswith("fixstr"):
            raise ValueError(f"String fields aren't supported: {name}")
        _, size = TYPES[type_name]

        if bits is not None:
            bits = int(bits)
            # Pack into the current unit if it's the same size and there's room
            if unit is None or unit[0] != size or unit[2] + bits > size * 8:
                unit = (size, offset, 0)
                offset += size
            fields.append((name, type_name, unit[1], unit[2], bits, 1))
            unit = (unit[0], unit[1], unit[2] + bits)
        else:
            unit = None
            count = int(count) if count else 1
            fields.append((name, type_name, offset, None, None, count))
            offset += size * count

    return fields, offset


def read_param(param_path, def_path, version):
    """Return (field names, rows) where each row is a dict including "id" and "rowName"."""
    fields, row_size = read_fields(def_path, int(version))
    data = open(param_path, "rb").read()

    row_count = struct.unpack_from("<H", data, 0x0A)[0]
    format_2d = data[0x2D]
    if not format_2d & 0x04:
        raise ValueError("Only 64-bit offset params (ELDEN RING) are supported")

    rows = []
    for i in range(row_count):
        row_id, data_offset, name_offset = struct.unpack_from("<i4xqq", data, 0x40 + 24 * i)
        rows.append((row_id, data_offset, name_offset))

    # Verify the definition matches the file by comparing row sizes
    actual_row_size = rows[1][1] - rows[0][1] if row_count > 1 else None
    if actual_row_size is not None and actual_row_size != row_size:
        raise ValueError(f"Definition row size {row_size} != file row size {actual_row_size}")

    def read_name(offset):
        end = offset
        while data[end : end + 2] != b"\0\0":
            end += 2
        return data[offset:end].decode("utf-16-le")

    output_fields = [f for f in fields if f[1] != "dummy8"]
    result = []
    for row_id, data_offset, name_offset in rows:
        values = []
        for name, type_name, offset, bit, bits, count in output_fields:
            fmt, size = TYPES[type_name]
            if bit is not None:
                unit = int.from_bytes(data[data_offset + offset : data_offset + offset + size], "little")
                values.append((unit >> bit) & ((1 << bits) - 1))
            elif count > 1:
                values.append(
                    " ".join(
                        str(v)
                        for v in struct.unpack_from(f"<{count}{fmt}", data, data_offset + offset)
                    )
                )
            else:
                value = struct.unpack_from(f"<{fmt}", data, data_offset + offset)[0]
                values.append(round(value, 6) if fmt == "f" else value)
        row = {"id": row_id, "rowName": read_name(name_offset) if name_offset else ""}
        row.update(zip((f[0] for f in output_fields), values))
        result.append(row)

    return ["id", "rowName"] + [f[0] for f in output_fields], result, row_size


def main():
    param_path, def_path, version, out_path = sys.argv[1:5]
    columns, rows, row_size = read_param(param_path, def_path, version)
    with open(out_path, "w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} rows, {len(columns) - 2} fields, row size {row_size} -> {out_path}")


if __name__ == "__main__":
    main()
