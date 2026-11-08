import { useEffect, useState } from "react";
import { allDamageTypes, WeaponType, type Weapon } from "../calculator/calculator.ts";
import { allPhysicalTypes } from "../optimizer/defense.ts";
import type { AttackData, AttackDataHit, StepTimes } from "../optimizer/build.ts";

export const allAttacks = [
  "R1",
  "R2",
  "Charged R2",
  "Running R1",
  "Running R2",
  "Rolling R1",
  "Backstep R1",
  "Jumping R1",
  "Jumping R2",
  "Jump Shot + Landing Shot",
  "Guard Counter",
  "Backstab",
  "Riposte",
  "Large Riposte",
  "Small Riposte",
  "Powerstance L1",
  "Powerstance Running L1",
  "Powerstance Rolling L1",
  "Powerstance Backstep L1",
  "Powerstance Jumping L1",
  "Mounted R1",
  "Mounted R2",
  "Mounted Charged R2",
] as const;

export type AttackName = typeof allAttacks[number];

/** A single hit with 100 motion values for everything, i.e. the weapon's plain attack power */
export const baseAttack = "base";
export type AttackChoice = AttackName | typeof baseAttack;

/** Attacks that are chains of several steps, weighted towards the first */
export const chainAttacks: ReadonlySet<AttackName> = new Set([
  "R1",
  "R2",
  "Charged R2",
  "Powerstance L1",
  "Mounted R1",
]);

/** Critical hits, which some enemies take less damage from */
const criticalAttacks: ReadonlySet<string> = new Set([
  "Backstab",
  "Riposte",
  "Large Riposte",
  "Small Riposte",
]);

/** Ripostes, which depend on the enemy (most get one of them, some none) */
export const riposteAttacks: ReadonlySet<string> = new Set([
  "Riposte",
  "Large Riposte",
  "Small Riposte",
]);

/**
 * The button repeated for an attack's DPS, for attacks that can be repeated back to back (a chain
 * starts again after its last step). Others are repeated once any attack can start.
 */
const repeatButtons: Partial<Record<AttackName, NonNullable<StepTiming["next"]>["attack"]>> = {
  R1: "R1",
  R2: "R2",
  "Charged R2": "R2",
  "Powerstance L1": "L1",
  "Mounted R1": "R1",
};

/**
 * Each step starts about a frame after the cancel into it opens. Tested in game on 60 fps
 * recordings, between hits: a Rapier's two handed R1 chain took 194 frames from its first hit to its
 * sixth (184 without the delay), a Longsword's one handed R1 chain 158 from its first to its fifth,
 * twice (150), then 79 to the next chain's first (78), and an Uchigatana's 152 and 151 (152). Not
 * for tapped R2s, whose start (from the press, with its lag) already has it: a Longsword's two
 * handed tapped R2 chain took 136 and 141 frames (142 with it, 138 without), about the 2.32s 50 of
 * them took by stopwatch.
 */
export const stepStartDelay = 1 / 30;

/**
 * Jumping attacks, from the jump press: the attack starts this long after it at the earliest (an
 * earlier press waits for it), and it lands this much later (its landing's recovery is the lighter
 * one, recorded with each jumping attack). Tested in game on 60 fps recordings of a Rapier's one
 * handed jumping R1 (its window at 10 frames into the swing, 30 fps): pressed 13 and 14 frames after
 * the jump, it hit at 36 and landed at 53, twice; pressed 3 frames after, it hit at 37. Assumed the
 * same for every weapon and jumping attack. (An R1 after it is R1 2, tested on several weapons.)
 */
const jumpAttackStart = 14 / 60;
const jumpAirTime = 53 / 60;

/** Chains cut short: to a number of steps, or the steps that fit a time budget */
export type ChainLimit = { steps: number } | { seconds: number };

/**
 * @returns each step's times, or undefined if the timings don't have them all. A chain cut short
 * (lastStep) ends with any attack, not its next step.
 */
