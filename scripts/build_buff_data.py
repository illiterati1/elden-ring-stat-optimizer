"""
Build public/buffs.json: talismans, armor, physick tears, consumables, incantations, weapon skills,
spirit ashes, and Godrick's Great Rune that change the player's damage or stats, and debuffs that
make enemies take more damage, for the buffs panel.

Usage:
  python3 -I scripts/build_buff_data.py <ELDEN RING Game dir> <Paramdex ER dir>

Inputs:
  - <Game>/regulation-bin/*.param, unpacked from regulation.bin with WitchyBND
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND
  - <Paramdex ER dir> is the Paramdex folder bundled with WitchyBND (Assets/Paramdex/ER)
  - public/movesets.json and public/ashes.json (build_moveset_data.py and build_ash_data.py), for
    the attack subcategories weapons' and skills' hits have: effects limited to others (e.g. the
    Alberich set's thorn sorceries) only boost spells, so they're left out

Each buff has a list of effects (SpEffectParam), each with:
  - attackPowerRates: attack power multipliers by damage type, before defenses
    (physicsAttackPowerRate etc.)
  - damageRates: damage multipliers by damage type, after defenses (physicsAttackRate etc. times
    atkEnemyDmgCorrectRate_*, the multiplier against enemies)
  - flat: flat attack added to the weapon by damage type, like a grease (physicsAttackPower etc.,
    weapon effects only)
  - spellScaling: "int" or "fai" if flat is multiplied by the catalyst's spell scaling (as a
    percentage), counting only that stat's part of it (bAdjustMagicAblity, bAdjustFaithAblity), e.g.
    Electrify Armament's
  - status: status buildup added to the weapon, by AttackPowerType (5 poison to 11 death blight),
    from the effect its hits apply (atkOccurrenceSpEffectId, e.g. Poison Grease's), or its own
    (poizonAttackPower etc., weapon effects only)
  - hitStatus: status buildup each hit applies without scaling, by AttackPowerType, from an on-hit
    effect that builds it up over time (its cycleOccurrenceSpEffectId's buildup times its ticks, e.g.
    Bloodflame Blade's 40 blood loss)
  - hpDamage: a percentage of the enemy's max HP each hit does over time, from an on-hit effect
    (changeHpRate percent plus changeHpPoint each tick), as { label, rate, ticks, flat }, e.g. Black
    Flame Blade's black flame
  - stats: points added to stats (addStrengthStatus etc.)
  - scalingBonus: points added to the weapon's stat scaling, as fractions (changeStrengthPoint etc.,
    e.g. War Cry's +5 Strength scaling, tested in game with its R2s)
  - poiseRate: stance damage multiplier (saAttackPowerRate)
  - enemyTypeRates: damage multipliers against enemy types (weakDmgRateA-D, see
    build_enemy_data.py's ENEMY_TYPES), e.g. Sacred Order's ×2 against those who live in death
  - categories: the attack subcategories (AtkParam subCategory1-4) it only applies to, if any
  - group: its spCategory, if effects of the same one replace each other (e.g. 162 weapon buffs)
  - critical: true if it only applies to critical hits (the Dagger Talisman, not in the data)
  - byEquipWeight: true if its multipliers shrink with equip weight (the Blue Dancer Charm, not in
    the data)
  - firstHitOnly: true if it only applies to an attack's first hit (Determination and Royal
    Knight's Resolve)
  - physicalTypes: the physical damage types of the hits it only applies to, if limited
  - counter: true if it only applies to counterattacks (the Spear Talisman)
  - hp: the HP percentages it applies at, as { min, max } (at least min, below max), e.g. Shriek of
    Sorrow's levels
  - tierRates: for successive attack stacks, the damage multiplier at each tier (damageRates is the
    last tier's)
Consumables, spells, skills, and spirit ashes also have type: "weapon", "body", or "aura" for the
in-game stacking groups (only one of each is active at a time), or "unique" for buffs that stack
with everything. Weapons that can't take an Ash of War have their own skill's weapon buff as a skill
named after it, with weapons: its effects on each weapon with it, by name, and no effects of its own,
unless an Ash of War's buff has the same name (e.g. Sacred Blade), which gets the weapons.
Each buff can also have exclusive: keys it can't be used with another buff with, e.g. talismans of
the same accessoryGroup, or buffs whose conditions can't hold at once.
Spells also have requirements: the stats needed to cast them (requirementIntellect etc.), if any.
Talismans, armor, and off-hand weapons have weight: theirs (EquipParam* weight), for the Blue Dancer
Charm's equip weight (merged armor has the first piece's).
"""

import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import read_weapons  # noqa: E402
from extract_fmg import read_fmg  # noqa: E402
from extract_param import read_param  # noqa: E402
from extract_tae import read_tae  # noqa: E402

REGULATION_VERSION = 11730034

