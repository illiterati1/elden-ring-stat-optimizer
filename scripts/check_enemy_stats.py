"""
Cross-check the enemy picker's HP and defenses (public/enemies.json) at NG and in NG+ against the
datamining spreadsheet, and report where they disagree.

Usage:
  python3 -I scripts/check_enemy_stats.py

Inputs:
  - public/enemies.json, from build_enemy_data.py
  - data/sheets/NG.csv, NG+.csv, NG+2.csv, and NG+7.csv: those tabs of
    https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes exported as
    CSV
  - data/ClearCountCorrectParam-vanilla.csv, for later journeys' multipliers

Stats at each NG+ level are worked out the way the app's getEnemyStats (src/app/useEnemies.ts)
does. NG+2 is checked since enemies with no NG+ scaling effect only start scaling there. HP after
beating Promised Consort Radahn is checked against the spreadsheet's dlcClear column.

Writes every disagreement to data/sheets/check-enemy-stats.csv.
"""

import csv
import json
import math
import os
from collections import Counter

# Spreadsheet tabs by NG+ level
TABS = {0: "NG.csv", 1: "NG+.csv", 2: "NG+2.csv", 7: "NG+7.csv"}

# Spreadsheet columns (after its two header rows)
NPC_ID = 2
HEALTH = 6
DLC_CLEAR_HEALTH = 7
# Physical, magic, fire, lightning, holy, as in enemies.json (Strike, Slash, and Pierce, between
# Phys and Magic, are always the same as Phys)
DEFENSES = [9, 13, 14, 15, 16]
DAMAGE_TYPES = ["physical", "magic", "fire", "lightning", "holy"]


def parse_number(text):
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None  # e.g. "-"


def read_tab(path):
    """@returns each NpcParam ID's HP, HP after beating Radahn, and defenses (the first row for it)"""
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f))[2:]
    stats = {}
    for row in rows:
        if len(row) <= DEFENSES[-1] or not row[NPC_ID].strip().isdigit():
            continue
        stats.setdefault(
            int(row[NPC_ID]),
            {
                "location": row[0],
                "hp": parse_number(row[HEALTH]),
                "dlcClearHp": parse_number(row[DLC_CLEAR_HEALTH]),
                "defense": [parse_number(row[column]) for column in DEFENSES],
            },
        )
    return stats


def read_ng_plus_rates(path):
    """@returns ClearCountCorrectParam's HP and defense multipliers by NG+ level"""
    with open(path, encoding="utf-8") as f:
        rows = {int(row["id"]): row for row in csv.DictReader(f)}
    return {
        level: (float(rows[level]["MaxHpRate"]), float(rows[level]["PhysicsDefenseRate"]))
        for level in range(1, 8)
    }


def get_enemy_stats(enemy, ng_plus, radahn_beaten, rates):
    """@returns an enemy's HP and defenses at an NG+ level, like getEnemyStats in useEnemies.ts"""
    if ng_plus == 0:
        return enemy["hp"], enemy["defense"]
    base = enemy.get("ngPlus", enemy)
    hp_rate, defense_rate = rates[ng_plus]
    radahn_rate = base.get("radahnHpRate", 1) if radahn_beaten else 1
    return (
        math.floor(base["hp"] * radahn_rate * hp_rate),
        [defense * defense_rate for defense in base["defense"]],
    )


def main():
    project_dir = os.path.join(os.path.dirname(__file__), "..")
    data_dir = os.path.join(project_dir, "data")
    with open(os.path.join(project_dir, "public", "enemies.json"), encoding="utf-8") as f:
        areas = json.load(f)["areas"]
    rates = read_ng_plus_rates(os.path.join(data_dir, "ClearCountCorrectParam-vanilla.csv"))

    problems = []
    checked = Counter()
    mismatched = Counter()
    for ng_plus, tab in TABS.items():
        sheet = read_tab(os.path.join(data_dir, "sheets", tab))
        label = tab.removesuffix(".csv")
        for area in areas:
            for enemy in area["enemies"]:
                for npc_param_id in enemy["npcParamIds"]:
                    row = sheet.get(npc_param_id)
                    if not row or row["hp"] is None:
                        continue

                    def check(field, ours, theirs, ok=None):
                        checked[(label, field)] += 1
                        if not (ok if ok is not None else ours == theirs):
                            mismatched[(label, field)] += 1
                            problems.append(
                                [label, area["name"], enemy["name"], npc_param_id, field, ours, theirs]
                            )

                    hp, defense = get_enemy_stats(enemy, ng_plus, False, rates)
                    check("hp", hp, int(row["hp"]))
                    # The spreadsheet rounds defenses down, and enemies.json rounds them to one decimal
                    # (e.g. 102.97 is 102 in the spreadsheet, 103.0 in enemies.json)
                    for damage_type, ours, theirs in zip(DAMAGE_TYPES, defense, row["defense"]):
                        if theirs is not None:
                            ours = round(ours, 2)
                            check(f"{damage_type} defense", ours, theirs, 0 <= ours - theirs < 1.05)
                    if ng_plus > 0 and row["dlcClearHp"] is not None:
                        radahn_hp, _ = get_enemy_stats(enemy, ng_plus, True, rates)
                        check("hp after Radahn", radahn_hp, int(row["dlcClearHp"]))

    out_path = os.path.join(data_dir, "sheets", "check-enemy-stats.csv")
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["tab", "area", "enemy", "npcParamId", "field", "ours", "sheet"])
        writer.writerows(problems)

    for (label, field), count in checked.items():
        print(f"{label} {field}: {count - mismatched[(label, field)]}/{count} match")
    print(f"{len(problems)} disagreements -> {out_path}")


if __name__ == "__main__":
    main()
