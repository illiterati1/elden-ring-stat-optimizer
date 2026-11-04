"""
Build public/buffable.json: which weapons can be buffed (e.g. with greases or Flame, Grant Me
Strength), in which affinities.

Usage:
  python3 -I scripts/build_buffable_data.py <ELDEN RING Game dir>

Inputs:
  - data/EquipParamWeapon-vanilla.csv, decoded with extract_param.py
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND, for
    weapon names
  - public/regulation-vanilla-v1.17.js, for the weapons and affinities the app has

Output format: { "Longsword": [0, 1, 2, 3], "Bloodhound's Fang": [-1], ... }, the affinity IDs
(-1 for unique weapons) each weapon can be buffed in. Each affinity of a weapon is its own
EquipParamWeapon row, 100 IDs after the last, with its own isEnhance flag.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import read_weapon_rows, read_weapons  # noqa: E402

UNIQUE_AFFINITY_ID = -1


def main():
    game_dir = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_rows = read_weapons(game_dir, project_dir)
    rows = read_weapon_rows(project_dir)

    with open(os.path.join(project_dir, "public", "regulation-vanilla-v1.17.js"), encoding="utf-8") as f:
        regulation = json.load(f)

    output = {}
    missing = set()
    for weapon in regulation["weapons"]:
        name = weapon["weaponName"]
        base = base_rows.get(name)
        if base is None:
            missing.add(name)
            continue
        affinity_id = weapon["affinityId"]
        row = rows.get(int(base["id"]) + max(affinity_id, 0) * 100)
        if row is not None and row["isEnhance"] == "1":
            output.setdefault(name, []).append(affinity_id)

    if missing:
        print(f"Warning: no game data for {sorted(missing)}")
    out_path = os.path.join(project_dir, "public", "buffable.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(output)} buffable weapons -> {out_path}")


if __name__ == "__main__":
    main()
