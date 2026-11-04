"""
Build public/enemies.json: enemy defenses and negations grouped by area, for the enemy picker.

Usage:
  python3 -I scripts/build_enemy_data.py <ELDEN RING Game dir> <Paramdex ER dir> <msb enemies .tsv>

Inputs (all from the base game):
  - <Game>/regulation-bin/*.param, unpacked from regulation.bin with WitchyBND
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx, unpacked with WitchyBND
  - The enemy placements .tsv from scripts/extract_msb_enemies.ps1
  - <Paramdex ER dir> is the Paramdex folder bundled with WitchyBND (Assets/Paramdex/ER)

Enemy names come from the game's text where a row has its own name, then from a community
datamining spreadsheet (data/sheets/NG.csv, the "NG" tab of
https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes exported as
CSV) by NpcParam ID, then from the game's text by character model.

Human enemies (model c0000) get their defense from their level and attributes like the player, and
their negation from their armor, all from their CharaInitParam row.

Also writes data/unnamed-enemies.csv (per NpcParam row) and data/unnamed-models.csv (per character
model) listing enemies that were left out because they have no name. Names found elsewhere can be
added to data/model-names.csv (columns: model,name, e.g. c4310,Godrick Soldier).
"""

import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from extract_fmg import read_fmg  # noqa: E402
from extract_param import read_param  # noqa: E402

REGULATION_VERSION = 11730034

# Defense fields in NpcParam and the matching multipliers in area scaling SpEffects, in the order
# physical, magic, fire, lightning, holy
DEFENSES = [
    ("def_phys", "physicsDiffenceRate"),
    ("def_mag", "magicDiffenceRate"),
    ("def_fire", "fireDiffenceRate"),
    ("def_thunder", "thunderDiffenceRate"),
    ("def_dark", "darkDiffenceRate"),
]

# Negation multipliers in the order standard, slash, strike, pierce, magic, fire, lightning, holy
NEGATIONS = [
    "neutralDamageCutRate",
    "slashDamageCutRate",
    "blowDamageCutRate",
    "thrustDamageCutRate",
    "magicDamageCutRate",
    "fireDamageCutRate",
    "thunderDamageCutRate",
    "darkDamageCutRate",
]

# Armor negation multipliers in EquipParamProtector, in the same order as NEGATIONS
ARMOR_SLOTS = ["equip_Helm", "equip_Armer", "equip_Gaunt", "equip_Leg"]

# CalcCorrectGraph IDs for human enemy (and player) stats
LEVEL_DEFENSE_GRAPH = 102
VIGOR_HP_GRAPH = 100

# For each defense type, the CalcCorrectGraph and CharaInitParam attribute that adds to the level
# based defense. Lightning defense doesn't depend on an attribute for NPCs.
ATTRIBUTE_DEFENSES = [
    (130, "baseStr"),
    (132, "baseMag"),
    (133, "baseVit"),
    (None, None),
    (135, "baseLuc"),
]

CHARA_INIT_ATTRIBUTES = [
    "baseVit",
    "baseWil",
    "baseEnd",
    "baseStr",
    "baseDex",
    "baseMag",
    "baseFai",
    "baseLuc",
]

# NpcParam team types for characters that aren't normally fought: none (story state copies), white
# ghost (summonable helpers), and friendly NPC
FRIENDLY_TEAM_TYPES = {0, 2, 26}

# Wildlife that doesn't fight back much, shown in its own section. Team types don't tell them apart
# (most are on the enemy team), so they're listed by name.
NEUTRAL_NAMES = {
    "Deer",
    "Sheep",
    "Springhare",
    "Eagle",
    "Owl",
    "Turtle",
    "Scarab",
    "Crab",
    "Albinauric Crab",
    "Albinauric Crab (Clean)",
    "Albinauric Crab (Golden Tuffs)",
    "Black Crab (Maggots)",
    "Guillemot",
}

# Names by character model that override the spreadsheet's: it calls the passive sheep (c6060) "Ram"
# like the rams that attack (c5450)
MODEL_NAME_OVERRIDES = {6060: "Sheep"}

# Names by NpcParam ID, e.g. for a boss's phases, which share a name
NPC_PARAM_NAME_OVERRIDES = {
    20300024: "Rennala, Queen of the Full Moon (Phase 1)",
    20310024: "Rennala, Queen of the Full Moon (Phase 2)",
}