DAMAGE_TYPES = ["physics", "magic", "fire", "thunder", "dark"]
ENEMY_DAMAGE_FIELDS = ["Physics", "Magic", "Fire", "Thunder", "Dark"]
# SpEffectParam damage multiplier fields for each enemy type
ENEMY_TYPE_RATE_FIELDS = {
    "star": "weakDmgRateA",
    "death": "weakDmgRateB",
    "ancientDragon": "weakDmgRateC",
    "dragon": "weakDmgRateD",
}
STAT_FIELDS = {
    "str": "addStrengthStatus",
    "dex": "addDexterityStatus",
    "int": "addMagicStatus",
    "fai": "addFaithStatus",
    "arc": "addLuckStatus",
}

# SpEffectParam fields that add to the weapon's stat scaling (not growing with upgrades)
SCALING_FIELDS = {
    "str": "changeStrengthPoint",
    "dex": "changeAgilityPoint",
    "int": "changeMagicPoint",
    "fai": "changeFaithPoint",
    "arc": "changeLuckPoint",
}

# SpEffectParam status buildup fields, by AttackPowerType
STATUS_FIELDS = {
    5: "poizonAttackPower",
    6: "diseaseAttackPower",
    7: "bloodAttackPower",
    8: "freezeAttackPower",
    9: "sleepAttackPower",
    10: "madnessAttackPower",
    11: "curseAttackPower",
}

# spCategory values that don't replace each other
SHARED_CATEGORIES = {0, 20}

# SpEffectParam wepParamChange: 1 for the right hand weapon, 3 for spells only (left out)
WEAPON_EFFECT = 1
SPELL_EFFECT = 3

# Kinds of buff whose effects of the same spCategory replace each other (equipment's don't: armor
# effects share categories, e.g. 10 for many DLC sets, but each slot has one piece)
STACKING_KINDS = {"consumable", "tear", "spell", "skill", "spirit", "debuff"}

# Consumables' and spells' stacking groups, by spCategory (others stack with everything: "unique")
BUFF_TYPES = {162: "weapon", 151: "body", 160: "aura"}
LEFT_HAND_WEAPON_BUFF = 163

# Buffs the params don't link to their item, skill, or spirit, by kind and name: their effects
# (followed through cycleOccurrenceSpEffectId), and their type if their effects' spCategory doesn't
# give it. Skills apply theirs from their animations (a{600 + swordArtsTypeNew}.tae
# AddSpEffect events), spirit ashes from their bullets (BuddyParam npcParamId's
# behaviorVariationId), items that buff through a bullet from it (EquipParamGoods refCategory 1, e.g.
# the aromatics), and the Golden Great Arrow from its bullet (BehaviorParam_PC 105102300).
# Weapon skills' right hand effect (spCategory 162); 163 is the left's.
EXTRA_BUFFS = [
    # Weapon buffs from Ashes of War
    ("skill", "Sacred Blade", [821], {}),
    # ×2 against those who live in death, and ×1.1 to everything from the effect it keeps applying
    # (1849), like Shared Order's
    ("skill", "Sacred Order", [1841], {}),
    ("skill", "Flaming Strike", [1776], {}),
    ("skill", "Lightning Slash", [1676], {}),
    ("skill", "Chilling Mist", [826], {}),
    ("skill", "Poisonous Mist", [831], {}),
    ("skill", "Seppuku", [1755], {}),
    ("skill", "Cragblade", [1821], {}),
    ("skill", "Barbaric Roar", [1681], {}),
    ("skill", "War Cry", [1811], {}),
    ("skill", "Braggart's Roar", [1861], {}),
    ("skill", "Flame Skewer", [20000891], {}),
    ("skill", "Flame Spear", [20000961], {}),
    ("skill", "Determination", [1691], {}),
    ("skill", "Royal Knight's Resolve", [1701], {}),
    # Its levels by HP (see HP_CONDITIONS)
    ("skill", "Shriek of Sorrow", [20000901, 20000903, 20000921, 20000923], {}),
    # Body buffs
    ("consumable", "Bloodboil Aromatic", [503550], {}),
    ("skill", "Light", [20000980], {}),
    # Aura buffs
    ("consumable", "Uplifting Aromatic", [503501], {}),
    ("consumable", "Golden Vow", [20503170], {}),
    ("consumable", "Golden Great Arrow", [1730], {}),
    ("skill", "Golden Vow", [1730], {}),
    ("skill", "Last Rites", [1836], {}),
    ("skill", "Rallying Standard", [1768], {}),
    # Its damage multiplier is a 0.1s effect it keeps applying (1876)
    ("skill", "Shared Order", [1870], {"type": "aura"}),
    ("spirit", "Perfumer Tricia", [14406], {}),
    ("spirit", "Stormhawk Deenh", [10945], {}),
    # Unique buffs. The Lamenter's Mask's Arcane is applied by the game's scripts while it's worn
    # without armor, like the Sharpshot Talisman's effect.
    ("consumable", "Lamenter's Mask", [19982], {"type": "unique", "exclusive": ["armor"]}),
    ("consumable", "Sacred Bloody Flesh (blood loss)", [20501212], {"type": "unique"}),
    ("skill", "Oath of Vengeance", [1850], {"type": "unique"}),
    # The Jellyfish Shield's skill, so other weapons are one handed (the shield itself can be two
    # handed)
    ("skill", "Contagious Fury", [1586], {"type": "unique", "oneHanded": True, "skillOf": "Jellyfish Shield"}),
]
# Buffs whose effects aren't followed (cycleOccurrenceSpEffectId): Sacred Bloody Flesh's blood loss
# boost is its own buff
UNFOLLOWED = {"Sacred Bloody Flesh"}

