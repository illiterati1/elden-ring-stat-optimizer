"""
Build public/ashes.json: Ashes of War, which weapons can take them, weapons' built-in skills, and
each skill's hits.

Usage:
  python3 -I scripts/build_ash_data.py <ELDEN RING Game dir>

Inputs:
  - data/EquipParamGem-, SwordArtsParam-, EquipParamWeapon-, AttackElementCorrectParam-, and
    Bullet-vanilla.csv, decoded with extract_param.py
  - <Game>/msg/engus/item-msgbnd-dcx and item_dlc02-msgbnd-dcx (GemName, ArtsName, WeaponName),
    unpacked with WitchyBND
  - data/sheets/mv/AshesOfWarAttackData.csv: the motion value sheet's "Ashes of War Attack Data" tab
    (gid=362983777), the only source linking skills to their hits (the game does it in animations)

The sheet's hit names are "[Weapon Class] Skill Name <rest>", or skill hits of unique weapons with
the weapon in the "Unique Skill Weapon" column. The rest says which hit it is:
  - nothing, "[n]" (one of several hits), " - Part" (e.g. " - Bullet"), or "(Qualifier)": a hit of
    the main attack
  - "R1", "R2", "#2", "Charged", "1h R2 #1", ...: a follow-up, shown separately ("Early Release",
    which just does fewer of the skill's hits, is left out)
  - "(Lacking FP)" and "(Far)" (an alternative of another hit): left out
A bracketed prefix that isn't a weapon class is a version of the skill (e.g. "[Var1] Spinning Slash",
"[Slow] Double Slash", "[Luster Tier 1] Euporia Vortex"), shown like a follow-up, labeled with it.
Hits with "Tick" in the name are damage over time; projectile ticks have their interval
(Bullet dmgHitRecordLifeTime).

Output format:
  {
    "ashes": [{ "name": skill, "mounts": [weapon types], "affinities": [affinity IDs] }, ...],
    "weapons": { name: { "skill": skill, "canChange": bool, "types": [physical type, 2nd type],
                         "skillRange": which of skills' animations it uses (get_skill_range) } },
    "skills": { skill: { "generic": hits, "classes": { weapon type: hits }, "unique": { weapon: hits },
                         "weaponBuff": true if it puts its own weapon buff on the weapon } }
  }
where hits is { "main": [hit, ...], "followUps": [{ "label", "hands"?: "1h"/"2h", "hits" }],
"timing"?: each part's timing by weapon animation range (see get_skill_timing) } (main
is empty for skills that only do damage with follow-ups, e.g. stances like Unsheathe), and
each hit is like build_moveset_data.py's: [motion value, status motion value, poise motion value,
physical type, details], except physical type 4 and 5 are the weapon's own first and second types.
Details can also have "fixed": true for flat attack not added to the weapon's base attack (assumed
unscaled), "tickInterval" in seconds, "tickDuration" in seconds (for lingering status), "poise" for flat poise damage, and "buff" for a weapon buff's
flat attack by damage type (unscaled, times "buffMotionValue" if it isn't 100). "status" and
"scaledStatus" are status buildup the hit applies through its own effects, by AttackPowerType, not
scaled by its status motion value: "status" as is, "scaledStatus" with the weapon's status correction
(e.g. Arcane for blood loss).
"""

import copy
import csv
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import (  # noqa: E402
    PHYSICAL_TYPES,
    UNIQUE_FLAT_ATTACK_FIELDS,
    UNIQUE_MOTION_VALUE_FIELDS,
    WEAPON_ATTRIBUTE_TYPES,
    number,
    read_attack_element_correct,
    read_weapons,
)
from extract_fmg import read_fmg  # noqa: E402
from game_attacks import get_motion_values  # noqa: E402

# EquipParamGem canMountWep_* flags, by weapon type (EquipParamWeapon wepType). SpearLarge and
# Sorcery aren't used.
MOUNT_FIELDS = {
    "Dagger": 1,
    "SwordNormal": 3,
    "SwordLarge": 5,
    "SwordGigantic": 7,
    "SaberNormal": 9,
    "SaberLarge": 11,
    "katana": 13,
    "SwordDoubleEdge": 14,
    "SwordPierce": 15,
    "RapierHeavy": 16,
    "AxeNormal": 17,
    "AxeLarge": 19,
    "HammerNormal": 21,
    "HammerLarge": 23,
    "Flail": 24,
    "SpearNormal": 25,
    "SpearHeavy": 28,
    "SpearAxe": 29,
    "Sickle": 31,
    "Knuckle": 35,
    "Claw": 37,
    "Whip": 39,
    "AxhammerLarge": 41,
    "BowSmall": 50,
    "BowNormal": 51,
    "BowLarge": 53,
    "ClossBow": 55,
    "Ballista": 56,
    "Staff": 57,
    "Talisman": 61,
    "ShieldSmall": 65,
    "ShieldNormal": 67,
    "ShieldLarge": 69,
    "Torch": 87,
    "HandToHand": 88,
    "PerfumeBottle": 89,
    "ThrustingShield": 90,
    "ThrowingWeapon": 91,
    "ReverseHandSword": 92,
    "LightGreatsword": 93,
    "GreatKatana": 94,
    "BeastClaw": 95,
}

# The sheet's weapon class names, by weapon type
CLASS_TYPES = {
    "Dagger": 1,
    "Straight Sword": 3,
    "Greatsword": 5,
    "Colossal Sword": 7,
    "Curved Sword": 9,
    "Curved Greatsword": 11,
    "Katana": 13,
    "Twinblade": 14,
    "Thrusting Sword": 15,
    "Heavy Thrusting Sword": 16,
    "Axe": 17,
    "Greataxe": 19,
    "Hammer": 21,
    "Great Hammer": 23,
    "Flail": 24,
    "Spear": 25,
    "Great Spear": 28,
    "Halberd": 29,
    "Reaper": 31,
    "Fist": 35,
    "Claw": 37,
    "Whip": 39,
    "Colossal Weapon": 41,
    "Light Bow": 50,
    "Bow": 51,
    "Greatbow": 53,
    "Crossbow": 55,
    "Ballista": 56,
    "Glintstone Staff": 57,
    "Sacred Seal": 61,
    "Small Shield": 65,
    "Medium Shield": 67,
    "Greatshield": 69,
    "Torch": 87,
    "Hand-to-Hand": 88,
    "Perfume Bottle": 89,
    "Thrusting Shield": 90,
    "Throwing Blade": 91,
    "Backhand Blade": 92,
    "Light Greatsword": 93,
    "Great Katana": 94,
    "Beast Claw": 95,
}

AFFINITY_COUNT = 24

# Skills with a held stance, whose follow-ups are stance attacks (a made-up attack subcategory, for
# Rellana's Cameo). Going by their animations (chr/c0000.anibnd.dcx, read with extract_tae.py): the
# stance hold (a{600 + SwordArtsParam swordArtsTypeNew}_040050-040052) applies the Cameo's stance
# SpEffects (20382201, 20382205), and the attacks out of it (040060-040075) end it (20382206).
# Transient Moonlight's hold is Unsheathe's.
STANCE_SKILLS = {
    "Unsheathe",
    "Square Off",
    "Transient Moonlight",
    "Night-and-Flame Stance",
    "Muleta",
    "Overhead Stance",
    "Wing Stance",
    "Moon-and-Fire Stance",
}
STANCE_ATTACK_CATEGORY = 1000

# Physical types relative to the weapon (AtkParam atkAttribute 253 and 252)
WEAPON_TYPE = 4
WEAPON_TYPE_2 = 5

ASH_PREFIX = "Ash of War: "

# Weapon buffs skills put on the weapon for their own weapon hits (and after), by SpEffectParam, which
# the params don't link to the skill (its animation applies it), tested in game: Sacred Blade's 90
# holy for 40 seconds, added to the hit's holy attack before defenses (Longsword +25 slash 306,
# Sacred Longsword +25 slash 355), and Flame Skewer's and Flame Spear's 95 fire (Longsword +25:
# Flame Skewer's thrust 822, 797 without; Flame Spear's uncharged thrust 395, 370 without), and
# Flaming Strike's 90 fire (Longsword +25 R2 966, 944 without), and Lightning Slash's 85 lightning
# (Longsword +25 slash 921, 902 without). A (skill, weapon) key is the weapon's unique version's: the
# Dragon Halberd's Spinning Slash (its own animation, a766) puts 160 lightning on it for 45 seconds,
# and the Ornamental Straight Sword's Golden Tempering 100 holy for 60 seconds, for its R2s, and the
# Sword of St. Trina's Mists of Slumber 20 sleep a hit (1884) for 30 seconds, and the Velvet Sword of
# St. Trina's Mists of Eternal Sleep 15 (20001034), and the Dark Moon Greatsword's Moonlight
# Greatsword 65 magic for 60 seconds, for its R2s, and Helphen's Steeple's Ruinous Ghostflame 110
# magic and 80 frost a hit (1809) for 60 seconds, and the Spirit Sword's and Spirit Glaive's Rancor
# Slash 20 magic while each step's animation plays (renewed by its event, 0.25 seconds after it ends:
# 2.3 seconds for #1, 1.17 for #2, covering its hits and spirits; tested in game on the Spirit Sword +10 with 99
# in every stat: its spirit projectiles 995 for all 5, then 1142 with #1's slashes and 2042 with #2),
# and the Dragonscale Blade's Ice Lightning Sword the Dragon Halberd's 160 lightning and 80 frost
# (tested in game at +10 with 99 in every stat: about 148 frost, its slash's own 70 and the buff's;
# 1792 damage, its slash and projectile right, its stomp lightning 167, 161 here, not yet explained),
# and the Stormhawk Axe's Thunderstorm 120 lightning for 40 seconds (1511), which its lightning
# strikes get 150% of (tested in game at +25 on the training dummy: #1's strikes 443, 482, and 545
# with 99 in every stat, 883 for the three at 20 Strength and 15 Dexterity), and the Serpent Flail's
# Flare, O Serpent 90 fire for 30 seconds (20000852, renewed by 20000851), on its R2s and their fire
# (tested in game at +10 with 99 in every stat: the R2 1465, its swing 915 at its sweet spot and its
# explosion 550)
SKILL_BUFFS = {
    "Sacred Blade": 821,
    "Chilling Mist": 826,
    "Poisonous Mist": 831,
    "Flame Skewer": 20000891,
    "Flame Spear": 20000961,
    "Flaming Strike": 1776,
    "Lightning Slash": 1676,
    ("Spinning Slash", "Dragon Halberd"): 1891,
    ("Golden Tempering", "Ornamental Straight Sword"): 1716,
    ("Mists of Slumber", "Sword of St. Trina"): 1881,
    ("Mists of Eternal Sleep", "Velvet Sword of St. Trina"): 20001031,
    ("Moonlight Greatsword", "Dark Moon Greatsword"): 1721,
    ("Ruinous Ghostflame", "Helphen's Steeple"): 1806,
    ("Rancor Slash", "Spirit Sword"): 20000871,
    ("Rancor Slash", "Spirit Glaive"): 20000871,
    ("Ice Lightning Sword", "Dragonscale Blade"): 1891,
    ("Thunderstorm", "Stormhawk Axe"): 1511,
    ("Flare, O Serpent", "Serpent Flail"): 20000852,
}

# Skills' own weapon buffs' status buildup a hit (before its status motion value), by AttackPowerType,
# where the game applies less than the buff's effect says: the Dragon Halberd's Spinning Slash buff
# applies 1894's 80 frost, but its first hit does 45 (tested in game, at most 45: 70 at its 65% status
# motion value, like 6703's 70 frost), then about 35 more and about 49
SKILL_BUFF_STATUS = {("Spinning Slash", "Dragon Halberd"): {8: 70}}

# Projectiles whose own effects' status doesn't apply in game, by AtkId: Rancor Slash's spirits
# (Bullet 107800's 30 frost; tested in game on the Spirit Sword: none), and Mohgwyn's Sacred Spear's
# Bloodboon Ritual's ticks (SpEffect 1625's 60 blood loss; tested in game at +25 with 99 in every stat:
# 36 for the first tick and about 115 for #1's 3, 40% of the weapon's 94.6 each)
NO_STATUS_ROWS = {"700000033", "700000043", *(f"3017119{row}" for row in ["05", "06", "15", "16", "25", "26"])}

# Skills that use another skill's follow-ups (its weapon class versions, for some hands), which the
# sheet doesn't list for them: Braggart's Roar's buffed R2s are War Cry's two handed ones (AtkParam
# 3xxx0098x), going by their animations in game; one handed R2s are unchanged
BORROWED_FOLLOW_UPS = {"Braggart's Roar": ("War Cry", "2h")}

# Follow-ups whose poise-only ticks are one hit in game, and its total poise damage, tested in game:
# War Cry's charged R2s' running charge does 3 poise in #1 (two tick rows of 1 each) and 2 in #2
# (one tick row)
MERGED_TICKS = {"War Cry": {"Charged R2 #1": 3, "Charged R2 #2": 2}}

# Skills whose main attack is only some of its hits, by kind, for damage and poise. Tested in game:
# Beast's Roar's bullet and its AoE don't both hit (Quality Longsword +25 with 99 in every stat:
# bullet 542, AoE 363, sometimes 457 between them), and it's mostly ranged, so the roar's poise
# doesn't count either
# Golden Slam and Ground Slam hit once, close or far (Golden Slam on a Greatsword +25 with 99 in every
# stat: the tush 1584 close, the shockwave 1132 further away), so only the close hit counts, and so
# does the Staff of the Avatar's and Rotten Staff's Erdtree Slam (tested in game on a Rotten Staff +10
# with 99 in every stat: the tush 1441 with 36 poise, or the shockwave 1169; its "?" row doesn't hit).
# Lifesteal Fist's grab doesn't do damage itself once it lands, only the confirmed grab's hits: 5,
# like in game (Iron Ball +25 with 99 in every stat: 281, 281, 281, then 682 for the last two, 1525
# in total). Their damage doesn't match the sheet's rows yet: 281 is the grab row's motion value
# (73) with physical alone, and 341 matches no row.
MAIN_HIT_KINDS = {
    "Beast's Roar": {"Bullet"},
    "Erdtree Slam": {"Tush"},
    "Golden Slam": {"Tush"},
    "Ground Slam": {"Tush"},
    "Lifesteal Fist": {"Confirmed Grab"},
}

