"""
Read weapons' basic attacks from the game's own attack data, decoded with extract_param.py:
data/BehaviorParam_PC-vanilla.csv, data/AtkParam_Pc-vanilla.csv, and data/Bullet-vanilla.csv.

A weapon's behaviorVariationId and an attack's behavior judge ID pick a BehaviorParam_PC row, which
points to the AtkParam_Pc row with the attack's motion values (refType 0), or to a Bullet row for a
projectile (refType 1), whose atkId_Bullet is the AtkParam_Pc row. A unique variation (e.g. 209) only
lists the attacks that differ from its class's variation (200), so other attacks come from the
class's variation. Rows with no motion values are skipped. Multi-hit attacks and projectiles use
consecutive judge IDs (e.g. 105, 106, 107); judge IDs 3 and 4 past an attack are alternate
versions of its hits, not extra hits. Two handed attacks are 200 judge IDs later.

This can't tell how many times one row hits (that's in the animation files), so the motion value
sheet is used for which hits an attack has, and this for details the sheet leaves out.
"""

import csv
import os
from collections import defaultdict

# Behavior judge ID for each spreadsheet column (one handed)
JUDGE_IDS = {
    **{f"R1 {i}": (i - 1) * 10 for i in range(1, 7)},
    "R2 1": 100,
    "Charged R2 1": 105,
    "R2 2": 110,
    "Charged R2 2": 115,
    "Running R1": 120,
    "Running R2": 125,
    "Rolling R1": 130,
    "Backstep R1": 140,
    "Jumping R1": 150,
    "Jumping R2": 160,
    "Guard Counter": 180,
}
TWO_HANDED_OFFSET = 200
MAX_HITS = 3

# Motion value fields, in AttackPowerType order (physical, magic, fire, lightning, holy)
CORRECTION_FIELDS = [
    "atkPhysCorrection",
    "atkMagCorrection",
    "atkFireCorrection",
    "atkThunCorrection",
    "atkDarkCorrection",
]

ATTACK_REF_TYPE = "0"
BULLET_REF_TYPE = "1"

# Behavior rows from this ID on aren't part of a weapon's basic moveset: Ashes of War (e.g.
# 300406905) and shared extras (e.g. 600200100)
NON_MOVESET_BEHAVIOR_IDS = 300_000_000


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def get_motion_values(hit):
    """@returns a hit's motion value for each damage type"""
    return [float(hit[field]) for field in CORRECTION_FIELDS]


class GameAttacks:
    def __init__(self, project_dir):
        data_dir = os.path.join(project_dir, "data")
        self.attacks = {
            int(row["id"]): row for row in read_csv(f"{data_dir}/AtkParam_Pc-vanilla.csv")
        }
        bullets = {int(row["id"]): row for row in read_csv(f"{data_dir}/Bullet-vanilla.csv")}
        # AtkParam_Pc row ID for each variation and judge ID
        self.behaviors = defaultdict(dict)
        # Several rows can share a variation and judge ID; the one with the lowest ID is the
        # regular attack (e.g. 100310 rather than 300100310)
        for row in sorted(
            read_csv(f"{data_dir}/BehaviorParam_PC-vanilla.csv"), key=lambda row: int(row["id"])
        ):
            if int(row["id"]) >= NON_MOVESET_BEHAVIOR_IDS:
                continue
            if row["refType"] == ATTACK_REF_TYPE:
                atk_id = int(row["refId"])
            elif row["refType"] == BULLET_REF_TYPE and int(row["refId"]) in bullets:
                atk_id = int(bullets[int(row["refId"])]["atkId_Bullet"])
            else:
                continue
            judges = self.behaviors[int(row["variationId"])]
            judges.setdefault(int(row["behaviorJudgeId"]), atk_id)

    def get_hits(self, weapon, column, two_handed):
        """
        @param weapon the weapon's EquipParamWeapon row
        @param column a motion value sheet column without "1h "/"2h ", e.g. "R2 1"
        @returns the AtkParam_Pc rows for the attack's hits, or None if the game has no such attack
        """
        judge_id = JUDGE_IDS[column] + (TWO_HANDED_OFFSET if two_handed else 0)
        variation = int(weapon["behaviorVariationId"])
        unique = self.behaviors.get(variation, {})
        base = self.behaviors.get(variation // 100 * 100, {})
        hits = []
        for i in range(MAX_HITS):
            atk_id = unique.get(judge_id + i, base.get(judge_id + i))
            hit = self.attacks.get(atk_id)
            # Rows with no motion values (e.g. a shove before the real hit) don't do damage
            if hit and any(get_motion_values(hit)):
                hits.append(hit)
        return hits or None

    def get_candidate_rows(self, weapon, column, two_handed):
        """
        Rows that may be an attack's hits, for matching the sheet's hits to game rows, best first.
        This is wider than get_hits:
        - Paired weapons' two handed attacks hit with both weapons, and R1s (judge IDs 10 apart)
          use 5 IDs later for the second weapon (e.g. Rellana's Twin Blades: 200 for the magic
          blade, 205 for the fire blade).
        - Two handed paired weapons use their one handed attack where they have no two handed
          one, e.g. Rellana's Twin Blades' R2s.
        - Every other row of the weapon's unique variation, as a last resort, e.g. Rellana's Twin
          Blades' two handed jumping R2 matches its one handed jumping R1, nearest judge ID first.
          Not the class's variation, which has too many unrelated rows.
        """
        variation = int(weapon["behaviorVariationId"])
        unique = self.behaviors.get(variation, {})
        base = self.behaviors.get(variation // 100 * 100, {})
        paired = weapon["isDualBlade"] == "1"
        offsets = list(range(MAX_HITS))
        if paired and two_handed and column.startswith("R1 "):
            offsets += [5 + i for i in range(MAX_HITS)]

        def rows(judges, judge_id):
            return [judges[judge_id + i] for i in offsets if judge_id + i in judges]

        judge_id = JUDGE_IDS[column]
        two_handed_id = judge_id + TWO_HANDED_OFFSET
        sources = (
            [(unique, two_handed_id)]
            + ([(unique, judge_id)] if paired else [])
            + [(base, two_handed_id)]
            if two_handed
            else [(unique, judge_id), (base, judge_id)]
        )
        # The first variation that has the attack, like the game
        attack_rows = next((found for found in (rows(*source) for source in sources) if found), [])
        target = two_handed_id if two_handed else judge_id
        other_rows = (
            [unique[judge] for judge in sorted(unique, key=lambda judge: abs(judge - target))]
            if variation != variation // 100 * 100
            else []
        )
        candidates = []
        for atk_id in attack_rows + other_rows:
            hit = self.attacks.get(atk_id)
            if hit and any(get_motion_values(hit)) and hit not in candidates:
                candidates.append(hit)
        return candidates, len([atk_id for atk_id in attack_rows if atk_id in self.attacks])