function getStepTimes(
  attack: AttackName,
  timing: StepTiming[] | undefined,
  stepCount: number,
  cutShort = false,
): StepTimes[] | undefined {
  if (!timing || timing.length < stepCount) return undefined;
  const button = repeatButtons[attack];
  return timing.slice(0, stepCount).map((step, i) => {
    // From the jump press: the attack, and its landing recovery once it lands; repeated by jumping
    // again
    const { landing } = step;
    if (landing) {
      const lead = jumpAttackStart + stepStartDelay;
      const next = landing.anyAttack != null ? jumpAirTime + landing.anyAttack : undefined;
      const repeat = landing.jump;
      return {
        lead,
        hits: step.hits.map((time) => lead + time),
        ...(next != null && { next: { attack: "any attack" as const, time: next } }),
        ...(next != null && { anyAttack: next }),
        ...(landing.roll != null && { roll: jumpAirTime + landing.roll }),
        ...(landing.block != null && { block: jumpAirTime + landing.block }),
        ...(repeat != null && { cycle: jumpAirTime + repeat }),
      };
    }
    const lead = step.start ?? stepStartDelay;
    const own = button && !(cutShort && i === stepCount - 1) ? step.cancels?.[button] : undefined;
    const repeat = own ?? step.anyAttack ?? step.end;
    const next =
      own != null && (step.anyAttack == null || own <= step.anyAttack)
        ? { attack: button!, time: lead + own }
        : step.anyAttack != null
        ? { attack: "any attack" as const, time: lead + step.anyAttack }
        : undefined;
    return {
      lead,
      hits: step.hits.map((time) => lead + time),
      ...(next && { next }),
      ...(step.anyAttack != null && { anyAttack: lead + step.anyAttack }),
      ...(step.roll != null && { roll: lead + step.roll }),
      ...(step.block != null && { block: lead + step.block }),
      ...(repeat != null && { cycle: lead + repeat }),
    };
  });
}

/**
 * @returns how many of a chain's steps it's limited to: a number of steps, or the steps that fit a
 * time budget from the press until a roll can start after them (at least one)
 */
function getChainLength(
  attack: AttackName,
  timing: StepTiming[] | undefined,
  stepCount: number,
  limit: ChainLimit | undefined,
) {
  if (!limit || !chainAttacks.has(attack)) return stepCount;
  if ("steps" in limit) return Math.max(1, Math.min(stepCount, Math.floor(limit.steps)));
  const times = getStepTimes(attack, timing, stepCount);
  if (!times) return stepCount;
  let elapsed = 0;
  let count = 0;
  for (const step of times) {
    const roll = step.roll ?? step.anyAttack;
    if (roll == null || elapsed + roll > limit.seconds + 1e-9) break;
    count++;
    if (step.cycle == null) break;
    elapsed += step.cycle;
  }
  return Math.max(1, count);
}

/**
 * Flails' weapon hits do 12.5% more damage at the start of their hit windows (the sweet spot), in
 * the steps whose animations mark it (StepTiming sweetSpot): not their backstabs, ripostes, or
 * mounted charged R2, or Spinning Chain (the Flail +25's spin tested at 419, no bonus). Tested in game at 99 in every stat on the training dummy: the Serpent Flail +10's
 * first one handed R1 644 and R2 811 (572 and 721 without), and 493 and 618 at 99 Dexterity and 21
 * Faith (438 and 548 without); a Flail +25's too.
 */
const flailSweetSpotRate = 1.125;

/** Attacks that are always one handed, whatever the two handing setting */
const oneHandedAttacks: ReadonlySet<string> = new Set([
  "Powerstance L1",
  "Powerstance Running L1",
  "Powerstance Rolling L1",
  "Powerstance Backstep L1",
  "Powerstance Jumping L1",
]);

/**
 * [motion value, status motion value, stance motion value, physical type index, details?]. The
 * motion value is a list of one per damage type (by AttackPowerType) if they differ.
 */