# Skills whose sheet rows are alternative versions of one hit rather than several hits, with how many
# main hits to keep. Blind Spot's animations (a876) each hit once, 40080-40082 with AtkParam
# 600000180 and 40083 with 600000181 (tested in game: one hit, 813 on a Backhand Blade +25 with 99 in
# every stat).
# Lightning Ram's two rows are a ram and the next one, which can be chained indefinitely, so only one
# counts (tested in game: one hit of 551 on a Longsword +25 with 99 in every stat).
MAIN_HIT_COUNTS = {"Blind Spot": 1, "Lightning Ram": 1}

# Skills charged to repeat hits, split into a follow-up for each charge, with how many of each kind
# of main hit it does. Tested in game: Black Flame Tornado does its finisher alone when tapped, and at
# most 5 loops before it when fully charged.
CHARGE_VARIANTS = {
    "Black Flame Tornado": {
        "Tap": [("Final Hit Bullet", 1)],
        "Fully charged": [("Loop Bullet", 5), ("Final Hit Bullet", 1)],
    }
}

# Skills whose follow-up comes after either version of the main attack, as uncharged and charged
# chains of the main attack then it (like Carian Sovereignty's; an empty label is the skill's name):
# the Glintstone Kris's Glintstone Dart, its dart (charged or not) then its R2, and the Falx's
# Revenger's Blade, its slash (charged or not) then its follow-up R2, which the sheet calls "R1"
# (tested in game at +25 with 99 in every stat on the training dummy: damage, poise, and status)
SHARED_FOLLOW_UPS = {
    "Glintstone Dart": ("R2", "Charged", ["Uncharged", "Charged"]),
    "Revenger's Blade": ("R1", "Charged", ["", "Charged"]),
}

# Skills whose main attack is one version of several, shown with its label: Shield Crash's hits are
# its full charge (tested in game on a Blood Brass Shield +25); an empty label is the skill's name:
# Euporia's Euporia Vortex, whose Luster Tier 1 and 2 versions are separate (tested in game at +25 with
# 99 in every stat: 2040, 2530 with Luster Tier 1, 6921 and 61 poise with Tier 2)
MAIN_LABELS = {"Shield Crash": "Fully charged", "Euporia Vortex": "", "Spinning Guillotine": ""}

# Skills whose main attack is part of each of its follow-ups, which are versions of the skill: the
# Gazing Finger's Kowtower's Resentment's first swing, then a second swing and its projectile,
# released early (uncharged) or not (tested in game at +10 with 99 in every stat: uncharged 2091,
# 653, 510, and 928; charged 2724, 653, 722, and 1349; each 22.5 poise)
MAIN_IN_VERSIONS = {"Kowtower's Resentment"}

# Hits whose own effects' status buildup also gets their status motion value, by AtkId: the Rivers
# of Blood's Corpse Piler's slashes (6400 and 6401's blood loss; tested in game at +10 with 99 in
# every stat: the first slash about 77, its own 49 and 6400's 45 × its 62% rate × its 62% status
# motion value × the weapon's 1.593 correction, 94 without the motion value), and Eleonora's
# Poleblade's Bloodblade Dance's (tested in game at +25 with 99 in every stat: about 350 for #1). Not
# general: Blood Blade, Bloody Slash, Chilling Mist, and others are right without it.
OWN_STATUS_MOTION_ROWS = {
    "303400300",
    "303400301",
    "303400302",
    "303400303",
    "303400304",
    "303400305",
    "301005900",
    "301005901",
    "301005902",
    "301005903",
    "301005904",
    "301005906",
    "301005920",
    "301005921",
}

# Hits counted as separate hits rather than damage over time, though their name says lava etc.: the
# Magma Wyrm's Scalesword's Magma Guillotine's lava (counted 5 times, ROW_REPEATS)
HIT_ROWS = {"300729002"}

# What hits are called where the sheet's name for them is misleading, by AtkId: the Royal Greatsword's
# Wolf's Assault's "bullet" is the explosion when it lands
ROW_KINDS = {
    "300406910": "Explosion",
    "302404901": "Ground Fire",
    "300000591": "Ground Fire",
    "302305905": "Roar",
    "302305908": "Shockwave",
    "301217905": "Explosion",
    "301217910": "Projectile",
    "700000421": "Ground Fire",
    "301302900": "Large Skull",
    "301302902": "Medium Skull",
    "301302903": "Medium Skull",
    "301302904": "Small Skull",
    "301302905": "Small Skull",
}

# Hits shown but not counted in the total, by AtkId: the Forked-Tongue Hatchet's Dragonform Flame's
# ground fire only burns where the stream hits the ground (tested in game at +25 with 99 in every
# stat: its other numbers right), and so does the Steel-Wire Torch's Firebreather's (tested in game),
# and St. Trina's Torch's Fires of Slumber's (its sleep)
NOT_COUNTED_ROWS = {"700000421", "302003902", "302003906", "300000591", "302404901"}

# Hits left out of the hits and total but whose damage is shown in the skill's note, by AtkId: the
# Greatsword of Radahn (Lord)'s Promised Consort's small light projectiles (tested in game on the
# training dummy: only #3's last, big projectile hit it), and Surge of Faith's random small projectiles
# (tested in game: 336 each), and Vyke's War Spear's Frenzyflame Thrust's thrust, which hits point blank
# instead of its explosion (tested in game at +25 with 99 in every stat: 1469 point blank, its thrust 519
# and 5 ticks of 190; 1909 from a slight distance, its explosion 959 and the ticks)
UNCOUNTED_ROWS = {"700000120", "301217910", "301705900", "302106903"}

# Hits whose flat attack doesn't scale with the weapon's upgrade level or stats though the sheet says
# it's added to the weapon's attack (isAddBaseAtk), by AtkId: Carian Retaliation's swords, the only
# skill bullets fired by a shared behavior (BehaviorParam_PC 2140, from the parry) rather than the
# weapon's. Tested in game: 185 a hit on a Beast Crest Heater Shield +25 with 99 in every stat,
# which is the unscaled 270 magic.
FIXED_FLAT_ROWS = {"300000682", "300000683"}


# How many times hits count, by AtkId, if not once: Carian Retaliation fires 3 swords (Bullet 2652
# numShoot), and the bullet each one spawns on hitting (300000683) doesn't hit again (tested in game:
# 3 hits, 555 in total). Glintblade Phalanx fires 4 glintblades (Bullet 2300 numShoot; tested in
# game on a Longsword +25: 812, 203 each). Other bullets that fire several don't all hit one target,
# e.g. Divine Beast Frost Stomp's ice spikes (numShoot 4, one hit in game).
# Golden Land's wave (Bullet 2797: 82 holy, can hit every 0.2s for 2s) hits a target up to 4 times
# as it passes (seen in game on a Greatsword +25: 367 each, at most 1468).
# Prelate's Charge on one press: the initial attack, the charge hit twice (3832, at the end of the
# start and at the start of the end animation) and its last hit (3833) once, and the final attack;
# the explosion (30000831) doesn't hit, and the dummy burns 5 times (198 each) in all, so the fire
# patches dropped while charging (30000836) don't add to the first one's (tested in game on Great
# Stars: 937 before the final attack, 1507 after it, 2299 when the fire runs out).
# Rolling Sparks fires 6 sparks (600000031: Bullet 200003030 and 200003031-35 for the Firespark
# Perfume Bottle), and only the first spawns the explosion; the sparks re-hit every 0.5s and the
# first keeps spawning ones that explode, so big targets take more (tested in game on a Firespark
# Perfume Bottle +25: 461 to 886, the explosion 407 and a spark 9, so 1 explosion and 6 sparks up to
# 2 and 8).
# Storm Assault's jump and landing whirlwinds (300000461 and 300000462, the same) hit one or the other
# (tested in game on a Bloody Spear +25), so only one counts. Troll's Roar's inner and outer roars
# (300000850, 300000854) hit one or the other (tested in game on Great Stars +25), so only the inner
# one counts, and so do its R2's direct hit and shockwave (300000852, 300000853: 1226 or 506), so
# only the direct hit counts; its "Ground Impact?" (300000851) wasn't seen to hit at all.
# Wall of Sparks sprays sparks (600000022, 9 each on a Firespark Perfume Bottle +25) that each spawn an
# explosion on hitting (600000020, 245; the other set's, 600000021, 165, wasn't seen to hit): tested in
# game, 245, 490, 735, or 989 in all (1 to 4 explosions, and the odd spark), so 1 explosion counts.
# Waves of Darkness's waves (30000812) are three expanding rings (Bullet 2811, 2814, and 2817), each
# hitting (tested in game on Great Stars +25: 822, 352, then 590 three times, 2944 in all).
# Night-and-Flame Stance's R2 fire bursts (300214925, 300214926, the same) hit one or the other
# (tested in game on the Sword of Night and Flame +10: 2595, the swing 719 and the fire 1876). Its R1
# beam's loops hit as often as the sheet's names say (300214907 "Loop 2x", 300214906 "Loop 4x"): the
# R1 does 3175 in all (the swing 650, the point blank burst 195, 321 six times, and the final 404),
# 2330 for the beam alone, and 2525 with the burst. Its "Loop 5x" (300214905) only does poise damage,
# 3 times going by its 49.5 poise in all in game (25 for the swing and burst with it, 24.5 the beam).
# The Sword of Light's Light fires 16 bolts (8 at once, then 8 more; Bullet 200002410 and 200002415,
# bursting into 200002411 with 600000880), of which only some reach a target: at most 5 in game on the
# training dummy (298 each, 1490; 4 most often, 1192), and 5 on Magma Wyrm Makar (920 at most, about
# 185 a bolt) though many more beams reached him, so 5 count. Leda's Sword's Needle Piercer fires 10
# needles (600000501, "10x" in the sheet), all of which can hit (tested in game: 157 each, 1570 in all
# with 11 poise). The Golden Order Greatsword's Establish Order's second step does one of its three
# holy hits (300317906, or the bullets 300317910 and 300317911, all the same), a bullet going by the
# game: tested in game, 977 then 531 and 1466, 2974 in all. The Sacred Relic Sword's Wave of Gold
# hits once, though the sheet has four wave rows (300310905 to 300310908; tested in game: 1483). The
# 1364 rows (300310906 and 300310908) are what it does at range instead (seen in game). The Alabaster
# Lord's Sword's Alabaster Lords' Pull hits with one of its three rings, the outer one (303400707,
# with 20 poise; tested in game on the training dummy: 1726 and 25.5 poise, the thrust 706 and 5.5).
# The Onyx Lord's Greatsword's Onyx Lords' Repulsion likewise hits with one, counted as the outer
# (303400807, with 20 poise; tested in game at +10 with 99 in every stat: damage and poise).
# Eleonora's Poleblade's Bloodblade Dance's second slash (301005905) doesn't land (tested in game at
# +25 with 99 in every stat: 1949 for #1). The Rivers of Blood's Corpse Piler's slashes hit with either the blade or its blood extension, not
# both, so the extensions (303400320-325) are left out (tested in game). The Magma Wyrm's Scalesword's Magma Guillotine's explosion (300729001) doesn't add to its slash's
# damage, and its lava (300729002: Bullet 2862, spreading into 6 pools, 2863) hits 5 times (tested in
# game at +25 with 99 in every stat on the training dummy: 1566 for the slash, 2526 with the lava's 5
# hits of 192, 4841 with #2's 650 and 1665). The Horned Warrior's Greatsword's Horn Calling: Storm's slashes each fire a wind projectile, but
# only the first one hits, and only point blank, so none are counted (tested in game at +25
# with 99 in every stat on the training dummy: 1919 for #1, its slashes and one 131, 3741 with #2's
# slashes, 5597 with #3's). The Wing of Astel's Nebula fires 11 projectiles (Bullet 2770, 10 at once, and 2771), each exploding
# into 300707902: 4 hit a human-sized enemy (tested in game: 703 and 13 poise each, at +25 with 99 in
# every stat), more a bigger one (noted). The Spirit Sword's and Spirit Glaive's Rancor Slash fires 2 spirits with its slashes (700000033,
# 700000043; see CHAIN_SHARED_KINDS). The Magma Blade's Magma Shower's magma pool (303400507: Bullet 2981, isEndlessHit) hits 4 times
# in its first step at most (see CHAIN_SHARED_KINDS). The Family Heads' Familial Rancor spawns 1 large
# skull (301302900), 2 medium (301302902-903), and 4 small (301302904-905) (tested in game at +25 with
# 99 in every stat: 1417 and 19.8 poise). The Envoy's Horn's Oracular Bubble hits with its
# bubble or its burst, not both (the same damage), so the burst (301110901) is left out (tested in
# game), and so does the Envoy's Greathorn's Great Oracular Bubble (302306901 left out; tested in
# game). The Axe of Godrick's I Command Thee, Kneel!
# hits with the axe or its shockwave, not both, so the axe hits (301504900, 910, 920) are left out,
# the shockwaves doing more (tested in game at +25 with 99 in every stat: 1663 at most and 16.5 poise
# for #1, its shockwaves' 823 and 840; less point blank, noted). The Stormhawk Axe's Thunderstorm only hits with
# its lightning strikes, not its weapon rows (301414900-902, 915-916, 930-931; tested in game: 28.5
# poise for #1, its three strikes' 9.5). The Starscourge Greatsword's Starcaller Cry is a chain of two hits, one of each of its identical
# rows (300405900-904, then 300405910, 300405911, and its bullet 300405915), and the 300405920-921
# hits don't land (tested in game at +10 with 99 in every stat on the training dummy: 685 and 15
# poise, then 2461 and 10.2). Moonrithyll's Knight Sword's Tremendous Phalanx fires 3 of its swords (700000052; tested in game at
# +10 with 99 in every stat: 334 and 8 poise each, then its R2 1395 and 15). The Greatsword
# of Radahn (Lord)'s Promised Consort #3 swings its second slash once (700000106 is
# the same as 700000105; tested in game at +10 with 99 in every stat on the training dummy: 4135 and
# 52 poise for the whole chain, with only #3's last projectile hitting).

