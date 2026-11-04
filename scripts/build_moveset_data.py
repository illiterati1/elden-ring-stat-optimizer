"""
Build public/movesets.json: each weapon's basic attacks with their motion values, from a community
motion value spreadsheet:
https://docs.google.com/spreadsheets/d/1j4bpTbsnp5Xsgw9TP2xv6d8R4qk0ErpE9r_5LGIDraU

Usage:
  python3 -I scripts/build_moveset_data.py <ELDEN RING Game dir>

Reads these tabs, exported as CSV to data/sheets/mv/: MotionValues.csv (gid=0), StatusMVs.csv
(gid=882013776), PoiseMVs.csv (gid=1213023409), PhysicalAtkAttribute.csv (gid=506566839), and
BaseMovesetUnique.csv (gid=1083259082) for extra hits the other tabs leave out, e.g. Bloodfiend's
Arm's R2 area attack.

The sheet has one motion value per hit, but some hits have different motion values for each damage
type, e.g. Wing of Astel's R2 projectile is magic only. Those come from the game's own attack data
(see game_attacks.py) for each sheet hit that can be matched to a game row with the same motion
value. Each weapon's own physical damage type (for the base attack, without motion values) is the most
common type of the hits of its first three one handed R1s and first R2, with the second R2 breaking
ties, or else its type in data/EquipParamWeapon-vanilla.csv (atkAttribute). Both are decoded with extract_param.py, and weapon names come
from <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND.

Output format, keyed by base weapon name:
  { "Longsword": { "poise": 5, "type": 0, "1h": { "R1": [[hit, ...], ...], ... }, "2h": { ... } } }
"timing" has each attack step's timing from the game's animations, if <Game>/chr/c0000.anibnd.dcx has
been unpacked (see check_animations.py's get_timings), by hands and attack like the attacks:
[{ "start": for tapped R2s, seconds from the press until the step starts, "hits": [seconds when
each hit's window opens], "next": { "attack": the earliest attack it can be
cancelled into ("R1", "R2", or "L1"), "time" }, "anyAttack": seconds until any attack can start,
"roll": seconds until a roll can start, "stamina": what the step costs, "leftStamina": how much of
that the left hand's weapon costs (powerstance attacks), "sweetSpot": true if its hits
are in a flail's sweet spot (×1.125 damage) }], each left out if the animation doesn't allow it (or
costs nothing, or has no sweet spot).
"oneHanded": true is added for weapons that can't be two handed (bothHandEquipable), whose two
handed attacks are left out even if the sheet lists them.
Each attack is a list of chain steps, each step a list of hits (more than one for multi-hit
attacks), and each hit is [motion value, status motion value, poise motion value, physical type]
where physical type is 0 standard, 1 slash, 2 strike, 3 pierce. The motion value is a number, or a
list of one per damage type (physical, magic, fire, lightning, holy) if they differ. A hit may have
a fifth element with more details: "flat", flat attack for each damage type added to the weapon's
base attack (scaled by upgrade level and stats like base attack), and "kind", what kind of hit it
is if it isn't the weapon itself, as the sheet names it (e.g. "Bullet", "Projectile", "AoE"), and
"noTwoHandBonus", true for hits that don't get two handing's Strength bonus
(isDisableBothHandsAtkBonus, e.g. the Lizard Greatsword's R2 projectile, or any hit of a paired
weapon that can't be matched to a game row), and "correct", which stats
scale the hit (its flat attack, or its motion values' attack power) if not the weapon's own, e.g.
staves' and seals' melee hits use standard weapon scaling (overwriteAttackElementCorrectId, from
data/AttackElementCorrectParam-vanilla.csv), in the same format as the weapon data: by damage type,
each attribute true for the weapon's own scaling or the overwriting correction rate (e.g. 0.25).
"""

import csv
import functools
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extract_fmg import read_fmg  # noqa: E402
from game_attacks import GameAttacks, get_motion_values  # noqa: E402

# Attacks, and the spreadsheet columns for their chain steps (after "1h " or "2h ")
ATTACKS = {
    "R1": [f"R1 {i}" for i in range(1, 7)],
    "R2": ["R2 1", "R2 2"],
    "Charged R2": ["Charged R2 1", "Charged R2 2"],
    "Running R1": ["Running R1"],
    "Running R2": ["Running R2"],
    "Rolling R1": ["Rolling R1"],
    "Backstep R1": ["Backstep R1"],
    "Jumping R1": ["Jumping R1"],
    "Jumping R2": ["Jumping R2"],
    "Guard Counter": ["Guard Counter"],
}