# Enemies left out of the picker, by a word in their name: teardrop scarabs only drop items
EXCLUDED_NAME_WORDS = ["Teardrop"]

# NpcParam rows left out by hand: corpses with nothing in the params to identify them (their poses
# come from the maps' events). The picker shows each enemy's NpcParam IDs.
EXCLUDED_NPC_PARAM_IDS = {
    523380016,  # Finger Maiden, Chapel of Anticipation
    46209152,  # Malformed Star, Yelough Anix Tunnel (not seen in game)
}

# Overworld enemies near a map label for an evergaol, ruins, or village (WorldMapPointParam) are in an
# area of its name, within this distance in meters (horizontally, vertically). Every evergaol and
# ruins boss is within 43 m and 18 m; the nearest other boss is 97 m away. Villages are bigger, so
# bosses further into them are listed by hand below.
PLACE_LABEL_WORDS = ["Evergaol", "Ruins", "Village"]
PLACE_LABEL_DISTANCE = (60, 30)

# Overworld enemies' areas by NpcParam ID, by hand, for places too big for their map label's distance
NPC_PARAM_AREA_OVERRIDES = {
    41300032: "Hermit Village",  # Demi-Human Queen, 72 m from the label
    35600030: "Dominula, Windmill Village",  # Godskin Apostle, 127 m away and 41 m higher
    48200920: "Village of the Albinaurics",  # Omenkiller, 170 m away
}

# Overworld areas' regions, by hand, where the nearest grace is the wrong one
AREA_REGION_OVERRIDES = {
    "Wyndham Ruins": "Altus Plateau",  # nearest Mt. Gelmir's Seethewater River
    "Writheblood Ruins": "Altus Plateau",  # nearest a Mt. Gelmir grace
    "Stormhill Evergaol": "Stormhill",  # nearest a Limgrave grace
}

# Bosses are named "... [Boss]" in the spreadsheet, or drop a boss's runes (NpcParam isSoulGetByBoss,
# e.g. Rennala, whose name comes from the game's text). These are bosses with neither, by NpcParam ID,
# and characters with one that aren't bosses on their own, by name.
BOSS_NPC_PARAM_IDS = {
    49500050,  # Tibia Mariner, Mountaintops of the Giants
    56200084,  # Tibia Mariner, Charo's Hidden Grave
}
NOT_BOSS_NAMES = {"Night's Cavalry Horse"}

# Damage multipliers for critical hits (backstabs and ripostes), after defenses: Crucible Knights
# take 30% less (tested in game: a Longsword riposte does 833 rather than 1190 at +25, and 274 at +0,
# to the Stormhill Evergaol one), by
# character model (c2500, including Tanith's Knight) or name (e.g. Crucible Knight Devonia)
CRITICAL_DAMAGE_RATE_MODELS = {2500: 0.7}
CRITICAL_DAMAGE_RATE_NAMES = {"Crucible Knight": 0.7}

# Which ripostes the player can do to each enemy, from the player's critical animations for its
# character model in ThrowParam: 31700 the normal riposte, 31720 the small riposte (a downward stab),
# 31750 the large riposte (tested in game: a Longsword riposte matches each on the Sanguine Noble,
# Mini Midra, and the Putrid Avatar). Models with none can't be riposted. Human characters (c0000)
# use the default rows (model 0).
RIPOSTE_ANIMATIONS = {31700: "Riposte", 31720: "Small Riposte", 31750: "Large Riposte"}
# Models whose animations don't say which, by hand: those with a large riposte and another only get
# the large one (e.g. Mad Pumpkin Heads); these get one or more specific ones (tested in game: a
# Quality Longsword +25 does the small riposte's 2219 to the Dragonbarrow Night's Cavalry), with
# notes on when a riposte applies
RIPOSTE_OVERRIDES = {
    3150: ["Riposte", "Small Riposte"],  # Night's Cavalry
    5840: ["Riposte", "Small Riposte"],  # Black Knights
    5810: ["Small Riposte"],  # Demi-Human Swordmaster Onze
    3300: ["Riposte", "Small Riposte"],  # Nox Priest and Swordstress: not known which
}
# Named enemies that don't ride horses, unlike others of their model
RIPOSTE_NAME_OVERRIDES = {"Black Knight Edredd": ["Riposte"], "Black Knight Garrew": ["Riposte"]}
RIPOSTE_NOTES = {
    3150: {"Small Riposte": "when they fall from their horse"},
    5840: {"Small Riposte": "when they fall from their horse"},
}