# How many times hits count, by the sheet's name, for rows whose AtkId other rows share: the
# Ornamental Straight Sword's fully charged Golden Tempering R2 thrusts 5 times with each hand before
# its final hits (tested in game with its 100 holy buff: 3282 and 50 poise in all on a +25 with 99
# in every stat, 200 a thrust and 641 a final hit; the R2 1048 with 10 poise), and the Dragon King's
# Cragblade's charged Thundercloud Form loops its lightning 6 times (tested in game at +10 with 99 in
# every stat: 2783 and 45 poise in all; uncharged, its once is right), and the Zamor Curved Sword's
# Zamor Ice Storm's "4x" projectile hits 4 times (tested in game at +25 with 99 in every stat: 2075,
# the swing's 385 and 5 projectile hits of 338). The Scepter of the All-Knowing's Knowledge Above All
# does no damage (tested in game); the sheet gives it Helphen's Steeple's Ruinous Ghostflame swing
# (303401400), which stays
NAME_REPEATS = {
    "Golden Tempering Charged R2 - 5x (Right)": 5,
    "Golden Tempering Charged R2 - 5x (Left)": 5,
    "Thundercloud Form Charged [1] - Loop 6x": 6,
    "Zamor Ice Storm - Bullet (4x)": 4,
    "Knowledge Above All": 0,
    # The Bloodfiend's Sacred Spear's Bloodfiends' Bloodboon is a chain whose bullets hit several times,
    # reportedly up to 4, 4, and 8; tested in game, 2 or 3 for #1 and #2, and at least 5 for #3 (176
    # damage, 3 poise, and 71 blood loss each at +25 with 99 in every stat)
    "Bloodfiends' Bloodboon #1 - Bullet": 4,
    "Bloodfiends' Bloodboon #2 - Bullet": 4,
    "Bloodfiends' Bloodboon #3 - Bullet": 8,
}

# Clouds skills' animations release with their hit (bullets with AtkParam 0, so a status motion value
# of 100: the weapon's own status as well as the cloud's), by the hit's AtkId and the cloud's
# SpEffect: the Sword of St. Trina's Mists of Slumber (behavior 300205900, Bullet 2720: 1885, 90
# sleep) and the Velvet Sword of St. Trina's Mists of Eternal Sleep (behavior 700000400, Bullet
# 200003250: 20001035, 70 sleep). Tested in game on the training dummy: Mists of Slumber about 241
# sleep at once (the swing's 66 and its buff's 20, the cloud's 90 and 66), Mists of Eternal Sleep's
# cloud 112 (70 and the sword's 42).
SKILL_CLOUDS = {"300208910": 1885, "700000401": 20001035}

# Effects skills put on the player that multiply their own hits' damage, by the hits' AtkIds, read
# from the effect's atkEnemyDmgCorrectRate fields: the Sword of Light's Light puts 20000980 on the
# player (×1.2 holy, "Dark" in the params) as it fires its bolts (tested in game: 298 a bolt on the
# training dummy, 248 without)
SKILL_DAMAGE_EFFECTS = {"600000880": 20000980}

# Hits that only do poise damage through their poise motion value (no attack or flat poise), kept
# rather than left out as doing nothing, by AtkId: Night-and-Flame Stance's R1 "Loop 5x", and the
# Death's Poker's Ghostflame Ignition thrust and R2 swing, which also apply the weapon's frost (tested
# in game: 1504, 15.5 poise and about 660 frost with its ticks and explosion; with the R2, 32 poise
# and about 860 frost), and the Greatsword of Solitude's Solitary Moon Slash R2's startup stagger, and
# the Ringed Finger's Claw Flick's first hit (13 poise, tested in game), and the Axe of Godfrey's Regal
# Roar's roar (3 poise, tested in game)
# Status motion values fitted to tests in game, by AtkId, where the data's don't match and the cause
# is unknown: the Red Bear's Claw's Red Bear Hunt's #1 and #2 swipes build up twice its 45 blood loss
# (tested in game at +25 with 99 in every stat: about 90 for #1 and 265 for the chain; its bullets,
# hitting alone, none). Its #3 swipes are as the data says (45 each). To do: test it in vanilla (tested
# in the Boss Arena mod, though its params for this are the same).
STATUS_MOTION_VALUE_FITS = {"600000640": 200, "600000642": 200}

# Rows that hit like another row in game, by AtkId, where the data's values don't match and the cause
# is unknown (the rest of each row, e.g. its name, is kept): Barbaric Roar's Fist and Hand-to-Hand
# two handed charged R2 #1's third hit does the same as its first (motion value 97 and its poise, not
# the data's 111 and 250), tested in game with the Roar Medallion at +25 with 99 in every stat: the
# Golem Fist 1875 with 27 poise (625 and 9 three times), the Iron Ball 1668 (556 three times), and
# Dryleaf Arts 1497 with 21.6 poise (499 and 7.2 three times). The Claw and Beast Claw versions, with
# the same values in the data, are right as the data says (tested on the Hookclaws and Beast Claw).
ROW_FITS = {"302100962": "302100960", "306300962": "306300960"}

# Skills' hits the sheet leaves out, as sheet rows (the rest of each copied from its first row): the
# Deadly Poison Perfume Bottle's Deadly Poison Spray, its 3 sprays (Bullet 200018920, numShoot 3) and
# what each becomes when it hits (200019305), each with 65% of the bottle's status (AtkParam_Pc 6150305
# and 6151305). They do no damage in game, though the rows have 59 motion values, only deadly poison
# (tested in game at +10 with 99 in every stat: a 273 resistance proc within a second, and 752 in about
# a second, more than these 6 hits' 442, probably from a cloud of it the data doesn't show).
_STATUS_ONLY = {
    **{field: "0" for field in ["Phys MV", "Magic MV", "Fire MV", "Ltng MV", "Holy MV", "Poise Dmg MV"]},
    **{field: "0" for field in ["AtkPhys", "AtkMag", "AtkFire", "AtkLtng", "AtkHoly", "AtkSuperArmor"]},
    "Status MV": "65",
    "Weapon Buff MV": "0",
    "PhysAtkAttribute": "Standard",
    "isAddBaseAtk": "FALSE",
    "overwriteAttackElementCorrectId": "-1",
    **{f"spEffectId{i}": "-1" for i in range(5)},
}
EXTRA_SHEET_ROWS = [
    {**_STATUS_ONLY, "Unique Skill Weapon": "Deadly Poison Perfume Bottle", "Name": "Deadly Poison Spray - Bullet", "AtkId": "6150305"},
    {**_STATUS_ONLY, "Unique Skill Weapon": "Deadly Poison Perfume Bottle", "Name": "Deadly Poison Spray - Bullet [Hit]", "AtkId": "6151305"},
]

POISE_ONLY_ROWS = {
    "300214905",
    "303401300",
    "303401302",
    "600000822",
    "301113900",
    "302305905",
    "6150305",
    "6151305",
    # St. Trina's Torch's Fires of Slumber, which only builds up sleep
    "302404900",
    "302404901",
}
ROW_REPEATS = {
    # Surge of Faith's rows no animation uses (901, 902, 925), its lacking FP version's (920-922,
    # 930), and its other small projectiles, the same as 910
    **{f"3012179{row}": 0 for row in ["01", "02", "11", "12", "13", "14", "20", "21", "22", "25", "30"]},
    # The Envoy's Long Horn's Bubble Shower's bubbles' later stages (Bullet 2690 becomes 2691, then
    # 2692), the same bubble, and how many of its bubbles usually hit a human-sized enemy (tested in
    # game: 1092, 6 of 182)
    "301216900": 6,
    # The Axe of Godfrey's Regal Roar's "?" row, which none of its animations use (40000 roars, then
    # slams: 905 and 906-908)
    "302305900": 0,
    # Devonia's Hammer's charged Devonia's Vortex's first projectile hits twice (tested in game at +10
    # with 99 in every stat: 3504 and 52.5 poise, two of its 535 and 7.5)
    "600000844": 2,
    # The Fallingstar Beast Jaw's Gravity Bolt fires one bolt a cast (its animations' bullet 3905;
    # 302308909, the same, isn't used): tested in game at +10 with 99 in every stat, 1054 and 7 poise
    "302308909": 0,
    # The Watchdog's Staff's Sorcery of the Crozier fires 8 bullets (Bullet 2920's numShoot, each
    # becoming 2923, 302301901; tested in game: 8 hits)
    "302301901": 8,
    # The Death Ritual Spear's Spearcall Ritual only hits with its spears (its animation 40000: Bullet
    # 2325 becomes 2326, which spawns one every 0.06-0.08s for 1s, each ending in 2330, 301612910, then
    # 2331, 911, the same spear); its thrust (900) isn't in its animation, and 915 is its lacking FP
    # version (tested in game: only 305 hits, at random)
    # The Barbed Staff-Spear's Jori's Inquisition only hits with its bullet (Bullet 200002390, out for
    # 2.3s in its animation 40000), 5 times; 600000851 is its lacking FP version (tested in game at +25
    # with 99 in every stat: 2300, 15 poise, and about 130 blood loss)
    "600000850": 5,
    # The Red Bear's Claw's Red Bear Hunt's bullets each hit twice (tested in game at +25 with 99 in
    # every stat: 1229 for #1, its swing's 743 and 2 of 243, and 3655 for the chain)
    "600000641": 2,
    "600000643": 2,
    "600000646": 2,
    # The Veteran's Prosthesis's Storm Kick's "(Left)" rows are its left handed version, the same, and
    # its [2] wind and its R2's [3] lightning don't hit (tested in game at +10 with 99 in every stat: #1
    # 1006 and 10 poise, #2 1506 and 25)
    **{f"3021129{row}": 0 for row in range(10, 15)},
    "302112901": 0,
    "302112904": 0,
    # St. Trina's Torch's Fires of Slumber's fire hits a target again every 0.4s (Bullet 2825's
    # dmgHitRecordLifeTime), 2.5 times as often as Firebreather's (1s), counted once on the same
    # stream: counted twice (seen in game: its numbers right, hitting more often than the others)
    "302404900": 2,
    "6150305": 3,
    "6151305": 3,
    # The Grafted Dragon's Bear Witness! hits directly with its fire ([2]) and its explosion (tested in
    # game at +25 with 99 in every stat: 1282 and 10 poise, 102 and 1180); its windup's weapon hit ([1],
    # 302106900, 238) only hits up close, with the fire twice (442), and its 18 projectiles (903-905:
    # Bullet 2388-2390's numShoot, 8, 6, and 4) and their lingering fire (906) land at random, so they're
    # noted
    "302106900": 0,
    "302106904": 0,
    "302106905": 0,
    "302106906": 0,
    # The Magma Whip Candlestick's Sea of Magma: its start (animation 40000: 302003900-901 and its magma,
    # 905), loops while held (40003: 902-903 and magma), and final (40004: 904 and magma); one of each
    # pair of lashes hits: the start's first (0 poise). Counted without loops (tested in game at +25
    # with 99 in every stat: 2195 and 8 poise, a lash's 451, the final's 715, and 3 magma ticks of 343,
    # sometimes 4, 2538; each loop 794 more, a lash and a tick, shown but not counted: 902 and 906, the
    # same magma)
    "302003901": 0,
    "302003903": 0,
    "302003905": 3,
    # The Poleblade of the Bud's Romina's Purification's bullet hits several times, varying (tested in
    # game at +25 with 99 in every stat: 1799 and about 160 scarlet rot, its slashes' 761 and 708 and 3
    # of its 110)
    "600000582": 3,
    # Siluria's Tree's charged Siluria's Woe hits with its bullet close or ranged, not both
    # (301702910 left out; tested in game at +25 with 99 in every stat: one 2225)
    "301702910": 0,
    # The Serpent-Hunter's Great-Serpent Hunt only hits with its two thrusts (301703950, 951); its "?"
    # rows don't (tested in game at +25 with 99 in every stat: 2075, then 2195)
    **{f"3017039{row}": 0 for row in ["00", "01", "05", "55", "75"]},
    # Mohgwyn's Sacred Spear's Bloodboon Ritual: each step's bullet ("Bullet 1" or "Bullet 2", the
    # same) ticks up to 4, 4, and 8 times (reportedly), its first with 100 fire and the rest 65, each
    # with 40%, 50%, and 60% of the status plus 60 blood loss; tested in game at +25 with 99 in every
    # stat: 1284 for #1 and #2 (592 and 2 of 346), and 3014 for #3 (592 and 7 of 346)
    "301711907": 0,
    "301711917": 0,
    "301711927": 0,
    "301711906": 3,
    "301711916": 3,
    "301711926": 7,
    "600000851": 0,
    "301612900": 0,
    "301612911": 0,
    "301612915": 0,
    # The Shadow Sunflower Blossom's Shadow Sunflower Headbutt hits with its head or the AoE around it,
    # not both (the same motion values; tested in game: one of each), so the AoE rows are left out
    **{f"60000098{row}": 0 for row in "1357"},
    # Ghiza's Wheel's Spinning Wheel: its opening (animation 40050) has 6 windows of 302309903, its
    # downswing, which only hits once (tested in game: 0.6 poise, then about 2 for the next hit, 901),
    # then 901 3 times and 900 4 times, then its loops while it's held: 40051 with 902 twice and 900 6
    # times, and 40052 with 902 twice and 900 8 times. All of them are counted (tested in game at +10
    # with 99 in every stat: 5044 for 26 hits of 194; poise 19.5, 20.4 here, and 6.9 after 7 hits, 7.8
    # here, as if one of the opening's 1.8 hits were 0.9)
    "302309903": 1,
    "302309901": 3,
    "302309900": 18,
    "302309902": 4,
    "301216901": 0,
    "301216902": 0,
    "300000682": 3,
    "300000683": 0,
    "300200867": 4,
    "30000554": 4,
    "30000831": 0,
    "300000832": 2,
    "30000836": 0,
    "600000031": 6,
    "300000462": 0,
    "300000854": 0,
    "300000851": 0,
    "300000853": 0,
    "600000020": 1,
    "600000021": 0,
    "600000022": 0,
    "30000812": 3,
    "300214926": 0,
    "300214907": 2,
    "300214906": 4,
    "300214905": 3,
    "600000880": 5,
    "600000501": 10,
    "300317906": 0,
    "300317911": 0,
    "300310906": 0,
    "300310907": 0,
    "300310908": 0,
    "303400705": 0,
    "303400706": 0,
    "303400805": 0,
    "303400806": 0,
    "700000106": 0,
    "700000052": 3,
    "303400507": 4,
    "700000033": 2,
    "300707902": 4,
    "700000373": 0,
    "300729001": 0,
    "301005905": 0,
    "303400320": 0,
    "303400321": 0,
    "303400322": 0,
    "303400323": 0,
    "303400324": 0,
    "303400325": 0,
    "300729002": 5,
    "700000374": 0,
    "700000381": 0,
    "700000382": 0,
    "700000387": 0,
    "700000388": 0,
    "700000043": 2,
    "301110901": 0,
    "302306901": 0,
    "301302901": 0,
    "301302904": 2,
    "301302905": 2,
    "301504900": 0,
    "301504910": 0,
    "301504920": 0,
    "301414900": 0,
    "301414901": 0,
    "301414902": 0,
    "301414915": 0,
    "301414916": 0,
    "301414930": 0,
    "301414931": 0,
    "300405901": 0,
    "300405902": 0,
    "300405903": 0,
    "300405904": 0,
    "300405911": 0,
    "300405915": 0,
    "300405920": 0,
    "300405921": 0,
}

