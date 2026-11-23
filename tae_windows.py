"""
Print the TAE hit windows of player animations as JSON, for summarize.mjs.

    python3 -I tae_windows.py 29030000 29030010:8100010 ...

Animation IDs are as the game reports them: file * 1000000 + animation (29030000 = a29, 030000).
Output: {"29030000": {"file": 29, "windows": [[start, end], ...], "length": frames}, ...} in 60 fps
frames from the animation's start, with speed changes applied. Uses the stat calculator's TAE reader.

An animation given as ID:weapon (the weapon's EquipParamWeapon ID as the logger reads it, with affinity
and upgrade level) also gets "stamina": each window's behavior's stamina cost, after the weapon's
staminaConsumptionRate and rounded down, as the stat calculator counts it (0 for a window whose
behavior costs none, e.g. Cursed-Blood Slice's judge 3900 push before its slash).
"""
import csv
import json
import math
import os
import sys

CALCULATOR = os.path.expanduser("~/elden_ring/stat-calculator/scripts")
GAME = "/mnt/c/Program Files (x86)/Steam/steamapps/common/ELDEN RING/Game"
sys.path.insert(0, CALCULATOR)
from check_animations import Animations  # noqa: E402

DATA = os.path.join(os.path.dirname(CALCULATOR), "data")
# PCBehavior windows (event 307) whose type isn't an attack's (16) cost nothing, as in check_animations
PC_BEHAVIOR_EVENT, PC_BEHAVIOR_ATTACK_TYPE = 307, 16

animations = Animations(GAME)
weapons, behaviors = None, None


def stamina_costs(weapon_id, windows):
    """@returns each window's stamina cost for a weapon, or None if the weapon isn't known"""
    global weapons, behaviors
    if weapons is None:
        with open(os.path.join(DATA, "EquipParamWeapon-vanilla.csv"), encoding="utf-8") as f:
            weapons = {int(row["id"]): row for row in csv.DictReader(f)}
        with open(os.path.join(DATA, "BehaviorParam_PC-vanilla.csv"), encoding="utf-8") as f:
            behaviors = {int(row["id"]): int(row["stamina"]) for row in csv.DictReader(f)}
    # the row without the upgrade level (affinities have their own rows, 100 apart)
    row = weapons.get(weapon_id // 100 * 100)
    if row is None:
        return None
    variation = int(row["behaviorVariationId"])
    rate = float(row["staminaConsumptionRate"])
    costs = []
    for _, _, judge, event_type, attack_index, *_ in windows:
        cost = 0
        if not (event_type == PC_BEHAVIOR_EVENT and attack_index != PC_BEHAVIOR_ATTACK_TYPE):
            # the behavior for the weapon's variation, or its class's, or the common one
            for source in dict.fromkeys([variation, variation // 100 * 100, 0]):
                behavior_id = max(1, judge // 1000) * 100_000_000 + source * 1000 + judge % 1000
                if behavior_id in behaviors:
                    cost = math.floor(behaviors[behavior_id] * rate + 1e-9)
                    break
        costs.append(cost)
    return costs


out = {}
for arg in sys.argv[1:]:
    anim_arg, _, weapon_arg = arg.partition(":")
    full = int(anim_arg)
    file, anim = divmod(full, 1000000)
    # an animation missing from its weapon type's file comes from the common one (a00)
    number, windows = animations.find([file, 0], anim)
    if windows is None:
        out[arg] = None
        continue
    real = lambda t: round(animations.to_real_time(number, anim, t) * 60, 1)
    length = animations.get_length(number, anim)
    out[arg] = {
        "file": number,
        "windows": [[real(start), real(end)] for start, end, *_ in windows],
        "length": real(length) if length else None,
    }
    if weapon_arg:
        out[arg]["stamina"] = stamina_costs(int(weapon_arg), windows)
print(json.dumps(out))
