"""
Build public/ammo.json: arrows, greatarrows, bolts, and ballista bolts, with ammunition of the
same class and identical damage merged into one entry.

The Spread Crossbow fires several bolts per shot (tested in game: three Black-Key Bolts build up
about 140 scarlet rot, 3 × 60 × 80%). Each bolt's spread shot is its behavior judge 341: a Bullet
with numShoot bolts, whose attack has the status motion value. The Pulley Crossbow fires three
regular shots in quick succession, which is in its animations rather than the params, so its count
is set here.

Each ammunition's physical damage type comes from its attack (all pierce in 1.17), since ranged
weapons' own types don't apply to their shots.

Ammunition's poise damage (saWeaponDamage) replaces the weapon's when fired (tested in game:
Stormwing Bone Arrows do 5 from a Longbow, whose own is 2).

Some ranged weapons boost some ammunition with an always-on effect (residentSpEffectId) limited to
an attack category (magicSubCategoryChange1-3): damage multipliers, e.g. the Lion Greatbow's ×1.2
physical attack for Radahn's Spears, and status buildup from an effect triggered on each hit
(atkOccurrenceSpEffectId), e.g. the Serpent Bow's 15 poison for every arrow. Each ammunition's category is subCategory1 of its attack, found through its
behavior variation (judge 300, a Bullet) as in game_attacks.py.

Ammunition's damage multipliers against enemy types (weakA-D_DamageRate, e.g. Igon's Harpoon's ×1.3
against dragons) are its enemyTypeRates.

Usage:
  python3 -I scripts/build_ammo_data.py <ELDEN RING Game dir> <Paramdex ER dir>

Inputs (all from the base game):
  - <Game>/regulation-bin/EquipParamWeapon.param and SpEffectParam.param, unpacked with WitchyBND
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND
  - <Paramdex ER dir> is the Paramdex folder bundled with WitchyBND (Assets/Paramdex/ER)
  - data/BehaviorParam_PC-, Bullet-, and AtkParam_Pc-vanilla.csv, decoded with extract_param.py
"""

import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extract_fmg import read_fmg  # noqa: E402
from extract_param import read_param  # noqa: E402
from game_attacks import GameAttacks  # noqa: E402

REGULATION_VERSION = 11730034

# EquipParamWeapon wepType for each ammunition class
AMMO_CLASSES = {81: "arrow", 83: "greatarrow", 85: "bolt", 86: "ballistaBolt"}

# Damage multiplier fields for each enemy type (see build_enemy_data.py's ENEMY_TYPES)
ENEMY_TYPE_RATE_FIELDS = {
    "star": "weakA_DamageRate",
    "death": "weakB_DamageRate",
    "ancientDragon": "weakC_DamageRate",
    "dragon": "weakD_DamageRate",
}

# Base attack fields, by AttackPowerType (physical, magic, fire, lightning, holy)
ATTACK_FIELDS = {
    0: "attackBasePhysics",
    1: "attackBaseMagic",
    2: "attackBaseFire",
    3: "attackBaseThunder",
    4: "attackBaseDark",
}

# Status buildup fields in SpEffectParam, by AttackPowerType
STATUS_FIELDS = {
    5: "poizonAttackPower",
    6: "diseaseAttackPower",
    7: "bloodAttackPower",
    8: "freezeAttackPower",
    9: "sleepAttackPower",
    10: "madnessAttackPower",
    11: "curseAttackPower",
}

FLETCHED_SUFFIX = " (Fletched)"

# The behavior judge ID of firing ammunition
SHOT_JUDGE_ID = 300

# Weapons that fire several bolts per shot: the behavior judge ID of the shot, and how many (None
# for the shot's Bullet numShoot)
MULTI_SHOT_WEAPONS = {"Spread Crossbow": (341, None), "Pulley Crossbow": (SHOT_JUDGE_ID, 3)}

# AtkParam atkAttribute values
PHYSICAL_TYPES = {0: "slash", 1: "strike", 2: "pierce", 3: "standard"}
WEAPON_ATTRIBUTE = 253