# Sections of each area's enemies, in order
CATEGORY_ORDER = ["boss", "enemy", "neutral", "friendly"]

# Enemy types that some weapons and buffs do more damage to (NpcParam isWeakA-D, matched with
# EquipParamWeapon weakA-D_DamageRate and SpEffectParam weakDmgRateA-D). E and F aren't on any enemy.
ENEMY_TYPES = {
    "isWeakA": "star",  # Fallingstar Beasts, Astel, Onyx Lords (gravity weapons)
    "isWeakB": "death",  # Those who live in death: skeletons, Death Rite Birds, etc.
    "isWeakC": "ancientDragon",  # Ancient dragons, e.g. Lansseax
    "isWeakD": "dragon",  # Other dragons, e.g. Agheel
}

# Grace categories with no matching place name
REGION_NAME_OVERRIDES = {6950: "Rauh Base"}

# Overworld map tiles' size in meters, and where their positions are measured from (0.5: the center)
TILE_SIZE = 256
TILE_ORIGIN = 0.5

# How much a height difference counts towards the nearest grace, relative to horizontal distance.
# Chosen by how consistent each region's enemies' area scaling is (4-5 is best: 2924 of 18283
# scaled overworld enemies differ from their region's most common scaling, vs 3303 at 1, 3978
# ignoring height, and 4279 with tile centers), and it puts the Omenkiller below the Cathedral of
# Manus Celes in Liurnia.
HEIGHT_WEIGHT = 5

# Shadow of the Erdtree's maps (legacy dungeons, dungeons, and the overworld), by prefix
# Regions' difficulty (area scaling HP multiplier) where their enemies' median is misleading, e.g.
# from enemies of a neighboring region assigned to it
REGION_SCALING_OVERRIDES = {}

# Moves applied in order to the regions sorted by scaling, by hand: (region, "first"), or
# (region, "before" or "after", other region)
REGION_ORDER_MOVES = [
    ("Stranded Graveyard", "first"),
    ("Chapel of Anticipation", "first"),
    ("Liurnia of the Lakes", "before", "Academy of Raya Lucaria"),
    ("Swamp of Aeonia", "after", "Caelid"),
    ("Mountaintops of the Giants", "before", "Flame Peak"),
    ("Forbidden Lands", "before", "Mountaintops of the Giants"),
    ("Belurat, Tower Settlement", "after", "Gravesite Plain"),
    ("Nokron, Eternal City", "after", "Greyoll's Dragonbarrow"),
    ("Volcano Manor", "after", "Mt. Gelmir"),
]

# The base game's regions grouped by where they are (underground and later regions with where they're
# reached from), so the enemy picker lists nearby regions together. Shadow of the Erdtree's regions
# are their own groups, since its map is more tangled.
REGION_GROUPS = {
    "Limgrave": [
        "Chapel of Anticipation",
        "Stranded Graveyard",
        "Limgrave",
        "Stormhill",
        "Weeping Peninsula",
        "Stormveil Castle",
        "Roundtable Hold",
        "Siofra River",
    ],
    "Liurnia": [
        "Liurnia of the Lakes",
        "Academy of Raya Lucaria",
        "Bellum Highway",
        "Moonlight Altar",
        "Ruin-Strewn Precipice",
        "Ainsel River",
    ],
    # Nokron with Caelid, since it opens after Radahn
    "Caelid": ["Caelid", "Swamp of Aeonia", "Greyoll's Dragonbarrow", "Nokron, Eternal City"],
    "Altus": [
        "Altus Plateau",
        "Capital Outskirts",
        "Mt. Gelmir",
        "Volcano Manor",
        "Leyndell, Royal Capital",
        "Subterranean Shunning-Grounds",
        "Deeproot Depths",
    ],
    "Mountaintops": [
        "Forbidden Lands",
        "Mountaintops of the Giants",
        "Flame Peak",
        "Consecrated Snowfield",
        "Elphael, Brace of the Haligtree",
        "Mohgwyn Palace",
        "Crumbling Farum Azula",
        "Leyndell, Ashen Capital",
    ],
}
REGION_GROUP = {region: group for group, regions in REGION_GROUPS.items() for region in regions}

