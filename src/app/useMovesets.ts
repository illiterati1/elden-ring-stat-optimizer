import { useEffect, useState } from "react";
import { allDamageTypes, WeaponType, type Weapon } from "../calculator/calculator.ts";
import { allPhysicalTypes } from "../optimizer/defense.ts";
import type { AttackData, AttackDataHit } from "../optimizer/build.ts";

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
 * starts again after its last step)
 */
const repeatButtons: Partial<Record<AttackName, NonNullable<StepTiming["next"]>["attack"]>> = {
  R1: "R1",
  R2: "R2",
  "Charged R2": "R2",
  "Powerstance L1": "L1",
};

/**
 * @returns how long each step takes when the attack is repeated as fast as possible: until the same
 * button's next attack can start (or any attack, after a chain's last step), plus a tapped R2's
 * start, or undefined if the timings don't say
 */
function getCycleTimes(attack: AttackName, timing: StepTiming[] | undefined, stepCount: number) {
  const button = repeatButtons[attack];
  if (!button || !timing || timing.length < stepCount) return undefined;
  const times = timing.slice(0, stepCount).map((step) => {
    const next = step.next?.attack === button ? step.next.time : step.anyAttack;
    return next != null ? (step.start ?? 0) + next : undefined;
  });
  return times.every((time) => time != null) ? (times as number[]) : undefined;
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
  anyAttack?: number;
  roll?: number;
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
): AttackData | undefined {
  const moveset = movesets[weapon.weaponName];
  if (!moveset) return undefined;
  if (attack === baseAttack) {
    // One hit, or one for each bolt of a spread shot
    const { count, motionValue, statusMotionValue, poiseMotionValue } = weapon.ammoShots ?? {
      count: 1,
      motionValue: 100,
      statusMotionValue: 100,
      poiseMotionValue: 100,
    };
    const hit = {
      motionValue,
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
    return {
      steps: [
        Array.from({ length: count }, () => (categories.length ? { ...hit, categories } : hit)),
      ],
      weights: [1],
      poiseBase: weapon.ammoPoise ?? moveset.poise,
    };
  }
  const twoHanded =
    (twoHanding && canTwoHand(movesets, weapon, attack)) ||
    twoHandedWeaponTypes.includes(weapon.weaponType);
  const [preferred, fallback] = twoHanded ? (["2h", "1h"] as const) : (["1h", "2h"] as const);
  const hands = moveset[preferred]?.[attack] ? preferred : fallback;
  const steps = moveset[hands]?.[attack];
  if (!steps) return undefined;
  const timing = moveset.timing?.[hands]?.[attack];

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
    ...(getCycleTimes(attack, timing, steps.length) && {
      cycleTimes: getCycleTimes(attack, timing, steps.length),
    }),
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
