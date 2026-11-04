"""
Cross-check the motion value spreadsheet used by build_moveset_data.py against the game's own
attack data, and report where they disagree.

Usage:
  python3 -I scripts/check_movesets.py <ELDEN RING Game dir>

Inputs:
  - data/sheets/mv/*.csv, as for build_moveset_data.py
  - data/EquipParamWeapon-, BehaviorParam_PC-, and AtkParam_Pc-vanilla.csv, decoded with
    extract_param.py
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND, for
    weapon names

Writes every disagreement to data/sheets/mv/check-movesets.csv.

How the game data is read is described in game_attacks.py.
"""

import csv
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import (  # noqa: E402
    ATTACKS,
    parse_numbers,
    read_tab,
    read_weapons,
    split_hits,
)
from game_attacks import GameAttacks, get_motion_values  # noqa: E402

# AtkParam atkAttribute values: physical types, or the weapon's own types
ATTRIBUTE_TYPES = {0: "slash", 1: "strike", 2: "pierce", 3: "standard"}
WEAPON_ATTRIBUTE = 253
WEAPON_ATTRIBUTE_2 = 252

def main():
    game_dir = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_dir, "data")

    game_attacks = GameAttacks(project_dir)
    weapons = read_weapons(game_dir, project_dir)

    tabs = {
        "mv": read_tab(project_dir, "MotionValues"),
        "status": read_tab(project_dir, "StatusMVs"),
        "poise": read_tab(project_dir, "PoiseMVs"),
        "type": read_tab(project_dir, "PhysicalAtkAttribute"),
    }

    def physical_type(weapon, attribute):
        if attribute == WEAPON_ATTRIBUTE:
            attribute = int(weapon["atkAttribute"])
        elif attribute == WEAPON_ATTRIBUTE_2:
            attribute = int(weapon["atkAttribute2"])
        return ATTRIBUTE_TYPES.get(attribute, f"? ({attribute})")

    def same(a, b):
        return len(a) == len(b) and all(abs(x - y) < 0.01 for x, y in zip(a, b))

    problems = []
    checked = Counter()
    mismatched = Counter()

    def report(weapon_name, column, field, sheet_value, game_value):
        mismatched[field] += 1
        problems.append([weapon_name, column, field, sheet_value, game_value])

    for weapon_name, row in tabs["mv"].items():
        weapon = weapons.get(weapon_name)
        if weapon is None:
            report(weapon_name, "", "weapon", weapon_name, "no weapon with this name")
            continue

        sheet_poise = parse_numbers(tabs["poise"].get(weapon_name, {}).get("Base", ""))
        checked["base stance"] += 1
        if not same(sheet_poise, [float(weapon["saWeaponDamage"])]):
            report(weapon_name, "Base", "base stance", sheet_poise, weapon["saWeaponDamage"])

        for hands in ["1h", "2h"]:
            for columns in ATTACKS.values():
                for column in columns:
                    key = f"{hands} {column}"
                    sheet_mvs = parse_numbers(row.get(key, ""))
                    hits = game_attacks.get_hits(weapon, column, hands == "2h")
                    if not sheet_mvs and not hits:
                        continue
                    checked["attack"] += 1
                    if not sheet_mvs or not hits:
                        report(
                            weapon_name,
                            key,
                            "attack",
                            sheet_mvs or "missing",
                            [max(get_motion_values(hit)) for hit in hits] if hits else "missing",
                        )
                        continue

                    game = {
                        # The sheet lists a hit's highest motion value, e.g. 150 for a magic-only
                        # projectile
                        "mv": [max(get_motion_values(hit)) for hit in hits],
                        "status": [float(hit["statusAilmentAtkPowerCorrectRate"]) for hit in hits],
                        "poise": [float(hit["atkSuperArmorCorrection"]) for hit in hits],
                        "type": [physical_type(weapon, int(hit["atkAttribute"])) for hit in hits],
                    }
                    sheet = {
                        field: parse_numbers(tabs[field].get(weapon_name, {}).get(key, ""))
                        for field in ["mv", "status", "poise"]
                    }
                    sheet["type"] = [
                        hit.lower() for hit in split_hits(tabs["type"].get(weapon_name, {}).get(key, ""))
                    ]

                    for field in ["mv", "status", "poise", "type"]:
                        checked[field] += 1
                        if field == "type":
                            ok = sheet[field] == game[field]
                        else:
                            ok = same(sheet[field], game[field])
                        if not ok:
                            report(weapon_name, key, field, sheet[field], game[field])


    out_path = os.path.join(data_dir, "sheets", "mv", "check-movesets.csv")
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["weapon", "attack", "field", "sheet", "game"])
        writer.writerows(problems)

    for field, count in checked.items():
        print(f"{field}: {count - mismatched[field]}/{count} match")
    if mismatched["weapon"]:
        print(f"weapon: {mismatched['weapon']} names not found")
    print(f"{len(problems)} disagreements -> {out_path}")


if __name__ == "__main__":
    main()
