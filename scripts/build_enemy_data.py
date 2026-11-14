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
from enemy_curation import apply_edits, drop_unneeded_identifiers, identify, merge_identical, report, where_is, with_identifier  # noqa: E402
from enemy_curation import base_name as without_boss_tag  # noqa: E402

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
# The team type of summonable helpers (white ghosts), left out (NpcParam rows 53xxxxxxx)
SUMMON_TEAM_TYPE = 2

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

# The rams: the other c5450 rows (54500xxx, 54503xxx, 54506xxx, 545070xx) and the base game's
# other 6060xxxx rows are sheep
RAM_ID = re.compile(r"5450[1245]\d{3}|545071\d\d|6060[1245]\d{3}")

# Foot soldiers' crossbow rows (437x4xxx, weaker than the others): labeled "Crossbow",
# leaving the other foot soldiers of their name in their area plain
CROSSBOW_ID = re.compile(r"437\d4\d{3}")

# Identifiers that are places, kept even where they tell nothing apart (other identifiers are dropped
# there: weapons, gear, and kinds like "Frenzied"; enemy_curation.py drop_unneeded_identifiers)
PLACE_IDENTIFIERS = {"Lake of Rot", "Ellac River", "Castle Sol", "Aureliette", "Agheel Lake South Camp"}

# Weak spots (NpcParam weakPartsDamageRate) are noted for enemies whose weak spot takes more damage from
# every attack (partsDamageType 1; 0 is arrows only, e.g. headshots), at least this much more (×1.5 is
# common and often on models without one). Which part it is comes from the model, not the params.
WEAK_PART_NOTE_MIN_RATE = 2

# Crystalians' shells (a permanent SpEffect until it shatters): damage taken multipliers, by NEGATIONS
# field. Each entry with one is listed whole and shattered ("... (Shattered)", its params' own
# negation)
CRYSTAL_SHELL_SPEFFECT = 11550

# Finger Reader Crones (2160xxxx, also Godwyn's Wet Nurse and the Keeper of Forbidden Lands) aren't
# fought
EXCLUDED_NPC_PARAM_ID = re.compile(r"2160\d{4}")

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
    41610013: "Castle Morne",  # Stray Dog, also NW of Castle Morne Lift
    43143041: "Redmane Castle",  # Radahn Soldier, also by the Impassable Greatbridge
}

# Areas of their own within a map, by the nearest grace, e.g. Castle Morne in the Weeping
# Peninsula: {map's area: {grace: area}}
GRACE_AREA_OVERRIDES = {
    "Weeping Peninsula": {
        grace: "Castle Morne" for grace in ["Morne Moangrave", "Beside the Rampart Gaol", "Behind the Castle"]
    },
    "Caelid": {grace: "Redmane Castle" for grace in ["Chamber Outside the Plaza", "Redmane Castle Plaza"]},
}

# Overworld areas' regions, by hand, where the nearest grace is the wrong one
AREA_REGION_OVERRIDES = {
    "Wyndham Ruins": "Altus Plateau",  # nearest Mt. Gelmir's Seethewater River
    "Writheblood Ruins": "Altus Plateau",  # nearest a Mt. Gelmir grace
    "Stormhill Evergaol": "Stormhill",  # nearest a Limgrave grace
    "Giants' Mountaintop Catacombs": "Mountaintops of the Giants",  # nearest a Flame Peak grace
}