# Attacks the sheet lists once rather than one and two handed, its columns for their chain steps,
# and which hands they're used with. They aren't matched to game rows (their behavior judge IDs
# aren't known), so they use the sheet's motion values for every damage type.
# - Critical hits: the plain columns are for most enemies, "Large PvE" for large ones, and the small
#   riposte ("Riposte (Small PvE)") is a downward stab some enemies get, e.g. Mini Midra and Night's
#   Cavalry knocked off their horse (tested in game)
# - Powerstance: two weapons of the same class, or a paired weapon, attacking with L1, one handed
# - Mounted: the right side's attacks (the left side's are the same, except the Messmer Soldier's
#   Axe's charged attack: 163 rather than 180)
SHARED_ATTACKS = {
    "Backstab": (["Backstab"], ["1h", "2h"]),
    "Riposte": (["Riposte"], ["1h", "2h"]),
    "Large Riposte": (["Riposte (Large PvE)"], ["1h", "2h"]),
    "Small Riposte": (["Riposte (Small PvE)"], ["1h", "2h"]),
    "Powerstance L1": ([f"Paired L1 {i}" for i in range(1, 7)], ["1h"]),
    "Powerstance Running L1": (["Paired Running L1"], ["1h"]),
    "Powerstance Rolling L1": (["Paired Rolling L1"], ["1h"]),
    "Powerstance Backstep L1": (["Paired Backstep L1"], ["1h"]),
    "Powerstance Jumping L1": (["Paired Jumping L1"], ["1h"]),
    "Mounted R1": (["Mounted R1 1", "Mounted R1 2", "Mounted R1 3"], ["1h", "2h"]),
    "Mounted R2": (["Mounted R2"], ["1h", "2h"]),
    "Mounted Charged R2": (["Mounted Charged R2"], ["1h", "2h"]),
}

# Attacks that never get two handing's Strength bonus. Tested in game: a backstab does the same two
# handed; ripostes are assumed to be the same.
NO_TWO_HAND_BONUS_ATTACKS = {"Backstab", "Riposte", "Large Riposte", "Small Riposte"}

# Attack subcategories (AtkParam subCategory1-4, which some buffs only apply to, e.g. 100 Charged
# Heavy Attack for the Axe Talisman) for hits that aren't matched to a game row, by attack, following
# the game's rows: two handed attacks add 120, and the last step of an R1 chain 104 (Final Chain
# Attack)
CATEGORY_FALLBACKS = {
    "Charged R2": [100],
    "Running R1": [122],
    "Running R2": [122],
    "Rolling R1": [121],
    "Backstep R1": [121],
    "Jumping R1": [102],
    "Jumping R2": [102],
    "Guard Counter": [103],
    "Powerstance Running L1": [122],
    "Powerstance Rolling L1": [121],
    "Powerstance Backstep L1": [121],
    "Powerstance Jumping L1": [102],
    "Mounted R1": [101],
    "Mounted R2": [101],
    "Mounted Charged R2": [100, 101],
}
FINAL_CHAIN_ATTACKS = {"R1", "Powerstance L1", "Mounted R1"}
TWO_HANDED_CATEGORY = 120
FINAL_CHAIN_CATEGORY = 104

PHYSICAL_TYPES = {"standard": 0, "slash": 1, "strike": 2, "pierce": 3}

# EquipParamWeapon atkAttribute values
WEAPON_ATTRIBUTE_TYPES = {0: "slash", 1: "strike", 2: "pierce", 3: "standard"}

