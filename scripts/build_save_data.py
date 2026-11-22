"""
Build public/saveItems.json: what the item IDs in a save file (ER0000.sl2) are, for importing a
character's stats and gear (src/app/saveFile.ts reads the save).

  - weapons: base weapon ID (without affinity and upgrade level) -> name
  - armor: armor ID -> name
  - talismans: talisman ID -> name
  - ashes: Ash of War (EquipParamGem) ID -> name, without the "Ash of War: " prefix, as in ashes.json

Names are the game's English ones, which buffs.json, ashes.json, and the weapon data also use.

Usage:
  python3 -I scripts/build_save_data.py <ELDEN RING Game dir> <Paramdex ER dir>

Inputs (all from the base game):
  - <Game>/regulation-bin/EquipParamWeapon, EquipParamProtector, EquipParamAccessory, and
    EquipParamGem.param, unpacked with WitchyBND
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND
  - <Paramdex ER dir> is the Paramdex folder bundled with WitchyBND (Assets/Paramdex/ER)
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_buff_data import read_names  # noqa: E402
from extract_param import read_param  # noqa: E402

REGULATION_VERSION = 11730034


def main():
    game_dir, paramdex_dir = sys.argv[1:3]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def param(name, def_name=None):
        _, rows, _ = read_param(
            os.path.join(game_dir, "regulation-bin", f"{name}.param"),
            os.path.join(paramdex_dir, "Defs", f"{def_name or name}.xml"),
            REGULATION_VERSION,
        )
        return {row["id"]: row for row in rows}

    def read_real_names(fmg):
        # Unused rows' placeholder names
        return {k: v for k, v in read_names(game_dir, fmg).items() if v and not v.startswith("[ERROR]")}

    def named(param_name, fmg):
        names = read_real_names(fmg)
        return {
            str(item_id): names[item_id]
            for item_id in sorted(param(param_name))
            if names.get(item_id)
        }

    # Affinity and upgrade level are the last four digits; base weapons have neither
    weapons = {
        item_id: entry for item_id, entry in named("EquipParamWeapon", "WeaponName").items()
        if int(item_id) % 10000 == 0
    }
    gem_names = read_real_names("GemName")
    ashes = {
        str(gem_id): gem_names[gem_id].removeprefix("Ash of War: ")
        for gem_id in sorted(param("EquipParamGem"))
        if gem_names.get(gem_id)
    }
    data = {
        "weapons": weapons,
        "armor": named("EquipParamProtector", "ProtectorName"),
        "talismans": named("EquipParamAccessory", "AccessoryName"),
        "ashes": ashes,
    }

    path = os.path.join(project_dir, "public", "saveItems.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {path}: " + ", ".join(f"{len(v)} {k}" for k, v in data.items()))


if __name__ == "__main__":
    main()
