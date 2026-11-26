"""
Cross-check the motion value sheet's basic attacks against the game's animations: for each weapon,
attack, and chain step, the hits the animation actually has (its attack windows), the AtkParam_Pc
row each one uses, and when it hits, against the sheet's hits.

Usage:
  python3 -I scripts/check_animations.py <ELDEN RING Game dir>

Inputs:
  - <Game>/chr/c0000-anibnd-dcx-wanibnd/INTERROOT_win64/chr/c0000/tae/*.tae: the player's
    animations, chr/c0000.anibnd.dcx unpacked with WitchyBND, read with extract_tae.py
  - <Game>/chr/c0000_*-anibnd-dcx-wanibnd: the animations' .hkx files, for their lengths,
    extracted and unpacked with extract_game_files.py, read with extract_hkx.py
  - data/sheets/mv/MotionValues.csv, and the game data build_moveset_data.py uses

Writes data/sheets/mv/ANIMATION_CHECK.md (the steps that differ) and data/animation-hits.csv
(every step's hits with their timings).

How an attack's hits are found: each sheet column has an animation ID (ANIMATION_IDS; two handed
ones 2000 later, e.g. 030000 and 032000 for the first R1). A weapon's animations are in
a{spAtkcategory}.tae if it has one and it has that animation (e.g. the Black Knife's two-stab R2s,
a103), or else a{wepmotionCategory}.tae. An animation with no hit windows may import another's
(e.g. the Starscourge Greatsword's two handed R2 is its one handed one). Its hits are its attack
windows (AttackBehavior, or PCBehavior for some, e.g. fists' rolling R1) and projectiles
(BulletBehavior), e.g. the Smithscript Dagger's two handed
R1 throws both daggers. Each has a behavior judge ID, which with the weapon's behaviorVariationId
picks a BehaviorParam_PC row and its AtkParam_Pc row (see game_attacks.py): 100000000 +
variation × 1000 + judge ID, or the class's variation (e.g. 200 for 209) if that row doesn't exist.
Judge IDs from 1000 on are dual wielding hits (e.g. paired weapons' two handed attacks, 3931), whose
thousands digit is the row's first digit instead of 1 (300405931). Those only count for paired
weapons; other weapons' animations have them for powerstancing. Windows whose row has no motion
values (e.g. a shove) are left out, and so are judge IDs 990-999 (small extra hitboxes, only in the
light greatswords' animations, listed separately). Each window hits once, except these, all tested in game (see DISCREPANCIES.md):
  - A window touching or overlapping one of the same AttackIndex and weapon or limb
    (get_hit_source) is the same swing continuing if
    it has the same motion values or is its alternate version (3 or 4 judge IDs later): the
    Backhand Blade's charged R2 1 (105 then 106), the Milady's R1 2 (10 then 13). Other indexes are
    separate hits, e.g. the Black Steel Twinblade's charged R2's spins.
  - Overlapping windows of other indexes with the same motion values on the same weapon or limb
    (get_hit_source) are one hit: Dryleaf Arts' R1 3 (two hitboxes on one foot), the Dueling
    Shield's running R2. On different ones they're separate: Dryleaf Arts' two handed R2 2's two
    feet, paired weapons' two blades, and unarmed and fists' two fists (on the same dummy poly).
  - A stream of the same projectile (AtkParam row) is one hit, e.g. a perfume bottle's spray (two
    handed, each bottle's), and so is a perfume bottle's or claws' swing from the hand overlapping
    it, with the projectile's motion values (a perfume bottle's jumping attacks' bottle and spray, the Claws of Night's two
    handed R2 2's claws). A blade's swing and projectile are separate hits.
  - A sheet hit's alternate projectile ("120 (105 Bullet)") is that hit, not another.
The extra hitboxes don't add damage (the Milady's R2 1 matches the sheet in game). A projectile may
hit more than once (e.g. one that explodes), which this can't tell.
"""

import csv
import math
import os
import re
import struct
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from build_moveset_data import ATTACKS, CROUCHING_ATTACKS, MOTION_VALUE_FIXES, parse_numbers, read_tab, read_weapons  # noqa: E402
from extract_hkx import read_hkx_length  # noqa: E402
from extract_tae import read_tae  # noqa: E402
from game_attacks import GameAttacks, get_motion_values  # noqa: E402

TAE_DIR = os.path.join("chr", "c0000-anibnd-dcx-wanibnd", "INTERROOT_win64", "chr", "c0000", "tae")
# The player's animations (.hkx, for their lengths), unpacked by extract_game_files.py into one
# folder per archive, each with its .hkx files in INTERROOT_win64/chr/c0000/hkx/<archive>_compendium
HKX_DIR = "chr"
HKX_ARCHIVE_PREFIX = "c0000_"
ATTACK_EVENT = 1
# AttackBehavior's Source for a hit with the left hand's weapon, e.g. powerstance L1s' second weapon
LEFT_HAND_SOURCE = 2
BULLET_EVENT = 2
# Another kind of attack window, e.g. fists' rolling R1, when its PCBehaviorType is 16 (type 4 is
# every jumping attack's landing, judge ID 550)
PC_BEHAVIOR_EVENT = 307
# A critical hit's (backstab's or riposte's) hit: its behavior judge ID at +4 (e.g. a23_031700's
# riposte, judge 510 at 0.833s; a32_031710's backstab, 500 and 501)
CRITICAL_EVENT = 304
PC_BEHAVIOR_ATTACK_TYPE = 16
HIT_EVENTS = (ATTACK_EVENT, BULLET_EVENT, PC_BEHAVIOR_EVENT)
# Bows, greatbows, crossbows, and ballistae (wepType), whose attacks are their arrows and bolts,
# which the sheet doesn't list
RANGED_WEAPON_TYPES = {"50", "51", "53", "55", "56"}
EXTRA_HITBOX_JUDGES = (990, 999)
# Unarmed and fists (wepType): two handed they punch with both fists, though both hitboxes are on
# the same dummy poly. Unarmed's two handed R2 1 does 10 in game at 99 in every stat, taken as 5 + 5
# (the calculator has 5.5 a hit)
FIST_TYPES = {"33", "35"}
# Perfume bottles and claws (wepType), whose swing from the hand and a projectile at once are one hit
HELD_ITEM_TYPES = {"89", "37"}
# Hand-to-hand arts (wepType), which hit with limbs rather than weapons
HAND_TO_HAND_ARTS_TYPE = "88"
# A hit's alternate versions' judge IDs are 3 or 4 later
ALTERNATE_JUDGE_OFFSETS = (3, 4)

# Animation ID for each sheet column (one handed)
ANIMATION_IDS = {
    **{f"R1 {i}": 30000 + (i - 1) * 10 for i in range(1, 7)},
    "R2 1": 30505,
    "Charged R2 1": 30500,
    "R2 2": 30515,
    "Charged R2 2": 30510,
    "Running R1": 30200,
    "Running R2": 30210,
    "Rolling R1": 30300,
    "Backstep R1": 30400,
    "Jumping R1": 31030,
    "Jumping R2": 31230,
    "Guard Counter": 30700,
}
TWO_HANDED_ANIMATION_OFFSET = 2000