# Notes shown with skills' results, e.g. where the hits counted are a guess at how many land; a
# (skill, follow-up) key is only shown with that follow-up
# Labels for fixed skills with one version, shown with their name: the Bloody Helice's Dynast's
# Finesse is its thrust then a follow-up R2 (tested in game at +25 with 99 in every stat on the
# training dummy: damage, poise, and blood loss), and the Eclipse Shotel's Death Flare is a
# follow-up (tested in game at +25 with 99 in every stat: damage and poise)
SKILL_LABELS = {
    "Dynast's Finesse": "Follow-up R2",
    "Death Flare": "Follow-up",
    "Dynastic Sickleplay": "R2 follow-up",
}

# Flat attack a weapon's own version of a skill's follow-up gets as if a weapon buff, by (skill,
# weapon, follow-up label), for its projectiles and its weapon hits, fitted to tests where the cause
# isn't known: Euporia's Euporia Vortex Luster Tier 1 gets 22 holy on its projectiles and 20 on its
# swings, and Tier 2 9 and 10, less than its luster buffs' 95 and 120 (tested in game at +25 on the
# training dummy, with 99 in every stat: Tier 1 2530, 2117 for its projectiles alone; Tier 2 6921,
# 5345 for its projectiles; and at 89 Strength and Dexterity and 25 Faith: Tier 1 1676, Tier 2 4416,
# all within 4). The skill counts as having its own weapon buff, so the luster buffs aren't added.
FOLLOW_UP_BUFFS = {
    ("Euporia Vortex", "Euporia", "Luster Tier 1"): ([0, 0, 0, 0, 22], [0, 0, 0, 0, 20]),
    ("Euporia Vortex", "Euporia", "Luster Tier 2"): ([0, 0, 0, 0, 9], [0, 0, 0, 0, 10]),
}

# Versions of a skill that are the same, merged into the first under a label naming both, by skill:
# the Serpent Flail's Flare, O Serpent's R2 and running R2 (the flail's running R2 is its R2)
MERGED_VERSIONS = {"Flare, O Serpent": [("R2", "Running R2")]}

# Notes for one weapon's own version of a skill, by (skill, weapon)
VERSION_NOTES = {
    ("Nebula", "Wing of Astel"): "Counts 4 of its 11 explosions, as many as hit a human-sized enemy: bigger ones can take more",
    # Tested in game at +10 with 99 in every stat: its numbers right
    ("Nebula", "Bastard's Stars"): "Counts one hit of its projectile, which can hit several times",
}

SKILL_NOTES = {
    "Rolling Sparks": "Counts a single explosion: bigger enemies can take more, and more sparks",
    "Spectral Lance": "The lance aims for the head, so headshots will likely make it do more in practice",
    "Wall of Sparks": "Counts a single explosion: it can do up to four, and some sparks",
    ("Moon-and-Fire Stance", "R2"): "Counts one hit of its flame pillars, which can hit several times",
    # Its light beams (Bullet 200003100 and 200003105) strike at random for a second, each one hitting
    # up to twice: tested in game on the Greatsword of Radahn (Light) +10 with 99 in every stat, up to
    # 1917 uncharged, and 2374 charged (the swing 1147, five 231 beams and a 72)
    "Lightspeed Slash": "Counts one hit of each of its light beams, which land at random and can hit many times",
    # {damage} is an uncounted hit's damage (UNCOUNTED_ROWS)
    "Promised Consort": "Doesn't count its small light projectiles, which may miss: {damage} damage each",
    # Each explosion fires 36 (Bullet 2371-2374's numShoot, 3 or 4 a volley, 10 volleys in its
    # animations); tested in game: at least 10 hit the training dummy
    # Tested in game: 182 damage and 1.9 poise each, usually 6 hitting a human-sized enemy, and at most
    # 17 on Dragonlord Placidusax (some of its bubbles are only for show)
    "Bubble Shower": "Counts the 6 bubbles that usually hit a human-sized enemy: bigger enemies can take more",
    "Surge of Faith": "Doesn't count its 36 small projectiles an explosion, which fly at random: {damage} damage each",
    # Tested in game on the Dancing Blade of Ranah +25 with 99 in every stat: right, varying with how
    # long the skill is held
    "Bloodboon Ritual": "Counts its bullets' most ticks, 4, 4, and 8: in practice they hit less",
    "Bloodfiends' Bloodboon": "Counts its bullets' most hits, 4, 4, and 8: in practice they hit less",
    "Frenzyflame Thrust": "Counts its explosion from a slight distance: point blank, its thrust hits instead ({damage})",
    "Romina's Purification": "Counts 3 hits of its bullet, which can hit more or fewer times",
    "Sea of Magma": "Counts it without looping: each loop while held adds the lash and magma tick in parentheses, and the magma can tick once more",
    "Bear Witness!": "Counts its fire and explosion: up close its windup's weapon hit and more fire can hit too, and its 18 projectiles land at random ({damage} each), leaving patches of fire",
    "Deadly Poison Spray": "Does no damage, only deadly poison: counts its sprays' 6 hits, but it keeps building up for about a second, much more in all",
    "Fires of Slumber": "Only builds up sleep: counts 2 hits of its fire, which can hit more often over the stream",
    "Spearcall Ritual": "Counts one of its spears: about 14 fall at random, and how many hit depends on the target",
    "Erdtree Slam": "Counts its slam close up: further away, only its weaker shockwave hits",
    "Spinning Wheel": "Counts its downswing, 7 opening spins, and its two loops of 8 and 10: it keeps looping while the skill is held",
    "Unending Dance": "Counts its opening slash and one cycle of its 12 looping slashes, which keep cycling while the skill is held and can stop early",
    "I Command Thee, Kneel!": "Counts its shockwaves: point blank, its axe hits instead and it does less",
    "Destined Death": "Counts its swings' Destined Death after the projectiles lower the enemy's max HP: it can do a little more if they hit later",
}

# Attack subcategories (AtkParam subCategory1-4) the game doesn't go by, by AtkId: Swift Slash's
# second slashes (600000079, and 600000074 charged) are skill attacks (112, 111) but don't get skill
# buffs (tested in game on a Blood Backhand Blade +25 with 99 in every stat: charged 602 then 965,
# with the Godfrey Icon 692 then 965, and with it and the Shard of Alexander 1760 in all; uncharged
# 518 then 712, 1308 with the Shard), so they're counted as neither. Nor are Lightspeed Slash's
# light beams (700000071-072, and 700000076-077 charged; tested in game on the Greatsword of Radahn
# (Light) +10 with 99 in every stat. Charged with the Godfrey Icon: the swing 1319, then totals of
# 2012, 2243, 2315, and 2474, whole numbers of its unboosted 231 and 72 beams; with the Shard of
# Alexander, 2690. Uncharged: 1917 and 20 poise without talismans, the swing's 829 and 15 and five
# 206 beams (1 poise each) and a 58; with the Shard, 1835, the swing's 953 and unboosted beams)
# Lightning Slash's projectile (300000371) is neither a skill (112) nor a Dragon Cult skill (133) in
# game, though the data says it's both. Tested on a Lightning Longsword +25 with 99 in every stat:
# with the Death Knight set (×1.08 for Dragon Cult skills), 1836 in all, the stomp and slash boosted
# (137 and 1061) and the projectile not (638); with the Shard of Alexander (×1.15 for skills), 1913,
# the same (146, 1129, and 638).
ROW_CATEGORIES = {
    "300000371": [],
    "600000074": [],
    "600000079": [],
    "700000071": [],
    "700000072": [],
    "700000076": [],
    "700000077": [],
}

# Skills whose spawned status bullets don't add to their buildup: Hoarfrost Stomp's lingering frost
# (70) doesn't when the shatter hits too (tested in game on a Longsword +25: 180 frost, the ice
# spikes' 70 and the shatter's 110; it may apply when the shatter misses), nor the Zamor Curved
# Sword's Zamor Ice Storm's lingering frost (80; tested in game at +25 with 99 in every stat: about
# 770 frost, the swing's 65 and its 5 projectile hits' 145)
NO_SPAWNED_STATUS = {"Hoarfrost Stomp", "Zamor Ice Storm"}

# Skills whose bracketed versions are the skill for weapon classes the sheet doesn't list, by the
# version to use (others are left out): Spinning Slash's [Var1] and [Var2] have the same motion values
DEFAULT_VERSIONS = {"Spinning Slash": "Var1"}

# Weapons' skills the sheet lists under another name: the Claws of Night's Scattershot (Claws), its
# version of Scattershot Throw
SKILL_SHEET_NAMES = {"Scattershot (Claws)": "Scattershot Throw"}

# Follow-ups left out, by label
DROPPED_FOLLOW_UPS = {"Early Release"}

# Hits the sheet labels wrongly, by AtkId, with their follow-up's label (None for the main attack):
# Hoarah Loux's Earthshaker's second slam is a follow-up (a chain, like Earthshaker), and Scattershot
# Throw's "#2" daggers are thrown with "#1"'s (tested in game on a Blood Smithscript Dagger +25: 960
# a throw, 240 for each of the 4 daggers), and the Starscourge Greatsword's Starcaller Cry's second
# hit is its second step, and the Putrescence Cleaver's Spinning Guillotine's follow-ups are separate
# versions (see MAIN_LABELS), its L2 one repeatable (tested in game at +25 with 99 in every stat),
# and the Golden Order Flail's Causality's Wrath's three levels are separate versions
ROW_FOLLOW_UPS = {
    # The Obsidian Lamina's Dynastic Sickleplay is a chain, which the sheet calls its "R2 #1" and "#2"
    "600000711": None,
    "600000712": "#2",
    "600000713": "#2",
    "600000714": "#2",
    # The Gazing Finger's Kowtower's Resentment's second swing and projectile, released early or not
    # (its animations 40001 and 40000; see MAIN_IN_VERSIONS)
    "600000963": "Uncharged",
    "600000964": "Uncharged",
    "600000961": "Charged",
    "600000962": "Charged",
    "300000881": "#2",
    "700000251": "chainable L2 follow-up",
    "700000252": "chainable L2 follow-up",
    "700000253": "chainable L2 follow-up",
    "700000254": "R2 follow-up",
    "700000255": "R2 follow-up",
    "700000256": "R2 follow-up",
    "305000120": "Tier 1",
    "305000110": "Tier 2",
    "305000100": "Tier 3",
    "300405910": "#2",
    "600000122": None,
    "600000123": None,
    "600001002": None,
    "600001003": None,
}

# Hits listed first, by kind, for skills whose sheet rows aren't in the order they happen: Hoarah Loux's
# Earthshaker roars before it slams
HIT_ORDER = {"Hoarah Loux's Earthshaker": ["Initial Roar", "Roar Tick"]}

# Skills whose charged versions are alternatives to the uncharged one rather than follow-ups, as
# levels: the main attack and its charged follow-ups, in order, are shown as these instead (with no
# main attack, like a stance). Tested in game: Carian Grandeur's levels are one hit each (Longsword
# +25, 99 in every stat: level 2 1620 with 30 poise, level 3 2058 with 45), and Carian Greatsword's
# charged version. Skills whose only follow-up is "Charged" get CHARGED_LEVELS.
CHARGE_LEVELS = {"Carian Grandeur": ["Level 1", "Level 2", "Level 3"]}
CHARGED_LEVELS = ["Uncharged", "Charged"]