type MovesetHit = [
  number | number[],
  number,
  number,
  number,
  {
    /** Flat attack for each damage type */
    flat?: number[];
    /** What kind of hit this is, if it isn't the weapon itself, e.g. "Projectile" */
    kind?: string;
    /** True if this hit doesn't get two handing's Strength bonus */
    noTwoHandBonus?: boolean;
    /** Which stats scale this hit's flat attack, if not the weapon's own */
    correct?: Weapon["attackElementCorrect"];
    /** Attack subcategories, which some buffs only apply to */
    categories?: number[];
    /** How much of a weapon buff's flat attack the hit gets, in percent, if not 100 */
    buffMotionValue?: number;
    /** True for a powerstance hit with the left hand's weapon */
    leftHand?: boolean;
    /** For a left hand hit, its behavior judge ID, to look up the left hand's weapon's own row */
    judge?: number;
  }?,
];

/** When things happen in an attack step, from scripts/check_animations.py's get_timings */
export interface StepTiming {
  /** For tapped R2s, how long after the press the step starts (the rest are from its start) */
  start?: number;
  hits: number[];
  /** The stamina the step costs */
  stamina?: number;
  /** How much of the step's stamina the left hand's weapon costs (powerstance attacks) */
  leftStamina?: number;
  /** For steps of more than one hit, what each of the moveset's hits costs */
  hitStamina?: number[];
  /** True if its hits are in a flail's sweet spot (flailSweetSpotRate) */
  sweetSpot?: true;
  next?: { attack: "R1" | "R2" | "L1"; time: number };
  /** When it can be cancelled into each of R1, R2, and L1 that it can */
  cancels?: Partial<Record<"R1" | "R2" | "L1", number>>;
  /** Without an any attack cancel (anyAttack), when the animation ends */
  end?: number;
  anyAttack?: number;
  roll?: number;
  /** When blocking can start */
  block?: number;
  /**
   * For jumping attacks, when any attack, a roll, blocking, and another jump can start after landing
   * (the time in the air depends on the jump, not the animations: see jumpAirTime)
   */
  landing?: { anyAttack?: number; roll?: number; block?: number; jump?: number };
}

/** A weapon's basic attacks, generated by scripts/build_moveset_data.py */
interface Moveset {
  poise: number;
  /** The weapon's own physical damage type, as an index into allPhysicalTypes */
  type: number;
  /** Set for weapons that can't be two handed */
  oneHanded?: true;
  "1h"?: Partial<Record<AttackName, MovesetHit[][]>>;
  "2h"?: Partial<Record<AttackName, MovesetHit[][]>>;
  /**
   * Each attack step's timing from the game's animations, in seconds from the step's start: when
   * each hit's window opens, the earliest attack it can be cancelled into and when, when any attack
   * can start, and when a roll can (not used yet)
   */
  timing?: Partial<Record<"1h" | "2h", Partial<Record<AttackName, StepTiming[]>>>>;
  /**
   * The weapon's own motion value, poise motion value, and stamina cost for each behavior judge ID
   * of the left hand's powerstance hits, for when it's in the left hand with another weapon
   */
  leftHandRows?: Record<string, [number, number, number]>;
}

export type Movesets = Record<string, Moveset>;

/**
 * @returns a powerstance attack with its left hand hits using the off hand weapon's own attack rows:
 * the right hand weapon's animations decide the hits, but each hand's weapon has its own motion values
 * and poise for them (e.g. a Wakizashi's L1 #1 with a katana, 115 and 80, not the katana's 90 and 40),
 * scaled by the ratio of the two weapons' rows, and its own stamina cost for them
 */