# An R2 press starts the charged R2's animation, and the player's behavior script (c0000.hks,
# AttackRightHeavy1Start_onUpdate) only switches to the uncharged R2 once R2 is released and the
# charged animation's charging window is on (SpEffect 100280, or TAE_FLAG_CHARGING), so a tapped R2
# starts when that window opens, plus about 2 frames. Tested in game with infinite stamina,
# Longsword +25 two handed (window at 0.233s and 0.267s): 50 tapped R2s took 58s, 1.16s each (this
# gives 1.15s; the R2 animations alone 0.833s), and an R2 1 hits about 0.567s after the press (this
# gives 0.567s). Every charged R2 has the window, from 0.033s to 0.833s in. Mounted R2s too: the
# Uchigatana's mounted R2 (window at 0.533s in its mounted charged R2) hit 63 and 65 frames after the
# press, standing still and running (64 here), and repeated every 94, 95, and 95 (96 here); its
# running charged R2 hit 133 (132 here).
CHARGING_SPEFFECT = 100280
CHARGING_LAG = 2 / 30
TAPPED_R2_ATTACKS = {"R2": "Charged R2", "Mounted R2/L2": "Mounted Charged R2/L2"}
ADD_SPEFFECT_EVENT = 67
# AddSpEffect_Multiplayer, which some skills' charging windows use (e.g. Swift Slash's)
ADD_SPEFFECT_MULTIPLAYER_EVENT = 66



def charged_stamina(cost, rate):
    """
    @returns what a window's behavior's stamina cost takes from the stamina bar, times the weapon's
    staminaConsumptionRate: rounded down, as stamina is a whole number (seen in game: Loretta's
    Slash's 15 and 20 at the Loretta's War Sickle's 1.1 take 16 and 22; Great-Serpent Hunt's 30 and 40
    at the Serpent-Hunter's 1.12, 33 and 44)
    """
    # (with a little leeway for floating point, so 200 × 1.035 is 207)
    return math.floor(cost * rate + 1e-6)


# Attacks the sheet lists once rather than one and two handed (see build_moveset_data.py's
# SHARED_ATTACKS): their sheet columns and animation ID. Powerstance (dual wielding) L1s hit with
# both weapons; mounted attacks' charged R2 animation has the charging hit and the charged one. The
# left side's mounted attacks (L1 and L2) are 039xxx. Critical hits have no attack windows (their
# damage is the throw's), so they aren't checked.
SHARED_ANIMATION_IDS = {
    **{(f"Paired L1 {i}",): 34000 + (i - 1) * 10 for i in range(1, 7)},
    ("Paired Running L1",): 34200,
    ("Paired Rolling L1",): 34300,
    ("Paired Backstep L1",): 34400,
    ("Paired Jumping L1",): 34530,
    **{(f"Mounted R1 {i}",): 38000 + (i - 1) * 10 for i in range(1, 4)},
    ("Mounted R2",): 38110,
    ("Mounted R2 Charging", "Mounted Charged R2"): 38100,
    **{(f"Mounted L1 {i}",): 39000 + (i - 1) * 10 for i in range(1, 4)},
    ("Mounted L2",): 39110,
    ("Mounted L2 Charging", "Mounted Charged L2"): 39100,
}

CLASS_ONLY = "Not in the sheet, only in the class's animations (unreachable)"
CHARGED_ONLY = "Mounted charged attacks without the sheet's charging hit"

# Mounted R2 and L2 (released without charging)
MOUNTED_CHARGE_RELEASES = {38110, 39110}
# Mounted charged attacks, whose sheet columns are the charging hit (repeated while charging) and
# the charged one
MOUNTED_CHARGED = {38100, 39100}

# ChrActionFlag types that end an attack early: cancelling into an R1, R2, or L1 (the same
# attack's next step, or the next attack), any right hand attack, or a roll (or backstep). The
# first window of each is when that can start (or its early window's, EARLY_JUMP_TABLE_EVENT).
ACTION_FLAG_EVENT = 0
# Per DS Anim Studio's names: 115 is "cancel - R1 attack", 116 "cancel - R2 attack", 117 "cancel -
# L1 attack", and 4 "cancel - RH attack" and 16 "cancel - LH attack", any attack with that hand:
# 4 is R1 or R2, not L1 ("rightHandAttack" in the data; R1 and R2 chains go on at it, powerstance
# L1 chains and skills don't, tested in game), and 16 is L1, or on horseback L1 or L2
# ("leftHandAttack"; powerstance chains without 117 go on at it: a Dagger's powerstance L1 chain,
# tested in game on a recording, each gap between hits within a frame). 117 is on few animations
# (mostly powerstance L1s and mounted attacks), usually before 16 when both are, and an L1 goes on
# at the earlier (tested in game: a Greataxe's left hand L1 1 to 2, hits 59 and 58 frames apart,
# 60 by its 117 and 66 by its 16, and an Uchigatana's powerstance L1 1 to 2, first hits 50 frames
# apart at fastest, 50 by its 117 and 62 by its 16), even where 16 is first (a colossal sword's
# powerstance running L1 into L1 1, first hits 99 frames apart, 100 by its 16 and 112 by its 117,
# and an Uchigatana's one handed R1 5, which only has 16, into powerstance L1 1, 66 frames apart,
# 68 by its 16). 11 "cancel - LS movement" is when moving (the left stick) ends the animation
# ("move"). Others not used here: 107 quick goods (e.g. some consumables), 31 goods, and 29 magic.
# Blocking is 22, jumping (or crouching) 32, and skills (L2) 103 ("quickL2") and 104 ("L2"): 103 is a
# quick one, only for skills of SwordArtsParam artsSpeedType 1 (see build_ash_data.py
# QUICK_SKILL_SPEED_TYPE). A skill's chain continues on L2 (tested in game: Storm Blade's and Sword
# Dance's follow-ups).
CANCEL_FLAGS = {
    115: "R1",
    116: "R2",
    117: "L1",
    4: "rightHandAttack",
    16: "leftHandAttack",
    26: "roll",
    22: "block",
    11: "move",
    32: "jump",
    103: "quickL2",
    104: "L2",
}
# The action flag marking a flail's sweet spot (×1.125 damage), at the start of most of its attacks'
# hit windows (e.g. the Flail's R1 1: window 0.533-0.667s, flag 0.533-0.6s). Its backstabs,
# ripostes, and mounted charged attacks, and Spinning Chain, don't have it (the Flail's Spinning
# Chain spin tested in game at 419, no bonus).
SWEET_SPOT_FLAG = 42
# ActivateJumpTableEarly: a window before an action flag's (JumpTableID_ToActivateEarly, s16) that
# lets it start earlier, judged by the weapon's weaponWeightRate (JumpTable2ID_ToJudgeHowEarly 2,
# Parameter1 0.0 to Parameter2 1.0), which is 0 on every weapon: as early as possible, the window's
# start. Most are 2 frames, ending where the flag starts. Tested in game, 10 chains of two handed R1s
# (each step's repeat cancel has one): a Rapier's took about 43s (45s at the flags' starts, 41s
# early), against a Longsword's one handed 41.5s (38s, none early), so they start early.
EARLY_JUMP_TABLE_EVENT = 300
# AnimSpeedGradient: plays part of an animation faster or slower (SpeedAtStart to SpeedAtEnd, f32),
# e.g. the Giant-Crusher's two handed R1 1 at x1.23 for frames 0-22 and x1.3 for 26-39. Timings are
# in real time: tested in game on recordings, the Giant-Crusher's two handed R1 chain took 257 frames
# at 60 fps (257.5 with the speeds, 272 without), and a Dagger's powerstance L1 chain 192 and 194.
ANIM_SPEED_EVENT = 608
CANCEL_BUTTONS = ["R1", "R2", "L1"]
# A jumping attack's landing is a separate animation: this many after the attack's, the lighter of
# its landings (+42 is a slower one), e.g. the Longsword's one handed jumping R1 31030 lands in 31071
JUMP_LANDING_OFFSET = 41