# Identifiers by hand for entries that share a name in an area, by area and NpcParam ID (see
# enemy_curation.py identify), from a review of each area
ENEMY_LABELS = {
    ("Limgrave", 40710009): "Summonwater Village",  # White Wolf
    ("Limgrave", 40710010): "Murkwater Coast",
    ("Divine Tower of Limgrave", 46601010): "Archer",  # Guardian Golem
    ("Divine Tower of Limgrave", 46600010): "Halberd",
    ("Ainsel River Main", 46500262): "Lake of Rot",  # Dragonkin Soldier
    # Ainsel River Main: the weaker Ainsel River enemies are south, the stronger
    # north (the Lake of Rot side)
    ("Ainsel River Main", 41500060): "Ainsel River",  # Basilisk
    **{("Ainsel River Main", i): "Lake of Rot" for i in [41500862, 41500062]},
    **{("Ainsel River Main", i): "South" for i in [37500060, 37501060, 37502060]},  # Clayman
    **{("Ainsel River Main", i): "North" for i in [37500062, 37501062, 37502062]},
    **{("Ainsel River Main", i): "South" for i in [42800060, 42800160]},  # Giant Ant
    # Giant Ant queens (428003xx: a ×10 weak spot)
    ("Ainsel River Main", 42800360): "Queen, South",
    ("Deeproot Depths", 42800366): "Queen",
    **{("Deeproot Depths", i): "" for i in [42800566, 42800466, 42800066, 42800166]},
    **{("Ainsel River Main", i): "North" for i in [42800062, 42800462, 42800862]},
    ("Ainsel River Main", 42801162): "Mount",
    ("Ainsel River Main", 46202060): "South",  # Malformed Star
    ("Ainsel River Main", 46202062): "North",
    **{("Ainsel River Main", i): "" for i in [33200062, 33200162, 33200262, 33201062]},  # Silver Tear
    **{("Ainsel River Main", i): "Lightning" for i in [33202062, 33202262]},
    # Altus Plateau (an empty label keeps the plain name)
    # Dominula Celebrants (the same rows in Dominula, Windmill Village)
    **{
        (area, i): label
        for area in ["Altus Plateau", "Dominula, Windmill Village"]
        for i, label in {
            30700030: "Cleaver",
            30701030: "Lantern",
            30702030: "Sickle",
            30703030: "Skull",
            30704030: "Rib-Rake",
        }.items()
    },
    ("Altus Plateau", 30601030): "Glaive",  # Giant Skeleton
    ("Altus Plateau", 30600030): "Greataxe",
    ("Altus Plateau", 46601030): "Archer",  # Guardian Golem
    ("Altus Plateau", 46600030): "Halberd",
    ("Altus Plateau", 43734030): "Crossbow",  # Leyndell Foot Soldier
    **{("Altus Plateau", i): "" for i in [43730530, 43731530, 43730030, 43731730, 43731030, 43732530, 43736030, 43737030]},
    ("Altus Plateau", 523480030): "Erdtree-Gazing Hill",  # Millicent
    ("Altus Plateau", 523480230): "Dominula",
    ("Altus Plateau", 36610030): "",  # Putrid Corpse (the other is renamed)
    ("Altus Plateau", 40001030): "",  # Revenant Follower (Horseback), SSE of Old Altus Tunnel
    ("Altus Plateau", 40001031): "Shaded Castle",
    ("Altus Plateau", 40000030): "",  # Revenant Follower
    ("Altus Plateau", 40000031): "Shaded Castle",
    ("Altus Plateau", 40400031): "",  # Slug, beside the Slug (Thick Antenna)
    **{("Altus Plateau", i): "" for i in [  # Wandering Noble
        43000030, 43000130, 43001030, 43001230, 43002030, 43003030, 43004030, 43005030, 43005230,
        43006030, 43006630, 43006130, 43006230,
    ]},
    **{("Altus Plateau", i): "Shaded Castle" for i in [43000131, 43001031, 43002031]},
    ("Bellum Highway", 43724020): "Crossbow",  # Raya Lucaria Foot Soldier
    # Plain names that don't need a type, beside a "(...)" version (like the Slug)
    ("Bellum Highway", 40000020): "",  # Revenant Follower, beside (Cloakless)
    **{("Bellum Highway", i): "" for i in [43720020, 43722020, 43723020, 43727020]},
    # Caelid
    ("Caelid", 44702041): "",  # Abductor Virgin (its unscaled copy is left out)
    ("Caelid", 42700040): "",  # Elder Lion
    **{("Caelid", i): "" for i in [45500040, 45502040, 45501040, 45503040]},  # Giant Dog
    ("Caelid", 30601040): "Glaive",  # Giant Skeleton
    ("Caelid", 30600040): "Greataxe",
    **{("Caelid", i): "Karolos/Olivinus" for i in [37020040, 37021140]},  # Glintstone Sorcerer
    **{("Caelid", i): "Lazuli/Twinsage" for i in [37022140, 37023140, 37024040]},
    ("Caelid", 523730040): "Left",  # Knight of the Great Jar
    ("Caelid", 523740040): "Right",
    ("Caelid", 523750040): "Middle",
    **{("Caelid", i): "" for i in [42000040, 42000140]},  # Man-Bat
    **{("Caelid", i): "" for i in [42017440, 42017640, 42017540, 42017740, 42017840]},  # Operatic Bat
    **{("Caelid", i): "" for i in [  # Radahn Foot Soldier
        43740540, 43740040, 43741040, 43743040, 43746040, 43747040,
    ]},
    **{("Caelid", i): "" for i in [  # Radahn Soldier
        43140040, 43140340, 43140140, 43141040, 43141140, 43142040, 43143040,
    ]},
    **{("Caelid", i): "" for i in [43540040, 43541040, 43541140, 43542040]},  # Redmane Knight
    ("Caelid", 41700140): "",  # Skeletal Slime
    ("Caelid", 41610040): "",  # Stray Dog
    ("Caelid", 46000040): "Pot",  # Troll
    # Consecrated Snowfield
    ("Consecrated Snowfield", 34703252): "Broken Club",  # Albinauric
    **{("Consecrated Snowfield", i): "" for i in [
        34701552, 34701652, 34702552, 34704352, 34700352, 34700452,
    ]},
    # Crumbling Farum Azula
    **{("Crumbling Farum Azula", i): "" for i in [  # Beastman of Farum Azula (the Cleaver one's named)
        39700072, 39700272, 39700472, 39700172, 39700372, 39703172, 39702072, 39702272, 39701272,
        39702172, 39702372, 39703072,
    ]},
    # Ancient Dragons, by HP (four can be fought, of five spots)
    **{("Crumbling Farum Azula", i): "12,312 HP" for i in [45100572, 45100072, 45100272, 45100172]},
    **{("Crumbling Farum Azula", i): "20,529 HP" for i in [45102272, 45101272]},
    ("Crumbling Farum Azula", 30611072): "Glaive",  # Giant Beast Skeleton
    ("Crumbling Farum Azula", 30610072): "Greataxe",
    # Deeproot Depths: Fia's Champions share an NpcParam row, so they're labeled by their CharaInitParam
    # builds
    ("Deeproot Depths", "chara", 23711): "Staff",
    ("Deeproot Depths", "chara", 23611): "Twinblade",
    ("Deeproot Depths", "chara", 23701): "Greataxes",
    # Mountaintops of the Giants' Banished Knights
    **{("Mountaintops of the Giants", i): "Castle Sol Rooftops" for i in [30101651, 30102651]},
    **{("Mountaintops of the Giants", i): "Inner Castle Sol" for i in [30100451, 30101451]},  # Draconic
    ("Mountaintops of the Giants", 40800051): "Castle Sol",  # Rat, beside the Rat / Stray Dog
    ("Mountaintops of the Giants", 36703051): "Black Dumpling",  # Elder Albinauric
    **{("Mountaintops of the Giants", i): "Screamer" for i in [36702051, 36702251]},
    ("Mountaintops of the Giants", 46609050): "Archer",  # Guardian Golem
    ("Mountaintops of the Giants", 46602050): "Halberd",
    **{("Mountaintops of the Giants", i): "Red Wings" for i in [42000050, 42000150]},  # Man-Bat
    **{("Mountaintops of the Giants", i): "Green Wings" for i in [42001050, 42001150]},
    **{("Rivermouth Cave", i): "" for i in [50800490, 50801490]},  # Bloodfiend
    ("Sainted Hero's Grave", 40000030): "",  # Revenant Follower, beside (Horseback)
    **{("Ruin-Strewn Precipice", i): "" for i in [42017426, 42017526]},  # Operatic Bat
    ("Ruin-Strewn Precipice", 42018026): "Crown",
    ("Ruins of Unte", 52404191): "1,004 HP",  # Shadow Commoner
    ("Ruins of Unte", 52407091): "1,925 HP",
    # Rauh Base
    **{("Rauh Base", i): "Rauh Base" for i in [50900090, 50900190]},  # Gravebird
    **{("Rauh Base", i): "Scorpion River" for i in [50900295, 50900095]},
    ("Rauh Base", 57901095): "Archer",  # Guardian Golem
    ("Rauh Base", 57900095): "Halberd",
    **{("Rauh Base", i): "" for i in [56510095, 56512095, 56512595]},  # Messmer Foot Soldier
    **{("Rauh Base", i): "" for i in [62900095, 62901095]},  # Misbegotten
    # Scadu Altus
    **{("Scadu Altus", i): "" for i in [  # Boar
        54400090, 54400890, 54400190, 54401090, 54401190,
    ]},
    **{("Scadu Altus", i): "Recluses' River" for i in [54401091, 54400091, 54400191, 54401191]},
    **{("Scadu Altus", i): "" for i in [53800390, 53810390]},  # Miranda Blossom, Sprout
    **{("Scadu Altus", i): "Recluses' River" for i in [53800091, 53810091]},
    **{("Scadu Altus", i): "" for i in [62902090, 62901090, 62900090]},  # Misbegotten
    ("Scadu Altus", 55230081): "1,395 HP",  # Shadow Stray Dog
    ("Scadu Altus", 55230090): "1,625 HP",
    ("Sellia Hideaway", 37021040): "Olivinus",  # Glintstone Sorcerer
    **{("Sellia Hideaway", i): "Lazuli/Twinsage" for i in [37022040, 37023040]},
    # Siofra River
    **{("Siofra River", i): "" for i in [37500064, 37502064]},  # Clayman
    **{("Siofra River", i): "Upper Siofra" for i in [37500065, 37502065]},
    **{("Siofra River", i): "" for i in [70003165, 70002065, 70000065]},  # Fallen Hawk Soldier
    ("Siofra River", 70001065): "Greatshield",
    **{("Specimen Storehouse", i): "Shortsword" for i in [  # Fire Knight
        51601099, 51602099, 51600099, 51602299,
    ]},
    **{("Stone Coffin Fissure", i): "" for i in [59400087, 59401087]},  # Sentry Stone
    ("Stone Coffin Fissure", 59400487): "Beam",
    **{("Stormveil Castle", i): "" for i in [42101214, 42101014, 42101114]},  # Warhawk
    **{("Stormveil Castle", i): "Hooded" for i in [42100114, 42100014]},
    **{("Subterranean Shunning-Grounds", i): "" for i in [36610035, 36611035]},  # Putrid Corpse
    **{("Subterranean Shunning-Grounds", i): "Excised" for i in [21400035, 21400135, 21401035]},  # Omen
    **{("Subterranean Shunning-Grounds", i): "Monstrosity" for i in [21400335, 21400235, 21401235]},
    **{("Subterranean Shunning-Grounds", i): "" for i in [21401435, 21400435]},
    **{("Village of the Albinaurics", i): "" for i in [36700120, 36704020]},  # Elder Albinauric
    **{("Village of the Albinaurics", i): "Cloak" for i in [36701120, 36701121, 36701021]},
    # Volcano Manor
    **{("Volcano Manor", i): "Screamer" for i in [36702238, 36702138, 36702038]},  # Elder Albinauric
    **{("Volcano Manor", i): "Cloak" for i in [36701138, 36701038]},
    ("Volcano Manor", 36703038): "Black Dumpling",
    ("Volcano Manor", 39504038): "Sorcerer",  # Man-Serpent
    **{("Volcano Manor", i): "" for i in [39502038, 39500038, 39501138, 39503038]},
    **{("Greyoll's Dragonbarrow", i): "Spectral" for i in [  # Radahn Soldier
        43143242, 43143042, 43142042, 43140042, 43140342, 43141342, 43141042,
    ]},
    ("Greyoll's Dragonbarrow", 60601042): "55 HP",  # Ram
    ("Greyoll's Dragonbarrow", 60602042): "82 HP",
    ("Scadu Altus", 54700090): "",  # Dragonfly, beside the Recluses' River ones
    # Scaduview
    ("Scaduview", 50600193): "Pink",  # Lamprey
    ("Scaduview", 50600093): "Black",
    ("Scaduview", 54501092): "Scaduview",  # Ram
    ("Scaduview", 54501093): "Hinterland",
    # Nokron, Eternal City
    **{("Nokron, Eternal City", i): "1,020 HP" for i in [33700865, 33700265]},  # Ancestral Follower Shaman
    ("Nokron, Eternal City", 33700065): "1,462 HP",
    **{("Nokron, Eternal City", i): "" for i in [70002065, 70003165, 70000065]},  # Fallen Hawk Soldier
    ("Nokron, Eternal City", 70001065): "Greatshield",
    **{("Nokron, Eternal City", i): "" for i in [33201065, 33201165, 33200265]},  # Silver Tear
    # Its Mimic Tears share an NpcParam row, so they're labeled by their CharaInitParam builds
    ("Nokron, Eternal City", "chara", 23680): "Crossbow",
    ("Nokron, Eternal City", "chara", 23681): "Mace",
    ("Nokron, Eternal City", "chara", 23682): "Zweihander",
    ("Nokron, Eternal City", "chara", 23683): "Spear",
    # Mt. Gelmir
    **{("Mt. Gelmir", i): "" for i in [44700032, 44701032]},  # Abductor Virgin
    ("Mt. Gelmir", 36610032): "",  # Putrid Corpse
    # Mohgwyn Palace's Albinaurics
    ("Mohgwyn Palace", 34703068): "Broken Club",
    **{("Mohgwyn Palace", i): "" for i in [34700268, 34701468, 34704268, 34702468]},
    # Liurnia of the Lakes
    **{("Liurnia of the Lakes", i): "Brown Tunic" for i in [  # Albinaurics
        34702120, 34700120, 34701120, 34703020, 34704120, 34702320,
    ]},
    **{("Liurnia of the Lakes", i): "Chainmail" for i in [34701020, 34704020, 34700020]},
    ("Liurnia of the Lakes", 30601020): "Glaive",  # Giant Skeleton
    ("Liurnia of the Lakes", 30600020): "Greataxe",
    ("Liurnia of the Lakes", 523100010): "Lake-Facing Cliffs",  # Lightseeker Hyetta
    **{("Liurnia of the Lakes", i): "" for i in [523100020, 523100120]},
    **{("Liurnia of the Lakes", i): "Frenzy" for i in [44800120, 44810120]},  # Miranda Blossom, Sprout
    **{("Liurnia of the Lakes", i): "Magic" for i in [44800220, 44810220]},
    ("Liurnia of the Lakes", 40000020): "",  # Revenant Follower
    # Leyndell, Royal Capital
    **{("Leyndell, Royal Capital", i): "" for i in [43530034, 43531034, 43532034]},  # Leyndell Knight
    ("Leyndell, Royal Capital", 43531534): "Spear, NE of Fortified Manor",
    ("Leyndell, Royal Capital", 37030034): "",  # Noble's Page
    ("Leyndell, Royal Capital", 37031034): "Pulley Crossbow",
    # Greyoll's Dragonbarrow
    **{("Greyoll's Dragonbarrow", i): "Fort Faroth" for i in [42017542, 42017642, 42017442]},  # Operatic Bat
    ("Greyoll's Dragonbarrow", 42018042): "",
    # (its Vulgar Militia like the Forbidden Lands')
    **{("Greyoll's Dragonbarrow", i): "" for i in [43210142, 43211142]},
    ("Greyoll's Dragonbarrow", 43212142): "Chain",
    **{("Hidden Path to the Haligtree", i): "" for i in [43210152, 43211152]},  # Vulgar Militia
    # Forbidden Lands' Vulgar Militia: two outfits with the same stats, and the chain one, with
    # 20% dark negation (the same parts shown as the Hidden Path to the Haligtree's)
    **{("Forbidden Lands", i): "" for i in [43210150, 43211150]},
    ("Forbidden Lands", 43212150): "Chain",
    # Giant-Conquering Hero's Grave's Fire Monks
    ("Giant-Conquering Hero's Grave", 39000050): "Mace",
    ("Giant-Conquering Hero's Grave", 39001050): "Sword",
    # Gravesite Plain
    ("Gravesite Plain", 58400080): "Church",  # Black Knight (Great Hammer)
    ("Gravesite Plain", 58400081): "Castle Front",
    **{("Gravesite Plain", i): "Prospect Town" for i in [50807080, 50802080, 50801080, 50800080]},  # Bloodfiend
    **{("Gravesite Plain", i): "" for i in [50801081, 50800081]},
    **{("Gravesite Plain", i): "" for i in [54400080, 54401080]},  # Boar (two looks, the same stats)
    ("Gravesite Plain", 54401181): "Pillar Path",
    ("Gravesite Plain", 50400080): "",  # Curseblade
    ("Gravesite Plain", 50400081): "Pillar Path",
    ("Gravesite Plain", 50900080): "S of Greatbridge",  # Gravebird
    **{("Gravesite Plain", i): "N of Greatbridge" for i in [50900081, 50900281]},
    ("Gravesite Plain", 55220080): "",  # Large Shadow Stray Dog
    ("Gravesite Plain", 55220081): "Prospect Town",
    **{("Gravesite Plain", i): "Cliffroad" for i in [55300180, 55300080]},  # Man-Bat
    **{("Gravesite Plain", i): "" for i in [55300181, 55300081]},
    **{("Gravesite Plain", i): "Ellac River" for i in [59000081, 59000181]},  # Man-Fly (two looks)
    # Messmer Soldiers and Shadow Commoners: their weapons and outfits have the same stats
    **{("Gravesite Plain", i): "Church" for i in [58300080, 58300280, 58300680, 58300180, 58300380]},
    **{("Gravesite Plain", i): "" for i in [58300081, 58300181, 58300381, 58300681, 58300281, 58300581]},
    **{("Gravesite Plain", i): "" for i in [
        52403280, 52403480, 52400280, 52404180, 52407580, 52407480, 52400780,
    ]},
    ("Gravesite Plain", 52404181): "Pillar Path",
    ("Abandoned Ailing Village", 52407080): "",  # Shadow Commoner, beside (Jar)
    **{("Gravesite Plain", i): "" for i in [55230080, 57600080]},  # Rat / Shadow Stray Dog
    **{("Gravesite Plain", i): "Ellac River" for i in [55230081, 57600081]},
    ("Gravesite Plain", 51100080): "",  # Spirit Eel
    **{("Gravesite Plain", i): "Ellac River/Pillar Path" for i in [51100781, 51100081]},
    # Foot of the Jagged Peak
    **{("Foot of the Jagged Peak", i): "" for i in [53600184, 53601184, 53602184, 53603184, 53604084]},
    ("Foot of the Jagged Peak", 59310084): "Greataxe",  # Giant Beast Skeleton
    ("Foot of the Jagged Peak", 55800084): "Pond",  # Jagged Peak Drake
    ("Foot of the Jagged Peak", 55800985): "Duel",
    # Dragon's Pit's Giant Beast Skeletons
    **{("Dragon's Pit", i): "" for i in [53604181, 53603181, 53600181, 53601181]},
    ("Dragon's Pit", 59311081): "Glaive",
    ("Dragon's Pit", 59310081): "Greataxe",
    # Miquella's Haligtree: the weaker ones are in the Haligtree, the stronger in
    # Elphael; Millicent by her nearest grace
    **{("Miquella's Haligtree", i): "Haligtree" for i in [
        33501154, 33500154, 33502154,  # Crystalian
        44820054,  # Rotten Miranda Blossom
        44830054, 44831054,  # Rotten Miranda Sprout
    ]},
    **{("Miquella's Haligtree", i): "Elphael" for i in [
        33501556, 33500556, 33502556, 44820056, 44831056,
    ]},
    ("Miquella's Haligtree", 523480256): "Drainage Channel",  # Millicent
    ("Miquella's Haligtree", 523480056): "Prayer Room",
    # Enir-Ilim's Divine Beast Warriors: the strong one by its grace, and Belurat's (moved
    # here) by its area
    **{("Enir-Ilim", i): "" for i in [52501289, 52501389]},
    ("Enir-Ilim", 52501489): "Cleansing Chamber",
    ("Enir-Ilim", 52501189): "Belurat",
    # Divine Tower of East Altus's Leyndell Foot Soldiers
    ("Divine Tower of East Altus", 43734050): "Crossbow",
    ("Divine Tower of East Altus", 43737050): "",
    # Capital Outskirts
    ("Capital Outskirts", 46607033): "Archer",  # Guardian Golem
    ("Capital Outskirts", 46600133): "Halberd",
    **{("Capital Outskirts", i): "" for i in [  # Leyndell Foot Soldier
        43731630, 43730030, 43730530, 43732030, 43736030, 43737030,
    ]},
    **{("Capital Outskirts", i): "Giant-Crusher Camp" for i in [43730033, 43737033]},
    ("Capital Outskirts", 40400033): "",  # Slug (the other is renamed)
    ("Capital Outskirts", 32510030): "Shield",  # Tree Sentinel
    # Ancient Ruins of Rauh's Bloodfiends, by HP
    **{("Ancient Ruins of Rauh", i): "4,552 HP" for i in [50800094, 50801094, 50802094]},
    ("Ancient Ruins of Rauh", 50800194): "7,236 HP",
    # Its two Mimic Tears share an NpcParam row, so they're labeled by their CharaInitParam builds
    ("Ainsel River Main", "chara", 23682): "Greatsword",
    ("Ainsel River Main", "chara", 23683): "Spear/Shield",
    # Glintstone Sorcerers: the stronger ones are Lazuli or Twinsage, the weaker Karolos or Olivinus
    ("Academy Crystal Cave", 37023020): "Lazuli/Twinsage",
    ("Academy Crystal Cave", 37020020): "Karolos/Olivinus",
    **{("Academy of Raya Lucaria", i): "Lazuli/Twinsage" for i in [37022024, 37023024, 37024024]},
    **{("Academy of Raya Lucaria", i): "Karolos/Olivinus" for i in [37020024, 37021024]},
    # The Man-Flies differ only in HP, as far as can be seen in game
    ("Abandoned Ailing Village", 59000080): "1,353 HP",
    ("Abandoned Ailing Village", 59000081): "1,653 HP",
}