export function withOffhandRows(
  attack: AttackData,
  movesets: Movesets,
  mainWeaponName: string,
  offhandWeaponName: string,
): AttackData {
  const mainRows = movesets[mainWeaponName]?.leftHandRows;
  const offhandRows = movesets[offhandWeaponName]?.leftHandRows;
  if (!mainRows || !offhandRows || mainWeaponName === offhandWeaponName) return attack;
  const rowsOf = (hit: AttackDataHit) =>
    hit.leftHand && hit.judge != null
      ? { main: mainRows[hit.judge], offhand: offhandRows[hit.judge] }
      : undefined;
  // Rounded, so 90 × 115 / 90 is 115
  const scale = (value: number, rate: number) => Math.round(value * rate * 1e6) / 1e6;
  const steps = attack.steps.map((step) =>
    step.map((hit) => {
      const { main, offhand } = rowsOf(hit) ?? {};
      if (!main || !offhand || !main[0]) return hit;
      const rate = offhand[0] / main[0];
      const poiseRate = main[1] ? offhand[1] / main[1] : 1;
      return {
        ...hit,
        motionValue: scale(hit.motionValue, rate),
        ...(hit.motionValues && {
          motionValues: hit.motionValues.map((motionValue) => scale(motionValue, rate)),
        }),
        poiseMotionValue: scale(hit.poiseMotionValue, poiseRate),
      };
    }),
  );
  // Each left hand hit's stamina is the off hand weapon's for its row instead of the main weapon's
  const staminaChange = attack.steps.map((step) =>
    step.map((hit) => {
      const { main, offhand } = rowsOf(hit) ?? {};
      return main && offhand ? offhand[2] - main[2] : 0;
    }),
  );
  const round = (value: number) => Math.round(value * 100) / 100;
  const stepChange = (i: number) => staminaChange[i].reduce((sum, change) => sum + change, 0);
  return {
    ...attack,
    steps,
    ...(attack.stamina && {
      stamina: attack.stamina.map((total, i) =>
        total == null ? total : round(total + stepChange(i)),
      ),
    }),
    ...(attack.leftStamina && {
      leftStamina: attack.leftStamina.map((left, i) => round(left + stepChange(i))),
    }),
    ...(attack.hitStamina && {
      hitStamina: attack.hitStamina.map((costs, i) =>
        costs?.map((cost, j) => round(cost + (staminaChange[i][j] ?? 0))),
      ),
    }),
  };
}

/** Weapons that are always two handed */
const twoHandedWeaponTypes: WeaponType[] = [
  WeaponType.LIGHT_BOW,
  WeaponType.BOW,
  WeaponType.GREATBOW,
  WeaponType.BALLISTA,
];

/** @returns false for weapons that can't be two handed, e.g. the Grafted Dragon */
export function canTwoHand(movesets: Movesets, weapon: Weapon, attack?: string) {
  return !movesets[weapon.weaponName]?.oneHanded && !(attack && oneHandedAttacks.has(attack));
}

/** A bow shot's timing from the press: when its arrow fires, the next shot, and a roll or block */
interface BowShot {
  release: number;
  /** For several bolts fired one after another (the Pulley Crossbow's), the time between them */
  spacing?: number;
  cycle: number;
  roll: number;
  block: number;
}

/**
 * Bows' shots: the arrow fires as the release animation (36000) starts, after drawing, and the release
 * can be cancelled into another attack, a roll, or a block (its TAE). Measured in game at 60 fps:
 * - the Longbow's animations (a44): the shot hits 65 frames after the press at point blank (the
 *   release at 63, after the step start delay), cancelled 36 frames in (so a shot every 99), a roll
 *   or block at 48. Also the Albinauric Bow's (its own, a230, doesn't exist), and the Black Bow's and
 *   Ansbach's Longbow's (a231, the same cancels: tested on the Black Bow, 65 frames to the hit and
 *   then every 99)
 * - light bows' (a51): 50 frames to the hit, then every 73 (its release cancelled 25 frames in; the
 *   TAE says 26), a roll at 42, a block at 46. Also the Harp Bow's (its a232 doesn't exist)
 * - greatbows' (a45): 155 frames to the hit, then every 220 (hits at 336, 558, 778, and 998 from a
 *   press at 181), a roll 78 frames into the release, a block 88
 * - crossbows' (a46: reloading, 39730, then the shot, 39700): unloaded, 75 frames to the hit, then
 *   every 110.5 (the Heavy Crossbow's hits at 1266, 1375, and 1487 from a press at 1191), a roll or
 *   block 40 frames into the shot. Also the Full Moon Crossbow's, whose own reload (a236) can be
 *   cancelled as soon (tested: 75 frames, then every 111)
 * - the Pulley Crossbow's (a233): its 3 bolts 10 frames apart, unloaded 78 frames to the first,
 *   then every 118.5 (hits at 664, 684, 779, 799, 901, and 921 from a press at 586: first and third
 *   bolts)
 * - the Spread Crossbow's (a235, its bolts at once): unloaded 95 frames to the hit, then every 137.5
 *   (hits at 667, 805, and 942 from a press at 572)
 * - the Repeating Crossbow's (a935's reload): unloaded 74 frames to the hit, then every 111 (hits at
 *   274, 383, and 496 from a press at 200)
 */