# Sheet cells the game's animations disagree with (see check_animations.py), by weapon and column.
# The backhand blades' one handed jumping R2 is 127 early in the jump (animations 031230-031250) and
# 122 late (031270), tested in game (Backhand Blade +25, 99 in every stat: 702 and 670); the sheet
# has the late one, and other attacks use their main animation. Their two handed guard counter's last
# hit is 80, not 100: Backhand Blade +25, 99 in every stat, does 1955 in all on Margit (100 would be
# 2098).
# The Death Knight's Twin Axes' two handed jumping R2 and guard counter are their one handed ones'
# rows, 127 and 125 (and get two handing's Strength bonus, see TWO_HANDED_STRENGTH_BONUS), at +10,
# 99 in every stat: the jumping R2 does 855 on the training dummy (the sheet's 132 would be 860, or
# 896 with the bonus), the guard counter 866 on Margit (130 would be 873, or 907 with the bonus). Rakshasa's Great Katana's
# powerstance L1 2 is 92 + 92: 1426 on the dummy at +25, 99 in every stat (94 + 94 would be 1462).
MOTION_VALUE_FIXES = {
    **{
        weapon: {"1h Jumping R2": "127", "2h Guard Counter": "96 + 78 + 98 + 80"}
        for weapon in ["Reverse-Bladed Sword", "Backhand Blade", "Curseblade's Cirque"]
    },
    "Death Knight's Twin Axes": {"2h Jumping R2": "127", "2h Guard Counter": "125"},
    "Rakshasa's Great Katana": {"Paired L1 2": "92 + 92"},
    # The mounted attacks' alternate AoE is 115 in the game's rows, not 90
    **{
        weapon: {"Mounted R2": "130 (115 Bullet)", "Mounted L2": "130 (115 Bullet)"}
        for weapon in ["Dryleaf Arts", "Dane's Footwork"]
    },
}
# Steps that hit more times in game than the sheet lists, tested in game (the user): Dryleaf Arts'
# two handed R1 6 hits twice, with both feet (its full chain does 4428 at +25 with 99 in every stat
# on the training dummy); Dane's Footwork's two handed guard counter is both kicks and one of their
# AoEs, 1616 in all on Margit at +10 with 99 in every stat (the sheet has the AoEs as alternates)
MOTION_VALUE_FIXES["Dryleaf Arts"] = {**MOTION_VALUE_FIXES["Dryleaf Arts"], "2h R1 6": "106 + 106"}
MOTION_VALUE_FIXES["Dane's Footwork"] = {
    **MOTION_VALUE_FIXES["Dane's Footwork"],
    "2h Guard Counter": "113 + 113 + (160 Bullet)",
}

# Base stance damage where the sheet disagrees with EquipParamWeapon saWeaponDamage (found by
# check_movesets.py)
BASE_POISE_FIXES = {"Black Steel Greathammer": 7.5, "Hookclaws": 3}


def read_weapon_rows(project_dir):
    """@returns every EquipParamWeapon row by ID, including each affinity"""
    with open(os.path.join(project_dir, "data", "EquipParamWeapon-vanilla.csv"), encoding="utf-8") as f:
        return {int(row["id"]): row for row in csv.DictReader(f)}


def read_weapons(game_dir, project_dir):
    """
    @returns each weapon's name, and its base (unaffinitied) EquipParamWeapon row by name
    """
    names = {}
    msg_dir = os.path.join(game_dir, "msg", "engus")
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            path = os.path.join(msg_dir, folder, f"WeaponName{suffix}.fmg")
            if os.path.exists(path):
                names.update(read_fmg(path))

    rows = read_weapon_rows(project_dir)
    weapons = {}
    for weapon_id in sorted(rows):
        name = names.get(weapon_id)
        if name and weapon_id % 100 == 0 and name not in weapons:
            weapons[name] = rows[weapon_id]
    return weapons