DLC_MAP_PREFIXES = ("m20_", "m21_", "m22_", "m25_", "m28_", "m40_", "m41_", "m42_", "m43_", "m61_")

# Maps with no place name or grace of their own that are part of another map. The datamining
# spreadsheet places m42_01's enemies in the Ruined Forge of Starfall Past.
MAP_ALIASES = {"m42_01": "m42_02"}

# Maps with no place name or grace of their own: (area name, region name)
MAP_OVERRIDES = {
    # The two Ancestor Spirit arenas. The lower HP spirit is the one under Siofra River.
    "m12_08": ("Hallowhorn Grounds (Siofra River)", "Siofra River"),
    "m12_09": ("Hallowhorn Grounds (Nokron)", "Nokron, Eternal City"),
    # The Elden Beast's arena, reached from the Ashen Capital
    "m19_00": ("Stone Platform", "Leyndell, Ashen Capital"),
}


def evaluate_graph(graph, x):
    """Evaluate a CalcCorrectGraph row at x, like evaluateCalcCorrectGraph in regulationData.ts"""
    max_vals = [graph[f"stageMaxVal{i}"] for i in range(5)]
    grow_vals = [graph[f"stageMaxGrowVal{i}"] for i in range(5)]
    adj_pts = [graph[f"adjPt_maxGrowVal{i}"] for i in range(5)]
    if x <= max_vals[0]:
        return grow_vals[0]
    for i in range(1, 5):
        if x <= max_vals[i] or i == 4:
            ratio = max(0, min(1, (x - max_vals[i - 1]) / (max_vals[i] - max_vals[i - 1])))
            if adj_pts[i - 1] > 0:
                ratio = ratio ** adj_pts[i - 1]
            elif adj_pts[i - 1] < 0:
                ratio = 1 - (1 - ratio) ** -adj_pts[i - 1]
            return grow_vals[i - 1] + (grow_vals[i] - grow_vals[i - 1]) * ratio