const longbowShot: BowShot = {
  release: 63 / 60,
  cycle: 99 / 60,
  roll: (63 + 48) / 60,
  block: (63 + 48) / 60,
};
const shortbowShot: BowShot = {
  release: 48 / 60,
  cycle: 73 / 60,
  roll: (48 + 42) / 60,
  block: (48 + 46) / 60,
};
const greatbowShot: BowShot = {
  release: 153 / 60,
  cycle: 220 / 60,
  roll: (153 + 78) / 60,
  block: (153 + 88) / 60,
};
const crossbowShot: BowShot = {
  release: 73 / 60,
  cycle: 110.5 / 60,
  roll: (73 + 40) / 60,
  block: (73 + 40) / 60,
};
const pulleyCrossbowShot: BowShot = {
  release: 76 / 60,
  spacing: 10 / 60,
  cycle: 118.5 / 60,
  roll: (76 + 40) / 60,
  block: (76 + 40) / 60,
};
const spreadCrossbowShot: BowShot = {
  release: 93 / 60,
  cycle: 137.5 / 60,
  roll: (93 + 40) / 60,
  block: (93 + 40) / 60,
};
const repeatingCrossbowShot: BowShot = {
  release: 72 / 60,
  cycle: 111 / 60,
  roll: (72 + 40) / 60,
  block: (72 + 40) / 60,
};
const shortbowWeapons: ReadonlySet<string> = new Set([
  "Shortbow",
  "Misbegotten Shortbow",
  "Red Branch Shortbow",
  "Composite Bow",
  "Bone Bow",
  "Harp Bow",
]);
const bowShots = new Map<string, BowShot>([
  ...[
    "Longbow",
    "Horn Bow",
    "Erdtree Bow",
    "Serpent Bow",
    "Pulley Bow",
    "Albinauric Bow",
    "Black Bow",
    "Ansbach's Longbow",
  ].map((name) => [name, longbowShot] as const),
  ...[...shortbowWeapons].map((name) => [name, shortbowShot] as const),
  ...["Lion Greatbow", "Golem Greatbow", "Erdtree Greatbow", "Greatbow", "Igon's Greatbow"].map(
    (name) => [name, greatbowShot] as const,
  ),
  ...[
    "Soldier's Crossbow",
    "Light Crossbow",
    "Heavy Crossbow",
    "Arbalest",
    "Crepus's Black-Key Crossbow",
    "Full Moon Crossbow",
  ].map((name) => [name, crossbowShot] as const),
  ["Pulley Crossbow", pulleyCrossbowShot],
  ["Spread Crossbow", spreadCrossbowShot],
  ["Repeating Crossbow", repeatingCrossbowShot],
]);

function getBowShotTimes(weapon: Weapon, count = 1): StepTimes | undefined {
  const shot = bowShots.get(weapon.weaponName);
  if (!shot) return undefined;
  const lead = stepStartDelay;
  return {
    lead,
    hits: shot.spacing
      ? Array.from({ length: count }, (_, i) => lead + shot.release + i * shot.spacing!)
      : [lead + shot.release],
    next: { attack: "any attack", time: shot.cycle },
    anyAttack: shot.cycle,
    roll: shot.roll,
    block: shot.block,
    cycle: shot.cycle,
  };
}