# Edits by hand to the picker's entries, from a review of each area, in order (see
# enemy_curation.py apply_edits). Anywhere unless an area is given.
ENEMY_EDITS = [
    # Things that aren't enemies to fight, or aren't fought
    *[("delete", {"name": name}) for name in [
        "Merciless Chariot", "Ballista", "Trebuchet", "Walking Mausoleum", "Commoner (Ghost)",
        "Wandering Noble (Ghost)", "Dragon-faced Flamethrower", "Balloon", "Unnamed Human",
        "Defeated Godrick", "Vyke's Finger Maiden",
    ]],
    ("delete", {"name_re": r"Silent Spirit$"}),
    ("delete", {"name": "Wandering Noble", "friendly": True}),
    ("delete", {"area": "Roundtable Hold", "friendly": True}),
    ("delete", {"area": "Academy of Raya Lucaria", "name": "Boc the Seamster", "friendly": True}),
    ("delete", {"area": "Academy of Raya Lucaria", "name": "Rennala, Queen of the Full Moon", "friendly": True}),
    # Friendly Sellens can't be fought (she's fought as an enemy in the Academy)
    ("delete", {"name": "Sorceress Sellen", "friendly": True}),
    ("delete", {"area": "Academy of Raya Lucaria", "name": "Sorcerer Thops"}),
    ("delete", {"area": "Liurnia of the Lakes", "name": "Jarwight"}),
    ("delete", {"area": "Liurnia of the Lakes", "name": "Finger Maiden Therolina"}),
    ("delete", {"area": "Forlorn Hound Evergaol", "name": "Blaidd the Half-Wolf", "hp": 1506}),
    ("delete", {"area": "Weeping Peninsula", "name": "Miranda Sprout", "hp": 0}),
    # Ainsel River's Dragonkin Soldier with the Nokstella one's stats is it (its event versions)
    ("rename", {"area": "Ainsel River Main", "ids": [46500060, 46500160]}, "Dragonkin Soldier of Nokstella"),
    # Village of the Albinaurics' characters, placed near its grace
    ("move", {"area": "Liurnia of the Lakes", "name": "Elder Albinauric"}, "Village of the Albinaurics"),
    ("move", {"area": "Liurnia of the Lakes", "ids": [533340020]}, "Village of the Albinaurics"),
    ("split", {"area": "Liurnia of the Lakes", "ids": [36708020]}, {36708020: "Old Albus"}),
    ("move", {"area": "Liurnia of the Lakes", "ids": [36708020]}, "Village of the Albinaurics"),
    # Names
    ("rename", {"name": "Putrid Flesh", "dlc": False}, "Skeletal Slime"),
    # (Mohgwyn Palace's and Writheblood Ruins' large ones)
    ("rename", {"name": "Large Putrid Flesh", "dlc": False}, "Giant Skeletal Slime"),
    # Liurnia's Albinaurics away from the Village of the Albinaurics are just Albinaurics
    ("rename", {"area": "Liurnia of the Lakes", "name_re": r"^Albinauric Frog"}, ("^.*$", "Albinauric")),
    ("rename", {"name_re": r"^Omen Monstrosity"}, (r"^Omen Monstrosity", "Omen")),
    ("rename", {"name": "Godskin Apostle [Boss HP]"}, (r"Godskin Apostle \[Boss HP\]", "Godskin Apostle [Boss]")),
    ("rename", {"area": "Stormhill", "name": "Death Rite Bird"}, "Death Bird"),
    ("rename", {"area": "Weeping Peninsula", "name": "Death Rite Bird"}, "Death Bird"),
    ("rename", {"area": "Stormhill", "name": "Heartbroken Maiden"}, "Roderika"),
    ("rename", {"area": "Ainsel River Main", "name": "Ulcerated Tree Spirit"}, "Putrid Tree Spirit"),
    ("rename", {"area": "Ainsel River Main", "ids": [523680062]}, "Mimic Tear"),
    ("rename", {"area": "Altus Plateau", "ids": [36612030]}, "Burning Putrid Corpse"),
    # Caelid: unscaled copies (NpcParam IDs ending 000) not found in the game, their placements in
    # ordinary spots
    ("delete", {"area": "Caelid", "ids": [44702000]}),  # Abductor Virgin
    ("delete", {"area": "Caelid", "ids": [45600000]}),  # Giant Crow
    ("delete", {"area": "Caelid", "ids": [36610000]}),  # Putrid Corpse
    ("delete", {"area": "Caelid", "ids": [45501000, 45502000, 45500000]}),  # Giant Dog (668 HP)
    ("delete", {"area": "Caelid", "ids": [46003140]}),  # Troll
    # The rest of the unscaled group by Deep Siofra Well
    ("delete", {"area": "Caelid", "ids": [48200100]}),  # Omenkiller
    ("delete", {"area": "Caelid", "ids": [37010000]}),  # White Veil Perfumer
    ("rename", {"area": "Caelid", "ids": [36622040]}, "Large Burning Putrid Corpse"),
    ("rename", {"area": "Caelid", "ids": [36626040]}, "Large Rotten Putrid Corpse"),
    ("rename", {"area": "Caelid", "ids": [36612040]}, "Burning Putrid Corpse"),
    ("rename", {"area": "Caelid", "ids": [36616040]}, "Rotten Putrid Corpse"),
    # Limgrave's Troll (its params) placed at Caelid's edge
    ("move", {"area": "Caelid", "ids": [46000010]}, "Limgrave"),
    ("move", {"area": "Capital Outskirts", "ids": [46300030]}, "Altus Plateau"),  # Runebear
    ("rename", {"area": "Capital Outskirts", "ids": [40403033]}, "Fire Slug"),
    # Not bosses, though they drop runes like one (NpcParam isSoulGetByBoss)
    ("set", {"area": "Scadu Altus", "ids": [58301590]}, {"boss": None}),  # Messmer Soldier
    ("set", {"area": "Scadu Altus", "ids": [58401290, 58401390]}, {"boss": None}),  # Black Knight
    # Friendly Messmer Soldiers are story copies, not fought
    ("delete", {"name": "Messmer Soldier", "friendly": True}),
    # Consecrated Snowfield: its Albinauric Frogs are merged with its Albinaurics
    ("rename", {"area": "Consecrated Snowfield", "ids": [34700352, 34700452]}, ("^.*$", "Albinauric")),
    ("rename", {"area": "Consecrated Snowfield", "ids": [34001852]}, ("^.*$", "Rotten Grave Warden Duelist (Hammer)")),
    ("rename", {"area": "Consecrated Snowfield", "ids": [34000852]}, ("^.*$", "Rotten Grave Warden Duelist (Greataxe)")),
    # Crumbling Farum Azula: its second Godskin Apostle isn't fought
    ("delete", {"area": "Crumbling Farum Azula", "ids": [35600972]}),
    # Elphael: the 8993 HP Mary, Eldest Sister (533870056) is the player's ally in the version where they
    # fight Millicent with her; the one fought is 523870056, beside Millicent
    ("delete", {"area": "Miquella's Haligtree", "ids": [533870056]}),
    # Enir-Ilim: one Divine Bird Warrior; the rest (the greatsword ones, parts shown 23: the
    # Divine Beast head) are Divine Beast Warriors. Its Fat Hornsent Inquisitor 53200000 is an unscaled
    # copy (576 HP)
    ("rename", {"area": "Enir-Ilim", "ids": [52500189]}, (r"^.*$", "Divine Bird Warrior")),
    ("rename", {"area": "Enir-Ilim", "ids": [52501289, 52501389, 52501489]}, (r"^.*$", "Divine Beast Warrior")),
    ("delete", {"area": "Enir-Ilim", "ids": [53200000]}),
    # Enir-Ilim's non-boss Promised Consort Radahn isn't fought
    ("delete", {"area": "Enir-Ilim", "ids": [52202000]}),
    # Enir-Ilim's only ally is Sir Ansbach, by the Gate of Divinity. Its Ansbach, Nataan, and
    # Thiollier by the Cleansing Chamber Anteroom are summons, like Ansbach and Thiollier's for Radahn
    # (534160089 and 534190089, already left out), and its other allies aren't fought
    ("delete", {"area": "Enir-Ilim", "ids": [
        524250089, 524140089, 524150089, 524180089, 524170089,  # Dane, Hornsent, Moore, Leda, Freyja
        524190089,  # Thiollier
        534160189, 534260089, 534190189,  # Ansbach, Nataan, Thiollier by the Cleansing Chamber
    ]}),
    # Belurat: its Divine Beast Warrior goes with Enir-Ilim's (kept apart from the Divine Bird
    # Warrior, whose stats are the same), and its Divine Bird Warriors are Horned Warriors
    ("rename", {"area": "Belurat, Tower Settlement", "ids": [52501189]}, (r"^.*$", "Divine Beast Warrior")),
    ("set", {"area": "Belurat, Tower Settlement", "ids": [52501189]}, {"separate": True}),
    ("move", {"area": "Belurat, Tower Settlement", "ids": [52501189]}, "Enir-Ilim"),
    ("rename", {"area": "Belurat, Tower Settlement", "ids": [52500088, 52500988, 52501088]}, (r"^.*$", "Horned Warrior")),
    # Deeproot Depths: the level 149 Fia's Champion (CharaInitParam 23612) isn't in the fight
    ("delete", {"area": "Deeproot Depths", "name": "Fia's Champion", "hp": 1680}),
    # Cerulean Coast
    ("move", {"area": "Cerulean Coast", "ids": [51100184]}, "Charo's Hidden Grave"),  # Spirit Eel
    # Castle Ensis' stronger versions are Scadu Altus'
    ("move", {"area": "Castle Ensis", "ids": [
        56511890, 56510590, 58300490, 58300290, 58300690, 58300590,
    ]}, "Scadu Altus"),
    # Belurat's stronger Spider Scorpions are Enir-Ilim's
    ("move", {"area": "Belurat, Tower Settlement", "ids": [51920094, 51930094]}, "Enir-Ilim"),
    ("rename", {"area": "Moonlight Altar", "name": "Spiritcaller Snail"}, "Crystal Snail"),
    # Forbidden Lands' Black Blade Kindred and Night's Cavalry need no identifiers
    ("rename", {"area": "Forbidden Lands", "ids": [47700250, 31500050]}, (r" \([^()]*\)$", "")),
    # Limgrave: its stronger Larval Land Octopus and Miranda Sprout are the Weeping
    # Peninsula's, its strongest Wandering Noble is a sniper, and its weakest Wolves are corpses
    ("move", {"area": "Limgrave", "ids": [42300012, 44810012]}, "Weeping Peninsula"),
    ("rename", {"area": "Limgrave", "ids": [43002110]}, (r"^.*$", "Noble Sorcerer Sniper (Agheel Lake South Camp)")),
    ("delete", {"area": "Limgrave", "ids": [40700009]}),
    # Liurnia of the Lakes: an unscaled Blaidd (20100000) that isn't seen, its Deathbird, rows
    # not fought (a Glintstone Sorcerer, two Jar-Bairns, Pidia), and its stronger Red and White Wolves,
    # which are the Moonlight Altar's
    ("delete", {"area": "Liurnia of the Lakes", "ids": [
        20100000, 37020020, 44919320, 44919020, 36709920, 36709020,
    ]}),
    ("rename", {"area": "Liurnia of the Lakes", "ids": [49800020]}, "Deathbird"),
    ("move", {"area": "Liurnia of the Lakes", "ids": [31810022, 40710022]}, "Moonlight Altar"),
    # Moorth Ruins' one Gravesite Plain-level Shadow Stray Dog (55230081) isn't found there
    ("delete", {"area": "Moorth Ruins", "ids": [55230081]}),
    # Mountaintops of the Giants: an unscaled Skeleton (148 HP), and plain names for the
    # rest of its Skeletons, its Fire Slug, and its White Stormhawk
    ("delete", {"area": "Mountaintops of the Giants", "ids": [35001000]}),
    ("rename", {"area": "Mountaintops of the Giants", "name": "Skeleton (Curved Sword)"}, (r"^.*$", "Skeleton")),
    ("rename", {"area": "Mountaintops of the Giants", "ids": [40403050]}, (r"^.*$", "Fire Slug")),
    ("rename", {"area": "Mountaintops of the Giants", "ids": [42103050]}, (r"^.*$", "White Stormhawk")),
    # The DLC's friendly Kindred of Rot are Forager Broods
    ("rename", {"name": "Kindred of Rot", "friendly": True, "dlc": True}, (r"^.*$", "Forager Brood")),
    # Rauh Base: its crossbow Messmer Foot Soldier is just "Crossbow", and its strongest
    # Misbegotten is scaly
    ("rename", {"area": "Rauh Base", "ids": [56514095]}, (r"^.*$", "Messmer Foot Soldier (Crossbow)")),
    ("rename", {"area": "Rauh Base", "ids": [62910095]}, (r"^.*$", "Scaly Misbegotten")),
    ("rename", {"area": "Rauh Base", "ids": [52500095, 52501095]}, (r"^.*$", "Horned Warrior")),
    # (the one 57 m from Temple Town Ruins' grace is the ruins')
    ("split", {"area": "Rauh Base", "ids": [52501095]}, {52501095: "Horned Warrior"}),
    ("move", {"area": "Rauh Base", "ids": [52501095]}, "Temple Town Ruins"),
    # Scadu Altus: entries that are other areas', and its Longhaft Axe Misbegotten is scaly
    # (as in Rauh Base). Its stronger Shadow Commoners (by the Castle Watering Hole, and one by
    # Recluses' River Downstream) are the Ruins of Unte's
    ("move", {"area": "Scadu Altus", "ids": [54401193, 51100693]}, "Scaduview"),  # Boar, Spirit Eel
    ("move", {"area": "Scadu Altus", "ids": [50400090]}, "Moorth Ruins"),  # Curseblade
    ("move", {"area": "Scadu Altus", "ids": [50400091]}, "Village of Flies"),
    ("move", {"area": "Scadu Altus", "ids": [51700091, 52404191, 52407091]}, "Ruins of Unte"),
    ("move", {"area": "Scadu Altus", "ids": [50900090, 50900190]}, "Rauh Base"),  # Gravebird
    ("rename", {"area": "Scadu Altus", "ids": [62910090]}, (r"^.*$", "Scaly Misbegotten")),
    # Shadow Keep's throwing Fire Knights: the weaker has a shortsword, the stronger is Wego
    ("rename", {"area": "Shadow Keep", "ids": [51602398]}, (r"^.*$", "Fire Knight (Shortsword)")),
    ("rename", {"area": "Shadow Keep", "ids": [51602198]}, (r"^.*$", "Fire Knight Wego")),
    # Shadow Keep's stronger Leda and Hornsent (the same spots as the weaker) aren't the ones fought
    #, nor Specimen Storehouse's stronger Leda and Ansbach
    ("delete", {"area": "Shadow Keep", "ids": [534180098, 534140198]}),
    ("delete", {"area": "Specimen Storehouse", "ids": [534180099, 534160099]}),
    ("delete", {"area": "Specimen Storehouse", "ids": [524140099]}),  # Hornsent, a summon
    # Stone Coffin Fissure's friendly Thiollier and St. Trina
    ("delete", {"area": "Stone Coffin Fissure", "ids": [524190087, 53300087], "friendly": True}),
    # Stranded Graveyard's Banished Knights, by weapon
    ("rename", {"area": "Stranded Graveyard", "ids": [30100507]}, (r"^.*$", "Banished Knight (Sword)")),
    ("rename", {"area": "Stranded Graveyard", "ids": [30102507]}, (r"^.*$", "Banished Knight (Halberd)")),
    # The Stranded Graveyard's Fringefolk Hero's Grave, as its own area
    ("move", {"area": "Stranded Graveyard", "ids": [
        46400007,  # Ulcerated Tree Spirit
        30100507, 30102507,  # Banished Knight
        30004007, 30005007,  # Castle Exile
        30800007, 30806007,  # Imp
        46900007,  # Grafted Scion
    ]}, "Fringefolk Hero's Grave"),
    ("rename", {"area": "Subterranean Shunning-Grounds", "ids": [36612035]}, (r"^.*$", "Burning Putrid Corpse")),
    # Caelid's Spear Cleanrot Knight is the base row (unscaled, 437 HP), not one that's there
    ("delete", {"area": "Caelid", "ids": [38000000]}),
    # Swamp of Aeonia's Giant Dog is Caelid's, and its unscaled base row (668 HP) isn't one that's there
  
    ("move", {"area": "Swamp of Aeonia", "ids": [45504040]}, "Caelid"),
    ("delete", {"area": "Swamp of Aeonia", "ids": [45500000]}),
    # The Weeping Peninsula's Limgrave-level (…10) rows are Limgrave's, and one of its Irinas isn't
    # there
    ("move", {"area": "Weeping Peninsula", "ids": [
        41000010, 41002010,  # Demi-Human
        43711510, 43710010,  # Godrick Foot Soldier
        41010010,  # Large Demi-Human
        43112110, 43112010, 43110010, 43114010,  # Soldier of Godrick
    ]}, "Limgrave"),
    ("delete", {"area": "Weeping Peninsula", "ids": [523100012]}),
    # From review notes
    ("rename", {"name_re": r"^Banished Knight\b.*\(Draconic"}, (r"\(Draconic", "(Dragon Helm")),
    # (the Mountaintops of the Giants' need no identifier for it)
    ("rename", {"area": "Mountaintops of the Giants", "name_re": r"^Banished Knight\b"}, (r" \(Dragon Helm\)", "")),
    ("rename", {"area": "Hallowhorn Grounds (Nokron)", "name": "Ancestor Spirit"}, "Regal Ancestor Spirit"),
    ("rename", {"name": "White Veil Perfumer"}, "Perfumer"),
    # Liurnia's friendlies
    ("delete", {"area": "Liurnia of the Lakes", "name_re": r"^(Archer's Wolf|Omenkiller|Raya Lucaria Soldier|Scaly Misbegotten)$", "friendly": True}),
    ("rename", {"area": "Liurnia of the Lakes", "ids": [523140020, 523140220]}, (r"^.*$", "Knight Diallos")),
    ("delete", {"area": "Liurnia of the Lakes", "name": "Dolores the Sleeping Arrow"}),
    ("delete", {"area": "Liurnia of the Lakes", "name": "Dung Eater"}),
    ("rename", {"area": "Redmane Castle", "ids": [44702041]}, (r"^.*$", "Abductor Virgin (Mixed)")),
    ("rename", {"area": "Capital Outskirts", "name": "Death Rite Bird"}, "Deathbird"),
    ("rename", {"area": "Capital Outskirts", "name": "Spiritcaller Snail"}, "Skull Snail"),
    ("rename", {"area": "Mountaintops of the Giants", "name": "Spiritcaller Snail"}, "Skull Snail"),
    # (414040xx rows are Crystal Snails)
    ("rename", {"ids": [41404022, 41404052]}, (r"^Spiritcaller Snail", "Crystal Snail")),
    ("move", {"area": "Liurnia of the Lakes", "ids": [41404022]}, "Moonlight Altar"),
    ("set", {"area": "Capital Outskirts", "name": "Dung Eater"}, {"friendly": None}),
    ("delete", {"area": "Volcano Manor", "name_re": r"^(Knight Diallos|Patches|Recusant Bernahl|Rykard-Hating Spirit)$"}),
    ("delete", {"area": "Volcano Manor", "name": "Tanith's Knight", "friendly": True}),
    ("rename", {"area": "Volcano Manor", "ids": [523130038, 523130138]}, (r"^.*$", "Rya the Scout")),  # human
    ("delete", {"area": "Volcano Manor", "ids": [39509038, 39509138]}),  # Zorayas, her serpent form
    # Swamp of Aeonia: its friendly Kindred of Rot, its enemies on the Caelid side, and its
    # Sentry Stones, which are Sellia Evergaol's
    ("delete", {"area": "Swamp of Aeonia", "ids": [38109040]}),
    ("move", {"area": "Swamp of Aeonia", "ids": [
        20410040,  # Larva of Rot
        43401040,  # Mad Pumpkin Head
        43140140,  # Radahn Soldier
        43002040,  # Wandering Noble
        38101040,  # Kindred of Rot
    ]}, "Caelid"),
    ("move", {"area": "Swamp of Aeonia", "ids": [44300040, 44301040]}, "Sellia Evergaol"),
    # Greyoll's Dragonbarrow: its Radahn Foot Soldiers are the Divine Tower of Caelid's, and
    # its Gargoyles (base rows) aren't there
    ("move", {"area": "Greyoll's Dragonbarrow", "ids": [43740542, 43747042, 43742042]}, "Divine Tower of Caelid"),
    ("delete", {"area": "Greyoll's Dragonbarrow", "ids": [47700000, 47701000]}),
    ("rename", {"area": "Altus Plateau", "ids": [30800830]}, (r"^.*$", "Imp (Spectral)")),
    ("rename", {"area": "Consecrated Snowfield", "ids": [30800852]}, (r"^.*$", "Imp (Spectral)")),
    ("rename", {"area": "Consecrated Snowfield", "ids": [40403052]}, (r"^.*$", "Fire Slug")),
    # The other fire-immune Slugs are Fire Slugs too
    ("rename", {"area": "Stormhill", "ids": [40403010]}, (r"^.*$", "Fire Slug")),
    ("rename", {"area": "Liurnia of the Lakes", "ids": [40403020]}, (r"^.*$", "Fire Slug")),
    ("rename", {"area": "Volcano Manor", "ids": [40401038]}, (r"^.*$", "Fire Slug")),
    ("delete", {"area": "Consecrated Snowfield", "friendly": True}),
    # Mt. Gelmir's Vulgar Militia (Altus Plateau rows) are the Altus Plateau's
    ("move", {"area": "Mt. Gelmir", "ids": [43211030, 43212030]}, "Altus Plateau"),
    # Flame Peak's Chief Guardian Arghanthy, Fire Prelate, and Guilty are the Mountaintops of the
    # Giants'
    ("move", {"area": "Flame Peak", "ids": [523820050, 39101150, 43811150]}, "Mountaintops of the Giants"),
    # Its Slug is a Fire Slug, and its Large Stray Dog, Stray Dog, and Warhawk are the Mountaintops of
    # the Giants' (the Warhawk is its White Stormhawk's row)
    ("rename", {"area": "Flame Peak", "ids": [40403050]}, (r"^.*$", "Fire Slug")),
    ("rename", {"area": "Flame Peak", "ids": [42103050]}, (r"^.*$", "White Stormhawk")),
    ("move", {"area": "Flame Peak", "ids": [41602050, 41610350, 42103050]}, "Mountaintops of the Giants"),
    ("rename", {"area": "Crumbling Farum Azula", "ids": [42102072]}, (r"^.*$", "Stormhawk")),
    ("set", {"area": "Leyndell, Ashen Capital", "ids": [523240070]}, {"friendly": None, "boss": True}),  # Gideon
    # Bosses' phase prefixes
    ("rename", {"name_re": r"^(EB|PCR|Messmer|Godfrey) - "}, (r"^(EB|PCR|Messmer|Godfrey) - ", "")),
    ("rename", {"area": "Mohgwyn Palace", "ids": [36615068]}, (r"^.*$", "Blistered Putrid Corpse")),
    ("rename", {"area": "Caelem Ruins", "ids": [36622040]}, (r"^.*$", "Large Burning Putrid Corpse")),  # as in Caelid
    ("delete", {"area": "Mohgwyn Palace", "ids": [523010168]}),  # the friendly Varré
    ("rename", {"area": "Gravesite Plain", "name_re": r"^Black Knight \(Great Hammer\)$"}, (r" \(Great Hammer\)", "")),
    # Castle Ensis' and Scaduview's Moore and Forager Brood are Scadu Altus' (the same rows)
    ("move", {"area": "Castle Ensis", "ids": [544150090, 544150190, 57409090]}, "Scadu Altus"),
    ("move", {"area": "Scaduview", "ids": [544150090, 544150190, 57409090]}, "Scadu Altus"),
    ("delete", {"area": "Scadu Altus", "ids": [524150090]}),  # the friendly Moore
    ("move", {"area": "Castle Ensis", "ids": [58400590]}, "Scadu Altus"),  # Black Knight Garrew
    ("delete", {"name_re": r"^Scarab\b", "dlc": True}),
    ("move", {"area": "Scadu Altus", "ids": [544120090]}, "Finger Ruins of Miyr"),  # Swordhand of Night Anna
    ("delete", {"area": "Finger Ruins of Miyr", "name": "Dragonfly"}),
    ("delete", {"area": "Scaduview", "ids": [524120090]}),  # the friendly Anna
    ("delete", {"name": "Basilisk Eyes"}),
    ("delete", {"area": "Shadow Keep", "name": "Black Knight", "friendly": True}),
    ("delete", {"area": "Specimen Storehouse", "ids": [51400099, 51410099]}),  # Messmer's serpents
    # Abyssal Woods' bosses (Jori and his Inquisitors) are Darklight Catacombs'
    ("move", {"area": "Abyssal Woods", "ids": [53120086, 53200286, 53111386]}, "Darklight Catacombs"),
    ("rename", {"area": "Midra's Manse", "ids": [52501086, 52500086]}, (r"^.*$", "Horned Warrior")),
    # The Ancient Ruins of Rauh's Divine Bird Warriors are its 52500194 (E of Church of the Bud and of Rauh
    # Ancient Ruins, East); its other two are Horned Warriors
    ("rename", {"area": "Ancient Ruins of Rauh", "ids": [52501094, 52500094]}, (r"^.*$", "Horned Warrior")),
    ("rename", {"area": "Ancient Ruins of Rauh", "ids": [52500194]}, (r"^.*$", "Divine Bird Warrior")),
    # Scadu Altus' stronger Dragonflies are by Recluses' River
    ("rename", {"area": "Scadu Altus", "ids": [54700091, 54710091, 54720091]}, (r"^.*$", "Dragonfly (Recluses' River)")),
    # Specimen Storehouse's Greatsword Fire Knight is Kood
    ("rename", {"area": "Specimen Storehouse", "ids": [51600199]}, (r"^.*$", "Fire Knight Kood")),
    ("rename", {"area": "West Rampart", "ids": [51601198]}, (r"^.*$", "Fire Knight Salza")),
    # Scaduview's weaker Boar is Scadu Altus' (the same row)
    ("move", {"area": "Scaduview", "ids": [54401190]}, "Scadu Altus"),
    # Scadu Altus' Lampreys and Large Lamprey are Scaduview's
    ("move", {"area": "Scadu Altus", "ids": [50600793, 50600593, 50600193, 50610893]}, "Scaduview"),
    # Its weaker Shadow Militia, by the Fog Rift, are Gravesite Plain's (the same rows)
    ("move", {"area": "Rauh Base", "ids": [56610081, 56611081, 56612081]}, "Gravesite Plain"),
    # Nokron's Silver Tears turn into Mimic Tears, placed on top of them
    ("rename", {"area": "Nokron, Eternal City", "ids": [523680065]}, (r"^.*$", "Mimic Tear")),
    ("rename", {"area": "Nokron, Eternal City", "ids": [47701165, 47700165]}, "Valiant Gargoyle"),
    # (its one Troll, near Night's Sacred Ground, is a Silver Tear's too, 16 m from it)
    ("rename", {"area": "Nokron, Eternal City", "ids": [46000065]}, (r"^.*$", "Mimic Tear (Troll)")),
    # Murkwater Cave's weakest Patches (523090110, friendly) isn't one of its two
    ("delete", {"area": "Murkwater Cave", "ids": [523090110]}),
    # Mt. Gelmir: its wheel-less Abductor Virgin is headless, one Putrid Corpse burns, and its
    # Altus Plateau-level (…30) rows are the Altus Plateau's
    ("rename", {"area": "Mt. Gelmir", "ids": [44701132]}, (r"^.*$", "Abductor Virgin (Headless)")),
    ("rename", {"area": "Mt. Gelmir", "ids": [36612132]}, (r"^.*$", "Burning Putrid Corpse")),
    ("move", {"area": "Mt. Gelmir", "ids": [
        43737030, 43736030, 43730030, 43734030,  # Leyndell Foot Soldier
        43130130, 43130030,  # Leyndell Soldier
        43401030,  # Mad Pumpkin Head
        40700030,  # Wolf
    ]}, "Altus Plateau"),
    # Mohgwyn Palace's Albinauric Frog has the same stats as its Albinaurics
    ("rename", {"area": "Mohgwyn Palace", "ids": [34700268]}, (r"^.*$", "Albinauric")),
    # The low-HP Gargoyles (base HP 260, part 16 shown) are broken statues
    ("rename", {"ids": [47702034, 47702066]}, (r"^.*$", "Broken Statue")),
    ("delete", {"area": "Leyndell, Royal Capital", "ids": [21310034]}),  # Defeated Morgott
    # Greyoll's Dragonbarrow's weaker Giant Dog is Caelid's
    ("move", {"area": "Greyoll's Dragonbarrow", "ids": [45500040]}, "Caelid"),
    # Gravesite Plain's weaker Man-Fly is the Abandoned Ailing Village's
    ("move", {"area": "Gravesite Plain", "ids": [59000080]}, "Abandoned Ailing Village"),
    # Friendly Shadow Commoners aren't fought
    ("delete", {"name_re": r"^Shadow Commoner", "friendly": True}),
    # Its Messmer Soldiers and Shadow Commoners differ only in HP, not by weapon or outfit; the strongest
    # Messmer Soldiers are Scadu Altus', and the strongest Shadow Commoner the Abandoned Ailing
    # Village's
    ("rename", {"area": "Gravesite Plain", "name_re": r"^Messmer Soldier"}, (r"^.*$", "Messmer Soldier")),
    ("move", {"area": "Gravesite Plain", "ids": [58300490, 58300290, 58300690, 58300390]}, "Scadu Altus"),
    ("rename", {"area": "Gravesite Plain", "name_re": r"^Shadow Commoner", "friendly": False}, (r"^.*$", "Shadow Commoner")),
    ("move", {"area": "Gravesite Plain", "ids": [52407080]}, "Abandoned Ailing Village"),
    # Its strongest Spirit Eel is Charo's Hidden Grave's (the same row)
    ("move", {"area": "Gravesite Plain", "ids": [51100184]}, "Charo's Hidden Grave"),
    # Foot of the Jagged Peak's Twinsword Giant Beast Skeleton is the same as the plain ones
    ("rename", {"area": "Foot of the Jagged Peak", "ids": [53604084]}, (r"^.*$", "Giant Beast Skeleton")),
    # The only Royal Revenant is Kingsrealm Ruins' boss; the others are Revenants.
    # Moonlight Altar's is in the Lunar Estate Ruins
    ("move", {"area": "Moonlight Altar", "name": "Royal Revenant"}, "Lunar Estate Ruins"),
    ("rename", {"name_re": r"^Royal Revenant$"}, "Revenant"),
    # Sections and areas
    ("set", {"name": "Night's Cavalry Horse"}, {"boss": True}),
    ("set", {"area": "Hallowhorn Grounds (Nokron)", "name": "Boar"}, {"neutral": True}),
    ("move", {"area": "Limgrave", "name": "Guardian Golem"}, "Stormhill"),
    ("region", {"area": "Highroad Cave"}, "Stormhill"),
    ("move", {"area": "Malefactor's Evergaol", "friendly": True}, "Liurnia of the Lakes"),
    ("move", {"area": "Caelid", "name_re": r"^Cleanrot Knight"}, "Swamp of Aeonia"),
    ("delete", {"area": "Redmane Castle", "friendly": True}),  # the festival's summons
    # Redmane Castle's Misbegotten Warrior fights beside the Crucible Knight
    ("set", {"area": "Redmane Castle", "name": "Misbegotten Warrior"}, {"sortName": "Crucible Knight [Boss] (Greatsword) 2"}),
    # Caelem Ruins' two Mad Pumpkin Heads (identical but for their weapons)
    ("split", {"area": "Caelem Ruins", "ids": [43400940]}, {
        43400940: "Mad Pumpkin Head [Boss] (Flail)", 43401940: "Mad Pumpkin Head [Boss] (Hammer)",
    }),
]