# Skills whose follow-ups continue the main attack, chosen as chains like War Cry's R2s
# (src/app/useAshes.ts chainSkills): the main attack and its "#n" follow-ups (or the follow-ups
# listed, in order) become the chain "<name> #n" ("#n" for an unnamed one), beside any others
# (Carian Sovereignty's "Charged #n"). Tested in game with 99 in every stat: on a Longsword +25,
# Carian Sovereignty uncharged 1620 then 1620, charged 2282 (821 of it the projectile) then 2058;
# Double Slash 962 (2 hits), then 1380 (3 hits), then 763; Flame Skewer 822, then its R2 638 (1460
# in total); Flaming Strike 656, then its R2 966 (1622 in total); Glintblade Phalanx's glintblades
# 812, then its R2 848; Glintstone Pebble's pebble 691, then its R2 948; on a Great Mace +25, Earthshaker
# 1484 then its R2 887; on a Spear +25, Phantom Slash 905 and 671, then 931 and 701; on the Beast
# Claw +10, Raging Beast 679, then its R2 299 and 759; on Great Stars +25, Savage Lion's Claw 1328, then
# its follow-up 413 and 1055; on a Blood Smithscript Dagger +25, Scattershot Throw 960 a throw (it can be
# chain thrown, but one throw is counted, like other skills recast the same); on a
# Blood Sword Lance +25, Spinning Gravity Thrust 144 ×4 and 693, then 144 ×3 and 761; on the Ancient
# Meteoric Ore Greatsword +10, White Light Charge's swing 736, then its projectile 1713.
MAIN_CHAINS = {
    "Carian Sovereignty": ("Uncharged", None),
    "Double Slash": ("", None),
    "Earthshaker": ("", ["R2"]),
    "Flame Skewer": ("", ["R2"]),
    "Flaming Strike": ("", ["R2"]),
    "Glintblade Phalanx": ("", ["R2"]),
    "Glintstone Pebble": ("", ["R2"]),
    "Golden Land": ("", ["R2"]),
    "Hoarah Loux's Earthshaker": ("", None),
    "Phantom Slash": ("", None),
    "Raging Beast": ("", ["R2"]),
    "Savage Lion's Claw": ("", None),
    "Spinning Gravity Thrust": ("", None),
    "Spinning Slash": ("", None),
    "Storm Blade": ("", None),
    "Stormcaller": ("", None),
    "Sword Dance": ("", None),
    "Troll's Roar": ("", ["R2"]),
    "Waves of Darkness": ("", ["R2"]),
    "Establish Order": ("", None),
    "Golden Crux": ("", None),
    "Solitary Moon Slash": ("", ["R2"]),
    "White Light Charge": ("", None),
    "The Queen's Black Flame": ("", None),
    "Promised Consort": ("", None),
    "Tremendous Phalanx": ("", ["R2"]),
    "Starcaller Cry": ("", None),
    "Magma Shower": ("", None),
    "Rancor Slash": ("", None),
    "Bloodhound's Finesse": ("", ["R2"]),
    "Horn Calling: Storm": ("", None),
    "Magma Guillotine": ("", None),
    "Cursed-Blood Slice": ("", None),
    "Deadly Dance": ("", None),
    "Waterfowl Dance": ("", None),
    "Corpse Piler": ("", None),
    "Onze's Line of Stars": ("", None),
    "Bloodblade Dance": ("", None),
    "Blinkbolt: Twinaxe": ("", ["R2"]),
    "Thunderstorm": ("", None),
    "I Command Thee, Kneel!": ("", None),
    "Blinkbolt: Long-hafted Axe": ("", ["R2"]),
    "Shield Strike": ("", None),
    "Surge of Faith": ("", None),
    "Shadow Sunflower Headbutt": ("", None),
    "Bloodboon Ritual": ("", None),
    "Great-Serpent Hunt": ("", None),
    "Messmer's Assault": ("", None),
    "Bloodfiends' Bloodboon": ("", None),
    "Dynastic Sickleplay": ("", None),
    "Storm Kick": ("", ["R2"]),
    "Red Bear Hunt": ("", None),
}

# Skills whose main attack's hits of a kind are a version of their own, by label: the Greatsword of
# Damnation's Golden Crux grabs NPCs ("Grab Confirm"; tested in game on Gideon Ofnir: 1810) rather than
# thrusting then firing its bullet (tested in game on the training dummy: 1137, then 1386)
KIND_VERSIONS = {"Golden Crux": ("Grab Confirm", "NPC")}

# Chain steps that are another follow-up, by label: Leontiel's Greatsword's Muleta charged R2 is followed
# by the same second R2 as its R2 (tested in game)
COPIED_STEPS = {"Muleta": {"Charged R2 #2": "R2 #2"}}

# Follow-ups that are one attack in game, merged by label (for each of the second ones' hands), and
# the rest left out: the Dark Moon Greatsword's Moonlight Greatsword R2s are a swing and its
# projectile (tested in game: R2 1282, charged R2 1834 with the Godfrey Icon), as R2 and charged R2
# chains of two
MERGED_FOLLOW_UPS = {
    "Moonlight Greatsword": {
        "R2 #1": ("R2", "R2 #1"),
        "R2 #2": ("R2", "R2 #2"),
        "Charged R2 #1": ("Charged R2", "Charged R2 #1"),
        "Charged R2 #2": ("Charged R2", "Charged R2 #2"),
    }
}

# Chains that repeat the main attack, by how many steps, e.g. throwing again, or (count, kind) to
# repeat only its hits of a kind: the Cranial Vessel Candlestand's Surge of Faith repeats its
# explosion but not its slam (its animations: 40000 slams then explodes, 40010 explodes again).
# Tested in game at +10 with 99 in every stat: the slam 13, the explosion 1647
CHAIN_REPEATS = {"Surge of Faith": (2, "Explosion")}

# Chains whose every step has the first step's hits of a kind, which the sheet lists once, and how
# many of them later steps have (None for as many as the first): each of Storm Blade's slashes fires
# its projectile (tested in game on a Bloody Longsword +25: 1152 for the second, 1159 for the third,
# then it loops over those two), and Magma Shower's magma pool keeps hitting through its follow-up
# (tested in game on the Magma Blade +25 with 99 in every stat: at most 1119 for #1, its slash and 4
# magma hits, and 3239 with #2, its slashes and 8 more), and Rancor Slash's follow-up fires 3 of its
# spirits (a{600 + 365}.tae: #1's animation fires 2, #2's 3; tested in game on the Spirit Sword +10
# with 99 in every stat: 995 for all 5, and 1142 for #1)
CHAIN_SHARED_KINDS = {
    "Storm Blade": ("Bullet", None),
    "Magma Shower": ("Bullet", 8),
    "Rancor Slash": ("Bullet", 3),
}

# Chains whose steps hit with either their weapon hits or their hits of a kind, not both, as a second
# chain of those hits with its label: each of Stormcaller's swings hits with the weapon or its
# whirlwind (seen in game), so it's a chain of swings and an "AoE only" chain of whirlwinds
CHAIN_SPLIT_KINDS = {"Stormcaller": ("Bullet", "AoE only")}

# Skills that do more to targets with a status, as two versions, by the effect their hit applies to
# such targets (a percentage of max HP plus flat damage) and the versions' labels: Poison Moth
# Flight's hit applies 1620, which only takes effect on a poisoned target and then applies 1621, 5%
# of its max HP plus 250 (tested in game: 706, and 4666 on the poisoned training dummy, 74212 HP). The Poison Flower Blooms Twice's kick
# applies 20000860, which on a poisoned or rotted target applies 20000861 (5% of its max HP plus 250)
# in place of its 160 scarlet rot (20000862), so that version doesn't build up rot (the user's
# estimate in game: about 5025 on the training dummy). Seen in game, though: on a target that's only
# poisoned it still builds up rot, so this is right for a rotted target. Thiollier's Hidden Needle's
# Sleep Evermore applies 20001040 (and 20001044, the same under another condition), which on a sleeping
# target applies 20001041, 6.5% of its max HP plus 300 (tested in game at +25 with 99 in every stat:
# its hit right, and the bonus on a sleeping target).
CONDITIONAL_HP_DAMAGE = {
    "Sleep Evermore": (20001041, "Sleeping bonus", ["Awake target", "Sleeping target"], False),
    "Poison Moth Flight": (1621, "Poisoned bonus", ["Unpoisoned target", "Poisoned target"], False),
    "The Poison Flower Blooms Twice": (
        20000861,
        "Poisoned/rotted bonus",
        ["Unafflicted target", "Poisoned or rotted target"],
        True,
    ),
}

# Projectile SpEffects that do a percentage of the enemy's max HP over time (changeHpRate percent plus
# changeHpPoint every motionInterval seconds for effectEndurance seconds, including when applied), by
# name. Tested in game: Black Flame Tornado's black flame (835) does 21 ticks of 0.1% of the training
# dummy's 74212 HP plus 1, rounded down (75), finishing before the next loop reapplies it. The Black
# Knife's Blade of Death applies Destined Death (6845, 0.045% plus 4 every 0.1s for 5s), with 6865
# lowering the target's max HP to 90% (maxHpRate), which the percentage is of: 34 a tick on the
# training dummy, 51 ticks (tested in game: 1090 for the projectile and first tick, then 2916 in all
# with the Sacred Scorpion Charm, its ×1.12 holy making the projectile 1182). The Gargoyle's
# Blackblade's Corpse Wax Cutter applies 860 (0.1% plus 1 every 0.1s for 2s, no max HP change: 21
# ticks of 75, tested in game: 3062 in all), and Maliketh's Black Blade's Destined Death 6850 (the
# same with 6865's lowered max HP). Attack rows' effects count too: the Godslayer's Greatsword's The
# Queen's Black Flame swings apply 855, the same as 835 (tested in game: 1575 of black flame after
# each), and Maliketh's Black Blade's Destined Death swings 860. Each hit's effect counts in full.
HP_DAMAGE_EFFECTS = {835: "Black flame", 855: "Black flame", 860: "Destined Death", 6845: "Destined Death", 6850: "Destined Death"}

# Max HP multipliers for hits' percentage of max HP damage from other hits' effects, by AtkId:
# Maliketh's Black Blade's Destined Death projectiles (6865) lower the enemy's max HP to 90% soon
# after its swings apply 860, so most of their ticks are of the lowered max HP. Tested in game at
# +10 with 99 in every stat on the training dummy (74212 HP): 9509 to 9726, from every tick after
# the projectiles (9497: the hits' 2462, the swings' 2 × 21 ticks of 67, the projectiles' 3 × 21
# of 67) to about 28 of the swings' ticks of 75 before them
HP_DAMAGE_MAX_HP_RATES = {"300408900": 0.9, "300408901": 0.9}

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

# SpEffectParam flat attack fields, by AttackPowerType
BUFF_ATTACK_FIELDS = [
    "physicsAttackPower",
    "magicAttackPower",
    "fireAttackPower",
    "thunderAttackPower",
    "darkAttackPower",
]


def read_names(game_dir, name):
    names = {}
    msg_dir = os.path.join(game_dir, "msg", "engus")
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            path = os.path.join(msg_dir, folder, f"{name}{suffix}.fmg")
            if os.path.exists(path):
                names.update(read_fmg(path))
    return names


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def normalize(name):
    """Skill names without case or punctuation, e.g. "Onyx Lord's" and "Onyx Lords'" are the same"""
    return re.sub(r"[^a-z0-9 ]", "", name.lower())


def parse_hit(row, tick_bullets, hp_damage, attack_categories, hit_status):
    """@returns a hit in the output format, or None for a hit that does nothing"""
    motion_values = [number(row[field] or 0) for field in UNIQUE_MOTION_VALUE_FIELDS]
    flat = [number(row[field] or 0) for field in UNIQUE_FLAT_ATTACK_FIELDS]
    if (
        not any(motion_values)
        and not any(flat)
        and not float(row["AtkSuperArmor"] or 0)
        and row["AtkId"] not in hit_status
        and row["AtkId"] not in POISE_ONLY_ROWS
    ):
        return None
    attribute = row["PhysAtkAttribute"]
    physical_type = (
        WEAPON_TYPE
        if attribute == "253"
        else WEAPON_TYPE_2
        if attribute == "252"
        else PHYSICAL_TYPES.get(attribute.lower(), 0)
    )
    hit = [
        motion_values if len(set(motion_values)) > 1 else motion_values[0],
        STATUS_MOTION_VALUE_FITS.get(row["AtkId"], number(row["Status MV"] or 0)),
        number(row["Poise Dmg MV"] or 0),
        physical_type,
    ]
    details = {}
    name = row["Name"]
    kind = re.search(r" - ([A-Za-z][A-Za-z ]*?)(?: \[|\s*\(|$)", name)
    # The game doesn't add fixed flat attack (not isAddBaseAtk) to the weapon's own hits, only to
    # projectiles and the like. Tested in game at +10 with 99 in every stat: The Queen's Black Flame's
    # first swing (60 fire) does 606 on the Godslayer's Greatsword, 657 with it, and Lightspeed
    # Slash's swing (20 holy) 829 uncharged and 1147 charged on the Greatsword of Radahn (Light)
    fixed = row["isAddBaseAtk"] != "TRUE" or row["AtkId"] in FIXED_FLAT_ROWS
    if any(flat) and not (fixed and not kind):
        details["flat"] = flat
        if fixed:
            details["fixed"] = True
    if row["overwriteAttackElementCorrectId"] not in ("-1", ""):
        correct = read_attack_element_correct(PROJECT_DIR, row["overwriteAttackElementCorrectId"])
        # An empty one means no stat scaling at all (e.g. Kick's 50000: tested in game on a Longsword
        # +25 with 99 in every stat, 45 damage, its 30 flat physical times 4 for the upgrade level)
        if correct is not None:
            details["correct"] = correct
    if row["isDisableBothHandsAtkBonus"] == "TRUE":
        details["noTwoHandBonus"] = True
    if row["AtkId"] in UNCOUNTED_ROWS:
        details["uncounted"] = True
    if row["AtkId"] in NOT_COUNTED_ROWS:
        details["notCounted"] = True
    # Flat poise damage, for hits without a poise motion value (tested in game: Sacred Blade's
    # projectile does 13). A hit with both uses the motion value's alone if its flat attack is fixed:
    # the Dragon Halberd's Spinning Slash projectile (poise motion value 100, flat 10) does 5, its
    # weapon's base poise (tested in game: 31.75 for the whole chain, its weapon hits' 11.5, 3.75, and
    # 11.5). If it's added to the weapon's (isAddBaseAtk), both count: the Falx's charged Revenger's
    # Blade's second hit (poise motion value 100, flat 5) does 10 (tested in game: 15 with its first),
    # and the Zamor Curved Sword's Zamor Ice Storm's projectiles (100 and 2) 7.5 each (tested in game)
    if float(row["AtkSuperArmor"] or 0) and (
        not float(row["Poise Dmg MV"] or 0) or row["isAddBaseAtk"] == "TRUE"
    ):
        details["poise"] = number(row["AtkSuperArmor"])
    if row["AtkId"] in ROW_KINDS:
        details["kind"] = ROW_KINDS[row["AtkId"]]
    elif kind:
        details["kind"] = kind.group(1).strip()
    # An initial tick (e.g. Eruption's lava's, with more poise than the ticks after it) happens once,
    # so it's a hit rather than damage over time. Areas left on the ground hit again too, if their
    # bullet can (e.g. Ghostflame Call's R1's ground flame, 43 every 0.5s for 5s: tested in game, its
    # 10 ticks and the wave's 205 make 635 from a distance).
    tick_bullet = tick_bullets.get(row["AtkId"])
    is_area = re.search(r"\b(Ground|Lingering|Lava)\b", name) and tick_bullet and tick_bullet[1]
    if ("tick" in name.lower() or is_area) and "initial" not in name.lower() and row["AtkId"] not in HIT_ROWS:
        details["tick"] = True
        interval, duration = tick_bullets.get(row["AtkId"], (None, None))
        if interval:
            details["tickInterval"] = interval
        if duration:
            details["tickDuration"] = duration
    if row["AtkId"] in hp_damage:
        details["hpDamage"] = hp_damage[row["AtkId"]]
    # Attack subcategories, which some buffs only apply to (e.g. 112 Skill Attack)
    if attack_categories.get(row["AtkId"]):
        details["categories"] = attack_categories[row["AtkId"]]
    own_status = copy.deepcopy(hit_status.get(row["AtkId"], {}))
    if row["AtkId"] in OWN_STATUS_MOTION_ROWS:
        for status_type in own_status.get("scaledStatus", {}):
            own_status["scaledStatus"][status_type] *= number(row["Status MV"] or 0) / 100
    details.update(own_status)
    if details:
        hit.append(details)
    return hit