# Unique weapons' own skill buffs their skills' animations don't name, by weapon: the Stormhawk Axe's
# Thunderstorm's 120 lightning for 40 seconds (1511; tested in game: its lightning strikes), and
# Mohgwyn's Sacred Spear's Bloodboon Ritual's 30 fire for 20 seconds (1627, which the game's scripts
# apply: no param or animation names it)
EXTRA_UNIQUE_SKILL_BUFFS = {"Stormhawk Axe": 1511, "Mohgwyn's Sacred Spear": 1627}

# Weapon buffs only one weapon gets from its own passive, by name: Euporia's luster tiers (19881 and
# 19883, from its resident effects' build-up: 95 and 120 holy; tested in game at +25 with 99 in every
# stat: its first one handed R1 733 and 759, 637 without). They only exclude each other.
WEAPON_PASSIVE_BUFFS = {
    "Luster Tier 1": ("Euporia", 19881),
    "Luster Tier 2": ("Euporia", 19883),
}
TAE_DIR = os.path.join("chr", "c0000-anibnd-dcx-wanibnd", "INTERROOT_win64", "chr", "c0000", "tae")
# AddSpEffect_Multiplayer, AddSpEffect, and AddSpEffect_WeaponArts
SPEFFECT_EVENTS = {66, 67, 331}
# Weapon buffs shorter than this are part of the skill's own attack, e.g. Rancor Slash's
MIN_SKILL_BUFF_DURATION = 1

# Equipment left out: the Omen set only boosts Shriek of Milos
EXCLUDED = {"Omen Helm", "Omen Armor", "Omen Gauntlets", "Omen Greaves"}

# Spells left out: Litany of Proper Death's ×10 against those who live in death is on its own
# projectile (Bullet), so it only boosts the spell itself
EXCLUDED_SPELLS = {"Litany of Proper Death"}

# Notes for weapons' own skills' buffs, which are shown with whose skill they are otherwise
FIXED_SKILL_NOTES = {
    "Shriek of Milos": "Sword of Milos's skill. Its enemy debuff is separate, in the enemy debuffs",
}

# Attack subcategories the app gives hits rather than the data: 105 ammunition (bows' arrows and
# bolts) and 120 two handed attacks
APP_CATEGORIES = {105, 120}

# Godrick's Great Rune once restored and activated: +5 to every stat (SpEffectParam 600)
GODRICK_GREAT_RUNE = 600

# Conditions the data doesn't have, shown with the buff
NOTES = {
    "Determination": "First hit of a chain only",
    "Royal Knight's Resolve": "First hit of a chain only",
    "Light": "Sword of Light's skill",
    "Lamenter's Mask": "Requires no armor",
    "Sacred Bloody Flesh (blood loss)": "After blood loss nearby",
    "Contagious Fury": "Jellyfish Shield's skill, so other weapons are one handed",
    "Luster Tier 1": "Euporia's, from its hits",
    "Luster Tier 2": "Euporia's, from its hits",
    "Dagger Talisman": "Critical hits only",
    "Blue Dancer Charm": "Less with more equip weight",
    "Lord of Blood's Exultation": "After blood loss nearby",
    "Kindred of Rot's Exultation": "After poison or scarlet rot nearby",
    "Mushroom Crown": "After poison or scarlet rot nearby",
    "Black Dumpling": "While suffering madness",
    "Poisoned Hand": "After poison or scarlet rot nearby",
    "Madding Hand": "After madness nearby",
    "Aged One's Exultation": "After madness nearby",
    "St. Trina's Smile": "After sleep nearby",
    "White Mask": "After blood loss nearby",
    "Sacred Bloody Flesh": "First stage",
    "Crusade Insignia": "After defeating an enemy",
    "Dried Bouquet": "After a summoned spirit dies",
    "Blade of Mercy": "After a critical hit",
    "Rellana's Cameo": "After holding the stance for 1s",
    "Sharpshot Talisman": "Aimed shots only",
}
CRITICAL_ONLY = {"Dagger Talisman"}
# Buffs whose multipliers shrink with equip weight (the game's code, not the data; see
# getEquipWeightRate in src/optimizer/build.ts)
EQUIP_WEIGHT_SCALED = {"Blue Dancer Charm"}
# Counterattacks: the counter window's effect (attacking characters take more pierce damage,
# thrustDamageCutRate; the player's attack animations apply it), as the "Counterattack" buff
COUNTER_EFFECT = 45
# Buffs that only apply to pierce counterattacks, not in the data
PIERCE_COUNTER_ONLY = {"Spear Talisman"}

# Buffs that only apply to the first hit of the next attack (the skill ends its effect on hit)
FIRST_HIT_ONLY = {"Determination", "Royal Knight's Resolve"}