# Questions from the review: where entries are (area or None for anywhere, name, HP or None)
WHERE_IS = []

# Bosses are named "... [Boss]" in the spreadsheet, or drop a boss's runes (NpcParam isSoulGetByBoss,
# e.g. Rennala, whose name comes from the game's text). These are bosses with neither, by NpcParam ID,
# and characters with one that aren't bosses on their own, by name.
BOSS_NPC_PARAM_IDS = {
    49500050,  # Tibia Mariner, Mountaintops of the Giants
    56200084,  # Tibia Mariner, Charo's Hidden Grave
}
NOT_BOSS_NAMES = set()

# What a SpEffect's deleteCriteriaDamage (the damage that removes it) means, where known: the
# Abductor Virgins' 14300 (5 poise per hit) and 14302 (15 more), which lightning staggers in
# game. Unnamed in the Paramdex; 10 is only on 14302. Untested
POISE_DELETE_DAMAGE_TYPES = {1: "per hit", 10: "per lightning hit (untested)"}

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
        "Miquella's Haligtree",
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

# Maps that hold several regions, whose enemies are in the region (and an area of its name) of the
# nearest grace in the map: m12_02 is both Siofra River and Nokron, Eternal City (Siofra's
# Ancestral Followers and Dragonkin Soldier were under Nokron otherwise)
MAPS_SPLIT_BY_GRACE = {"m12_02"}

