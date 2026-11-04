"""
Find unusual attacks in the moveset data: steps whose motion values, status buildup, or poise damage
are much higher than their weapon class's, whose stamina cost is much lower, and steps where the one
handed version beats the two handed one.

Usage:
  python3 -I scripts/find_outliers.py <ELDEN RING Game dir>

Reads public/movesets.json (built by build_moveset_data.py, with timings for stamina) and each
weapon's class (EquipParamWeapon wepType). Writes data/docs/outliers.md (not in git).

Each step is compared with the same step (same hands, attack, and chain step, whatever the chain's
length) of the other weapons of its class, by the median: an outlier is at least OUTLIER_RATIO times it (or at most 1 / OUTLIER_RATIO
for stamina), and different by at least the metric's MIN_DIFFERENCE, in a class of at least MIN_CLASS
weapons with the step. Per step:
  - motion value: its hits' motion values added up (each hit's largest, by damage type)
  - status: its hits' status motion values added up
  - poise: its poise damage, the weapon's base poise times its hits' poise motion values (and flat
    poise) added up
  - stamina: what it costs (see check_animations.py's get_timings)
"""

import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import read_weapons  # noqa: E402

OUTLIER_RATIO = 1.25
MIN_CLASS = 4
MIN_DIFFERENCE = {"motion value": 15, "status": 15, "poise": 3, "stamina": 3}
# How many of each kind the report lists
LIMIT = 60

# EquipParamWeapon wepType names (as in src/app/uiUtils.ts weaponTypeLabels)
WEAPON_TYPES = {
    1: "Dagger", 3: "Straight Sword", 5: "Greatsword", 7: "Colossal Sword", 9: "Curved Sword",
    11: "Curved Greatsword", 13: "Katana", 14: "Twinblade", 15: "Thrusting Sword",
    16: "Heavy Thrusting Sword", 17: "Axe", 19: "Greataxe", 21: "Hammer", 23: "Great Hammer",
    24: "Flail", 25: "Spear", 28: "Great Spear", 29: "Halberd", 31: "Reaper", 33: "Unarmed",
    35: "Fist", 37: "Claw", 39: "Whip", 41: "Colossal Weapon", 50: "Light Bow", 51: "Bow",
    53: "Greatbow", 55: "Crossbow", 56: "Ballista", 57: "Glintstone Staff", 59: "Dual Catalyst",
    61: "Sacred Seal", 65: "Small Shield", 67: "Medium Shield", 69: "Greatshield", 87: "Torch",
    88: "Hand-to-Hand", 89: "Perfume Bottle", 90: "Thrusting Shield", 91: "Throwing Blade",
    92: "Backhand Blade", 93: "Light Greatsword", 94: "Great Katana", 95: "Beast Claw",
}


def hit_mv(hit):
    return max(hit[0]) if isinstance(hit[0], list) else hit[0]


def step_metrics(moveset, hands, attack, index, step):
    """@returns a step's metrics, by name"""
    details = [hit[4] if len(hit) > 4 else {} for hit in step]
    metrics = {
        "motion value": sum(hit_mv(hit) for hit in step),
        "status": sum(hit[1] for hit in step),
        "poise": sum(
            moveset["poise"] * hit[2] / 100 + detail.get("poise", 0) for hit, detail in zip(step, details)
        ),
    }
    timing = moveset.get("timing", {}).get(hands, {}).get(attack, [])
    if index < len(timing) and timing[index].get("stamina"):
        metrics["stamina"] = timing[index]["stamina"]
    return metrics


def label(hands, attack, index, count):
    return f"{hands} {attack}" + (f" {index + 1}" if count > 1 else "")


def fmt(value):
    return f"{value:g}" if isinstance(value, int) or value == int(value) else f"{value:.1f}"