/**
 * A light bow's jump shot and then a shot as soon as it lands, repeated (measured in game on a
 * Shortbow at 60 fps: from the jump press at 1513 (R1 4 frames later, as soon as it can be), hits at
 * 1546, 1602, 1660, 1716, 1777, 1834, 1894, and 1951, so the jump shot 33 frames after the jump
 * press, the landing shot 56.5 after it, and a pair every 116)
 */
const jumpLandingShotPair = 116 / 60;
const jumpShotHit = 33 / 60;
const landingShotDelay = 56.5 / 60;
function getJumpLandingShotTimes(): StepTimes {
  return {
    lead: stepStartDelay,
    hits: [jumpShotHit, jumpShotHit + landingShotDelay],
    next: { attack: "any attack", time: jumpLandingShotPair },
    anyAttack: jumpLandingShotPair,
    cycle: jumpLandingShotPair,
  };
}

/**
 * @param chainWeight how much each step of a chain counts relative to the one before it
 * @param sumChains add up a chain's steps rather than taking their weighted average
 * @returns the weapon's data for an attack, or undefined if it doesn't have that attack
 */
export function getAttackData(
  movesets: Movesets,
  weapon: Weapon,
  attack: AttackChoice,
  twoHanding: boolean,
  chainWeight: number,
  sumChains = false,
  limit?: ChainLimit,
): AttackData | undefined {
  const moveset = movesets[weapon.weaponName];
  if (!moveset) return undefined;
  // A catalyst's R1 casts its spell, so its melee R1s are its base attack instead
  if (
    weapon.weaponType === WeaponType.GLINTSTONE_STAFF ||
    weapon.weaponType === WeaponType.SACRED_SEAL
  ) {
    if (attack === "R1") return undefined;
    if (attack === baseAttack) attack = "R1";
  }
  // A light bow's, bow's, or crossbow's jumping shot is its shot with 0.96 times the attack power
  // (SpEffect 436 in its jumping animations, e.g. a44's 33030; tested in game: a Longbow's does 293
  // with Arrows where its shot does 309), so 96% of its motion value (status and poise unchanged)
  const jumpingShot =
    attack === "Jumping R1" &&
    (weapon.weaponType === WeaponType.LIGHT_BOW ||
      weapon.weaponType === WeaponType.BOW ||
      weapon.weaponType === WeaponType.CROSSBOW);
  // A light bow's jump shot and then its landing shot (see getJumpLandingShotTimes)
  const jumpLandingShot =
    attack === "Jump Shot + Landing Shot" && shortbowWeapons.has(weapon.weaponName);
  if (attack === "Jump Shot + Landing Shot" && !jumpLandingShot) return undefined;
  if (attack === baseAttack || jumpingShot || jumpLandingShot) {
    // One hit, or one for each bolt of a spread shot
    const { count, motionValue, statusMotionValue, poiseMotionValue } = weapon.ammoShots ?? {
      count: 1,
      motionValue: 100,
      statusMotionValue: 100,
      poiseMotionValue: 100,
    };
    const hit = {
      motionValue: jumpingShot ? (motionValue * 96) / 100 : motionValue,
      statusMotionValue,
      poiseMotionValue,
      physicalType: weapon.ammoPhysicalType ?? allPhysicalTypes[moveset.type] ?? "standard",
      // Most of a paired weapon's two handed attacks don't get two handing's Strength bonus
      ...(weapon.paired && { noTwoHandBonus: true }),
    };
    // Attack subcategories for buffs: ammunition (105) and two handed attacks (120)
    const categories = [
      ...(weapon.ammoPoise != null ? [105] : []),
      ...(twoHanding && !weapon.paired ? [120] : []),
    ];
    const shotTimes = jumpingShot
      ? undefined
      : jumpLandingShot
      ? getJumpLandingShotTimes()
      : getBowShotTimes(weapon, count);
    const shots = (shotHit: typeof hit) =>
      Array.from({ length: count }, () =>
        categories.length ? { ...shotHit, categories } : shotHit,
      );
    return {
      steps: [
        jumpLandingShot
          ? [...shots({ ...hit, motionValue: (motionValue * 96) / 100 }), ...shots(hit)]
          : shots(hit),
      ],
      weights: [1],
      poiseBase: weapon.ammoPoise ?? moveset.poise,
      ...(shotTimes && { stepTimes: [shotTimes], cycleTimes: [shotTimes.cycle!] }),
    };
  }
  const twoHanded =
    (twoHanding && canTwoHand(movesets, weapon, attack)) ||
    twoHandedWeaponTypes.includes(weapon.weaponType);
  const [preferred, fallback] = twoHanded ? (["2h", "1h"] as const) : (["1h", "2h"] as const);
  const hands = moveset[preferred]?.[attack] ? preferred : fallback;
  const allSteps = moveset[hands]?.[attack];
  if (!allSteps) return undefined;
  const timing = moveset.timing?.[hands]?.[attack];
  // A chain cut short ends with any attack instead of its next step
  const steps = allSteps.slice(0, getChainLength(attack, timing, allSteps.length, limit));
  const stepTimes = getStepTimes(attack, timing, steps.length, steps.length < allSteps.length);
  const cycleTimes = stepTimes?.every((step) => step.cycle != null)
    ? stepTimes.map((step) => step.cycle!)
    : undefined;

  const rawWeights = steps.map((_, i) => (chainAttacks.has(attack) ? chainWeight ** i : 1));
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  return {
    steps: steps.map((step, stepIndex) =>
      step.map(([motionValue, statusMotionValue, poiseMotionValue, physicalType, details]) => ({
        ...(details?.flat && { flatAttack: details.flat }),
        ...(details?.kind && { kind: details.kind }),
        ...(details?.noTwoHandBonus && { noTwoHandBonus: true }),
        ...(details?.correct && { attackElementCorrect: details.correct }),
        ...(details?.categories && { categories: details.categories }),
        ...(details?.buffMotionValue != null && { buffMotionValue: details.buffMotionValue }),
        ...(details?.leftHand && { leftHand: true }),
        ...(details?.judge != null && { judge: details.judge }),
        // A flail's weapon hits are counted at its sweet spot, where the step has one
        ...(timing?.[stepIndex]?.sweetSpot &&
          !details?.kind && { damageRates: allDamageTypes.map(() => flailSweetSpotRate) }),
        ...(Array.isArray(motionValue)
          ? { motionValue: Math.max(...motionValue), motionValues: motionValue }
          : { motionValue }),
        statusMotionValue,
        poiseMotionValue,
        physicalType: allPhysicalTypes[physicalType] ?? "standard",
      })),
    ),
    weights:
      sumChains && chainAttacks.has(attack)
        ? steps.map(() => 1)
        : rawWeights.map((weight) => weight / totalWeight),
    ...(chainAttacks.has(attack) && { chain: true }),
    poiseBase: weapon.ammoPoise ?? moveset.poise,
    ...(timing?.some((step) => step.stamina != null) && {
      stamina: steps.map((_, i) => timing[i]?.stamina),
    }),
    ...(timing?.some((step) => step.leftStamina != null) && {
      leftStamina: steps.map((_, i) => timing[i]?.leftStamina ?? 0),
    }),
    ...(timing?.some((step) => step.hitStamina) && {
      hitStamina: steps.map((_, i) => timing[i]?.hitStamina),
    }),
    ...(stepTimes && { stepTimes }),
    ...(cycleTimes && { cycleTimes }),
    ...(criticalAttacks.has(attack) && { critical: true }),
  };
}

let movesetsPromise: Promise<Movesets> | undefined;

/**
 * Loads the moveset data
 */
export default function useMovesets() {
  const [movesets, setMovesets] = useState<Movesets>({});
  useEffect(() => {
    movesetsPromise ??= fetch("/movesets.json").then((res) => res.json());
    movesetsPromise.then(setMovesets).catch(() => setMovesets({}));
  }, []);
  return movesets;
}