# Attack rate fields of SpEffectParam, by AttackPowerType
ATTACK_RATE_FIELDS = {
    0: "physicsAttackRate",
    1: "magicAttackRate",
    2: "fireAttackRate",
    3: "thunderAttackRate",
    4: "darkAttackRate",
}
SUB_CATEGORY_FIELDS = ["magicSubCategoryChange1", "magicSubCategoryChange2", "magicSubCategoryChange3"]


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

    weapons = param("EquipParamWeapon")
    sp_effects = param("SpEffectParam", "SpEffect")
    game_attacks = GameAttacks(project_dir)

    msg_dir = os.path.join(game_dir, "msg", "engus")
    names = {}
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            path = os.path.join(msg_dir, folder, f"WeaponName{suffix}.fmg")
            if os.path.exists(path):
                names.update(read_fmg(path))

    # Bonuses from ranged weapons' always-on effects, by weapon name and attack category
    weapon_bonuses = {}
    for row in weapons.values():
        name = names.get(row["id"])
        for resident_field in ["residentSpEffectId", "residentSpEffectId1", "residentSpEffectId2"]:
            effect = sp_effects.get(row[resident_field])
            if not name or not effect:
                continue
            bonus = {}
            rates = {t: effect[field] for t, field in ATTACK_RATE_FIELDS.items() if effect[field] != 1}
            if rates:
                bonus["damageMultipliers"] = rates
            on_hit = sp_effects.get(effect["atkOccurrenceSpEffectId"])
            status = (
                {t: on_hit[field] for t, field in STATUS_FIELDS.items() if on_hit[field] > 0}
                if on_hit
                else {}
            )
            if status:
                bonus["status"] = status
            for field in SUB_CATEGORY_FIELDS:
                if effect[field] and bonus:
                    weapon_bonuses.setdefault(name, {})[effect[field]] = bonus

    # Bullet for each behavior variation and judge ID, for spread shots
    with open(os.path.join(project_dir, "data", "Bullet-vanilla.csv"), encoding="utf-8") as f:
        bullets = {int(row["id"]): row for row in csv.DictReader(f)}
    with open(os.path.join(project_dir, "data", "BehaviorParam_PC-vanilla.csv"), encoding="utf-8") as f:
        behavior_rows = list(csv.DictReader(f))
    bullet_behaviors = {
        (int(row["variationId"]), int(row["behaviorJudgeId"])): int(row["refId"])
        for row in behavior_rows
        if row["refType"] == "1"
    }
    # Each shot's stamina cost (before the weapon's staminaConsumptionRate), by behavior variation
    # (from its row's ID, 100000000 + variation × 1000 + judge: the Piquebone Bolt's row has another
    # variationId)
    shot_stamina = {
        (int(row["id"]) - 100_000_000) // 1000: int(row["stamina"])
        for row in behavior_rows
        if 100_000_000 <= int(row["id"]) < 200_000_000 and int(row["id"]) % 1000 == SHOT_JUDGE_ID
    }

    def get_shots(row, judge_id, count):
        """@returns how many bolts a shot fires, and their motion values"""
        bullet = bullets.get(bullet_behaviors.get((row["behaviorVariationId"], judge_id)))
        attack = bullet and game_attacks.attacks.get(int(bullet["atkId_Bullet"]))
        if not attack:
            return None
        return {
            "count": count or int(bullet["numShoot"]),
            "motionValue": float(attack["atkPhysCorrection"]),
            "statusMotionValue": float(attack["statusAilmentAtkPowerCorrectRate"]),
            "poiseMotionValue": float(attack["atkSuperArmorCorrection"]),
        }

    def get_physical_type(row):
        atk_id = game_attacks.behaviors.get(row["behaviorVariationId"], {}).get(SHOT_JUDGE_ID)
        attack = game_attacks.attacks.get(atk_id)
        attribute = int(attack["atkAttribute"]) if attack else WEAPON_ATTRIBUTE
        if attribute == WEAPON_ATTRIBUTE:
            attribute = row["atkAttribute"]
        return PHYSICAL_TYPES.get(attribute, "pierce")

    def get_sub_categories(row):
        """@returns its shot's attack categories: any of subCategory1-4 (e.g. Igon's Harpoon's 135 is
        its subCategory3, which the Igon's Greatbow's ×1.2 physical is for: tested in game, its Igon's
        Drake Hunt does 1213 to the dummy at +25 with 99 in every stat, 1011 without it)"""
        atk_id = game_attacks.behaviors.get(row["behaviorVariationId"], {}).get(SHOT_JUDGE_ID)
        attack = game_attacks.attacks.get(atk_id)
        if not attack:
            return []
        return [int(attack[f"subCategory{i}"]) for i in range(1, 5) if int(attack[f"subCategory{i}"])]

    ammo = []
    for row in weapons.values():
        ammo_class = AMMO_CLASSES.get(row["wepType"])
        name = names.get(row["id"])
        # Skip cut and placeholder ammunition, which has no name
        if ammo_class is None or not name or name.startswith("["):
            continue

        attack = {t: row[field] for t, field in ATTACK_FIELDS.items() if row[field]}
        status = {}
        for slot in ["spEffectBehaviorId0", "spEffectBehaviorId1", "spEffectBehaviorId2"]:
            effect = sp_effects.get(row[slot])
            if effect:
                for t, field in STATUS_FIELDS.items():
                    if effect[field] > 0:
                        status[t] = effect[field]
        sub_categories = get_sub_categories(row)
        bonuses = {
            weapon: dict(next(bonus[category] for category in sub_categories if category in bonus))
            for weapon, bonus in weapon_bonuses.items()
            if any(category in bonus for category in sub_categories)
        }
        if ammo_class == "bolt":
            for weapon, (judge_id, count) in MULTI_SHOT_WEAPONS.items():
                shots = get_shots(row, judge_id, count)
                if shots:
                    bonuses.setdefault(weapon, {})["shots"] = shots
        ammo.append(
            {
                "class": ammo_class,
                "name": name,
                "attack": attack,
                "status": status,
                "poise": row["saWeaponDamage"],
                # Its shot's stamina cost, e.g. an Arrow's 13 and a Ballista Bolt's 40
                "stamina": shot_stamina.get(row["behaviorVariationId"]),
                "physicalType": get_physical_type(row),
                "enemyTypeRates": {
                    enemy_type: row[field]
                    for enemy_type, field in ENEMY_TYPE_RATE_FIELDS.items()
                    if row[field] != 1
                },
                "weaponBonuses": bonuses,
            }
        )

    def stats_key(entry):
        return (
            entry["class"],
            tuple(sorted(entry["attack"].items())),
            tuple(sorted(entry["status"].items())),
            entry["poise"],
            entry["stamina"],
            entry["physicalType"],
            tuple(sorted(entry["enemyTypeRates"].items())),
            json.dumps(entry["weaponBonuses"], sort_keys=True),
        )

    # Fletched ammunition is only listed if it differs from the regular version
    keys = {(entry["class"], entry["name"]): stats_key(entry) for entry in ammo}
    ammo = [
        entry
        for entry in ammo
        if not entry["name"].endswith(FLETCHED_SUFFIX)
        or keys.get((entry["class"], entry["name"][: -len(FLETCHED_SUFFIX)])) != stats_key(entry)
    ]

    # Merge ammunition of the same class with identical damage
    groups = {}
    for entry in ammo:
        group = groups.setdefault(
            stats_key(entry),
            {
                "class": entry["class"],
                "names": [],
                "attack": entry["attack"],
                "status": entry["status"],
                "poise": entry["poise"],
                **({"stamina": entry["stamina"]} if entry["stamina"] is not None else {}),
                "physicalType": entry["physicalType"],
                **({"enemyTypeRates": entry["enemyTypeRates"]} if entry["enemyTypeRates"] else {}),
                **({"weaponBonuses": entry["weaponBonuses"]} if entry["weaponBonuses"] else {}),
            },
        )
        group["names"].append(entry["name"])

    class_order = list(AMMO_CLASSES.values())
    output = sorted(
        groups.values(),
        key=lambda group: (class_order.index(group["class"]), sorted(group["names"])[0]),
    )
    for group in output:
        group["names"].sort()

    out_path = os.path.join(project_dir, "public", "ammo.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(ammo)} ammunition in {len(output)} groups -> {out_path}")


if __name__ == "__main__":
    main()