class Animations:
    """The player's animations' hit windows, read as needed"""

    def __init__(self, game_dir):
        self.game_dir = game_dir
        self.dir = os.path.join(game_dir, TAE_DIR)
        self.files = {}
        # Each animation's .hkx file that plays another's (read_tae's hkx_sources), by file
        self.hkx_sources = {}
        # Every .hkx file's path, by name (e.g. a138_030515), found when first needed
        self.hkx_paths = None
        # Each animation's speed changes (ANIM_SPEED_EVENT), by file: (start, end, speed at start,
        # speed at end)
        self.speeds = {}
        # Every window of each cancel (CANCEL_FLAGS), by file and animation: (start, end)
        self.cancel_windows = {}
        # Each critical hit (CRITICAL_EVENT), by file and animation: (start, judge ID)
        self.critical_hits = {}

    def get_file(self, number):
        if number not in self.files:
            path = os.path.join(self.dir, f"a{number:02d}.tae")
            if not os.path.exists(path):
                self.files[number] = None
            else:
                _, animations, data, imports, self.hkx_sources[number] = read_tae(path)
                windows = {}
                for anim_id, events in animations.items():
                    # (start, end, judge ID, event type, AttackIndex, DummyPolyID for projectiles, and
                    # for attack windows the hand: AttackBehavior's Source, 1 right and 2 left, 0 the
                    # weapon's own)
                    windows[anim_id] = sorted(
                        (start, end, struct.unpack_from("<i", data, params + 8)[0], event_type,
                         struct.unpack_from("<i", data, params + 4)[0],
                         struct.unpack_from("<i", data, params)[0] if event_type == BULLET_EVENT else None,
                         data[params + 13] if event_type == ATTACK_EVENT else 0)
                        for start, end, event_type, params in events
                        if event_type in HIT_EVENTS
                    )
                self.critical_hits[number] = {
                    anim_id: sorted(
                        (start, struct.unpack_from("<i", data, params + 4)[0])
                        for start, end, event_type, params in events
                        if event_type == CRITICAL_EVENT
                    )
                    for anim_id, events in animations.items()
                }
                # When each SpEffect an animation applies starts
                effects = {}
                for anim_id, events in animations.items():
                    effects[anim_id] = {}
                    for start, end, event_type, params in sorted(events):
                        if event_type in (ADD_SPEFFECT_EVENT, ADD_SPEFFECT_MULTIPLAYER_EVENT):
                            effects[anim_id].setdefault(struct.unpack_from("<i", data, params)[0], start)
                cancels = {}
                for anim_id, events in animations.items():
                    # Windows that let a flag start early, by flag: (start, end)
                    early = {}
                    for start, end, event_type, params in events:
                        if event_type == EARLY_JUMP_TABLE_EVENT:
                            flag = struct.unpack_from("<h", data, params)[0]
                            early.setdefault(flag, []).append((start, end))
                    # Roll and R1/R2 cancel windows run until a little after the animation ends (seen
                    # in DS Anim Studio: e.g. a036_034020, 124 frames), so a cancel
                    # window starting after they've ended is after the animation's end and doesn't
                    # count (its L1 attack window from 148)
                    cancel_ends = [
                        end
                        for start, end, event_type, params in events
                        if event_type == ACTION_FLAG_EVENT
                        and struct.unpack_from("<i", data, params)[0] in (4, 26)
                        and end < 1e6
                    ]
                    last_end = max(cancel_ends) if cancel_ends else None
                    first = {}
                    every = {}
                    for start, end, event_type, params in sorted(events):
                        if event_type == ACTION_FLAG_EVENT:
                            flag = struct.unpack_from("<i", data, params)[0]
                            name = CANCEL_FLAGS.get(flag)
                            if name and last_end is not None and start >= last_end - 1e-6:
                                continue
                            if name:
                                # Starting early if an early window ends where it starts
                                opens = min(
                                    [start]
                                    + [
                                        early_start
                                        for early_start, early_end in early.get(flag, [])
                                        if abs(early_end - start) < 0.01
                                    ]
                                )
                                first[name] = min(opens, first.get(name, opens))
                                every.setdefault(name, []).append((opens, end))
                    cancels[anim_id] = first
                    self.cancel_windows.setdefault(number, {})[anim_id] = every
                sweet_spots = {
                    anim_id: [
                        (start, end)
                        for start, end, event_type, params in events
                        if event_type == ACTION_FLAG_EVENT
                        and struct.unpack_from("<i", data, params)[0] == SWEET_SPOT_FLAG
                    ]
                    for anim_id, events in animations.items()
                }
                self.speeds[number] = {
                    anim_id: sorted(
                        (start, end, *struct.unpack_from("<ff", data, params))
                        for start, end, event_type, params in events
                        if event_type == ANIM_SPEED_EVENT and end > start
                    )
                    for anim_id, events in animations.items()
                }
                self.files[number] = (windows, imports, cancels, effects, sweet_spots)
        return self.files[number]

    def get_speeds(self, number, anim_id, depth=0):
        """@returns an animation's speed changes (see speeds), following imports"""
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return []
        windows, imports, _, _, _ = file
        if not windows[anim_id] and anim_id in imports and depth < 4:
            return self.get_speeds(*imports[anim_id], depth + 1)
        return self.speeds[number].get(anim_id, [])

    def to_real_time(self, number, anim_id, time):
        """
        @returns how long an animation takes to reach a time in it (in animation time), playing
        faster or slower where its speed changes
        """
        real = time
        for start, end, speed_start, speed_end in self.get_speeds(number, anim_id):
            if time <= start:
                continue
            until = min(time, end)
            # The speed changes linearly over the window: the time spent is its integral of 1/speed
            speed_until = speed_start + (speed_end - speed_start) * (until - start) / (end - start)
            if abs(speed_until - speed_start) < 1e-9:
                spent = (until - start) / speed_start
            else:
                rate = (speed_end - speed_start) / (end - start)
                spent = math.log(speed_until / speed_start) / rate
            real += spent - (until - start)
        return real

    def get_hkx_path(self, name):
        """@returns the path of a .hkx file by name (e.g. a138_030515), or None if it isn't unpacked"""
        if self.hkx_paths is None:
            self.hkx_paths = {}
            base = os.path.join(self.game_dir, HKX_DIR)
            for archive in sorted(os.listdir(base)) if os.path.isdir(base) else []:
                if not (archive.startswith(HKX_ARCHIVE_PREFIX) and archive.endswith("-wanibnd")):
                    continue
                hkx_dir = os.path.join(base, archive, "INTERROOT_win64", "chr", "c0000", "hkx")
                for folder in os.listdir(hkx_dir) if os.path.isdir(hkx_dir) else []:
                    for file in os.listdir(os.path.join(hkx_dir, folder)):
                        if file.endswith(".hkx"):
                            self.hkx_paths.setdefault(file[:-4], os.path.join(hkx_dir, folder, file))
        return self.hkx_paths.get(name)

    def get_length(self, number, anim_id, depth=0):
        """
        @returns an animation's length in seconds (in animation time), from its .hkx file (the
        .tae files don't have it, and their events can run past the end: a138_030515's action
        flags run to 3.3s, though it's 2.7s), following imports, or None if it isn't unpacked (see
        HKX_DIR)
        """
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return None
        _, imports, _, _, _ = file
        if anim_id in imports and depth < 4:
            return self.get_length(*imports[anim_id], depth + 1)
        source_number, source_id = self.hkx_sources[number].get(anim_id, (number, anim_id))
        path = self.get_hkx_path(f"a{source_number:03d}_{source_id:06d}")
        length = read_hkx_length(path) if path else None
        return length[0] if length else None

    def get_windows(self, number, anim_id, depth=0):
        """@returns an animation's hit windows, following imports"""
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return None
        windows, imports, _, _, _ = file
        if not windows[anim_id] and anim_id in imports and depth < 4:
            return self.get_windows(*imports[anim_id], depth + 1)
        return windows[anim_id]

    def get_critical_hits(self, number, anim_id, depth=0):
        """@returns a critical hit animation's hits (CRITICAL_EVENT) as (start, judge ID), following imports"""
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return []
        _, imports, _, _, _ = file
        hits = self.critical_hits.get(number, {}).get(anim_id, [])
        if not hits and anim_id in imports and depth < 4:
            return self.get_critical_hits(*imports[anim_id], depth + 1)
        return hits

    def get_cancels(self, number, anim_id, depth=0):
        """
        @returns when an animation can first be cancelled into each thing (CANCEL_FLAGS), following
        imports
        """
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return {}
        _, imports, cancels, _, _ = file
        if not cancels[anim_id] and anim_id in imports and depth < 4:
            return self.get_cancels(*imports[anim_id], depth + 1)
        return cancels[anim_id]

    def get_cancel_windows(self, number, anim_id, depth=0):
        """
        @returns every window of each cancel (CANCEL_FLAGS) in an animation, following imports, as
        (start, end), each starting early like get_cancels's: some skills have one before their last
        hit, which skips it (e.g. Black Flame Tornado's release: a roll before its finisher)
        """
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return {}
        _, imports, cancels, _, _ = file
        if not cancels[anim_id] and anim_id in imports and depth < 4:
            return self.get_cancel_windows(*imports[anim_id], depth + 1)
        return self.cancel_windows.get(number, {}).get(anim_id, {})

    def get_sweet_spots(self, number, anim_id, depth=0):
        """@returns an animation's sweet spot windows (SWEET_SPOT_FLAG), following imports"""
        file = self.get_file(number)
        if not file or anim_id not in file[0]:
            return []
        windows, imports, _, _, sweet_spots = file
        if not windows[anim_id] and anim_id in imports and depth < 4:
            return self.get_sweet_spots(*imports[anim_id], depth + 1)
        return sweet_spots[anim_id]

    def get_effect_start(self, numbers, anim_id, effect_id, depth=0):
        """
        @param numbers the files to look in, the first with the animation overriding the others'
        @returns when an animation first applies a SpEffect, following imports, or None
        """
        for number in numbers:
            file = self.get_file(number)
            if not file or anim_id not in file[0]:
                continue
            _, imports, _, effects, _ = file
            if effect_id in effects[anim_id]:
                return effects[anim_id][effect_id]
            if anim_id in imports and depth < 4:
                return self.get_effect_start([imports[anim_id][0]], imports[anim_id][1], effect_id, depth + 1)
            return None
        return None

    def find(self, numbers, anim_id):
        """
        @param numbers the files to look in, the first with the animation overriding the others'
        @returns the file with the animation, and its hit windows
        """
        for number in numbers:
            windows = self.get_windows(number, anim_id)
            if windows is not None:
                return number, windows
        return None, None