# Maps with no place name or grace of their own: (area name, region name)
# Areas and regions renamed from the game's map names
AREA_RENAMES = {"Elphael, Brace of the Haligtree": "Miquella's Haligtree"}

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
    # Every named grace's position, for describing where enemies are: overworld ones in meters
    # across the whole overworld by area, others in their map's own coordinates by (area, x, z)
    located_graces = defaultdict(list)
    for grace in graces:
        grace_name = place_names.get(grace["textId1"])
        if grace_name:
            area_no, gx_no, gz_no = grace["areaNo"], grace["gridXNo"], grace["gridZNo"]
            if area_no in (60, 61):
                located_graces[area_no].append(
                    (
                        (gx_no + TILE_ORIGIN) * TILE_SIZE + grace["posX"],
                        grace["posY"],
                        (gz_no + TILE_ORIGIN) * TILE_SIZE + grace["posZ"],
                        grace_name,
                    )
                )
            else:
                located_graces[(area_no, gx_no, gz_no)].append(
                    (grace["posX"], grace["posY"], grace["posZ"], grace_name)
                )
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

        if map_name[:6] in MAPS_SPLIT_BY_GRACE and position:
            px, py, pz = position
            candidates = located_graces[(area, x, z)]
            if candidates:
                grace = min(
                    candidates,
                    key=lambda g: (g[0] - px) ** 2 + ((g[1] - py) * HEIGHT_WEIGHT) ** 2 + (g[2] - pz) ** 2,
                )
                region = grace_regions_by_name.get(grace[3])
                if region:
                    return region, region

        regions = map_graces.get((area, x), [])
        name = place_names.get(area * 1000 + x * 10)
        if not name:
            name = regions[0][1] if regions and regions[0][1] else map_name[:6]
        if regions:
            return name, regions[0][0]
        # Dungeons with no grace inside usually have one with the same name at the entrance
        return name, grace_regions_by_name.get(name, name)

    def locate(map_name, position):
        """
        @returns where a placement is relative to the nearest grace: (grace name, east, up, north
        offsets in meters, True since every map's +x is east and +z north (checked in game: the Church of
        Elleh's grace is a few degrees west of north of The First Step's, and the Tree Sentinel a few
        degrees east; the other maps' match the game's compass too), or None if no grace shares its
        map
        """
        if position is None:
            return None
        map_name = MAP_ALIASES.get(map_name[:6], map_name[:6]) + map_name[6:]
        area, x, z, version = (int(part) for part in map_name[1:].split("_"))
        px, py, pz = position
        if area in (60, 61):
            size = TILE_SIZE * 2 ** (version % 10)
            wx, wz = (x + TILE_ORIGIN) * size + px, (z + TILE_ORIGIN) * size + pz
            candidates, compass = located_graces[area], True
        else:
            wx, wz = px, pz
            candidates, compass = located_graces[(area, x, z)], True
        if not candidates:
            return None
        gx, gy, gz, grace_name = min(
            candidates, key=lambda g: (g[0] - wx) ** 2 + ((g[1] - py) * 2) ** 2 + (g[2] - wz) ** 2
        )
        return grace_name, round(wx - gx, 1), round(py - gy, 1), round(wz - gz, 1), compass

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
        if row["id"] // 10000 in (5450, 6060):
            return "Ram" if RAM_ID.fullmatch(str(row["id"])) else "Sheep"
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
        other_rate = 1
        for field, effect_id in row.items():
            effect = sp_effects.get(effect_id) if field.lower().startswith("speffectid") else None
            if field != "spEffectID3" and effect and effect["effectEndurance"] == -1:
                other_rate *= effect["maxHpRate"]
        hp_rate = area_rate("maxHpRate") * other_rate
        # In NG+, its NG+ scaling effect (GameClearSpEffectID) multiplies its HP too: its multipliers
        # get smaller the more its area scales, bringing every area to about the same (e.g. ×1.141 ×
        # 3.122 = 3.56 in Limgrave, ×2.406 × 1.523 = 3.66 for a later area's). Untested; for the enemy
        # locations list only. Enemies without one aren't scaled.
        ng_plus_effect = sp_effects.get(row["GameClearSpEffectID"]) if row["GameClearSpEffectID"] > 0 else None
        ng_plus_rate = hp_rate * (ng_plus_effect["maxHpRate"] if ng_plus_effect else 1)

        if chara_init is None:
            defense = [round(row[field] * area_rate(rate), 1) for field, rate in DEFENSES]
            negation = [round((1 - row[field]) * 100, 1) for field in NEGATIONS]
            hp = round(row["hp"] * hp_rate)
            ng_plus_hp = round(row["hp"] * ng_plus_rate)
            return defense, negation, hp, ng_plus_hp

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

        base_hp = int(evaluate_graph(graphs[VIGOR_HP_GRAPH], chara_init["baseVit"]))
        hp = round(base_hp * hp_rate)
        ng_plus_hp = round(base_hp * ng_plus_rate)
        return defense, negation, hp, ng_plus_hp

    def get_poise(row):
        """
        @returns an enemy's poise damage multiplier (SpEffectParam saReceiveDamageRate) from its
        permanent SpEffects (e.g. 0.2 for ancient dragons, SpEffect 14857), and a note on how its
        poise differs otherwise: a multiplier only on some body parts (applyPartsGroup, e.g. the
        Giant Crayfish's 0.5), or none from attacks with a fixed amount per hit instead (an effect
        removed by damage, deleteCriteriaDamage, that replaces itself with one that takes poise,
        changeSaPoint: the Abductor Virgins'). Effects that apply to no one (every effectTarget off,
        e.g. the Basilisk Eyes', applied by its scripts) are left out.
        """
        rate = 1
        part_rates = []
        per_hit = []
        for field, effect_id in row.items():
            effect = sp_effects.get(effect_id) if field.lower().startswith("speffectid") else None
            if not effect or effect["effectEndurance"] != -1 or effect["saReceiveDamageRate"] == 1:
                continue
            if not any(effect[f"effectTarget{target}"] for target in ("Self", "Friend", "Enemy", "Player", "AI")):
                continue
            if effect["deleteCriteriaDamage"]:
                replacement = sp_effects.get(effect["replaceSpEffectId"])
                per_hit.append((effect["deleteCriteriaDamage"], replacement["changeSaPoint"] if replacement else 0))
                rate *= effect["saReceiveDamageRate"]
            elif effect["applyPartsGroup"]:
                part_rates.append(effect["saReceiveDamageRate"])
            else:
                rate *= effect["saReceiveDamageRate"]
        notes = []
        if part_rates:
            notes.append(f"Takes {min(part_rates):g}× poise damage on some body parts (others normal)")
        if per_hit:
            amounts = ", plus ".join(
                f"{points:g} {POISE_DELETE_DAMAGE_TYPES.get(kind, f'per damage type {kind} hit')}"
                for kind, points in sorted(per_hit)
            )
            notes.append(
                f"Attacks do no poise damage; each hit takes a fixed amount instead: {amounts} "
                f"({row['superArmorDurability']:g} poise)"
            )
        return round(rate, 3), " ".join(notes)

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
    placements_by_enemy = defaultdict(list)
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
            area_name, region = AREA_RENAMES.get(area_name, area_name), AREA_RENAMES.get(region, region)
            location = locate(placement["map"], position)
            if location and location[0] in GRACE_AREA_OVERRIDES.get(area_name, {}):
                area_name = GRACE_AREA_OVERRIDES[area_name][location[0]]
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
            if row["id"] in EXCLUDED_NPC_PARAM_IDS or EXCLUDED_NPC_PARAM_ID.fullmatch(str(row["id"])):
                continue
            # Summons (white ghosts, e.g. Sorceress Sellen's 533160124) aren't fought
            if row["teamType"] == SUMMON_TEAM_TYPE:
                continue

            chara_init = chara_inits.get(int(placement["charaInitId"])) if model == "c0000" else None
            defense, negation, hp, ng_plus_hp = get_stats(row, chara_init)
            area = areas.setdefault(area_name, {"name": area_name, "region": region, "enemies": {}})
            # Merge identical enemies, e.g. the same enemy placed several times
            friendly = row["teamType"] in FRIENDLY_TEAM_TYPES
            types = [enemy_type for field, enemy_type in ENEMY_TYPES.items() if row[field]]
            # Which parts of its model it shows (NpcParam modelDispMask0-31: e.g. an outfit or a weapon),
            # so rows that look different stay apart, e.g. the Academy's Glintstone
            # Sorcerers' two outfits
            appearance = tuple(i for i in range(32) if row[f"modelDispMask{i}"])
            poise = get_poise(row)
            weak_part_rate = (
                row["weakPartsDamageRate"]
                if row["partsDamageType"] == 1 and row["weakPartsDamageRate"] >= WEAK_PART_NOTE_MIN_RATE
                else 1
            )
            key = (name, tuple(defense), tuple(negation), hp, friendly, tuple(types), appearance, poise, weak_part_rate)
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
                    # (for the enemy locations list only, not output)
                    **({"ngPlusHp": ng_plus_hp} if ng_plus_hp else {}),
                    "appearance": appearance,
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
                    **({"poiseDamageRate": poise[0]} if poise[0] != 1 else {}),
                    **({"poiseNote": poise[1]} if poise[1] else {}),
                    **({"weakPartDamageRate": round(weak_part_rate, 2)} if weak_part_rate != 1 else {}),
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
            # (for the enemy locations list only, not output)
            enemy.setdefault("parts", {})[row["id"]] = list(appearance)
            # (for labels by character build, not output)
            if chara_init is not None and int(placement["charaInitId"]) not in enemy.setdefault("charaInits", []):
                enemy["charaInits"].append(int(placement["charaInitId"]))
            # Where it's placed (not output), for identifying enemies that share a name
            placements_by_enemy[id(enemy)].append((placement["map"], location, row["id"]))
            if not friendly:
                area_effect = sp_effects.get(row["spEffectID3"])
                region_scaling[region].append(area_effect["maxHpRate"] if area_effect else 1)
                region_dlc[region] += placement["map"].startswith(DLC_MAP_PREFIXES)

    # Merge entries that differ only in their names, and identify those that share a name (see
    # enemy_curation.py), listing those identified only by the nearest grace
    def enemy_category(enemy):
        return next((c for c in ["friendly", "boss", "neutral"] if enemy.get(c)), "enemy")

    def is_dlc(enemy):
        return any(
            map_name.startswith(DLC_MAP_PREFIXES) for map_name, _, _ in placements_by_enemy[id(enemy)]
        )

    def crossbow_labels(area_name, enemies):
        """@returns labels for an area's foot soldiers: "Crossbow" for crossbow rows, see CROSSBOW_ID"""
        crossbows = {
            without_boss_tag(enemy["name"])
            for enemy in enemies.values()
            if any(CROSSBOW_ID.fullmatch(str(i)) for i in enemy["npcParamIds"])
        }
        return {
            (area_name, i): "Crossbow" if CROSSBOW_ID.fullmatch(str(i)) else ""
            for enemy in enemies.values()
            if without_boss_tag(enemy["name"]) in crossbows
            for i in enemy["npcParamIds"]
        }

    # Rows with a crystal shell, and its damage taken multipliers (strike isn't reduced: it breaks it)
    shell = sp_effects[CRYSTAL_SHELL_SPEFFECT]
    shell_rates = [shell[field] for field in NEGATIONS]
    shelled_ids = {
        row["id"]
        for row in npc_params.values()
        if any(
            field.lower().startswith("speffectid") and value == CRYSTAL_SHELL_SPEFFECT
            for field, value in row.items()
        )
    }

    def add_shattered(enemies):
        """Lists each of an area's entries with a crystal shell whole, and shattered, in place"""
        for key, enemy in list(enemies.items()):
            if not shelled_ids & set(enemy["npcParamIds"]):
                continue
            enemies[(key, "shattered")] = {**enemy, "name": with_identifier(enemy["name"], "Shattered")}
            enemy["negation"] = [
                round(100 - (100 - negation) * rate, 1) for negation, rate in zip(enemy["negation"], shell_rates)
            ]

    apply_edits(areas, placements_by_enemy, ENEMY_EDITS, is_dlc)
    unresolved = []
    for area in areas.values():
        merge_identical(area["enemies"], placements_by_enemy)
        labels = {**crossbow_labels(area["name"], area["enemies"]), **ENEMY_LABELS}
        identify(area["name"], area["enemies"], placements_by_enemy, labels, unresolved)
        add_shattered(area["enemies"])
        drop_unneeded_identifiers(area["enemies"], PLACE_IDENTIFIERS)
        # (by section: the picker lists friendly characters, bosses, etc. separately)
        names = Counter(
            (enemy_category(enemy), enemy["name"]) for enemy in area["enemies"].values()
        )
        for (_, name), count in names.items():
            if count > 1:
                print(f"Warning: {count} entries named {name} in {area['name']}")
    locations_path = os.path.join(project_dir, "data", "enemy-locations.md")
    with open(locations_path, "w", encoding="utf-8") as f:
        f.write(report(unresolved, placements_by_enemy))
        if WHERE_IS:
            f.write(where_is(areas, placements_by_enemy, WHERE_IS))
    print(f"{len(unresolved)} entries to identify -> {locations_path}")

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
                        key=lambda e: (
                            CATEGORY_ORDER.index(enemy_category(e)),
                            e.get("sortName", e["name"]),
                            e["hp"],
                        ),
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
    # Sort names are only for ordering
    for area in output["areas"]:
        for enemy in area["enemies"]:
            enemy.pop("sortName", None)
            enemy.pop("separate", None)
            enemy.pop("ngPlusHp", None)
            enemy.pop("appearance", None)
            enemy.pop("parts", None)
            enemy.pop("labeled", None)
            enemy.pop("charaInits", None)
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