def main():
    game_dir, paramdex_dir, placements_path = sys.argv[1:4]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def param(name, def_name=None):
        _, rows, _ = read_param(
            os.path.join(game_dir, "regulation-bin", f"{name}.param"),
            os.path.join(paramdex_dir, "Defs", f"{def_name or name}.xml"),
            REGULATION_VERSION,
        )
        return {row["id"]: row for row in rows}

    npc_params = param("NpcParam")
    sp_effects = param("SpEffectParam", "SpEffect")
    graces = param("BonfireWarpParam").values()
    map_points = param("WorldMapPointParam").values()

    # Player ripostes for each character model
    model_ripostes = defaultdict(set)
    for throw in param("ThrowParam").values():
        if throw["AtkChrId"] == 0 and throw["atkAnimId"] in RIPOSTE_ANIMATIONS:
            model_ripostes[throw["DefChrId"]].add(RIPOSTE_ANIMATIONS[throw["atkAnimId"]])

    def get_ripostes(model):
        if model in RIPOSTE_OVERRIDES:
            return RIPOSTE_OVERRIDES[model]
        ripostes = model_ripostes.get(model, set())
        if "Large Riposte" in ripostes:
            return ["Large Riposte"]
        return [riposte for riposte in RIPOSTE_ANIMATIONS.values() if riposte in ripostes]
    chara_inits = param("CharaInitParam")
    armor = param("EquipParamProtector")
    graphs = param("CalcCorrectGraph")

    # Names from the datamining spreadsheet by NpcParam ID (the first name listed for each ID), and
    # the most common name for each character model, without suffixes like " [Boss] (Spear)"
    sheet_names = {}
    sheet_model_names = defaultdict(lambda: defaultdict(int))
    sheet_path = os.path.join(project_dir, "data", "sheets", "NG.csv")
    if os.path.exists(sheet_path):
        with open(sheet_path, encoding="utf-8") as f:
            for sheet_row in list(csv.reader(f))[2:]:
                if sheet_row[2].strip().isdigit() and sheet_row[1].strip():
                    npc_param_id, name = int(sheet_row[2]), sheet_row[1].strip()
                    sheet_names.setdefault(npc_param_id, name)
                    base_name = re.split(r" [\[(]", name)[0]
                    sheet_model_names[npc_param_id // 10000][base_name] += 1

    # Later files override earlier ones (the DLC versions include updated base game text)
    msg_dir = os.path.join(game_dir, "msg", "engus")
    npc_names, place_names = {}, {}
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            for names, fmg in [(npc_names, "NpcName"), (place_names, "PlaceName")]:
                path = os.path.join(msg_dir, folder, f"{fmg}{suffix}.fmg")
                if os.path.exists(path):
                    names.update(read_fmg(path))

    def region_name(sub_category_id):
        if sub_category_id in REGION_NAME_OVERRIDES:
            return REGION_NAME_OVERRIDES[sub_category_id]
        # Base game categories are place name IDs. DLC categories have one less digit.
        candidates = [sub_category_id]
        if sub_category_id < 10000:
            candidates += [sub_category_id * 10, sub_category_id // 10 * 100 + sub_category_id % 10]
        return next((place_names[c] for c in candidates if c in place_names), None)

    # Overworld graces by tile, dungeon graces by map, and all graces by name
    overworld_graces = defaultdict(list)
    map_graces = defaultdict(list)
    grace_regions_by_name = {}
    for grace in graces:
        area, x, z = grace["areaNo"], grace["gridXNo"], grace["gridZNo"]
        region = region_name(grace["bonfireSubCategoryId"])
        if not region:
            continue
        grace_regions_by_name.setdefault(place_names.get(grace["textId1"]), region)
        if area in (60, 61):
            # Positions in meters across the whole overworld, from the tile and the position in it
            overworld_graces[area].append(
                (
                    (x + TILE_ORIGIN) * TILE_SIZE + grace["posX"],
                    grace["posY"],
                    (z + TILE_ORIGIN) * TILE_SIZE + grace["posZ"],
                    region,
                )
            )
        else:
            map_graces[(area, x)].append((region, place_names.get(grace["textId1"])))

    # Evergaol and ruins labels on the overworld map, by area: (x, y, z, name)
    place_labels = defaultdict(list)
    for point in map_points:
        label = place_names.get(point["textId1"])
        if point["areaNo"] in (60, 61) and label and any(word in label for word in PLACE_LABEL_WORDS):
            place_labels[point["areaNo"]].append(
                (
                    (point["gridXNo"] + TILE_ORIGIN) * TILE_SIZE + point["posX"],
                    point["posY"],
                    (point["gridZNo"] + TILE_ORIGIN) * TILE_SIZE + point["posZ"],
                    label,
                )
            )

    def get_area(map_name, position=None):
        """
        Return (area name, region name) for a map like m60_42_36_00, and for the overworld, a position
        in it (x, y, z, if known)
        """
        map_name = MAP_ALIASES.get(map_name[:6], map_name[:6]) + map_name[6:]
        area, x, z, version = (int(part) for part in map_name[1:].split("_"))
        if area in (60, 61):
            # Overworld enemies belong to the region of the nearest grace, counting height, since
            # regions are often split by cliffs (e.g. Liurnia below the Altus Plateau). Lower detail
            # tiles cover 2x2 or 4x4 regular tiles. The last part is a variant and the detail level,
            # e.g. 10 for a variant of a regular tile. Without a position, the tile's center is used,
            # ignoring height.
            size = TILE_SIZE * 2 ** (version % 10)
            px, py, pz = position or (0, None, 0)
            gx, gz = (x + TILE_ORIGIN) * size + px, (z + TILE_ORIGIN) * size + pz

            def distance(grace):
                height = 0 if py is None else (grace[1] - py) * HEIGHT_WEIGHT
                return (grace[0] - gx) ** 2 + height**2 + (grace[2] - gz) ** 2

            nearest = min(overworld_graces[area], key=distance)
            # Evergaols and ruins get their own areas in the region
            if py is not None:
                for lx, ly, lz, label in place_labels[area]:
                    horizontal = ((lx - gx) ** 2 + (lz - gz) ** 2) ** 0.5
                    if horizontal <= PLACE_LABEL_DISTANCE[0] and abs(ly - py) <= PLACE_LABEL_DISTANCE[1]:
                        return label, nearest[3]
            return nearest[3], nearest[3]

        if map_name[:6] in MAP_OVERRIDES:
            return MAP_OVERRIDES[map_name[:6]]

        regions = map_graces.get((area, x), [])
        name = place_names.get(area * 1000 + x * 10)
        if not name:
            name = regions[0][1] if regions and regions[0][1] else map_name[:6]
        if regions:
            return name, regions[0][0]
        # Dungeons with no grace inside usually have one with the same name at the entrance
        return name, grace_regions_by_name.get(name, name)

    # Names for models the game has no name for, filled in by hand
    model_names = {}
    model_names_path = os.path.join(project_dir, "data", "model-names.csv")
    if os.path.exists(model_names_path):
        with open(model_names_path, encoding="utf-8-sig") as f:
            for entry in csv.DictReader(f):
                if entry["name"].strip():
                    model_names[int(entry["model"].strip().lstrip("c"))] = entry["name"].strip()

    def get_enemy_name(row):
        if row["id"] in NPC_PARAM_NAME_OVERRIDES:
            return NPC_PARAM_NAME_OVERRIDES[row["id"]]
        if row["id"] // 10000 in MODEL_NAME_OVERRIDES:
            return MODEL_NAME_OVERRIDES[row["id"] // 10000]
        if row["nameId"] > 0 and row["nameId"] in npc_names:
            return npc_names[row["nameId"]]
        if row["id"] in sheet_names:
            return sheet_names[row["id"]]
        # Otherwise use the character model's name, preferring the spreadsheet's name for other
        # rows of the model. Some models are shared by a boss and regular enemies, so the game's
        # model names (e.g. 902130000 for c2130) are only a last resort.
        model = row["id"] // 10000
        if model == 0:
            return None
        if model in model_names:
            return model_names[model]
        if model in sheet_model_names:
            names = sheet_model_names[model]
            return max(names, key=names.get)
        names = []
        for i in range(1000):
            name = npc_names.get(900000000 + model * 1000 + i)
            if name and name not in names:
                names.append(name)
        return " / ".join(names) or None

    def get_stats(row, chara_init):
        area_effect = sp_effects.get(row["spEffectID3"])

        def area_rate(field):
            return area_effect[field] if area_effect else 1

        # Every permanent SpEffect multiplies max HP, not just area scaling (e.g. SpEffect 4410
        # doubles the Morne Tunnel Scaly Misbegotten's: 531 × 1.281 × 2 = 1360, tested in game).
        # Their damage taken multipliers aren't applied, since they're mostly situational (e.g.
        # Crystalians' shells, Rennala's barrier).
        hp_rate = area_rate("maxHpRate")
        for field, effect_id in row.items():
            effect = sp_effects.get(effect_id) if field.lower().startswith("speffectid") else None
            if field != "spEffectID3" and effect and effect["effectEndurance"] == -1:
                hp_rate *= effect["maxHpRate"]

        if chara_init is None:
            defense = [round(row[field] * area_rate(rate), 1) for field, rate in DEFENSES]
            negation = [round((1 - row[field]) * 100, 1) for field in NEGATIONS]
            hp = round(row["hp"] * hp_rate)
            return defense, negation, hp

        # Human enemies: defense from level and attributes, negation from armor
        level = sum(chara_init[attribute] for attribute in CHARA_INIT_ATTRIBUTES)
        level_defense = evaluate_graph(graphs[LEVEL_DEFENSE_GRAPH], level)
        defense = []
        for (graph_id, attribute), (_, rate) in zip(ATTRIBUTE_DEFENSES, DEFENSES):
            attribute_defense = (
                evaluate_graph(graphs[graph_id], chara_init[attribute]) if graph_id else 0
            )
            defense.append(round((level_defense + attribute_defense) * area_rate(rate), 1))

        pieces = [armor[chara_init[slot]] for slot in ARMOR_SLOTS if chara_init[slot] in armor]
        negation = []
        for field in NEGATIONS:
            multiplier = 1
            for piece in pieces:
                multiplier *= piece[field]
            negation.append(round((1 - multiplier) * 100, 1))

        hp = round(
            int(evaluate_graph(graphs[VIGOR_HP_GRAPH], chara_init["baseVit"]))
            * hp_rate
        )
        return defense, negation, hp

    def get_critical_damage_rate(row, name):
        model_rate = CRITICAL_DAMAGE_RATE_MODELS.get(row["id"] // 10000)
        name_rate = next(
            (rate for prefix, rate in CRITICAL_DAMAGE_RATE_NAMES.items() if name.startswith(prefix)), None
        )
        return model_rate or name_rate or 1

    def is_boss(row, name):
        if name in NOT_BOSS_NAMES:
            return False
        return "[Boss]" in name or row["isSoulGetByBoss"] or row["id"] in BOSS_NPC_PARAM_IDS

    areas = {}
    # Each region's enemies' area scaling (HP multiplier), and how many of them are in the DLC
    region_scaling = defaultdict(list)
    region_dlc = defaultdict(int)
    unnamed = defaultdict(lambda: {"count": 0, "areas": set()})
    with open(placements_path, encoding="utf-8-sig") as f:
        for placement in csv.DictReader(f, delimiter="\t"):
            row = npc_params.get(int(placement["npcParamId"]))
            # Part names are like c2120_9000, sometimes prefixed with another map tile's name
            model_match = re.search(r"c\d{4}(?=_\d+$)", placement["part"])
            model = model_match.group(0) if model_match else placement["part"]
            # c0100 and c1000 are placeholder characters for events and summons, not enemies
            if row is None or model in ("c0100", "c1000"):
                continue
            position = (
                tuple(float(placement[axis]) for axis in "xyz") if placement.get("x") else None
            )
            area_name, region = get_area(placement["map"], position)
            area_name = NPC_PARAM_AREA_OVERRIDES.get(row["id"], area_name)
            region = AREA_REGION_OVERRIDES.get(area_name, region)
            name = get_enemy_name(row)
            # "Human" is the spreadsheet's name for the generic default character rows
            if name == "Human" or (name and any(word in name for word in EXCLUDED_NAME_WORDS)):
                continue
            if name is None:
                key = (model, row["id"])
                unnamed[key]["count"] += 1
                unnamed[key]["areas"].add(area_name)
                continue

            # Friendly corpses (e.g. "Commoner (Corpse)", "Rykard's Corpse") can't be fought. Other
            # corpses are only identifiable by hand (e.g. the Finger Maiden in the Chapel of
            # Anticipation: her pose comes from the map's events, not its params).
            if row["teamType"] in FRIENDLY_TEAM_TYPES and "Corpse" in name:
                continue
            if row["id"] in EXCLUDED_NPC_PARAM_IDS:
                continue

            chara_init = chara_inits.get(int(placement["charaInitId"])) if model == "c0000" else None
            defense, negation, hp = get_stats(row, chara_init)
            area = areas.setdefault(area_name, {"name": area_name, "region": region, "enemies": {}})
            # Merge identical enemies, e.g. the same enemy placed several times
            friendly = row["teamType"] in FRIENDLY_TEAM_TYPES
            types = [enemy_type for field, enemy_type in ENEMY_TYPES.items() if row[field]]
            key = (name, tuple(defense), tuple(negation), hp, friendly, tuple(types))
            riposte_override = next(
                (ripostes for prefix, ripostes in RIPOSTE_NAME_OVERRIDES.items() if name.startswith(prefix)),
                None,
            )
            enemy = area["enemies"].setdefault(
                key,
                {
                    "name": name,
                    "npcParamIds": [],
                    "hp": hp,
                    "defense": defense,
                    "negation": negation,
                    **({"types": types} if types else {}),
                    **({"friendly": True} if friendly else {}),
                    **({"boss": True} if not friendly and is_boss(row, name) else {}),
                    **({"neutral": True} if not friendly and name in NEUTRAL_NAMES else {}),
                    **(
                        {"criticalDamageRate": critical_rate}
                        if (critical_rate := get_critical_damage_rate(row, name)) != 1
                        else {}
                    ),
                    "ripostes": riposte_override
                    or get_ripostes(model_id := int(model[1:]) if re.fullmatch(r"c\d{4}", model) else -1),
                    **(
                        {"riposteNotes": RIPOSTE_NOTES[model_id]}
                        if not riposte_override and model_id in RIPOSTE_NOTES
                        else {}
                    ),
                },
            )
            if row["id"] not in enemy["npcParamIds"]:
                enemy["npcParamIds"].append(row["id"])
            if not friendly:
                area_effect = sp_effects.get(row["spEffectID3"])
                region_scaling[region].append(area_effect["maxHpRate"] if area_effect else 1)
                region_dlc[region] += placement["map"].startswith(DLC_MAP_PREFIXES)

    # Regions in order of difficulty, by their enemies' median area scaling, with the DLC's after the
    # base game's. Unscaled enemies don't count, since many regions have some (e.g. most of Moonlight
    # Altar's and Nokron's placements).
    def region_order(region):
        rates = sorted(rate for rate in region_scaling[region] if rate != 1) or [1]
        is_dlc = region_dlc[region] * 2 > len(region_scaling[region])
        return (is_dlc, REGION_SCALING_OVERRIDES.get(region, rates[len(rates) // 2]), region)

    regions = sorted({area["region"] for area in areas.values()}, key=region_order)

    def enemy_category(enemy):
        return next((c for c in ["friendly", "boss", "neutral"] if enemy.get(c)), "enemy")
    for region, where, *other in REGION_ORDER_MOVES:
        regions.remove(region)
        index = 0 if where == "first" else regions.index(other[0]) + (where == "after")
        regions.insert(index, region)
    region_index = {region: i for i, region in enumerate(regions)}
    # Each base game region's group, ordered by their earliest region; DLC regions are their own
    groups = list(dict.fromkeys(REGION_GROUP.get(region, region) for region in regions))
    group_index = {group: i for i, group in enumerate(groups)}
    ungrouped = [r for r in regions if r not in REGION_GROUP and region_dlc[r] * 2 <= len(region_scaling[r])]
    if ungrouped:
        print(f"Warning: base game regions with no group: {ungrouped}")

    output = {
        "areas": sorted(
            (
                {
                    **area,
                    # The defenses most of the area's (unfriendly) enemies have, for picking the area
                    # without an enemy
                    "defense": list(
                        Counter(
                            tuple(enemy["defense"])
                            for enemy in area["enemies"].values()
                            if not enemy.get("friendly")
                        ).most_common(1)[0][0]
                    ),
                    "enemies": sorted(
                        area["enemies"].values(),
                        key=lambda e: (CATEGORY_ORDER.index(enemy_category(e)), e["name"], e["hp"]),
                    ),
                }
                for area in areas.values()
            ),
            key=lambda area: (
                group_index[REGION_GROUP.get(area["region"], area["region"])],
                region_index[area["region"]],
                area["name"] != area["region"],
                area["name"],
            ),
        )
    }
    out_path = os.path.join(project_dir, "public", "enemies.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"), ensure_ascii=False)

    unnamed_path = os.path.join(project_dir, "data", "unnamed-enemies.csv")
    with open(unnamed_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["model", "npcParamId", "placements", "areas"])
        for (model, npc_param_id), info in sorted(unnamed.items()):
            writer.writerow([model, npc_param_id, info["count"], "; ".join(sorted(info["areas"]))])

    models = defaultdict(lambda: {"rows": 0, "count": 0, "areas": set()})
    for (model, _), info in unnamed.items():
        models[model]["rows"] += 1
        models[model]["count"] += info["count"]
        models[model]["areas"] |= info["areas"]
    unnamed_models_path = os.path.join(project_dir, "data", "unnamed-models.csv")
    with open(unnamed_models_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["model", "npcParamRows", "placements", "areas"])
        for model, info in sorted(models.items(), key=lambda m: -m[1]["count"]):
            writer.writerow([model, info["rows"], info["count"], "; ".join(sorted(info["areas"]))])

    enemy_count = sum(len(area["enemies"]) for area in output["areas"])
    print(f"{len(output['areas'])} areas, {enemy_count} enemies -> {out_path}")
    print(f"{len(unnamed)} unnamed enemy rows -> {unnamed_path}")
    print(f"{len(models)} unnamed models -> {unnamed_models_path}")


if __name__ == "__main__":
    main()