def read_tab(project_dir, name):
    with open(os.path.join(project_dir, "data", "sheets", "mv", f"{name}.csv"), encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    return {
        row[1]: dict(zip(header, row)) for row in rows[1:] if len(row) > 1 and row[1].strip()
    }


def split_hits(cell):
    """
    Split a cell into the first word of each hit. Hits are separated by " + ", and a hit in
    parentheses is a separate projectile, e.g. "85 + (60 Bullet)" is [85, 60]. A note in parentheses
    after a hit is another version of the same hit, e.g. the tip in "100 (90 Far)", and is ignored.
    """
    hits = []
    depth = 0
    term = ""
    for char in cell + "+":
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "+" and depth == 0:
            words = term.strip().lstrip("(").split()
            if words:
                hits.append(words[0])
            term = ""
        else:
            term += char
    return hits


def parse_kinds(cell):
    """
    @returns each hit's kind: the word after the number in a hit in parentheses, e.g. "Bullet" in
    "85 + (60 Bullet)", or None for the weapon's own hits
    """
    kinds = []
    depth = 0
    term = ""
    for char in cell + "+":
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "+" and depth == 0:
            term = term.strip()
            if term:
                words = term.lstrip("(").replace("(", " ").replace(")", " ").split()
                kinds.append(words[1] if term.startswith("(") and len(words) > 1 else None)
            term = ""
        else:
            term += char
    return kinds


def parse_numbers(cell):
    """Parse "95 + 95 + 105" into [95, 95, 105], or [] for an empty cell"""
    values = []
    for hit in split_hits(cell):
        try:
            value = float(hit)
        except ValueError:
            return []
        values.append(int(value) if value.is_integer() else value)
    return values


def parse_types(cell):
    return [PHYSICAL_TYPES.get(hit.lower(), 0) for hit in split_hits(cell)]


def pick(values, i, default):
    """The i-th value for a hit, or the last one if there are fewer values than hits"""
    if not values:
        return default
    return values[min(i, len(values) - 1)]


def get_damage_type_motion_values(sheet_mvs, candidates, attack_row_count):
    """
    @param candidates game rows that may be the attack's hits, best first (see
    GameAttacks.get_candidate_rows), of which the first attack_row_count are the attack's own
    @returns each sheet hit's motion value (a number, or one per damage type if the matching game
    row's motion values differ by damage type) and the matching game row, if any
    """

    def matches(hit, mv):
        motion_values = get_motion_values(hit)
        return any(abs(value - mv) < 0.01 for value in [max(motion_values), motion_values[0]])

    attack_rows = candidates[:attack_row_count]
    used = set()
    result = []
    for mv in sheet_mvs:
        # The attack's own rows not matched yet (e.g. a paired weapon's second blade), then any of
        # them again (the sheet can list one row's hit several times, e.g. "92 + 92" from one 92
        # row), then the weapon's other rows
        unused = [hit for hit in attack_rows if id(hit) not in used]
        match = next(
            (hit for hit in unused + attack_rows + candidates if matches(hit, mv)),
            None,
        )
        if match is not None:
            used.add(id(match))
        motion_values = get_motion_values(match) if match else None
        if motion_values and len(set(motion_values)) > 1:
            mv = [int(value) if value.is_integer() else value for value in motion_values]
        result.append((mv, match))
    return result


# Weapons whose two handed attacks are their one handed ones, tested in game (the sheet and params
# can disagree, e.g. the Dancing Blade of Ranah has its own two handed R2 params, but the game uses
# the one handed animation and damage, without two handing's Strength bonus)
TWO_HANDED_USES_ONE_HANDED = {
    "Dancing Blade of Ranah": ["R2", "Charged R2"],
    "Falx": ["R2"],
    "Horned Warrior's Sword": ["R2"],
    "Rellana's Twin Blades": ["R2", "Charged R2"],
}

# Chains that are shorter in game than in the sheet, tested in game: (hands, attack) -> steps (e.g.
# the Ornamental Straight Sword's two handed R1 has four steps; the sheet's fifth is a regular
# straight sword's)
CHAIN_LENGTHS = {"Ornamental Straight Sword": {("2h", "R1"): 4}}


# Paired weapons' two handed attacks that get two handing's Strength bonus, tested in game, where the
# params don't say (e.g. the Death Knight's Twin Axes' two handed R2 does 880 to the one handed 844)
TWO_HANDED_STRENGTH_BONUS = {"Death Knight's Twin Axes": ["R2", "Charged R2", "Jumping R2", "Guard Counter"]}

# Clearer names for some weapons' kinds of hits than the sheet's (its "Bullet" is any attack
# detached from the weapon)
KIND_RENAMES = {
    "Black Steel Greathammer": {"Bullet": "AoE"},
    "Bloodfiend's Arm": {"Bullet": "AoE"},
    "Golem Fist": {"Bullet": "Projectile"},
    "Lizard Greatsword": {"Bullet": "Projectile"},
}

# BaseMovesetUnique name prefixes, and the attacks whose every step they're an extra hit of
UNIQUE_HIT_ATTACKS = {"R2": "R2", "Charged R2": "Charged R2", "Guard Counter": "Guard Counter"}

UNIQUE_MOTION_VALUE_FIELDS = ["Phys MV", "Magic MV", "Fire MV", "Ltng MV", "Holy MV"]
UNIQUE_FLAT_ATTACK_FIELDS = ["AtkPhys", "AtkMag", "AtkFire", "AtkLtng", "AtkHoly"]


def number(value):
    value = float(value)
    return int(value) if value.is_integer() else value


CORRECT_DAMAGE_TYPES = {0: "Physics", 1: "Magic", 2: "Fire", 3: "Thunder", 4: "Dark"}
CORRECT_ATTRIBUTES = {
    "str": "Strength",
    "dex": "Dexterity",
    "int": "Magic",
    "fai": "Faith",
    "arc": "Luck",
}


@functools.cache
def read_attack_element_correct(project_dir, correct_id):
    """@returns an AttackElementCorrectParam row in the weapon data's format, or None if there's none"""
    with open(os.path.join(project_dir, "data", "AttackElementCorrectParam-vanilla.csv"), encoding="utf-8") as f:
        row = next((row for row in csv.DictReader(f) if row["id"] == str(correct_id)), None)
    if row is None:
        print(f"Warning: no AttackElementCorrectParam {correct_id}, using the weapon's own scaling")
        return None
    correct = {}
    for damage_type, damage_name in CORRECT_DAMAGE_TYPES.items():
        attributes = {}
        for attribute, attribute_name in CORRECT_ATTRIBUTES.items():
            if row[f"is{attribute_name}Correct_by{damage_name}"] == "1":
                rate = int(row[f"overwrite{attribute_name}CorrectRate_by{damage_name}"])
                attributes[attribute] = True if rate < 0 else rate / 100
        if attributes:
            correct[str(damage_type)] = attributes
    return correct


def read_unique_hits(project_dir):
    """
    @returns extra hits from the BaseMovesetUnique tab, by weapon and attack (e.g. "R2")
    """
    with open(os.path.join(project_dir, "data", "sheets", "mv", "BaseMovesetUnique.csv"), encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    hits = {}
    for row in rows:
        prefix = row["Name"].split(" - ")[0]
        attack = UNIQUE_HIT_ATTACKS.get(prefix)
        if attack is None:
            print(f"Warning: unknown BaseMovesetUnique attack {row['Name']!r} for {row['Weapon']}")
            continue
        motion_values = [number(row[field]) for field in UNIQUE_MOTION_VALUE_FIELDS]
        hit = [
            motion_values if len(set(motion_values)) > 1 or not any(motion_values) else motion_values[0],
            number(row["Status MV"]),
            number(row["Poise Dmg MV"]),
            PHYSICAL_TYPES.get(row["PhysAtkAttribute"].lower(), 0),
        ]
        details = {"kind": row["Name"].split(" - ")[-1]}
        if row["isDisableBothHandsAtkBonus"] == "TRUE":
            details["noTwoHandBonus"] = True
        if row["overwriteAttackElementCorrectId"] not in ("-1", ""):
            details["correct"] = read_attack_element_correct(
                project_dir, row["overwriteAttackElementCorrectId"]
            )
        if row["isAddBaseAtk"] == "TRUE":
            flat_attack = [number(row[field]) for field in UNIQUE_FLAT_ATTACK_FIELDS]
            if any(flat_attack):
                details["flat"] = flat_attack
        hit.append(details)
        hits.setdefault(row["Weapon"], {}).setdefault(attack, []).append(hit)
    return hits


# The attacks whose hits pick a weapon's own physical damage type, and the tie breaker
BASE_TYPE_STEPS = [("R1", 0), ("R1", 1), ("R1", 2), ("R2", 0)]
BASE_TYPE_TIE_BREAKER_STEPS = [("R2", 1)]


def get_base_type(attacks, game_type):
    """
    @param attacks a weapon's one handed attacks, as in the output
    @returns the most common physical type of the hits that pick a weapon's own type
    """

    def count(steps):
        counts = {}
        for attack, index in steps:
            attack_steps = attacks.get(attack, [])
            if index < len(attack_steps):
                for hit in attack_steps[index]:
                    counts[hit[3]] = counts.get(hit[3], 0) + 1
        return counts

    counts = count(BASE_TYPE_STEPS)
    if not counts:
        return game_type
    tied = [hit_type for hit_type, n in counts.items() if n == max(counts.values())]
    if len(tied) > 1:
        tie_breaker = count(BASE_TYPE_TIE_BREAKER_STEPS)
        best = max(tie_breaker.get(hit_type, 0) for hit_type in tied)
        tied = [hit_type for hit_type in tied if tie_breaker.get(hit_type, 0) == best]
    return game_type if game_type in tied else tied[0]


def main():
    game_dir = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    weapons = read_weapons(game_dir, project_dir)
    motion = read_tab(project_dir, "MotionValues")
    status = read_tab(project_dir, "StatusMVs")
    poise = read_tab(project_dir, "PoiseMVs")
    types = read_tab(project_dir, "PhysicalAtkAttribute")
    game_attacks = GameAttacks(project_dir)
    unique_hits = read_unique_hits(project_dir)
    # Attack timings from the animations, if they've been unpacked (see check_animations.py)
    from check_animations import TAE_DIR, Steps, get_left_hand_hits, get_timings  # noqa: E402

    timings = Steps(game_dir, project_dir) if os.path.isdir(os.path.join(game_dir, TAE_DIR)) else None
    split_count = 0

    output = {}
    hit_count = 0
    for weapon, row in motion.items():
        base_poise = parse_numbers(poise.get(weapon, {}).get("Base", ""))
        attribute = int(weapons[weapon]["atkAttribute"]) if weapon in weapons else 3
        entry = {
            "poise": BASE_POISE_FIXES.get(weapon, base_poise[0] if base_poise else 0),
            "type": PHYSICAL_TYPES[WEAPON_ATTRIBUTE_TYPES.get(attribute, "standard")],
        }
        if weapon not in weapons:
            print(f"Warning: no game data for {weapon}, assuming standard physical damage")
        one_handed = weapon in weapons and weapons[weapon]["bothHandEquipable"] == "0"
        if one_handed:
            entry["oneHanded"] = True
        for hands in ["1h"] if one_handed else ["1h", "2h"]:
            attacks = {}
            attack_keys = [
                (attack, [(column, f"{hands} {column}") for column in columns])
                for attack, columns in ATTACKS.items()
            ] + [
                (attack, [(None, column) for column in columns])
                for attack, (columns, attack_hands) in SHARED_ATTACKS.items()
                if hands in attack_hands
            ]
            for attack, keys in attack_keys:
                steps = []
                for column, key in keys:
                    mvs = parse_numbers(MOTION_VALUE_FIXES.get(weapon, {}).get(key, row.get(key, "")))
                    if not mvs:
                        break
                    status_mvs = parse_numbers(status.get(weapon, {}).get(key, ""))
                    poise_mvs = parse_numbers(poise.get(weapon, {}).get(key, ""))
                    hit_types = parse_types(types.get(weapon, {}).get(key, ""))
                    if weapon in weapons and column:
                        candidates, attack_row_count = game_attacks.get_candidate_rows(
                            weapons[weapon], column, hands == "2h"
                        )
                        matched = get_damage_type_motion_values(mvs, candidates, attack_row_count)
                        mvs = [mv for mv, _ in matched]
                        matches = [match for _, match in matched]
                        split_count += sum(isinstance(mv, list) for mv in mvs)
                    else:
                        matches = [None] * len(mvs)
                    kinds = parse_kinds(row.get(key, ""))
                    step = []
                    for i, mv in enumerate(mvs):
                        details = {}
                        # Game rows have their own subcategories; others follow the usual pattern
                        if matches[i]:
                            categories = [
                                int(matches[i][f"subCategory{k}"])
                                for k in range(1, 5)
                                if int(matches[i][f"subCategory{k}"] or 0)
                            ]
                        else:
                            categories = list(CATEGORY_FALLBACKS.get(attack, []))
                            if hands == "2h" and attack not in NO_TWO_HAND_BONUS_ATTACKS:
                                categories.append(TWO_HANDED_CATEGORY)
                        if categories:
                            details["categories"] = categories
                        if i < len(kinds) and kinds[i]:
                            details["kind"] = kinds[i]
                        # Hits not matched to a game row on paired weapons keep the usual rule
                        # that paired weapons don't get two handing's Strength bonus
                        if (
                            matches[i]["isDisableBothHandsAtkBonus"] == "1"
                            if matches[i]
                            else weapon in weapons and weapons[weapon]["isDualBlade"] == "1"
                        ):
                            details["noTwoHandBonus"] = True
                        # How much of a weapon buff's flat attack the hit gets (byPoint, the sheet's
                        # "Weapon Buff MV"), e.g. 90 for the Backhand Blade's two handed R1s
                        buff_motion_value = matches[i] and number(
                            matches[i]["spEffectAtkPowerCorrectRate_byPoint"]
                        )
                        if matches[i] and buff_motion_value != 100:
                            details["buffMotionValue"] = buff_motion_value
                        correct_id = matches[i] and matches[i]["overwriteAttackElementCorrectId"]
                        if correct_id and correct_id != "-1":
                            details["correct"] = read_attack_element_correct(project_dir, correct_id)
                        step.append(
                            [mv, pick(status_mvs, i, 100), pick(poise_mvs, i, 100), pick(hit_types, i, 0)]
                            + ([details] if details else [])
                        )
                    steps.append(step)
                    hit_count += len(mvs)
                for step in steps:
                    extra_hits = unique_hits.get(weapon, {}).get(attack, [])
                    step.extend(extra_hits)
                    hit_count += len(extra_hits)
                # The last step of a chain without game rows is its final chain attack
                if attack in FINAL_CHAIN_ATTACKS and attack in SHARED_ATTACKS and len(steps) > 1:
                    for hit in steps[-1]:
                        if len(hit) < 5:
                            hit.append({})
                        hit[4]["categories"] = hit[4].get("categories", []) + [FINAL_CHAIN_CATEGORY]
                if steps:
                    attacks[attack] = steps
            if attacks:
                entry[hands] = attacks
        for (hands, attack), length in CHAIN_LENGTHS.get(weapon, {}).items():
            if attack in entry.get(hands, {}):
                entry[hands][attack] = entry[hands][attack][:length]
        for attack in TWO_HANDED_STRENGTH_BONUS.get(weapon, []):
            for step in entry.get("2h", {}).get(attack, []):
                for hit in step:
                    if len(hit) > 4:
                        hit[4] = {key: value for key, value in hit[4].items() if key != "noTwoHandBonus"}
                        if not hit[4]:
                            hit.pop()
        for attack in NO_TWO_HAND_BONUS_ATTACKS:
            for step in entry.get("2h", {}).get(attack, []):
                for hit in step:
                    if len(hit) < 5:
                        hit.append({})
                    hit[4]["noTwoHandBonus"] = True
        for attack in TWO_HANDED_USES_ONE_HANDED.get(weapon, []):
            if attack in entry.get("1h", {}):
                entry.setdefault("2h", {})[attack] = [
                    [hit[:4] + [{**(hit[4] if len(hit) > 4 else {}), "noTwoHandBonus": True}] for hit in step]
                    for step in entry["1h"][attack]
                ]
        entry["type"] = get_base_type(entry.get("1h") or entry.get("2h") or {}, entry["type"])
        renames = KIND_RENAMES.get(weapon, {})
        for hands in ["1h", "2h"]:
            for steps in entry.get(hands, {}).values():
                for step in steps:
                    for hit in step:
                        if len(hit) > 4 and hit[4].get("kind") in renames:
                            hit[4] = {**hit[4], "kind": renames[hit[4]["kind"]]}
        if timings is not None and weapon in weapons:
            timing = get_timings(timings, weapons[weapon], entry)
            if timing:
                entry["timing"] = timing
            # Powerstance hits with the left hand's weapon, for an off hand weapon of another kind
            for attack, marks in get_left_hand_hits(timings, weapons[weapon], entry).items():
                for step, step_marks in zip(entry["1h"][attack], marks):
                    for i, left in enumerate(step_marks or []):
                        if left:
                            hit = step[i]
                            step[i] = [*hit[:4], {**(hit[4] if len(hit) > 4 else {}), "leftHand": True}]
        output[weapon] = entry

    out_path = os.path.join(project_dir, "public", "movesets.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"), ensure_ascii=False)
    print(
        f"{len(output)} weapons, {hit_count} hits ({split_count} with motion values by damage type)"
        f" -> {out_path}"
    )


if __name__ == "__main__":
    main()