class Behaviors:
    """
    BehaviorParam_PC rows' AtkParam_Pc rows, by row ID. A bullet with no attack of its own uses the
    first one that does damage of the bullets it creates (HitBulletID, intervalCreateBulletId), e.g.
    the Ruins Greatsword's charged R2's AoE.
    """

    def __init__(self, project_dir, game):
        data_dir = os.path.join(project_dir, "data")
        with open(os.path.join(data_dir, "Bullet-vanilla.csv"), encoding="utf-8") as f:
            self.bullets = {int(row["id"]): row for row in csv.DictReader(f)}
        self.game = game
        self.attacks = {}
        # Stamina each behavior costs (before the weapon's staminaConsumptionRate)
        self.stamina = {}
        with open(os.path.join(data_dir, "BehaviorParam_PC-vanilla.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                self.stamina[int(row["id"])] = int(row["stamina"])
                if row["refType"] == "0":
                    self.attacks[int(row["id"])] = int(row["refId"])
                elif row["refType"] == "1":
                    atk_id = self.get_bullet_attack(int(row["refId"]))
                    if atk_id is not None:
                        self.attacks[int(row["id"])] = atk_id

    def get_bullet_attack(self, bullet_id, depth=0):
        bullet = self.bullets.get(bullet_id)
        if not bullet or depth > 4:
            return None
        atk_id = int(bullet["atkId_Bullet"])
        atk = self.game.attacks.get(atk_id)
        if atk and any(get_motion_values(atk)):
            return atk_id
        for field in ("HitBulletID", "intervalCreateBulletId"):
            if int(bullet[field]) > 0 and int(bullet[field]) != bullet_id:
                found = self.get_bullet_attack(int(bullet[field]), depth + 1)
                if found is not None:
                    return found
        return None

    def get_behavior_id(self, variation, judge):
        """@returns the BehaviorParam_PC row for a weapon's variation and a window's judge ID"""
        prefix = max(1, judge // 1000)
        for source in (variation, variation // 100 * 100):
            behavior_id = prefix * 100_000_000 + source * 1000 + judge % 1000
            if behavior_id in self.stamina:
                return behavior_id
        return None

    def get_attack(self, variation, judge):
        """@returns the AtkParam_Pc row for a weapon's variation and a window's judge ID"""
        return self.attacks.get(self.get_behavior_id(variation, judge))

    def get_stamina(self, variation, judge):
        """@returns the stamina a window's behavior costs (before staminaConsumptionRate)"""
        return self.stamina.get(self.get_behavior_id(variation, judge), 0)


def format_mv(mvs):
    """A hit's motion value for display: the physical one, or each type's if they differ"""
    nonzero = [mv for mv in mvs if mv]
    if len(set(nonzero)) == 1 and (mvs[0] or len(nonzero) == 1):
        value = nonzero[0]
    else:
        return "/".join(f"{mv:g}" for mv in mvs)
    return f"{value:g}"


def get_hit_source(atk):
    """
    What a hit's hitbox is on, by its first dummy poly (AtkParam hit0_DmyPoly1): the right or left
    weapon (10xxx or 11xxx, e.g. paired weapons' two blades), the weapon (100-999), or a part of
    the body (e.g. Dryleaf Arts' feet, 1 and 2)
    """
    poly = int(atk["hit0_DmyPoly1"])
    if poly >= 10000:
        return f"weapon {poly // 1000}"
    if poly >= 100:
        return "weapon"
    return f"body {poly}"


def parse_alternate_bullets(cell):
    """
    @returns the motion values of a sheet cell's alternate projectile versions of hits, e.g. [105]
    for "120 (105 Bullet)", or [160, 160] for "113 + 113 (160 + 160 Bullets)": a hit that hits
    either directly or with its projectile, not both (tested in game: Dryleaf Arts' R2 1's kick
    does 479 or its AoE 404, one hit). A hit in parentheses on its own (e.g. "85 + (60 Bullet)") is
    a separate hit, not an alternate.
    """
    values = []
    for note in re.findall(r"[\d.]\s*\(([^()]*Bullets?)\)", cell):
        values += [float(value) for value in re.findall(r"[\d.]+", note)]
    return values


def format_hits(hits):
    """Hits for display, e.g. "100 @0.43s + 100 (bullet ×6) @0.47s" (repeated bullets once)"""
    parts = []
    for hit in hits:
        text = format_mv(hit["mvs"])
        if hit["bullet"] and parts and parts[-1][0] == text and parts[-1][1]:
            parts[-1][3] += 1
            continue
        parts.append([text, hit["bullet"], hit["start"], 1])
    return " + ".join(
        f"{text}{(' (bullet' + (f' ×{count}' if count > 1 else '') + ')') if bullet else ''} @{start:.2f}s"
        for text, bullet, start, count in parts
    )


def main_mv(mvs):
    """
    A hit's motion value for comparing with the sheet's one number: the physical one, which the
    sheet lists when they differ (e.g. the Twinblade's 160/170/170/170/170 charged R2), or else the
    largest
    """
    return mvs[0] or max(mvs)


class Steps:
    """Attack steps' hits from the animations, for each weapon"""

    def __init__(self, game_dir, project_dir):
        self.game = GameAttacks(project_dir)
        self.animations = Animations(game_dir)
        self.behaviors = Behaviors(project_dir, self.game)

    def get_step(self, param, hands, anim_id, cell="", both_weapons=False):
        """
        @param param the weapon's EquipParamWeapon row
        @param both_weapons true for attacks with both weapons whose hitboxes don't say which (e.g.
        powerstance L1s): simultaneous hits are one each
        @param cell the sheet's cell for the step, for its alternate projectiles
        @returns the animation's file (or None), its hit windows, the hits they make (see the module
        docstring), when it can first be cancelled into each thing (CANCEL_FLAGS), whether the windows
        have extra hitboxes, the stamina the step costs, and how much of it is the left hand weapon's
        (e.g. a powerstance L1's second swing)
        """
        file_numbers = [
            number for number in (int(param["spAtkcategory"]), int(param["wepmotionCategory"])) if number
        ]
        variation = int(param["behaviorVariationId"])
        rate = float(param["staminaConsumptionRate"])
        paired = param["isDualBlade"] == "1"
        file_number, windows = self.animations.find(file_numbers, anim_id)
        hits = []
        extra_hitboxes = False
        stamina = 0
        left_stamina = 0
        for start, end, hit_judge, event_type, attack_index, _, hand in windows or []:
            # PCBehavior's type is where the others' AttackIndex is (e.g. type 4, a jumping attack's
            # landing, judge 550, whose behavior's stamina isn't taken)
            if event_type == PC_BEHAVIOR_EVENT and attack_index != PC_BEHAVIOR_ATTACK_TYPE:
                continue
            if hit_judge >= 1000 and not paired:
                continue
            # Each window's behavior costs its stamina (usually only the first's has any, e.g. the
            # Longsword's R2 judge 100 but not 101, though the Twinblade's charged R2 spins each do),
            # times the weapon's rate, rounded down
            cost = charged_stamina(self.behaviors.get_stamina(variation, hit_judge), rate)
            stamina += cost
            if hand == LEFT_HAND_SOURCE:
                left_stamina += cost
            if EXTRA_HITBOX_JUDGES[0] <= hit_judge <= EXTRA_HITBOX_JUDGES[1]:
                extra_hitboxes = True
                continue
            atk_id = self.behaviors.get_attack(variation, hit_judge)
            atk = self.game.attacks.get(atk_id)
            if not atk or not any(get_motion_values(atk)):
                continue
            hits.append(
                {
                    "start": start,
                    "end": end,
                    "judge": hit_judge,
                    "atk": atk_id,
                    "mvs": get_motion_values(atk),
                    "bullet": event_type == BULLET_EVENT,
                    "index": attack_index,
                    "source": get_hit_source(atk),
                    "leftHand": hand == LEFT_HAND_SOURCE,
                    "cost": cost,
                }
            )
        # A mounted attack's window open from its start is the charging attack's, carried over (e.g.
        # the Zweihander's mounted R2 after starting to charge)
        if anim_id in MOUNTED_CHARGE_RELEASES:
            hits = [hit for hit in hits if hit["start"] > 0]
        merged = merge_hits(
            hits,
            both_weapons or (param["wepType"] in FIST_TYPES and hands == "2h"),
            param["wepType"] in HELD_ITEM_TYPES,
        )
        # A projectile that's the sheet's alternate version of a hit isn't another hit
        for value in parse_alternate_bullets(cell):
            alternate = next((hit for hit in merged if hit["bullet"] and main_mv(hit["mvs"]) == value), None)
            if alternate:
                merged.remove(alternate)
        cancels = self.animations.get_cancels(file_number, anim_id) if file_number is not None else {}
        # An attack whose hits cost nothing costs its first window's behavior's (the judge ending in
        # 0, as a second window's costs nothing, e.g. 101 after 100) instead: tested in game, the
        # Backhand Blade's one handed jumping R2 (judge 161, 0) costs 22, its 160's, not its
        # landing's (judge 550, 19), and its jump 10 more. But not where the weapon's own variation
        # makes them free, overriding the shared one's cost: tested in game (er-logger, in combat,
        # 2026-11-22), Rellana's Twin Blades' one handed jumping R2 (judges 163 and 164, 0 in 6701,
        # 10 in 6700) costs only its jump's 10, not its 160's 10. Why the Backhand Blade's pays isn't
        # known (its 161 is 0 in its own, shared, variation 6400)
        if not stamina:
            judges = [judge for _, _, judge, event_type, *_ in windows or [] if event_type != PC_BEHAVIOR_EVENT]
            first = min(judges, default=None)
            made_free = any(
                self.behaviors.get_behavior_id(variation, judge) != self.behaviors.get_behavior_id(variation // 100 * 100, judge)
                and self.behaviors.get_stamina(variation // 100 * 100, judge)
                for judge in judges
                if judge != 550
            )
            if first is not None and not made_free:
                stamina = charged_stamina(self.behaviors.get_stamina(variation, first // 10 * 10), rate)
        return file_number, hits, merged, cancels, extra_hitboxes, stamina, left_stamina


def merge_hits(hits, both_fists, held_items=False):
    """
    @param held_items true for perfume bottles and claws, whose swings with a projectile are one hit
    @param both_fists true for two handed unarmed and fists, which hit with both fists (and
    powerstance L1s, with both weapons)
    @returns the hits the windows make: which windows are the same hit (see the module docstring),
    all tested in game
    """
    merged = []
    for hit in hits:
        # A stream is one projectile's (its row's) hits, wherever it comes from (a perfume
        # bottle's moves from dummy poly 1 to 901); two handed, each bottle's has its own row
        stream = hit["atk"] if hit["bullet"] else None

        def joins(other):
            if stream:
                # The rest of a stream already part of a hit
                if stream in other["streams"]:
                    return True
                if other["bullet"] and other["atk"] == hit["atk"]:
                    return False
            if hit["start"] > other["end"] + 0.001:
                return False
            same_mvs = other["mvs"] == hit["mvs"]
            overlapping = hit["start"] < other["end"] - 0.001
            if hit["bullet"] and other["bullet"]:
                # Different projectiles, e.g. two handed perfume bottles' sprays
                return False
            if hit["bullet"] or other["bullet"]:
                # A held item's swing from the hand (a perfume bottle's or claws') and a projectile
                # at once are one hit, the projectile's: a perfume bottle's
                # powerstance jumping L1 is 82 + 82, not with its 71 swing, and the Claws of Night's
                # two handed R2 2 69 + 69, not with its 76 swing. A blade's swing and projectile are
                # separate, e.g. the Lizard Greatsword's R2, and so are a fist's punch and its
                # projectile, e.g. the Golem Fist's R2.
                swing = other if hit["bullet"] else hit
                return overlapping and held_items and swing["source"].startswith("body")
            if other["index"] == hit["index"] and other["source"] == hit["source"]:
                # One swing continuing in another window (not the other blade's, e.g. the
                # Backhand Blade's two handed R2 2)
                alternate = abs(hit["judge"] - other["judge"]) in ALTERNATE_JUDGE_OFFSETS
                return same_mvs or alternate
            # Several hitboxes at once on the same weapon or limb
            return same_mvs and overlapping and other["source"] == hit["source"] and not both_fists

        previous = next((other for other in reversed(merged) if joins(other)), None)
        if previous:
            previous["end"] = max(previous["end"], hit["end"])
            previous["cost"] = previous.get("cost", 0) + hit.get("cost", 0)
            if hit["bullet"] and not previous["bullet"]:
                previous.update(mvs=hit["mvs"], atk=hit["atk"], bullet=True)
        else:
            previous = {**hit, "streams": set()}
            merged.append(previous)
        if stream:
            previous["streams"].add(stream)
    return merged


# Animation IDs of the moveset's shared attacks' steps (see build_moveset_data.py's SHARED_ATTACKS),
# by step (critical hits': CRITICAL_ANIMATION_IDS)
SHARED_ATTACK_ANIMATION_IDS = {
    "Powerstance L1": [34000 + i * 10 for i in range(6)],
    "Powerstance Running L1": [34200],
    "Powerstance Rolling L1": [34300],
    "Powerstance Backstep L1": [34400],
    "Powerstance Jumping L1": [34530],
    "Mounted R1/L1": [38000, 38010, 38020],
    "Mounted R2/L2": [38110],
    "Mounted Charged R2/L2": [38100],
}


# Critical hits' animations (the same one and two handed), and how long after the press each starts.
# Tested in game (er-logger, 2026-11-23): Miséricorde's riposte (a23_031700) started 3-4 frames after
# R1 (8 times), against 1 for an attack from standing, so 4 frames rather than the usual 2; and
# Godslayer's Greatsword's backstab (a32_031710) 15 after (once), so 16. Backstabs of 32 weapons
# in 27 animation files (2026-11-25) started 14-16 frames after (most 15), and every hit landed within
# 2 frames of the calculator's except two 3 early after a 14-frame start (Serpentbone Blade's hit,
# Iron Cleaver's 2nd). Large ripostes on Margit (2026-11-25, log 21-38-01) started 3-4 frames after:
# Duelist Greataxe (a31) 4, Broadsword (a23) 3, Occult Iron Ball (a42) 3, and their hits landed
# within 2 frames of the calculator's by wall clock (the logger's frames fall behind in boss fights).
# The small riposte isn't measured and is taken as the riposte's
CRITICAL_ANIMATION_IDS = {"Backstab": 31710, "Riposte": 31700, "Small Riposte": 31720, "Large Riposte": 31750}
CRITICAL_STARTS = {"Backstab": 16 / 60, "Riposte": 4 / 60, "Small Riposte": 4 / 60, "Large Riposte": 4 / 60}


def get_critical_timing(steps, param, attack, moveset_step):
    """
    @param moveset_step the attack's moveset hits
    @returns a critical hit's timing (in get_timings's format), or None if its animation has no
    hits: its hits are CRITICAL_EVENTs, not attack windows. Its stamina is its hits' behaviors' without
    the weapon's staminaConsumptionRate: tested in game (er-logger, 2026-11-23), Miséricorde's
    riposte (judge 510, 14 in variation 100; rate 1.11) cost 14, and Godslayer's Greatsword's
    backstab (500 and 501, 12 and 13 in variation 400; rate 1.02) 12 + 13
    """
    anim_id = CRITICAL_ANIMATION_IDS[attack]
    files = [n for n in (int(param["spAtkcategory"]), int(param["wepmotionCategory"])) if n]
    file_number, _ = steps.animations.find(files, anim_id)
    if file_number is None:
        return None
    hits = steps.animations.get_critical_hits(file_number, anim_id)
    if not hits:
        return None

    def real(time):
        return steps.animations.to_real_time(file_number, anim_id, time)

    variation = int(param["behaviorVariationId"])
    costs = [steps.behaviors.get_stamina(variation, judge) for _, judge in hits]
    timing = {"start": round(CRITICAL_STARTS[attack], 3), "hits": [round(real(start), 3) for start, _ in hits]}
    cancels = {name: real(time) for name, time in steps.animations.get_cancels(file_number, anim_id).items()}
    button_cancels = sorted((cancels[name], name) for name in CANCEL_BUTTONS if name in cancels)
    if button_cancels:
        timing["cancels"] = {name: round(time, 3) for time, name in button_cancels}
    for name in ["rightHandAttack", "leftHandAttack", "roll", "block", "move", "jump", "quickL2", "L2"]:
        if name in cancels:
            timing[name] = round(cancels[name], 3)
    if "rightHandAttack" not in cancels:
        length = steps.animations.get_length(file_number, anim_id)
        if length is not None:
            timing["end"] = round(real(length), 3)
    if sum(costs):
        timing["stamina"] = sum(costs)
        if len(costs) > 1 and len(costs) == len(moveset_step):
            timing["hitStamina"] = costs
    return timing


# A crouching attack's animation is its rolling attack's plus this (e.g. the Greatsword's 032310, its
# 032300 slowed to 0.86 for its first 28 frames: tested in game, see get_attack_animation)
CROUCHING_ANIMATION_OFFSET = 10


def get_attack_animation(steps, param, attack, hands, step):
    """
    @returns the animation ID of a weapon's moveset attack's step, or None if it has none: for a
    crouching attack, its own animation (CROUCHING_ANIMATION_OFFSET) where the file with the rolling
    attack has one with hits, otherwise the rolling attack's, played instead. Tested in game at +25
    (+10 somber) with 99 in every stat on the training dummy, each as its rolling attack here:
    - the weapon's classes have none (most), e.g. the one handed Dagger's
    - the weapon's own file has its rolling attack but only its class's file has a crouching one:
      the two handed Falx's, 2 hits of 440 (its rolling R1's two, not its class's crouching R1's one)
    - the crouching animation has no hits (only effects): the Dark Moon Greatsword's (a129, 627
      damage and 10.175 stance one handed, 683 and 13.2 two handed) and the powerstance Sword Lance's
      (a39, 910 and 6.6)
    None where it hits with other behavior judges than the rolling attack, whose hits it copies
    """
    rolling = CROUCHING_ATTACKS.get(attack)
    if rolling is None:
        return get_animation_id(attack, hands, step)
    rolling_id = get_animation_id(rolling, hands, step)
    if rolling_id is None:
        return None
    files = [n for n in (int(param["spAtkcategory"]), int(param["wepmotionCategory"])) if n]
    rolling_file, rolling_windows = steps.animations.find(files, rolling_id)
    if rolling_file is None:
        return rolling_id
    crouching_windows = steps.animations.get_windows(rolling_file, rolling_id + CROUCHING_ANIMATION_OFFSET)
    if not crouching_windows:
        return rolling_id

    def judges(windows):
        return sorted((window[2], window[3]) for window in windows or [])

    return rolling_id + CROUCHING_ANIMATION_OFFSET if judges(crouching_windows) == judges(rolling_windows) else None


def get_animation_id(attack, hands, step):
    """@returns the animation ID of a moveset attack's step, or None if it has none"""
    if attack in ATTACKS:
        columns = ATTACKS[attack]
        if step >= len(columns):
            return None
        return ANIMATION_IDS[columns[step]] + (TWO_HANDED_ANIMATION_OFFSET if hands == "2h" else 0)
    anim_ids = SHARED_ATTACK_ANIMATION_IDS.get(attack, [])
    return anim_ids[step] if step < len(anim_ids) else None


def get_timings(steps, param, moveset):
    """
    @param steps a Steps
    @param moveset a weapon's build_moveset_data.py output
    @returns each attack step's timing, by hands and attack, in seconds from the step's start:
      - start: for tapped R2s, how long after the press the step starts (when its charged R2's
        charging window opens, see CHARGING_SPEFFECT); the rest are from the step's start
      - hits: when each hit's window opens (the hits the windows make, see the module docstring,
        which may differ from the moveset's)
      - cancels: when it can be cancelled into each of R1, R2, and L1 that it can ({ "R1": time })
      - rightHandAttack: when any right hand attack can start
      - leftHandAttack: when any left hand attack can start
      - roll: when a roll can start
      - block: when blocking can start
      - move: when moving can end the animation
      - jump: when a jump (or crouch) can start
      - landing: for jumping attacks, when any attack, a roll, blocking, moving, and another jump can start
        after landing (the lighter landing, JUMP_LANDING_OFFSET)
      - end: without a right hand attack cancel, when the animation ends (its .hkx's length), if
        its .hkx is unpacked (HKX_DIR)
      - stamina: what the step costs: its windows' behaviors' stamina (BehaviorParam_PC stamina)
        times the weapon's staminaConsumptionRate, each rounded down (charged_stamina)
      - leftStamina: how much of it the left hand's weapon's windows cost (powerstance attacks)
      - hitStamina: for steps of more than one hit, what each of the moveset's hits costs (its
        windows', matched by motion value, with any windows that aren't hits on the first), if they
        can all be matched
      - sweetSpot: true if every hit's window opens in a sweet spot (SWEET_SPOT_FLAG, flails')
    Each is left out if the animation doesn't allow it (e.g. jumping attacks, which end on landing)
    """
    timings = {}
    for hands in ["1h", "2h"]:
        for attack, attack_steps in moveset.get(hands, {}).items():
            step_timings = []
            if attack in CRITICAL_ANIMATION_IDS:
                timing = get_critical_timing(steps, param, attack, attack_steps[0])
                if timing:
                    timings.setdefault(hands, {})[attack] = [timing]
                continue
            for index in range(len(attack_steps)):
                anim_id = get_attack_animation(steps, param, attack, hands, index)
                if anim_id is None:
                    break
                both_weapons = attack.startswith("Powerstance") and param["wepType"] != HAND_TO_HAND_ARTS_TYPE
                file_number, _, merged, cancels, _, stamina, left_stamina = steps.get_step(
                    param, hands, anim_id, both_weapons=both_weapons
                )
                if file_number is None or not merged:
                    break
                # In real time, where the animation plays faster or slower (ANIM_SPEED_EVENT)
                def real(time):
                    return steps.animations.to_real_time(file_number, anim_id, time)

                cancels = {name: real(time) for name, time in cancels.items()}
                timing = {"hits": [round(real(hit["start"]), 3) for hit in merged]}
                if attack in TAPPED_R2_ATTACKS:
                    charged_id = get_animation_id(TAPPED_R2_ATTACKS[attack], hands, index)
                    files = [n for n in (int(param["spAtkcategory"]), int(param["wepmotionCategory"])) if n]
                    charging = steps.animations.get_effect_start(files, charged_id, CHARGING_SPEFFECT)
                    if charging is not None:
                        charged_file, _ = steps.animations.find(files, charged_id)
                        charging = steps.animations.to_real_time(charged_file, charged_id, charging)
                        timing = {"start": round(charging + CHARGING_LAG, 3), **timing}
                button_cancels = sorted(
                    (cancels[name], name) for name in CANCEL_BUTTONS if name in cancels
                )
                if button_cancels:
                    timing["cancels"] = {name: round(time, 3) for time, name in button_cancels}
                for name in ["rightHandAttack", "leftHandAttack", "roll", "block", "move", "jump", "quickL2", "L2"]:
                    if name in cancels:
                        timing[name] = round(cancels[name], 3)
                # Without a right hand attack cancel, the attack can only be repeated once it ends
                # (but jumping attacks end on landing: their animation is the time in the air)
                if "rightHandAttack" not in cancels and "Jumping" not in attack:
                    length = steps.animations.get_length(file_number, anim_id)
                    if length is not None:
                        timing["end"] = round(real(length), 3)
                # A jumping attack's landing recovery, from when it lands (the time in the air depends
                # on the jump, not the animations)
                if "Jumping" in attack:
                    landing_id = anim_id + JUMP_LANDING_OFFSET
                    files = [n for n in (int(param["spAtkcategory"]), int(param["wepmotionCategory"])) if n]
                    landing_file, _ = steps.animations.find(files, landing_id)
                    if landing_file is not None:
                        landing_cancels = steps.animations.get_cancels(landing_file, landing_id)
                        landing = {
                            name: round(steps.animations.to_real_time(landing_file, landing_id, time), 3)
                            for name, time in landing_cancels.items()
                            if name in ("rightHandAttack", "roll", "block", "move", "jump")
                        }
                        if landing:
                            timing["landing"] = landing
                # A jumping attack's 0 is kept, for its jump's stamina to be added to (e.g. Rellana's
                # Twin Blades' one handed jumping R2's)
                if stamina or "Jumping" in attack:
                    timing["stamina"] = round(stamina, 2)
                if left_stamina:
                    timing["leftStamina"] = round(left_stamina, 2)
                matched = match_hits(attack_steps[index], merged)
                if stamina and matched and len(matched) > 1:
                    costs = [hit.get("cost", 0) for hit in matched]
                    costs[0] += stamina - sum(costs)
                    timing["hitStamina"] = [round(cost, 2) for cost in costs]
                sweet_spots = steps.animations.get_sweet_spots(file_number, anim_id)
                if sweet_spots and all(
                    any(start < hit["end"] and end > hit["start"] for start, end in sweet_spots)
                    for hit in merged
                ):
                    timing["sweetSpot"] = True
                step_timings.append(timing)
            if step_timings:
                timings.setdefault(hands, {})[attack] = step_timings
    return timings


def match_hits(step, merged):
    """
    @param step a moveset step's hits
    @param merged the hits the step's windows make (Steps.get_step)
    @returns the merged hit for each of the moveset's hits, matched by motion value (right hand hits
    first, so equal ones split one each), or None if they don't all match
    """
    if len(merged) != len(step):
        return None
    pool = sorted(merged, key=lambda hit: hit["leftHand"])
    matched = []
    for hit in step:
        motion_value = max(hit[0]) if isinstance(hit[0], list) else hit[0]
        match = next((other for other in pool if main_mv(other["mvs"]) == motion_value), None)
        if match is None:
            return None
        pool.remove(match)
        matched.append(match)
    return matched


def get_shared_hits(steps, param, moveset):
    """
    @param steps a Steps
    @param moveset a weapon's build_moveset_data.py output
    @returns for each powerstance and mounted attack's step (the sheet's shared columns, which
    aren't matched to game rows otherwise), its hits matched to the moveset's by motion value, by
    hands and attack ({ "1h": { attack: [step hits or None] } }). Each hit is { "judge": behavior
    judge ID or False, for the left hand's weapon's hits (AttackBehavior Source; e.g. the Longsword's
    powerstance L1 1's second hit; never for hand-to-hand arts), "buffMotionValue": its AtkParam
    spEffectAtkPowerCorrectRate_byPoint, as text }, e.g. 90 for most powerstance hits (tested: two Serpent
    Flails' powerstance jumping L1 with Flare, O Serpent). Steps that can't be matched are None.
    """
    hand_to_hand = param["wepType"] == HAND_TO_HAND_ARTS_TYPE
    result = {}
    for hands in ["1h", "2h"]:
        for attack, attack_steps in moveset.get(hands, {}).items():
            powerstance = attack.startswith("Powerstance")
            if not powerstance and not attack.startswith("Mounted"):
                continue
            both_weapons = powerstance and not hand_to_hand
            marks = []
            for index, step in enumerate(attack_steps):
                anim_id = get_attack_animation(steps, param, attack, hands, index)
                file_number, _, merged, _, _, _, _ = (
                    steps.get_step(param, hands, anim_id, both_weapons=both_weapons) if anim_id else (None,) * 7
                )
                matched = match_hits(step, merged) if file_number is not None else None
                marks.append(
                    [
                        {
                            "judge": match["judge"] if match["leftHand"] and both_weapons else False,
                            "buffMotionValue": steps.game.attacks[match["atk"]][
                                "spEffectAtkPowerCorrectRate_byPoint"
                            ],
                        }
                        for match in matched
                    ]
                    if matched
                    else None
                )
            result.setdefault(hands, {})[attack] = marks
    return result


def get_left_hand_rows(steps, param, judges):
    """
    @param judges behavior judge IDs of powerstance hits with the left hand's weapon
    @returns the weapon's own motion value, stance motion value, and stamina cost for each of the
    judges, through its behavior variation, as { judge: [motion value, stance, stamina] }: the left
    hand's weapon's hits use its own attack rows, e.g. a Wakizashi's L1 #1 with a katana (115, not
    the katana's 90), and its own behaviors' stamina (times its staminaConsumptionRate, rounded down)
    """
    rows = {}
    variation = int(param["behaviorVariationId"])
    rate = float(param["staminaConsumptionRate"])
    for judge in sorted(judges):
        atk = steps.game.attacks.get(steps.behaviors.get_attack(variation, judge))
        if atk and any(get_motion_values(atk)):
            rows[str(judge)] = [
                main_mv(get_motion_values(atk)),
                float(atk["atkSuperArmorCorrection"]),
                charged_stamina(steps.behaviors.get_stamina(variation, judge), rate),
            ]
    return rows


def get_step_columns(param):
    """
    @returns each step the sheet can have for a weapon: (hands, sheet columns, label, animation ID)
    """
    one_handed = param["bothHandEquipable"] == "0"
    for hands in ["1h"] if one_handed else ["1h", "2h"]:
        for columns in ATTACKS.values():
            for column in columns:
                anim_id = ANIMATION_IDS[column] + (TWO_HANDED_ANIMATION_OFFSET if hands == "2h" else 0)
                yield hands, (f"{hands} {column}",), f"{hands} {column}", anim_id
    for columns, anim_id in SHARED_ANIMATION_IDS.items():
        yield "1h", columns, " + ".join(columns), anim_id


def main():
    game_dir = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    weapons = read_weapons(game_dir, project_dir)
    motion = read_tab(project_dir, "MotionValues")
    steps = Steps(game_dir, project_dir)

    rows_out = []
    extra_hitboxes = defaultdict(set)
    findings = defaultdict(list)
    counts = defaultdict(int)
    for weapon, sheet_row in motion.items():
        if weapon not in weapons or weapons[weapon]["wepType"] in RANGED_WEAPON_TYPES:
            continue
        param = weapons[weapon]
        for hands, columns, label, anim_id in get_step_columns(param):
            # The sheet, with the corrections the calculator makes to it
            fixed = {**sheet_row, **MOTION_VALUE_FIXES.get(weapon, {})}
            cell = " + ".join(fixed.get(column, "").strip() for column in columns if fixed.get(column, "").strip())
            sheet_mvs = parse_numbers(cell)
            if not sheet_mvs and cell:
                # Hits grouped in parentheses, e.g. the Lance's "(40+40) + (40+40) + (100+100)"
                sheet_mvs = parse_numbers(cell.replace("(", "").replace(")", ""))
            # Powerstance L1s hit with both weapons, except hand-to-hand arts' (limbs)
            both_weapons = columns[0].startswith("Paired") and param["wepType"] != HAND_TO_HAND_ARTS_TYPE
            file_number, hits, merged, _, extra, _, _ = steps.get_step(param, hands, anim_id, cell, both_weapons)
            if anim_id in MOUNTED_CHARGED and len(merged) > 2 and len(sheet_mvs) == 2:
                # The charging hit repeats; compare its first and the charged hit
                merged = [merged[0], merged[-1]]
            if extra:
                extra_hitboxes[weapon].add(label)
            if not sheet_mvs and not hits:
                continue
            for hit in hits:
                rows_out.append(
                    [weapon, label, f"a{file_number:02d}_{anim_id:06d}", f"{hit['start']:.3f}", f"{hit['end']:.3f}",
                     hit["judge"], hit["atk"], format_mv(hit["mvs"]), "bullet" if hit["bullet"] else "weapon"]
                )

            charged_only = (
                anim_id in MOUNTED_CHARGED and len(merged) == 1 and len(sheet_mvs) == 2
                and main_mv(merged[0]["mvs"]) == sheet_mvs[-1]
            )
            # A weapon with its own animations falls back to its class's for any it doesn't have,
            # but steps the sheet doesn't have aren't reachable (tested in game: the Smithscript
            # Axe's R2 is always its throw, never the class's R2 2)
            class_only = int(param["spAtkcategory"]) > 0 and file_number == int(param["wepmotionCategory"])

            def compare(found):
                if not found:
                    return "No hits in the animations"
                if not sheet_mvs:
                    return CLASS_ONLY if class_only else "Not in the sheet"
                if charged_only:
                    return CHARGED_ONLY
                if len(found) != len(sheet_mvs):
                    return "Different number of hits"
                if sorted(main_mv(hit["mvs"]) for hit in found) != sorted(sheet_mvs):
                    return "Different motion values"
                return None

            kind = compare(merged)
            if not kind:
                counts["match"] += 1
                continue
            counts[kind] += 1
            findings[kind].append(
                (weapon, label, cell or "-", format_hits(hits) or "-",
                 f"a{file_number:02d}_{anim_id:06d}" if file_number is not None else "-")
            )

    with open(os.path.join(project_dir, "data", "animation-hits.csv"), "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["weapon", "attack", "animation", "start", "end", "judge", "atkParam", "mv", "kind"])
        writer.writerows(rows_out)

    order = [
        "Different number of hits",
        "Different motion values",
        "Not in the sheet",
        CLASS_ONLY,
        CHARGED_ONLY,
        "No hits in the animations",
    ]
    lines = [
        "# Animation check",
        "",
        "The motion value sheet's basic attacks (with build_moveset_data.py's MOTION_VALUE_FIXES)",
        "against the game's animations (generated by",
        "scripts/check_animations.py, which explains how hits are found). Times are when each hit's",
        "window opens, from the start of its animation. Motion values are physical, or each damage",
        "type's (physical/magic/fire/lightning/holy) if they differ.",
        "",
        f"{counts['match']} steps match. " + ", ".join(f"{kind}: {counts[kind]}" for kind in order) + ".",
    ]
    for kind in order:
        if not findings[kind]:
            continue
        lines += ["", f"## {kind}", "", "| Weapon | Attack | Sheet | Animation hits | Animation |", "|---|---|---|---|---|"]
        for finding in findings[kind]:
            lines.append("| " + " | ".join(text.replace("|", "\\|") for text in finding) + " |")
    if extra_hitboxes:
        lines += [
            "",
            "## Extra hitboxes",
            "",
            "Small hitboxes (judge IDs 990-999, e.g. AtkParam 6700997: 0.2 radius on dummy polys",
            "110-120, 100 motion values) left out of the counts above:",
            "",
        ]
        lines += [f"- {weapon}: {', '.join(sorted(attacks))}" for weapon, attacks in extra_hitboxes.items()]
    out_path = os.path.join(project_dir, "data", "sheets", "mv", "ANIMATION_CHECK.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{counts['match']} match, " + ", ".join(f"{kind}: {counts[kind]}" for kind in order) + f" -> {out_path}")


if __name__ == "__main__":
    main()