# Attack subcategories for buffs whose data doesn't limit them. Rellana's Cameo only applies to
# attacks out of a held stance, which the skills' animations decide: build_ash_data.py's
# STANCE_ATTACK_CATEGORY.
CATEGORY_OVERRIDES = {"Rellana's Cameo": [1000]}

# Damage multipliers fitted to tests in game, by buff name, where the data's don't match and the cause
# is unknown: the Divine Beast Head's effect (6529000) has ×1.05 for its attacks, but they do ×1.04 in
# game, like the Divine Beast Helm's (6525200). Tested on a Longsword +25's Storm Blade with 99 in
# every stat on the training dummy: its first hit 1091 with the Head alone (1101 at ×1.05), and 1201
# for the first hit and 3622 for all three with the Enraged Divine Beast too, the same in vanilla and
# the Boss Arena mod. Its stats (+4 Strength and Dexterity) are right.
# The Dagger Talisman's effect (320900) has ×1.17 for critical hits (the same in the Boss Arena mod),
# but they do about ×1.16 in game. Tested with 99 in every stat: a Longsword +25's backstab 1414 (1220
# without it), +0's 407-408 (352), and a Dagger +25's 1758 (1516) on the training dummy, and a
# Longsword +25's riposte 1911 on the Weeping Peninsula's Leonine Misbegotten (1647). ×1.16 gives
# 1415, 408, 1758, and 1911: the first a point over, within the game's own variation (407-408).
DAMAGE_RATE_FITS = {"Divine Beast Head": 1.04, "Dagger Talisman": 1.16}

# HP percentages each of a buff's effects applies at, in order: at least min, below max. The talismans'
# conditions (conditionHp, and the Ritual Sword Talisman's full HP) and Shriek of Sorrow's levels
# (each level's effect's parent, 20000900-20000922: below 30% ×1.25 physical, below 55% ×1.2, below
# 85% ×1.15, otherwise ×1.1, each with +5 Strength scaling; tested in game at the strongest level)
HP_CONDITIONS = {
    "Red-Feathered Branchsword": [{"max": 20}],
    "Twinbird Kite Shield": [{"max": 20}],
    "Ritual Sword Talisman": [{"min": 100}],
    "Shriek of Sorrow": [{"max": 30}, {"min": 30, "max": 55}, {"min": 55, "max": 85}, {"min": 85}],
}

# Successive attack stacks: each tier's effect (accumuOverFireId of the item's effect and the ones
# after it). All have the same cutoffs (accumuOverVal 17, 30, 45), and the 4th tier (60) has the
# same multiplier as the 3rd, so it's left out.
STACK_TIERS = {
    "Winged Sword Insignia": [320804, 320805, 320806],
    "Rotten Winged Sword Insignia": [320814, 320815, 320816],
    "Millicent's Prosthesis": [312505, 312506, 312507],
    "Thorny Cracked Tear": [3558, 3559, 3560],
}

# Effects the item's own effect triggers in ways the data doesn't link to (defeating an enemy,
# etc.), assumed active
TRIGGERED_EFFECTS = {
    "Crusade Insignia": [20380501],
    "Dried Bouquet": [20381001],
    "Blade of Mercy": [20382302],
    "Rellana's Cameo": [20382204],
    "Sharpshot Talisman": [19991],
}

# Debuffs: effects on enemies that make them take more damage (*DamageCutRate, and
# defPlayerDmgCorrectRate_* for damage from players), from their sources' bullets. Effects of the
# same spCategory replace each other (1004 oil, 10007 frostbite, 157 negation debuffs).
DEBUFFS = {
    # Frost buildup from any source (frost weapons, Freezing Pots and Grease, ice sorceries, ...)
    "Frostbite": 6700,
    "Oil Pot": 420,  # also the Roped Oil Pot
    "Hefty Oil Pot": 20500380,
    "Oil-Soaked Tear": 20511042,  # Its bullet's (BehaviorParam 6020) oil coating
    # The same ×1.1 magic (bullets 10436001, 10436101; the Dark Moon's frostbite is Frostbite)
    "Rennala's Full Moon / Ranni's Dark Moon": 1436000,
    "Greyoll's Roar": 1709000,
    # Skills' bullets, from their behavior rows: for the skill animation's bullet judge J,
    # (J // 1000) × 100000000 + the weapon's behaviorVariationId × 1000 + J % 1000 (DLC judges,
    # 6xxx, use variation 0). E.g. Winged Greathorn 1511 and 3900, Sword of Milos 302 and 3905,
    # Sword of Darkness 6895, Flowerstone Gavel 6661 and 6660, Scepter of the All-Knowing 1116 and
    # 3900.
    "Soul Stifler": 1545,
    "Shriek of Milos": 1855,
    "Darkness": 20000990,
    # The two replace each other (spCategory 201); the stronger is assumed to be the charged one
    "Flower Dragonbolt": 20000951,
    "Flower Dragonbolt (charged)": 20000950,
    # spCategory 20, so it stacks with the others
    "Knowledge Above All": 1897,
}
DEBUFF_NOTES = {
    "Oil Pot": "Also the Roped Oil Pot",
    "Darkness": "Sword of Darkness's skill",
    "Flower Dragonbolt": "Flowerstone Gavel's skill",
    "Flower Dragonbolt (charged)": "Flowerstone Gavel's skill",
    "Knowledge Above All": "Scepter of the All-Knowing's skill",
    "Soul Stifler": "Winged Greathorn's skill",
    "Shriek of Milos": "Sword of Milos's skill. Its weapon buff is separate, in the weapon buffs",
}