def main():
    game_dir = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    weapons = read_weapons(game_dir, project_dir)
    with open(os.path.join(project_dir, "public", "movesets.json"), encoding="utf-8") as f:
        movesets = json.load(f)

    # Every step's metrics, grouped by class, hands, attack, and step
    groups = defaultdict(list)
    for weapon, moveset in movesets.items():
        if weapon not in weapons:
            continue
        weapon_class = WEAPON_TYPES.get(int(weapons[weapon]["wepType"]), weapons[weapon]["wepType"])
        for hands in ["1h", "2h"]:
            for attack, steps in moveset.get(hands, {}).items():
                for index, step in enumerate(steps):
                    metrics = step_metrics(moveset, hands, attack, index, step)
                    # Compared with other chains' same step, whatever their length (e.g. the Golem
                    # Fist's one charged R2 with other fists' first)
                    key = (weapon_class, hands, attack, index)
                    groups[key].append((weapon, metrics, len(steps)))

    outliers = defaultdict(list)
    for (weapon_class, hands, attack, index), members in groups.items():
        for metric in MIN_DIFFERENCE:
            values = [m[metric] for _, m, _ in members if metric in m]
            if len(values) < MIN_CLASS:
                continue
            median = statistics.median(values)
            if median <= 0:
                continue
            for weapon, metrics, count in members:
                value = metrics.get(metric)
                if value is None:
                    continue
                low = metric == "stamina"
                ratio = median / value if low and value else value / median
                if ratio >= OUTLIER_RATIO and abs(value - median) >= MIN_DIFFERENCE[metric]:
                    outliers[metric].append(
                        (ratio, weapon, weapon_class, label(hands, attack, index, count), value, median)
                    )

    # One handed steps that beat their two handed versions
    one_handed_better = defaultdict(list)
    for weapon, moveset in movesets.items():
        for attack, steps in moveset.get("1h", {}).items():
            two_handed = moveset.get("2h", {}).get(attack)
            if not two_handed or len(two_handed) != len(steps):
                continue
            for index, (step, step_2h) in enumerate(zip(steps, two_handed)):
                one = step_metrics(moveset, "1h", attack, index, step)
                two = step_metrics(moveset, "2h", attack, index, step_2h)
                for metric in ["motion value", "status", "poise"]:
                    if one[metric] > two[metric] and one[metric] - two[metric] >= MIN_DIFFERENCE[metric] / 3:
                        one_handed_better[metric].append(
                            (one[metric] / two[metric] if two[metric] else float("inf"), weapon,
                             label("", attack, index, len(steps)).strip(), one[metric], two[metric])
                        )

    lines = [
        "# Attack outliers",
        "",
        "Generated by scripts/find_outliers.py from public/movesets.json, which explains the method:",
        f"each step against the median of the same step for its weapon class (at least {MIN_CLASS}",
        f"weapons), flagged at {OUTLIER_RATIO}× (or below 1/{OUTLIER_RATIO} for stamina). Poise is",
        "damage (the weapon's base poise times the poise motion values), not motion values. Weapons",
        "that share a moveset each appear.",
    ]
    titles = {
        "motion value": "High motion values",
        "status": "High status buildup",
        "poise": "High poise damage",
        "stamina": "Low stamina cost",
    }
    for metric, title in titles.items():
        found = sorted(outliers[metric], key=lambda o: -o[0])
        lines += ["", f"## {title} ({len(found)})", "",
                  "| Weapon | Class | Attack | Value | Class median | Ratio |", "|---|---|---|---|---|---|"]
        for ratio, weapon, weapon_class, attack, value, median in found[:LIMIT]:
            lines.append(f"| {weapon} | {weapon_class} | {attack} | {fmt(value)} | {fmt(median)} | {ratio:.2f}× |")
        if len(found) > LIMIT:
            lines.append(f"| … {len(found) - LIMIT} more | | | | | |")
    for metric in ["motion value", "poise", "status"]:
        found = sorted(one_handed_better[metric], key=lambda o: -o[0])
        lines += ["", f"## One handed {metric} above two handed ({len(found)})", "",
                  "| Weapon | Attack | 1h | 2h | Ratio |", "|---|---|---|---|---|"]
        for ratio, weapon, attack, one, two in found[:LIMIT]:
            lines.append(f"| {weapon} | {attack} | {fmt(one)} | {fmt(two)} | {ratio:.2f}× |")
        if len(found) > LIMIT:
            lines.append(f"| … {len(found) - LIMIT} more | | | | |")

    out_path = os.path.join(project_dir, "data", "docs", "outliers.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(
        ", ".join(f"{titles[m]}: {len(outliers[m])}" for m in titles)
        + ", " + ", ".join(f"1h {m} > 2h: {len(one_handed_better[m])}" for m in one_handed_better)
        + f" -> {out_path}"
    )


if __name__ == "__main__":
    main()