def add_spawned(hits, spawned):
    """Adds spawned bullets' hits to a list of hits, unless it already has them"""
    for hit in spawned:
        if hit not in hits:
            hits.append(copy.deepcopy(hit))


def parse_rest(rest):
    """
    @param rest a hit name after the skill name, e.g. " Charged 1h R2 #1 (Tick)"
    @returns the follow-up label (None for the main attack) and the hands it's for (or None)
    """
    rest = re.sub(r"\s*\[[^\]]*\]", "", rest)
    rest = re.sub(r"\s*\([^)]*\)", "", rest)
    # " - R1" is a follow-up; other " - Part"s are parts of the attack
    part = re.search(r" - (.*)$", rest)
    if part and re.fullmatch(r"R[12]", part.group(1).strip()):
        rest = part.group(1)
    else:
        rest = re.sub(r" - .*$", "", rest)
    rest = rest.strip().rstrip("?").strip()
    hands = re.search(r"\b([12]h)\b", rest)
    label = re.sub(r"\s*\b[12]h\b\s*", " ", rest).strip()
    if label in ("", "#1"):
        return None, hands and hands.group(1)
    return label, hands and hands.group(1)


# Skills' animations are in a{600 + SwordArtsParam swordArtsTypeNew}.tae (tested in game: Storm
# Blade, Sword Dance, Wild Strikes, and Ice Spear). Each part of a skill (its main attack, or a
# follow-up or chain step) is an animation from 40000 (chain steps 40010, 40020, ...), with "Lacking
# FP" versions 5 later (left out). Some weapon classes have their own, 100s apart: a weapon's
# wepmotionOneHandId times 100 (e.g. 40200 for greatswords, tested in game: a Claymore's Sword Dance;
# 40300 for spears), and twinblades' 42400 (a guess: Sword Dance's has the twinblade's rows), or else
# 40000's (e.g. Ice Spear on a Short Spear, tested in game).
SKILL_ANIMATION_FILE_BASE = 600
SKILL_ANIMATIONS = (40000, 45000)
LACKING_FP_ANIMATION = 5
TWINBLADE_TYPE = 14
TWINBLADE_SKILL_RANGE = 2400
# AtkParam flat attack fields, by damage type
FLAT_ATTACK_FIELDS = ["atkPhys", "atkMag", "atkFire", "atkThun", "atkDark"]


def get_skill_range(row):
    """@returns which of a skill's animation ranges a weapon uses (see SKILL_ANIMATION_FILE_BASE)"""
    if int(row["wepType"]) == TWINBLADE_TYPE:
        return TWINBLADE_SKILL_RANGE
    return int(row["wepmotionOneHandId"]) * 100


def hit_signature(motion_values, flat):
    """A hit's motion value (physical, or else the largest) and flat attack, for matching"""
    return (round(motion_values[0] or max(motion_values)), tuple(round(value) for value in flat))