# Weapon buffs' on-hit effects that do a percentage of the enemy's max HP over time (changeHpRate
# percent plus changeHpPoint every motionInterval seconds for effectEndurance seconds, including when
# applied), by SpEffect ID, with their names. Others with changeHpRate are e.g. the player's own HP
# costs. Black Flame Blade's black flame: 0.1% plus 1 every 0.1s for 2s, 21 ticks (tested in game:
# 1575 on the training dummy's 74212 HP after a Longsword's R1, as the Queen's Black Flame's)
HIT_HP_DAMAGE_EFFECTS = {1626001: "Black flame"}

def merge_armor(buffs):
    """
    Merges armor of the same slot and effects that differs only in looks, in place: altered versions
    (under the normal name) and the Crucible sets (e.g. "Crucible Axe Helm / Tree Helm / Hammer-Helm")
    """
    groups = {}
    for buff in buffs:
        if buff["kind"] != "armor":
            continue
        base = buff["name"].removesuffix(" (Altered)")
        family = "Crucible" if base.startswith("Crucible ") else base
        key = (family, buff["slot"], json.dumps(buff["effects"], sort_keys=True))
        groups.setdefault(key, []).append(buff)
    for (family, _, _), group in groups.items():
        if len(group) < 2:
            continue
        bases = list(dict.fromkeys(buff["name"].removesuffix(" (Altered)") for buff in group))
        group[0]["name"] = " / ".join([bases[0]] + [base.removeprefix(f"{family} ") for base in bases[1:]])
        for buff in group[1:]:
            buffs.remove(buff)


def read_names(game_dir, fmg):
    names = {}
    msg_dir = os.path.join(game_dir, "msg", "engus")
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            path = os.path.join(msg_dir, folder, f"{fmg}{suffix}.fmg")
            if os.path.exists(path):
                names.update(read_fmg(path))
    return names


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

    sp_effects = param("SpEffectParam", "SpEffect")
    bullets = param("Bullet", "BulletParam")

    def get_effect(effect_id, own=False):
        """@returns the effect in the output format, or None if it doesn't affect damage or stats"""
        row = sp_effects.get(effect_id)
        if not row or row["wepParamChange"] == SPELL_EFFECT:
            return None
        effect = {}
        rates = [row[f"{t}AttackPowerRate"] for t in DAMAGE_TYPES]
        if any(rate != 1 for rate in rates):
            effect["attackPowerRates"] = [round(rate, 4) for rate in rates]
        damage = [
            row[f"{t}AttackRate"] * row[f"atkEnemyDmgCorrectRate_{field}"]
            for t, field in zip(DAMAGE_TYPES, ENEMY_DAMAGE_FIELDS)
        ]
        if any(abs(rate - 1) > 1e-6 for rate in damage):
            effect["damageRates"] = [round(rate, 4) for rate in damage]
        flat = [row[f"{t}AttackPower"] for t in DAMAGE_TYPES]
        # Flat attack without a weapon condition is something else, e.g. the Briar set's thorns
        if any(flat) and row["wepParamChange"] == WEAPON_EFFECT:
            effect["flat"] = flat
            if row["bAdjustMagicAblity"]:
                effect["spellScaling"] = "int"
            elif row["bAdjustFaithAblity"]:
                effect["spellScaling"] = "fai"
        if row["wepParamChange"] == WEAPON_EFFECT:
            source = sp_effects.get(row["atkOccurrenceSpEffectId"]) or row
            status = {
                status_type: source[field] for status_type, field in STATUS_FIELDS.items() if source[field] > 0
            }
            if status:
                effect["status"] = status
            # On-hit effects that build up status over time instead (e.g. Bloodflame Blade's: 2 blood
            # loss every 0.1s for 2s), added to each hit without scaling
            tick = sp_effects.get(source["cycleOccurrenceSpEffectId"])
            if not status and source is not row and tick and source["motionInterval"] > 0:
                ticks = round(source["effectEndurance"] / source["motionInterval"])
                hit_status = {
                    status_type: tick[field] * ticks
                    for status_type, field in STATUS_FIELDS.items()
                    if tick[field] > 0
                }
                if hit_status:
                    effect["hitStatus"] = hit_status
            # On-hit effects that do a percentage of the enemy's max HP over time
            if source is not row and source["id"] in HIT_HP_DAMAGE_EFFECTS:
                effect["hpDamage"] = {
                    "label": HIT_HP_DAMAGE_EFFECTS[source["id"]],
                    "rate": source["changeHpRate"] / 100,
                    "ticks": round(source["effectEndurance"] / source["motionInterval"]) + 1,
                    **({"flat": source["changeHpPoint"]} if source["changeHpPoint"] else {}),
                }
        # Effects that lower damage are debuffs on enemies, e.g. Greyoll's Roar, unless they're the
        # player's own equipment's (e.g. the Silver Tear Mask's ×0.95 physical)
        if not own and any(rate < 1 for rate in effect.get("attackPowerRates", []) + effect.get("damageRates", [])):
            return None
        enemy_type_rates = {
            enemy_type: row[field] for enemy_type, field in ENEMY_TYPE_RATE_FIELDS.items() if row[field] > 1
        }
        if enemy_type_rates:
            effect["enemyTypeRates"] = enemy_type_rates
        if row["saAttackPowerRate"] > 1:
            effect["poiseRate"] = round(row["saAttackPowerRate"], 4)
        stats = {stat: row[field] for stat, field in STAT_FIELDS.items() if row[field]}
        if stats:
            effect["stats"] = stats
        scaling = {stat: row[field] / 100 for stat, field in SCALING_FIELDS.items() if row[field]}
        if scaling:
            effect["scalingBonus"] = scaling
        if not effect:
            return None
        categories = [
            row[f"magicSubCategoryChange{i}"]
            for i in range(1, 4)
            if row[f"magicSubCategoryChange{i}"]
        ]
        if categories:
            effect["categories"] = categories
        if row["spCategory"] not in SHARED_CATEGORIES:
            effect["group"] = row["spCategory"]
        return effect

    def get_effects(effect_ids, depth=0, follow=True, own=False):
        """
        Effects, following effects they apply in turn (cycleOccurrenceSpEffectId). own: they're the
        player's equipment's, so ones that lower damage are kept.
        """
        effects = []
        for effect_id in effect_ids:
            row = sp_effects.get(effect_id)
            if not row or depth > 3:
                continue
            effect = get_effect(effect_id, own)
            # Left hand weapon buffs (spCategory 163) repeat the right hand's (162), e.g. the
            # Dragonwound Grease's
            if effect and effect.get("group") == LEFT_HAND_WEAPON_BUFF:
                effect = None
            if effect and effect not in effects:
                effects.append(effect)
            if follow and row["cycleOccurrenceSpEffectId"] > 0:
                effects += [
                    e
                    for e in get_effects([row["cycleOccurrenceSpEffectId"]], depth + 1, own=own)
                    if e not in effects
                ]
        return effects

    def get_enemy_effect(effect_id):
        """An effect on enemies as damage multipliers on the player's attacks"""
        row = sp_effects[effect_id]
        fields = ["neutral" if t == "physics" else t for t in DAMAGE_TYPES]
        effect = {
            "damageRates": [
                round(row[f"{field}DamageCutRate"] * row[f"defPlayerDmgCorrectRate_{enemy_field}"], 4)
                for field, enemy_field in zip(fields, ENEMY_DAMAGE_FIELDS)
            ]
        }
        if row["spCategory"] not in SHARED_CATEGORIES:
            effect["group"] = row["spCategory"]
        return effect

    def get_bullet_effects(bullet_id, depth=0):
        bullet = bullets.get(bullet_id)
        if not bullet or depth > 4:
            return []
        effects = get_effects([bullet[f"spEffectId{i}"] for i in range(5) if bullet[f"spEffectId{i}"] > 0])
        for field in ("HitBulletID", "intervalCreateBulletId"):
            if bullet[field] > 0 and bullet[field] != bullet_id:
                # The same effect can be reached through several bullets (e.g. Terra Magica's)
                effects += [e for e in get_bullet_effects(bullet[field], depth + 1) if e not in effects]
        return effects

    # Attack subcategories of weapons' and skills' hits, plus the ones the app gives hits itself
    # (getAttackData in src/app/useMovesets.ts)
    hit_categories = set(APP_CATEGORIES)

    def find_categories(value):
        if isinstance(value, dict):
            hit_categories.update(value.get("categories", []))
            for child in value.values():
                find_categories(child)
        elif isinstance(value, list):
            for child in value:
                find_categories(child)

    for data_file in ["movesets.json", "ashes.json"]:
        with open(os.path.join(project_dir, "public", data_file), encoding="utf-8") as f:
            find_categories(json.load(f))

    buffs = []

    def add(kind, name, effects, **extra):
        effects = effects + [
            effect for effect in get_effects(TRIGGERED_EFFECTS.get(name, [])) if effect not in effects
        ]
        if name in STACK_TIERS:
            tiers = [get_effect(effect_id) for effect_id in STACK_TIERS[name]]
            effects.append({**tiers[-1], "tierRates": [tier["damageRates"][0] for tier in tiers]})
        if (not effects and "weapons" not in extra) or any(buff["kind"] == kind and buff["name"] == name for buff in buffs):
            return
        # Only consumables, tears, and spells replace each other; equipment is one per slot
        if kind not in STACKING_KINDS:
            effects = [{key: value for key, value in effect.items() if key != "group"} for effect in effects]
        exclusive = extra.pop("exclusive", [])
        buff = {"kind": kind, "name": name, "effects": effects, **extra}
        if kind in ("consumable", "spell", "skill", "spirit") and "type" not in buff:
            group = next((effect["group"] for effect in effects if "group" in effect), None)
            buff["type"] = BUFF_TYPES.get(group, "unique")
        if name in NOTES:
            buff["note"] = NOTES[name]
        if exclusive:
            buff["exclusive"] = exclusive
        if name in CATEGORY_OVERRIDES:
            for effect in effects:
                effect["categories"] = CATEGORY_OVERRIDES[name]
        if name in PIERCE_COUNTER_ONLY:
            for effect in effects:
                effect["counter"] = True
                effect["physicalTypes"] = ["pierce"]
        if name in DAMAGE_RATE_FITS:
            for effect in effects:
                effect["damageRates"] = [DAMAGE_RATE_FITS[name]] * len(effect["damageRates"])
        if name in HP_CONDITIONS:
            assert len(effects) == len(HP_CONDITIONS[name]), name
            for effect, hp in zip(effects, HP_CONDITIONS[name]):
                effect["hp"] = hp
        if name in FIRST_HIT_ONLY:
            for effect in effects:
                effect["firstHitOnly"] = True
        if name in CRITICAL_ONLY:
            for effect in effects:
                effect["critical"] = True
        if name in EQUIP_WEIGHT_SCALED:
            for effect in effects:
                effect["byEquipWeight"] = True
        # Only attack subcategories weapons or skills have (e.g. not the Death Knight set's Dragon Cult
        # incantations, only its lightning skills). Effects only for others (e.g. sorcery schools) only
        # keep their stats, which don't depend on the attack (e.g. the Circlet of Light's).
        buff["effects"] = [
            effect
            if "categories" not in effect
            else {**effect, "categories": [c for c in effect["categories"] if c in hit_categories]}
            if set(effect["categories"]) & hit_categories
            else {key: value for key, value in effect.items() if key in ("stats", "group")}
            for effect in effects
        ]
        buff["effects"] = [effect for effect in buff["effects"] if set(effect) - {"group"}]
        if not buff["effects"] and "weapons" not in buff:
            return
        buffs.append(buff)

    # Talismans
    talisman_names = read_names(game_dir, "AccessoryName")
    for talisman_id, row in sorted(param("EquipParamAccessory").items()):
        name = talisman_names.get(talisman_id)
        if name:
            # Talismans of the same group can't be worn together, e.g. the Radagon's seals
            add(
                "talisman",
                name,
                get_effects([row["refId"]]),
                exclusive=[f"talisman{row['accessoryGroup']}"],
                weight=round(row["weight"], 2),
            )

    # Armor, by slot
    armor_names = read_names(game_dir, "ProtectorName")
    for armor_id, row in sorted(param("EquipParamProtector").items()):
        name = armor_names.get(armor_id)
        slot = next(
            (slot for slot, field in [("head", "headEquip"), ("body", "bodyEquip"), ("arms", "armEquip"), ("legs", "legEquip")] if row[field]),
            None,
        )
        if name and slot:
            effects = get_effects(
                [row[f] for f in ("residentSpEffectId", "residentSpEffectId2", "residentSpEffectId3") if row[f] > 0],
                own=True,
            )
            if name not in EXCLUDED:
                add("armor", name, effects, slot=slot, weight=round(row["weight"], 2))
    merge_armor(buffs)

    # Off-hand weapons' passive effects (residentSpEffectId etc.), which apply in either hand. Ones
    # with a condition (e.g. the Madding Hand's, after madness nearby) are unique weapon effects
    # instead, picked like other unique buffs
    weapon_names = read_names(game_dir, "WeaponName")
    for weapon_id, row in sorted(param("EquipParamWeapon").items()):
        name = weapon_names.get(weapon_id)
        # Infused versions' ids end in the affinity's, and have the same effects
        if not name or weapon_id % 10000:
            continue
        effects = get_effects(
            [row[f] for f in ("residentSpEffectId", "residentSpEffectId1", "residentSpEffectId2") if row[f] > 0],
            own=True,
        )
        # Conditional ones are picked separately (weapon effects), since they don't always apply
        if name in NOTES or name in HP_CONDITIONS:
            add("weaponEffect", name, effects, type="unique")
        else:
            add("offhand", name, effects, weight=round(row["weight"], 2))

    # Physick tears and other consumables
    goods_names = read_names(game_dir, "GoodsName")
    for goods_id, row in sorted(param("EquipParamGoods").items()):
        name = goods_names.get(goods_id)
        if not name or name.startswith("[ERROR]"):
            continue
        effects = get_effects(
            [row[f] for f in ("refId_default", "refId_1") if row[f] > 0], follow=name not in UNFOLLOWED
        )
        if name not in DEBUFFS:
            add("tear" if name.endswith(" Tear") else "consumable", name, effects)

    # Incantations and sorceries (spells' own buffs: refCategory 1 is a bullet, 2 an effect)
    for spell_id, row in sorted(param("Magic", "MagicParam").items()):
        name = goods_names.get(spell_id)
        if not name or name in EXCLUDED_SPELLS:
            continue
        effects = []
        for i in range(1, 11):
            ref, category = row[f"refId{i}"], row[f"refCategory{i}"]
            if ref > 0:
                found = get_bullet_effects(ref) if category == 1 else get_effects([ref]) if category == 2 else []
                effects += [effect for effect in found if effect not in effects]
        requirements = {
            stat: row[field]
            for stat, field in [("int", "requirementIntellect"), ("fai", "requirementFaith"), ("arc", "requirementLuck")]
            if row[field]
        }
        # Stance damage alone is the spell's own hit, e.g. Rejection's
        add(
            "spell",
            name,
            [effect for effect in effects if set(effect) - {"poiseRate", "group"}],
            **({"requirements": requirements} if requirements else {}),
        )

    add("rune", "Godrick's Great Rune", get_effects([GODRICK_GREAT_RUNE]))
    counter = sp_effects[COUNTER_EFFECT]
    add(
        "counter",
        "Counterattack",
        [{"damageRates": [round(counter["thrustDamageCutRate"], 4), 1, 1, 1, 1], "physicalTypes": ["pierce"]}],
    )

    for kind, name, effect_ids, extra in EXTRA_BUFFS:
        add(kind, name, get_effects(effect_ids), **extra)

    # Each unique weapon's own skill's weapon buff, from its animations
    skill_types = {skill_id: row["swordArtsTypeNew"] for skill_id, row in param("SwordArtsParam").items()}
    skill_effects = {}

    def get_skill_effects(skill_type):
        if skill_type not in skill_effects:
            effect_ids = []
            path = os.path.join(game_dir, TAE_DIR, f"a{600 + skill_type}.tae")
            if os.path.exists(path):
                _, animations, data, _ = read_tae(path)
                for events in animations.values():
                    for _, _, event_type, params in events:
                        if event_type not in SPEFFECT_EVENTS:
                            continue
                        # The effect, or one it applies in turn (e.g. Moonlight Greatsword's 1720
                        # applies 1721)
                        effect_id = struct.unpack_from("<i", data, params)[0]
                        for _ in range(4):
                            row = sp_effects.get(effect_id)
                            if not row:
                                break
                            if (
                                row["spCategory"] == 162
                                and row["effectEndurance"] >= MIN_SKILL_BUFF_DURATION
                                and effect_id not in effect_ids
                            ):
                                effect_ids.append(effect_id)
                            effect_id = row["cycleOccurrenceSpEffectId"]
            skill_effects[skill_type] = [effect for effect in get_effects(effect_ids, follow=False)]
        return skill_effects[skill_type]

    # Each one is a buff named after the skill, for its weapons; a skill that's also an Ash of War's
    # buff (e.g. the Inseparable Sword's Sacred Blade) adds its weapons to that one
    skill_names = read_names(game_dir, "ArtsName")
    skill_text_ids = {skill_id: row["textId"] for skill_id, row in param("SwordArtsParam").items()}
    fixed_skills = {}
    for weapon_name, row in read_weapons(game_dir, project_dir).items():
        skill_id = int(row["swordArtsParamId"])
        if row["gemMountType"] == "2" or skill_id not in skill_types:
            continue
        if weapon_name in EXTRA_UNIQUE_SKILL_BUFFS:
            effects = get_effects([EXTRA_UNIQUE_SKILL_BUFFS[weapon_name]], follow=False)
        else:
            effects = get_skill_effects(skill_types[skill_id])
        if effects:
            name = skill_names.get(skill_id) or skill_names[skill_text_ids[skill_id]]
            fixed_skills.setdefault(name, {})[weapon_name] = effects
    for name, weapons in sorted(fixed_skills.items()):
        existing = next(
            (buff for buff in buffs if buff["kind"] == "skill" and buff["name"] == name and buff.get("type") == "weapon"),
            None,
        )
        if existing:
            # The same skill, so the Ash of War's effects, including ones its effect applies in turn
            # (e.g. Sacred Order's ×1.1), which the animations' don't follow
            for weapon_name, effects in weapons.items():
                if any(effect not in existing["effects"] for effect in effects):
                    sys.exit(f"{weapon_name}'s {name} differs from the Ash of War's: {effects}")
            existing["weapons"] = {weapon_name: existing["effects"] for weapon_name in weapons}
        else:
            add(
                "skill",
                name,
                [],
                type="weapon",
                weapons=weapons,
                **({"note": FIXED_SKILL_NOTES[name]} if name in FIXED_SKILL_NOTES else {}),
            )
    for name, (weapon_name, effect_id) in WEAPON_PASSIVE_BUFFS.items():
        add("skill", name, [], type="weapon", weapons={weapon_name: get_effects([effect_id], follow=False)}, exclusive=["luster"])

    for name, effect_id in DEBUFFS.items():
        add("debuff", name, [get_enemy_effect(effect_id)], **({"note": DEBUFF_NOTES[name]} if name in DEBUFF_NOTES else {}))

    out_path = os.path.join(project_dir, "public", "buffs.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"buffs": buffs}, f, separators=(",", ":"), ensure_ascii=False)
    counts = {}
    for buff in buffs:
        counts[buff["kind"]] = counts.get(buff["kind"], 0) + 1
    print(f"{len(buffs)} buffs {counts} -> {out_path}")


if __name__ == "__main__":
    main()