def get_window_attacks(behaviors, bullets, attacks, variation, judge):
    """
    @returns the AtkParam_Pc rows an animation window's behavior does damage with: its attack, or
    for a projectile, its attack and the projectiles' it creates (on hitting, or at intervals),
    that have motion values or flat attack
    """
    prefix = max(1, judge // 1000)
    behavior = next(
        (
            behaviors[behavior_id]
            for source in dict.fromkeys([variation, variation // 100 * 100, 0])
            if (behavior_id := prefix * 100_000_000 + source * 1000 + judge % 1000) in behaviors
        ),
        None,
    )
    if not behavior:
        return []
    atk_ids = []
    if behavior["refType"] == "0":
        atk_ids.append(int(behavior["refId"]))
    elif behavior["refType"] == "1":
        pending = [int(behavior["refId"])]
        seen = set()
        while pending:
            bullet = bullets.get(pending.pop())
            if not bullet or int(bullet["id"]) in seen:
                continue
            seen.add(int(bullet["id"]))
            atk_ids.append(int(bullet["atkId_Bullet"]))
            pending += [int(bullet[field]) for field in ("HitBulletID", "intervalCreateBulletId") if int(bullet[field]) > 0]
    return [
        attacks[atk_id]
        for atk_id in atk_ids
        if atk_id in attacks
        and (any(get_motion_values(attacks[atk_id])) or any(float(attacks[atk_id][field]) for field in FLAT_ATTACK_FIELDS))
    ]


def get_skill_timing(steps, number, variation, hits, behaviors, bullets):
    """
    @param steps check_animations.py's Steps
    @param number the skill's animation file
    @param variation the weapon's behaviorVariationId for unique weapons' skills, or its class's for
    a class's version (0 for others)
    @param hits a version of the skill (main and followUps)
    @param behaviors BehaviorParam_PC rows, and bullets BulletParam rows, by ID
    @returns the version's timing, by weapon animation range (see get_skill_range; "0" is the
    default) and part ("" for the main attack, or the follow-up's label): each part's animation's
    hits, and when it can be cancelled into another skill ("L2"), "R1", "R2", any attack, a roll,
    or blocking, in seconds of real time (see Animations.to_real_time); a loop (a main attack of
    "Loop" hits, e.g. Wild Strikes') also has "loop", how long each pass takes, and "opening", how
    long until it starts. Each part's animation is the one whose hits (motion value and flat attack)
    match the most of its hits, in its range, or else in the default one.
    """
    animations = steps.animations
    file = animations.get_file(number)
    if not file:
        return None
    # Each animation's hits' signatures and when they start
    animation_hits = {}
    for anim_id in file[0]:
        if not SKILL_ANIMATIONS[0] <= anim_id < SKILL_ANIMATIONS[1] or anim_id % 10 >= LACKING_FP_ANIMATION:
            continue
        signatures = []
        starts = []
        for start, _, judge, *_ in animations.get_windows(number, anim_id) or []:
            # The weapon's (or its class's) own rows, or else the skill's general ones
            atks = get_window_attacks(behaviors, bullets, steps.game.attacks, variation, judge)
            for atk in atks:
                signatures.append(
                    hit_signature(get_motion_values(atk), [float(atk[field]) for field in FLAT_ATTACK_FIELDS])
                )
            if atks:
                starts.append(start)
        animation_hits[anim_id] = (signatures, sorted(starts))

    def range_of(anim_id):
        return anim_id // 100 * 100 - SKILL_ANIMATIONS[0]

    def part_timing(label, part_hits, skill_range):
        wanted = Counter(
            hit_signature(
                hit[0] if isinstance(hit[0], list) else [hit[0]],
                (hit[4].get("flat") if len(hit) > 4 else None) or [0] * 5,
            )
            for hit in part_hits
        )
        wanted.pop(hit_signature([0], [0] * 5), None)
        best = None
        for wanted_range in dict.fromkeys([skill_range, 0]):
            for anim_id, (signatures, _) in sorted(animation_hits.items()):
                if range_of(anim_id) != wanted_range:
                    continue
                score = sum((Counter(signatures) & wanted).values())
                if score and (best is None or score > best[0]):
                    best = (score, anim_id)
            if best:
                break
        if not best:
            return None
        anim_id = best[1]

        def real(time):
            return round(animations.to_real_time(number, anim_id, time), 3)

        starts = animation_hits[anim_id][1]
        timing = {"hits": [real(start) for start in starts]}
        cancels = animations.get_cancels(number, anim_id)
        for name in ["L2", "R1", "R2", "anyAttack", "roll", "block"]:
            if name in cancels:
                timing[name] = real(cancels[name])
        if any(len(hit) > 4 and hit[4].get("kind") == "Loop" for hit in part_hits) and len(starts) > 1:
            # Evenly spaced hits, looping: each pass is as many of their gaps as hits
            gaps = (real(starts[-1]) - real(starts[0])) / (len(starts) - 1)
            timing["loop"] = round(gaps * len(starts), 3)
            # Its opening: the animation before it without hits, until any attack can start (it
            # goes on to the loop then: tested in game, Wild Strikes' first hit)
            opening = [
                other
                for other, (signatures, _) in animation_hits.items()
                if not signatures and range_of(other) == range_of(anim_id) and other < anim_id
            ]
            opening_cancels = animations.get_cancels(number, max(opening)) if opening else {}
            if "anyAttack" in opening_cancels:
                timing["opening"] = round(
                    animations.to_real_time(number, max(opening), opening_cancels["anyAttack"]), 3
                )
        return timing

    parts = [("", hits["main"])] if hits["main"] else []
    parts += [(follow_up["label"], follow_up["hits"]) for follow_up in hits["followUps"]]
    ranges = sorted({range_of(anim_id) for anim_id in animation_hits})
    result = {}
    for skill_range in ranges:
        by_part = {}
        for label, part_hits in parts:
            timing = part_timing(label, part_hits, skill_range)
            if timing:
                by_part[label] = timing
        # Only ranges with their own timings
        if by_part and (skill_range == 0 or by_part != result.get("0")):
            result[str(skill_range)] = by_part
    return result


def main():
    global PROJECT_DIR
    game_dir = sys.argv[1]
    PROJECT_DIR = project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_dir, "data")

    gem_names = read_names(game_dir, "GemName")
    skill_names = read_names(game_dir, "ArtsName")
    weapons = read_weapons(game_dir, project_dir)

    # Skills without a name of their own use another's (SwordArtsParam textId), e.g. the Dragon
    # Halberd's Spinning Slash and Shield Strike's Ash of War
    sword_arts = read_csv(os.path.join(project_dir, "data", "SwordArtsParam-vanilla.csv"))
    skill_text_ids = {int(row["id"]): int(row["textId"]) for row in sword_arts}
    # Which file each skill's animations are in (see get_skill_timing)
    skill_animation_types = {int(row["id"]): int(row["swordArtsTypeNew"]) for row in sword_arts}
    # Each Ash of War's skill (SwordArtsParam) by its name
    ash_skill_ids = {}

    # Ashes of War
    ashes = []
    for gem in read_csv(os.path.join(data_dir, "EquipParamGem-vanilla.csv")):
        name = gem_names.get(int(gem["id"]))
        skill_id = int(gem["swordArtsParamId"])
        skill = skill_names.get(skill_id) or skill_names.get(skill_text_ids.get(skill_id))
        if not name or not name.startswith(ASH_PREFIX) or not skill:
            continue
        ash_skill_ids.setdefault(skill, skill_id)
        ashes.append(
            {
                "name": skill,
                "mounts": [t for field, t in MOUNT_FIELDS.items() if gem[f"canMountWep_{field}"] == "1"],
                "affinities": [
                    i for i in range(AFFINITY_COUNT) if gem.get(f"configurableWepAttr{i:02}") == "1"
                ],
            }
        )
    ashes.sort(key=lambda ash: ash["name"])

    # Weapons' built-in skills, and their own physical types for skills' hits, for the app's weapons
    with open(os.path.join(project_dir, "public", "regulation-vanilla-v1.17.js"), encoding="utf-8") as f:
        app_weapons = {weapon["weaponName"] for weapon in json.load(f)["weapons"]}
    weapon_skills = {}
    for name, row in weapons.items():
        if name not in app_weapons:
            continue
        skill_id = int(row["swordArtsParamId"])
        skill = skill_names.get(skill_id) or skill_names.get(skill_text_ids.get(skill_id, -1))
        if not skill:
            continue
        skill = SKILL_SHEET_NAMES.get(skill, skill)
        weapon_skills[name] = {
            "skill": skill,
            "canChange": row["gemMountType"] == "2",
            # Which of a skill's animations it uses (see get_skill_timing)
            "skillRange": get_skill_range(row),
            "types": [
                PHYSICAL_TYPES[WEAPON_ATTRIBUTE_TYPES.get(int(row["atkAttribute"]), "standard")],
                PHYSICAL_TYPES[WEAPON_ATTRIBUTE_TYPES.get(int(row["atkAttribute2"]), "standard")],
            ],
        }

    # Projectile ticks' intervals (dmgHitRecordLifeTime)
    # and how long they last (the bullet's life), if known
    tick_bullets = {}
    for bullet in read_csv(os.path.join(data_dir, "Bullet-vanilla.csv")):
        interval = float(bullet["dmgHitRecordLifeTime"])
        if interval > 0:
            life = float(bullet["life"])
            tick_bullets.setdefault(bullet["atkId_Bullet"], (interval, life if life > 0 else None))

    sp_effects = {
        row["id"]: row for row in read_csv(os.path.join(data_dir, "SpEffectParam-vanilla.csv"))
    }

    # Status buildup hits apply through their own effects: the attack's (AtkParam spEffectId0-4) and,
    # for projectiles, the bullet's (BulletParam spEffectId0-4 of the bullet with the attack), e.g.
    # Blood Blade's 55 and 60 blood loss. Effects with isUseStatusAilmentAtkPowerCorrect get the
    # weapon's status correction ("scaledStatus"), others don't ("status").
    def effects_status(effect_ids, weapon_buff=False, spawned=False, status_rate=None):
        """
        Status buildup from effects, as "scaledStatus" if it gets the weapon's status correction (like
        the weapon's own status) or "status" if it's flat. A weapon buff's (e.g. a skill's own) is
        scaled if it says so (isUseStatusAilmentAtkPowerCorrect). A hit's own effects are scaled
        whatever they say, and the effects they're replaced with aren't (tested in game with 99 in
        every stat: Bloody Slash's 60 blood loss, flag off, is about 85 on a Blood Great Katana +25,
        its ×1.435 Arcane correction; Poison Moth Flight's 1620, replaced with 1622's 250 poison, flag
        on, is 250 on a Poison Longsword +25). Spawned bullets' effects (e.g. lingering clouds) are
        assumed flat. With status_rate (the hit's AtkParam statusAilmentAtkPowerCorrectRate), its own
        effects that say they're scaled are also multiplied by it (tested in game: the Dragon
        Halberd's Spinning Slash projectile, rate 0, applies none of its 80 frost; Blood Blade's slash,
        rate 100, all its 55 blood loss; Bloody Slash's 60, flag off, despite its rate of 0).
        """
        found = {}
        pending = [(effect_id, False) for effect_id in effect_ids]
        seen = set()
        while pending:
            effect_id, replaced = pending.pop()
            effect = sp_effects.get(str(effect_id))
            if not effect or effect_id in seen:
                continue
            seen.add(effect_id)
            # An effect that's replaced by another applies that one's status, e.g. Poison Moth Flight's
            # 1620 by 1622 (250 poison)
            if int(effect["replaceSpEffectId"]) > 0:
                pending.append((int(effect["replaceSpEffectId"]), True))
            if weapon_buff:
                scaled = effect["isUseStatusAilmentAtkPowerCorrect"] == "1"
            else:
                scaled = not replaced and not spawned
            key = "scaledStatus" if scaled else "status"
            rate = (
                status_rate / 100
                if status_rate is not None and not replaced and effect["isUseStatusAilmentAtkPowerCorrect"] == "1"
                else 1
            )
            for status_type, field in STATUS_FIELDS.items():
                buildup = number(effect[field] or 0) * rate
                if buildup > 0:
                    found.setdefault(key, {})
                    found[key][str(status_type)] = found[key].get(str(status_type), 0) + buildup
        return found

    hit_status = {}
    for row in read_csv(os.path.join(data_dir, "AtkParam_Pc-vanilla.csv")):
        status = effects_status(
            (int(row[f"spEffectId{i}"]) for i in range(5)),
            status_rate=float(row["statusAilmentAtkPowerCorrectRate"] or 0),
        )
        if status:
            hit_status[row["id"]] = status
    for bullet in read_csv(os.path.join(data_dir, "Bullet-vanilla.csv")):
        status = effects_status(int(bullet[f"spEffectId{i}"]) for i in range(5))
        if status and bullet["atkId_Bullet"] not in hit_status and bullet["atkId_Bullet"] not in NO_STATUS_ROWS:
            hit_status[bullet["atkId_Bullet"]] = status
    for attack_id, effect_id in SKILL_DAMAGE_EFFECTS.items():
        effect = sp_effects[str(effect_id)]
        hit_status.setdefault(attack_id, {})["damageRates"] = [
            number(effect[f"atkEnemyDmgCorrectRate_{field}"]) for field in ("Physics", "Magic", "Fire", "Thunder", "Dark")
        ]

    # Attacks' subcategories (AtkParam subCategory1-4)
    attack_categories = {
        row["id"]: ROW_CATEGORIES.get(
            row["id"], [int(row[f"subCategory{i}"]) for i in range(1, 5) if int(row[f"subCategory{i}"] or 0)]
        )
        for row in read_csv(os.path.join(data_dir, "AtkParam_Pc-vanilla.csv"))
    }

    # Projectiles' and hits' percentage of max HP damage over time
    hp_damage = {}
    sources = [
        (bullet["atkId_Bullet"], bullet) for bullet in read_csv(os.path.join(data_dir, "Bullet-vanilla.csv"))
    ] + [(row["id"], row) for row in read_csv(os.path.join(data_dir, "AtkParam_Pc-vanilla.csv"))]
    for atk_id, source in sources:
        for i in range(5):
            effect_id = int(source[f"spEffectId{i}"])
            if effect_id in HP_DAMAGE_EFFECTS:
                effect = sp_effects[str(effect_id)]
                # The source's other effects can lower the target's max HP, which the percentage is of
                max_hp_rate = 1.0
                for j in range(5):
                    other = sp_effects.get(source[f"spEffectId{j}"])
                    if other and j != i and float(other["maxHpRate"] or 1) != 1:
                        max_hp_rate *= float(other["maxHpRate"])
                hp_damage.setdefault(
                    atk_id,
                    {
                        "label": HP_DAMAGE_EFFECTS[effect_id],
                        "rate": number(
                            float(effect["changeHpRate"]) * max_hp_rate * HP_DAMAGE_MAX_HP_RATES.get(atk_id, 1)
                        )
                        / 100,
                        "ticks": round(float(effect["effectEndurance"]) / float(effect["motionInterval"])) + 1,
                        **({"flat": number(effect["changeHpPoint"])} if number(effect["changeHpPoint"]) else {}),
                    },
                )
    # Skills' own weapon buffs: flat attack, and status from the effect their hits apply (like a
    # grease's, e.g. Chilling Mist's 60 frost), scaled by the hit's status motion value
    skill_buffs = {}
    for skill, effect_id in SKILL_BUFFS.items():
        effect = sp_effects[str(effect_id)]
        skill_buffs[skill] = {
            "flat": [number(effect[field]) for field in BUFF_ATTACK_FIELDS],
            "status": effects_status([int(effect["atkOccurrenceSpEffectId"])], weapon_buff=True),
        }
        if skill in SKILL_BUFF_STATUS:
            for status in skill_buffs[skill]["status"].values():
                status.update({str(k): v for k, v in SKILL_BUFF_STATUS[skill].items() if str(k) in status})

    # Bullets each sheet row's bullets spawn (HitBulletID, intervalCreateBulletId) that apply status
    # but have no row of their own, e.g. Chilling Mist's lingering cloud (Bullet 2411: 120 frost
    # every 0.7s for 4s): status-only hits after the row's, ticks if they can hit again
    # (dmgHitRecordLifeTime). Several rows can spawn the same one (e.g. Hoarfrost Stomp's), counted
    # once.
    sheet_attacks = {row["AtkId"] for row in read_csv(os.path.join(project_dir, "data", "sheets", "mv", "AshesOfWarAttackData.csv"))}
    bullets = {row["id"]: row for row in read_csv(os.path.join(data_dir, "Bullet-vanilla.csv"))}
    bullets_by_attack = {}
    for bullet in bullets.values():
        bullets_by_attack.setdefault(bullet["atkId_Bullet"], []).append(bullet)
    spawned_status = {}
    for attack_id in sheet_attacks:
        for bullet in bullets_by_attack.get(attack_id, []):
            for field in ("HitBulletID", "intervalCreateBulletId"):
                child = bullets.get(bullet[field])
                # Only bullets with a shared attack that does nothing itself (AtkParam ids below
                # 1000, e.g. 20 for the mists' clouds); a skill's own attack the sheet leaves out
                # doesn't apply its status (tested in game: Divine Beast Frost Stomp's shatter spawns
                # 600000200 with 110 frost, but the skill only builds up 140, its two hits' 70 each)
                if not child or child["atkId_Bullet"] in sheet_attacks or int(child["atkId_Bullet"]) >= 1000:
                    continue
                status = effects_status((int(child[f"spEffectId{i}"]) for i in range(5)), spawned=True)
                if status:
                    interval = float(child["dmgHitRecordLifeTime"])
                    details = (
                        {
                            **status,
                            "kind": "Lingering",
                            "tick": True,
                            "tickInterval": interval,
                            "tickDuration": float(child["life"]),
                            # Its first tick waits an interval, since the bullet that spawned it
                            # just hit (tested in game: Poisonous Mist's cloud ticks 5 times in its
                            # 4s, 720 poison in all on a Longsword +25)
                            "tickDelay": interval,
                        }
                        if interval > 0
                        else {**status, "kind": "Bullet"}
                    )
                    spawned_status.setdefault(attack_id, []).append([0, 0, 0, 0, details])

    # Skills' hits
    known_skills = sorted({normalize(s): s for s in skill_names.values() if s}.items(), key=lambda x: -len(x[0]))
    skills = {}
    unmatched = set()
    sheet_rows = read_csv(os.path.join(project_dir, "data", "sheets", "mv", "AshesOfWarAttackData.csv"))
    rows_by_id = {row["AtkId"]: row for row in sheet_rows}
    sheet_rows = [
        {**rows_by_id[ROW_FITS[row["AtkId"]]], "Name": row["Name"], "AtkId": row["AtkId"]}
        if row["AtkId"] in ROW_FITS
        else row
        for row in sheet_rows
    ]
    for row in sheet_rows + [{**sheet_rows[0], **extra} for extra in EXTRA_SHEET_ROWS]:
        name = row["Name"]
        if not name or re.search(r"\((lacking fp|far)\)", name, re.I):
            continue
        prefix = re.match(r"\[([^\]]+)\] (.*)", name)
        weapon_class, body = (prefix.group(1), prefix.group(2)) if prefix else (None, name)
        version = None
        if weapon_class and weapon_class not in CLASS_TYPES:
            version, weapon_class = weapon_class, None
        normalized_body = normalize(body)
        match = next((s for key, s in known_skills if normalized_body.startswith(key)), None)
        if not match:
            unmatched.add(body)
            continue
        if version and match in DEFAULT_VERSIONS:
            if version != DEFAULT_VERSIONS[match]:
                continue
            version = None
        # The rest of the name, after as many characters as the skill name has
        key = normalize(match)
        consumed = 0
        index = 0
        while consumed < len(key) and index < len(body):
            if normalize(body[index]) or body[index] == " ":
                consumed += len(normalize(body[index]) or " ")
            index += 1
        # Punctuation that ends the skill's name, e.g. "Stamp (Upward Cut)"
        while index < len(body) and body[index] in ")!'":
            index += 1
        label, hands = parse_rest(body[index:])
        if row["AtkId"] in ROW_FOLLOW_UPS:
            label = ROW_FOLLOW_UPS[row["AtkId"]]
        if version:
            label = f"{version} {label}" if label else version
        # Releasing a charged skill early just does fewer of its hits, so it's left out (the user's
        # finding: Charge Forth's "Early Release" follow-up wasn't right)
        if label in DROPPED_FOLLOW_UPS:
            continue
        # Lightning that spreads through water only hits a target standing in it (tested in game:
        # Lightning Slash on a Longsword +25 does 96, 921, and 554, without its water AoE)
        if "Water AoE" in name:
            continue
        # A partly charged attack is between the uncharged and fully charged ones, so it's left out
        if "(Partial)" in name:
            continue
        repeats = NAME_REPEATS.get(name, ROW_REPEATS.get(row["AtkId"], 1))
        hit = parse_hit(row, tick_bullets, hp_damage, attack_categories, hit_status)
        if hit is None or not repeats:
            continue
        # How much of a weapon buff's flat attack the hit gets (AtkParam
        # spEffectAtkPowerCorrectRate_byPoint), e.g. none for Blood Blade's slash (tested in game)
        buff_motion_value = number(row["Weapon Buff MV"] or 100)
        if buff_motion_value != 100:
            if len(hit) < 5:
                hit.append({})
            hit[4]["buffMotionValue"] = buff_motion_value
        # The skill's weapon hits get its weapon buff. A projectile with its own fixed attack takes the
        # buff's flat attack in place of its own instead: the Dragon Halberd's does 317 with its 160
        # lightning buff, as if 160 rather than its 149 lightning (tested in game with 99 Strength and
        # Dexterity: the same with 99 or 10 Intelligence and Faith, which its lightning is flagged to
        # scale with but the weapon has none of; 452 if the buff were added). A projectile whose flat
        # attack is added to the weapon's gets the buff's flat attack too, but not its status: the
        # Spirit Sword's Rancor Slash spirits do 199 with its 20 magic, 182 without, and no frost
        # (tested in game: 995 for all 5)
        buff = skill_buffs.get((match, row["Unique Skill Weapon"])) or skill_buffs.get(match)
        if buff and len(hit) > 4 and hit[4].get("fixed"):
            hit[4]["flat"] = [b or f for f, b in zip(hit[4]["flat"], buff["flat"])]
        elif buff and (
            any(v for v in ([hit[0]] if not isinstance(hit[0], list) else hit[0]))
            or (len(hit) > 4 and any(hit[4].get("flat", [])))
        ):
            if len(hit) < 5:
                hit.append({})
            if any(buff["flat"]):
                hit[4]["buff"] = buff["flat"]
            weapon_hit = any(v for v in ([hit[0]] if not isinstance(hit[0], list) else hit[0]))
            for key, status in (buff["status"] if weapon_hit else {}).items():
                for status_type, buildup in status.items():
                    total = hit[4].setdefault(key, {})
                    # Scaled by the hit's status motion value and its share of the buff (tested in
                    # game: Rancor Slash's 80 frost is about 45 on its slashes, 75% of each, and 80
                    # on its follow-up, 170 for all three)
                    total[status_type] = (
                        total.get(status_type, 0) + buildup * hit[1] / 100 * buff_motion_value / 100
                    )
        spawned = [] if match in NO_SPAWNED_STATUS else spawned_status.get(row["AtkId"], [])
        if row["AtkId"] in SKILL_CLOUDS:
            cloud = [0, 100, 0, 0, {"kind": "Cloud", **effects_status([SKILL_CLOUDS[row["AtkId"]]])}]
            spawned = [*spawned, cloud]

        skill = skills.setdefault(match, {"generic": None, "classes": {}, "unique": {}})
        if row["Unique Skill Weapon"]:
            hits = skill["unique"].setdefault(row["Unique Skill Weapon"], {"main": [], "followUps": []})
        elif weapon_class:
            hits = skill["classes"].setdefault(str(CLASS_TYPES[weapon_class]), {"main": [], "followUps": []})
        else:
            if skill["generic"] is None:
                skill["generic"] = {"main": [], "followUps": []}
            hits = skill["generic"]
        if label is None:
            hits["main"] += [copy.deepcopy(hit) for _ in range(repeats)]
            add_spawned(hits["main"], spawned)
        else:
            follow_up = next(
                (f for f in hits["followUps"] if f["label"] == label and f.get("hands") == hands), None
            )
            if follow_up is None:
                follow_up = {"label": label, **({"hands": hands} if hands else {}), "hits": []}
                hits["followUps"].append(follow_up)
            follow_up["hits"] += [copy.deepcopy(hit) for _ in range(repeats)]
            add_spawned(follow_up["hits"], spawned)

    for name, variants in CHARGE_VARIANTS.items():
        hits = skills[name]["generic"]
        by_kind = {hit[4]["kind"]: hit for hit in hits["main"] if len(hit) > 4 and "kind" in hit[4]}
        hits["followUps"] = [
            {"label": label, "hits": [copy.deepcopy(by_kind[kind]) for kind, count in counts for _ in range(count)]}
            for label, counts in variants.items()
        ]
        hits["main"] = []

    for name, (shared, charged, (plain_label, charged_label)) in SHARED_FOLLOW_UPS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            by_label = {f["label"]: f["hits"] for f in hits["followUps"]}
            hits["followUps"] = [
                {"label": f"{plain_label} #1".strip(), "hits": hits["main"]},
                {"label": f"{plain_label} #2".strip(), "hits": by_label[shared]},
                {"label": f"{charged_label} #1", "hits": by_label[charged]},
                {"label": f"{charged_label} #2", "hits": copy.deepcopy(by_label[shared])},
            ]
            hits["main"] = []

    for name in MAIN_IN_VERSIONS:
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            # Uncharged first
            hits["followUps"] = sorted(
                ({**f, "hits": [*copy.deepcopy(hits["main"]), *f["hits"]]} for f in hits["followUps"]),
                key=lambda f: f["label"] != "Uncharged",
            )
            hits["main"] = []

    for name, label in MAIN_LABELS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            hits["followUps"] = [{"label": label, "hits": hits["main"]}, *hits["followUps"]]
            hits["main"] = []

    charge_levels = dict(CHARGE_LEVELS)
    for name, skill in skills.items():
        versions = [skill["generic"], *skill["classes"].values(), *skill["unique"].values()]
        labels = {f["label"] for hits in filter(None, versions) for f in hits["followUps"]}
        if labels == {"Charged"}:
            charge_levels.setdefault(name, CHARGED_LEVELS)
    for name, (effect_id, label, (plain, bonus), replaces_status) in CONDITIONAL_HP_DAMAGE.items():
        effect = sp_effects[str(effect_id)]
        hp_hit = [
            0,
            0,
            0,
            0,
            {
                "kind": label,
                "hpDamage": {
                    "label": label,
                    "rate": number(effect["changeHpRate"]) / 100,
                    "ticks": round(float(effect["effectEndurance"]) / float(effect["motionInterval"])) + 1,
                    "flat": number(effect["changeHpPoint"]),
                },
            },
        ]
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            # The bonus replaces the status the hit applies otherwise
            bonus_hits = copy.deepcopy(hits["main"])
            if replaces_status:
                for hit in bonus_hits:
                    if len(hit) > 4:
                        hit[4].pop("status", None)
            hits["followUps"] = [
                {"label": plain, "hits": hits["main"]},
                {"label": bonus, "hits": [*bonus_hits, hp_hit]},
                *hits["followUps"],
            ]
            hits["main"] = []

    for name, labels in charge_levels.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            levels = [hits["main"], *(f["hits"] for f in hits["followUps"])]
            hits["followUps"] = [{"label": label, "hits": level} for label, level in zip(labels, levels)]
            hits["main"] = []

    for name, kinds in HIT_ORDER.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            kind_of = lambda hit: hit[4].get("kind") if len(hit) > 4 else None
            hits["main"].sort(key=lambda hit: kinds.index(kind_of(hit)) if kind_of(hit) in kinds else len(kinds))

    for name, merges in MERGED_FOLLOW_UPS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            merged = []
            for label, (first, second) in merges.items():
                base = next(f for f in hits["followUps"] if f["label"] == first)
                for f in hits["followUps"]:
                    if f["label"] == second:
                        merged.append(
                            {
                                "label": label,
                                **({"hands": f["hands"]} if f.get("hands") else {}),
                                "hits": [*copy.deepcopy(f["hits"]), *copy.deepcopy(base["hits"])],
                            }
                        )
            hits["followUps"] = merged

    for name, copies in COPIED_STEPS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            by_label = {f["label"]: f for f in hits["followUps"]}
            for label, source in copies.items():
                hits["followUps"].append({**copy.deepcopy(by_label[source]), "label": label})

    for name, (kind, label) in KIND_VERSIONS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            is_kind = lambda hit: len(hit) > 4 and hit[4].get("kind") == kind
            hits["followUps"].append({"label": label, "hits": [hit for hit in hits["main"] if is_kind(hit)]})
            hits["main"] = [hit for hit in hits["main"] if not is_kind(hit)]

    for name, (chain, steps) in MAIN_CHAINS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):

            def step_label(label):
                if steps is not None:
                    return f"#{steps.index(label) + 2}" if label in steps else None
                return label if re.fullmatch(r"#\d+", label) else None

            hits["followUps"] = [{"label": f"{chain} #1".strip(), "hits": hits["main"]}] + [
                {**f, "label": f"{chain} {step_label(f['label'])}".strip()} if step_label(f["label"]) else f
                for f in hits["followUps"]
            ]
            repeats, repeated_kind = (
                CHAIN_REPEATS[name] if isinstance(CHAIN_REPEATS.get(name), tuple) else (CHAIN_REPEATS.get(name, 1), None)
            )
            repeated = [
                hit
                for hit in hits["main"]
                if repeated_kind is None or (len(hit) > 4 and hit[4].get("kind") == repeated_kind)
            ]
            hits["followUps"][1:1] = [
                {"label": f"{chain} #{step}".strip(), "hits": copy.deepcopy(repeated)}
                for step in range(2, repeats + 1)
            ]
            if name in CHAIN_SPLIT_KINDS:
                kind, split_chain = CHAIN_SPLIT_KINDS[name]
                is_kind = lambda hit: len(hit) > 4 and hit[4].get("kind") == kind
                steps = hits["followUps"]
                hits["followUps"] = [
                    *({**f, "hits": [hit for hit in f["hits"] if not is_kind(hit)]} for f in steps),
                    *(
                        {
                            **f,
                            "label": f"{split_chain} {f['label']}",
                            "hits": [hit for hit in f["hits"] if is_kind(hit)],
                        }
                        for f in steps
                    ),
                ]
            if name in CHAIN_SHARED_KINDS:
                kind, count = CHAIN_SHARED_KINDS[name]
                shared = [hit for hit in hits["main"] if len(hit) > 4 and hit[4].get("kind") == kind]
                if count is not None:
                    shared = [shared[0]] * count
                for follow_up in hits["followUps"][1:]:
                    follow_up["hits"] = [*follow_up["hits"], *copy.deepcopy(shared)]
            hits["main"] = []

    for name, kinds in MAIN_HIT_KINDS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            hits["main"] = [hit for hit in hits["main"] if len(hit) > 4 and hit[4].get("kind") in kinds]

    for name, count in MAIN_HIT_COUNTS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            hits["main"] = hits["main"][:count]

    for name, labels in MERGED_TICKS.items():
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            for follow_up in hits["followUps"]:
                poise = labels.get(follow_up["label"])
                if poise is None:
                    continue
                ticks = [hit for hit in follow_up["hits"] if len(hit) > 4 and hit[4].get("tick")]
                rest = [hit for hit in follow_up["hits"] if hit not in ticks]
                if ticks:
                    merged = copy.deepcopy(ticks[0])
                    merged[4] = {k: v for k, v in merged[4].items() if k not in ("tick", "tickInterval")}
                    merged[4]["poise"] = poise
                    follow_up["hits"] = [merged, *rest]

    for name, (source, hands) in BORROWED_FOLLOW_UPS.items():
        skill = skills.setdefault(name, {"generic": None, "classes": {}, "unique": {}})
        for weapon_type, hits in skills[source]["classes"].items():
            follow_ups = [f for f in hits["followUps"] if f.get("hands") == hands]
            skill["classes"][weapon_type] = {"main": [], "followUps": copy.deepcopy(follow_ups)}

    for name in STANCE_SKILLS:
        versions = [skills[name]["generic"], *skills[name]["classes"].values(), *skills[name]["unique"].values()]
        for hits in filter(None, versions):
            for follow_up in hits["followUps"]:
                for hit in follow_up["hits"]:
                    if len(hit) < 5:
                        hit.append({})
                    hit[4]["categories"] = [*hit[4].get("categories", []), STANCE_ATTACK_CATEGORY]

    # Recasts and versions that repeat the main attack or an earlier follow-up are left out, e.g. Blood
    # Blade's #2 and #3 (chain casting it) and Double Slash's "Slow" ones. Follow-ups naming an attack
    # (R2, Charged, ...) are kept even if they repeat one, e.g. War Cry's R2 chain steps, and so are
    # chain steps, e.g. Magma Shower's #2. Skills recast the same way only count one cast (Scattershot
    # Throw, the Fallingstar Beast Jaw's Gravity Bolt).
    for name, skill in skills.items():
        chain = MAIN_CHAINS[name][0] if name in MAIN_CHAINS else None
        versions = [skill["generic"], *skill["classes"].values(), *skill["unique"].values()]
        for hits in filter(None, versions):
            seen = [hits["main"]] if hits["main"] else []
            kept = []
            for follow_up in hits["followUps"]:
                repeat = (
                    follow_up["hits"] in seen
                    and not re.search(
                        r"\b(R[12]|Charged|Uncharged|Running|Jumping|Backstep|Rolling)\b", follow_up["label"]
                    )
                    and not (chain is not None and re.fullmatch(rf"{re.escape(chain)} ?#\d+", follow_up["label"]))
                    and not (name in SHARED_FOLLOW_UPS and re.fullmatch(r".* #\d+", follow_up["label"]))
                )
                if not repeat:
                    seen.append(follow_up["hits"])
                    kept.append(follow_up)
            hits["followUps"] = kept

    # Skills that put their own weapon buff on the weapon, which replaces any other (they share
    # spCategory 162), e.g. a grease
    for name in SKILL_BUFFS:
        if isinstance(name, tuple):
            skills[name[0]]["unique"][name[1]]["weaponBuff"] = True
        elif name in skills:
            skills[name]["weaponBuff"] = True
    for name, note in SKILL_NOTES.items():
        if isinstance(name, tuple):
            skill = skills[name[0]]
            for hits in filter(None, [skill["generic"], *skill["classes"].values(), *skill["unique"].values()]):
                for follow_up in hits["followUps"]:
                    if follow_up["label"] == name[1]:
                        follow_up["note"] = note
        else:
            skills[name]["note"] = note
    # The sheet names some weapons' shared versions together, e.g. "(Nightrider / Chainlink) Flail" for
    # the Flail's, Nightrider Flail's, and Chainlink Flail's Spinning Chain: they go to each weapon with
    # the skill that has no version of its own
    for name, skill in skills.items():
        for shared in [weapon for weapon in skill["unique"] if weapon not in weapon_skills]:
            hits = skill["unique"].pop(shared)
            for weapon, info in weapon_skills.items():
                if info["skill"] == name and weapon not in skill["unique"]:
                    skill["unique"][weapon] = copy.deepcopy(hits)
    for name, merges in MERGED_VERSIONS.items():
        skill = skills[name]
        for hits in filter(None, [skill["generic"], *skill["classes"].values(), *skill["unique"].values()]):
            for first, second in merges:
                hits["followUps"] = [f for f in hits["followUps"] if f["label"] != second]
                for follow_up in hits["followUps"]:
                    if follow_up["label"] == first:
                        follow_up["label"] = f"{first} / {second}"
    for (name, weapon), note in VERSION_NOTES.items():
        skills[name]["unique"][weapon]["note"] = note
    for (name, weapon, label), (projectile_flat, weapon_flat) in FOLLOW_UP_BUFFS.items():
        version = skills[name]["unique"][weapon]
        version["weaponBuff"] = True
        for follow_up in version["followUps"]:
            if follow_up["label"] == label:
                for hit in follow_up["hits"]:
                    if len(hit) < 5:
                        hit.append({})
                    hit[4]["buff"] = projectile_flat if hit[4].get("kind") else weapon_flat
    for name, label in SKILL_LABELS.items():
        skills[name]["label"] = label

    # Each version's timing, from its skill's animations
    from check_animations import Steps  # noqa: E402

    steps = Steps(game_dir, project_dir)
    behavior_rows = {
        int(row["id"]): row for row in read_csv(os.path.join(data_dir, "BehaviorParam_PC-vanilla.csv"))
    }
    bullet_rows = {int(row["id"]): row for row in read_csv(os.path.join(data_dir, "Bullet-vanilla.csv"))}
    # Each weapon class's behavior variation (its weapons' share it, in 100s)
    class_variations = {}
    for row in weapons.values():
        class_variations.setdefault(int(row["wepType"]), int(row["behaviorVariationId"]) // 100 * 100)
    for name, skill in skills.items():
        for group, key, hits in [
            ("generic", None, skill["generic"]),
            *(("classes", key, hits) for key, hits in skill["classes"].items()),
            *(("unique", key, hits) for key, hits in skill["unique"].items()),
        ]:
            if not hits:
                continue
            row = weapons.get(key) if group == "unique" else None
            skill_id = int(row["swordArtsParamId"]) if row else ash_skill_ids.get(name)
            if skill_id not in skill_animation_types:
                continue
            # A class's version uses its class's behavior variation (e.g. 1400 for curved swords'
            # Wild Strikes), a unique weapon's its own
            variation = (
                int(row["behaviorVariationId"])
                if row
                else class_variations.get(int(key), 0)
                if group == "classes"
                else 0
            )
            timing = get_skill_timing(
                steps,
                SKILL_ANIMATION_FILE_BASE + skill_animation_types[skill_id],
                variation,
                hits,
                behavior_rows,
                bullet_rows,
            )
            if timing:
                hits["timing"] = timing

    for skill in skills.values():
        if skill["generic"] is None:
            del skill["generic"]
        for group in ["classes", "unique"]:
            if not skill[group]:
                del skill[group]

    out_path = os.path.join(project_dir, "public", "ashes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {"ashes": ashes, "weapons": weapon_skills, "skills": skills},
            f,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    print(f"{len(ashes)} ashes, {len(weapon_skills)} weapons, {len(skills)} skills -> {out_path}")
    if unmatched:
        print(f"Warning: no skill for {sorted(unmatched)}")


if __name__ == "__main__":
    main()
