import getWeaponAttack, {
  adjustAttributesForTwoHanding,
  allAttributes,
  allDamageTypes,
  allStatusTypes,
  AttackPowerType,
  type Attribute,
  type Attributes,
  type EnemyType,
  type EnemyTypeRates,
  getEnemyTypeRate,
  type Weapon,
  WeaponType,
} from "../calculator/calculator.ts";
import type { Defenses, PhysicalType } from "./defense.ts";
import { applyLimits, type LimitReason, type Limits } from "./limits.ts";
import { getCumulativeLevelUpCosts, maxCharacterLevel } from "./runes.ts";
import {
  evaluateObjective,
  getAttackScaling,
  getAttributeScaling,
  getBreakdown,
  getDamage,
  getHitDamage,
  maxAttributeValue,
  optimizeAttributes,
  type AttackHit,
  type OptimizeOptions,
  type BreakdownRow,
  type Objective,
} from "./optimizer.ts";

/** Finds the best attributes at every level, e.g. optimizeAttributes or a cached version of it */
export type CurveFinder = typeof optimizeAttributes;

export const maxRegularUpgradeLevel = 25;
export const maxSpecialUpgradeLevel = 10;

/**
 * @param regularUpgradeLevel the upgrade level of a regular weapon
 * @returns the corresponding upgrade level for a somber weapon
 */
export function toSpecialUpgradeLevel(regularUpgradeLevel: number) {
  // For in between levels with no exact equivalent, round down
  return Math.floor(
    (regularUpgradeLevel + 0.5) * (maxSpecialUpgradeLevel / maxRegularUpgradeLevel),
  );
}

export function getWeaponUpgradeLevel(weapon: Weapon, regularUpgradeLevel: number) {
  const maxUpgradeLevel = weapon.attack.length - 1;
  if (maxUpgradeLevel === maxSpecialUpgradeLevel) {
    return toSpecialUpgradeLevel(regularUpgradeLevel);
  }
  return Math.min(regularUpgradeLevel, maxUpgradeLevel);
}

/**
 * The multiplier to flat attack added to a weapon's base attack (ReinforceParamWeapon baseAtkRate):
 * 1 at +0 up to 4 when fully upgraded, for both regular and somber weapons
 */
export function getBaseAttackRate(weapon: Weapon, upgradeLevel: number) {
  const maxUpgradeLevel = weapon.attack.length - 1;
  return maxUpgradeLevel > 0 ? 1 + (3 * upgradeLevel) / maxUpgradeLevel : 1;
}

/**
 * @returns a weapon that scales every damage type like the catalyst's spell scaling, counting only
 * one stat's part of it (e.g. a seal's Faith for Electrify Armament), for a weapon buff's flat
 * attack. Its scaling is the catalyst's at its upgrade level, at every upgrade level of the weapon,
 * so it can be used as a term's weapon.
 */
export function getSpellBuffWeapon(
  weapon: Weapon,
  catalyst: Weapon,
  catalystUpgradeLevel: number,
  attribute: Attribute,
): Weapon {
  const upgradeLevel = Math.min(catalystUpgradeLevel, catalyst.attack.length - 1);
  const spellType = catalyst.sorceryTool ? AttackPowerType.MAGIC : AttackPowerType.HOLY;
  const scaling = getAttributeScaling(catalyst, upgradeLevel, spellType, attribute);
  return {
    ...weapon,
    name: `${catalyst.name} ${attribute} +${upgradeLevel}`,
    requirements: {},
    attackElementCorrect: Object.fromEntries(
      allDamageTypes.map((damageType) => [damageType, { [attribute]: true }]),
    ),
    calcCorrectGraphs: Object.fromEntries(
      allDamageTypes.map((damageType) => [damageType, catalyst.calcCorrectGraphs[spellType]]),
    ) as Weapon["calcCorrectGraphs"],
    attributeScaling: weapon.attack.map(() => ({ [attribute]: scaling })),
    attributeScalingRates: undefined,
  };
}

export interface BuildRequest {
  weapon: Weapon;
  regularUpgradeLevel: number;
  twoHanding: boolean;
  /**
   * The level of the planned stats the optimizer starts from. Limits on levels are relative to
   * this level.
   */
  startLevel: number;
  /**
   * The character's actual level. Levels below it are already owned (e.g. when respeccing into
   * a plan with a lower level), so they cost no runes. Defaults to startLevel.
   */
  currentLevel?: number;
  /** Planned damage attributes to start from */
  attributes: Attributes;
  bonusAttributes: Attributes;
  objective: Objective;
  defenses?: Defenses;
  motionValue?: number;
  limits: Limits;
  /** Level up to the weapon's requirements before optimizing */
  meetRequirements?: boolean;
  /** A chosen attack, whose hits' damage is optimized instead of attack power */
  attack?: AttackData;
  /** Enemy negation for each physical type, used with an attack */
  physicalNegation?: Record<PhysicalType, number>;
  /** The enemy's max HP, for hits that do a percentage of it (e.g. black flame), if known */
  enemyHp?: number;
  /** The enemy's damage multiplier for critical hits, e.g. 0.7 for Crucible Knights */
  criticalDamageRate?: number;
  /** The enemy's poise damage multiplier, e.g. 0.2 for ancient dragons */
  poiseDamageRate?: number;
  /** The enemy's types, for weapons and buffs that do more damage to them (e.g. dragons) */
  enemyTypes?: readonly EnemyType[];
  /**
   * The off hand weapon for a powerstance attack's hits with the left hand (AttackDataHit leftHand),
   * if not the same weapon: its upgrade level (on the regular scale, like regularUpgradeLevel) and
   * base poise
   */
  offhand?: {
    weapon: Weapon;
    regularUpgradeLevel: number;
    poiseBase: number;
  };
  /** Effects of the player's buffs (talismans, tears, etc.), applied to the hits they apply to */
  buffs?: readonly BuffEffect[];
  /**
   * Only optimize the level the level and rune limits stop at, rather than every level (faster, but
   * there's no curve, and the minimum gain and target value limits don't apply)
   */
  fast?: boolean;
  /** If set, the weapon isn't calculated, and this is shown instead (e.g. a bow with no arrows) */
  unavailableReason?: string;
  /** A note about the buffs applied, shown with the result */
  buffNote?: string;
  /** Which version of the weapon's fixed skill this is, if it has several */
  skillVariant?: { label: string; short: string };
  /**
   * Equip weight besides the weapon's (and the off hand weapon's when powerstancing), for buffs that
   * shrink with it (the Blue Dancer Charm)
   */
  equipWeight?: number;
  /**
   * The catalyst a weapon buff spell is cast with, whose spell scaling multiplies the buff's flat
   * attack (effects with spellScaling)
   */
  catalyst?: Weapon;
  /** The catalyst's own upgrade level (e.g. at most 10 for a somber one) */
  catalystUpgradeLevel?: number;
  /**
   * Stats needed to cast the buff spell (the catalyst's and spell's requirements). No levels are
   * spent meeting them, and the buff applies anyway, noted if the final stats don't meet them. The
   * catalyst is held one handed.
   */
  castingRequirements?: Partial<Record<Attribute, number>>;
}

/**
 * The best value achievable at each character level, so weapons can be compared at any level
 * without recalculating
 */
export interface ValueCurve {
  /** The character level of values[0], i.e. after any levels spent meeting requirements */
  startLevel: number;
  values: number[];
  /** allocations[n] is the leveled attributes (not including bonuses) that achieve values[n] */
  allocations?: Attributes[];
}

export interface AttackDataHit {
  /** The highest motion value of any damage type */
  motionValue: number;
  /** Motion values for each damage type (by AttackPowerType), if they differ */
  motionValues?: readonly number[];
  /**
   * Flat attack for each damage type (by AttackPowerType) added to the weapon's base attack, e.g.
   * the fire in Bloodfiend's Arm's R2 area attack. It's scaled by the weapon's base attack rate for
   * its upgrade level, and by stats like base attack.
   */
  flatAttack?: readonly number[];
  /** What kind of hit this is, if it isn't the weapon itself, e.g. "Projectile" or "AoE" */
  kind?: string;
  /** True if this hit doesn't get two handing's Strength bonus */
  noTwoHandBonus?: boolean;
  /** Which stats scale this hit's flat attack, if not the weapon's own */
  attackElementCorrect?: Weapon["attackElementCorrect"];
  /** True for flat attack not added to the weapon's base attack, assumed not to scale */
  fixedFlatAttack?: boolean;
  /** For damage over time, the seconds between ticks (0 if unknown) */
  tickInterval?: number;
  /** For damage over time, how long it lasts in seconds, if known (e.g. a lingering cloud's) */
  tickDuration?: number;
  /** For damage over time, the seconds before its first tick, if not right away */
  tickDelay?: number;
  /** True for a hit shown but not counted, e.g. one that only hits in some situations */
  notCounted?: boolean;
  /** Flat poise damage, added to the poise motion value's */
  flatPoise?: number;
  /** A weapon buff's flat attack by damage type (times its motion value), which doesn't scale */
  buffAttack?: readonly number[];
  /**
   * How much of weapon buffs' flat attack the hit gets, in percent (AtkParam
   * spEffectAtkPowerCorrectRate_byPoint), if not 100: e.g. 90 for the Backhand Blade's two handed
   * R1s, 0 for Blood Blade's slash (both tested in game)
   */
  buffMotionValue?: number;
  /**
   * The hit's own damage multipliers by damage type, from an effect its skill puts on the player,
   * e.g. the Sword of Light's ×1.2 holy
   */
  damageRates?: readonly number[];
  /** Attack subcategories (AtkParam subCategory1-4), which some buffs only apply to */
  categories?: readonly number[];
  /**
   * Status buildup the hit applies through its own effects (e.g. Blood Blade's projectile's 60 blood
   * loss), by status type, not scaled by its status motion value
   */
  status?: Partial<Record<AttackPowerType, number>>;
  /** Like status, but with the weapon's status correction (e.g. Blood Blade's slash's 55) */
  scaledStatus?: Partial<Record<AttackPowerType, number>>;
  /**
   * Damage over time of a percentage of the enemy's max HP, e.g. black flame: rate (of max HP, plus
   * any flat damage, rounded down) for each of its ticks
   */
  hpDamage?: HpDamage;
  statusMotionValue: number;
  poiseMotionValue: number;
  physicalType: PhysicalType;
  /** True for a powerstance hit with the left hand's weapon */
  leftHand?: boolean;
  /** For a left hand hit, its behavior judge ID (useMovesets.ts's withOffhandRows) */
  judge?: number;
  /** For a hit with an off hand weapon, its base stance (poise) damage, instead of the attack's */
  poiseBase?: number;
  /** For a hit with an off hand weapon, its status attack power, instead of the weapon's */
  statusAttackPower?: Partial<Record<AttackPowerType, number>>;
}

/**
 * One effect of a buff (e.g. a talisman), by damage type (AttackPowerType). Multipliers multiply
 * with each other's.
 */
export interface BuffEffect {
  /** Attack power multipliers, before defenses */
  attackPowerRates?: readonly number[];
  /** Damage multipliers, after defenses */
  damageRates?: readonly number[];
  /** Flat attack added to the weapon (a weapon buff, e.g. a grease), which doesn't scale */
  flat?: readonly number[];
  /**
   * If set, flat is multiplied by the catalyst's spell scaling (as a percentage), counting only this
   * stat's part of it, e.g. Electrify Armament's Faith
   */
  spellScaling?: "int" | "fai";
  /** Status buildup added to the weapon (e.g. Poison Grease), by status type */
  status?: Partial<Record<AttackPowerType, number>>;
  /**
   * Status buildup each weapon hit adds without scaling, by status type (e.g. Bloodflame Blade's
   * 40 blood loss)
   */
  hitStatus?: Partial<Record<AttackPowerType, number>>;
  /**
   * Damage over time of a percentage of the enemy's max HP that each weapon hit applies, e.g. Black
   * Flame Blade's black flame (unless the hit applies its own)
   */
  hpDamage?: HpDamage;
  /** Stance (poise) damage multiplier */
  poiseRate?: number;
  /** Damage multipliers against enemy types, e.g. Sacred Blade's ×2 against those who live in death */
  enemyTypeRates?: EnemyTypeRates;
  /**
   * For a weapon buff with an off hand weapon (BuildRequest offhand), which hand's weapon it's on:
   * it only applies to that weapon's hits
   */
  hand?: "main" | "off";
  /** Added to the weapon's stat scaling, as fractions (e.g. War Cry's +5 Strength scaling) */
  scalingBonus?: Partial<Record<Attribute, number>>;
  /** The attack subcategories it only applies to, if any (e.g. 100 Charged Heavy Attack) */
  categories?: readonly number[];
  /** True if it only applies to critical hits */
  critical?: boolean;
  /** True if it only applies to the attack's first hit (e.g. Royal Knight's Resolve) */
  firstHitOnly?: boolean;
  /** The physical damage types of the hits it only applies to, if limited (e.g. pierce counters) */
  physicalTypes?: readonly PhysicalType[];
  /**
   * True if its multipliers shrink with equip weight (the Blue Dancer Charm): see
   * getEquipWeightRate
   */
  byEquipWeight?: boolean;
}

/** The Blue Dancer Charm's full multiplier, which getEquipWeightRate gives at no equip weight */
const fullEquipWeightRate = 1.15;

/**
 * @returns the Blue Dancer Charm's attack power multiplier at an equip weight (from the game's
 * code, not the data): 1.15 at none, falling faster from 8 to 20, and none from 30. Matches a test
 * in game: ×1.137 with the Golem Fist (6) and the charm (0.9).
 */
export function getEquipWeightRate(weight: number) {
  if (weight < 8) return weight * -0.001875 + 1.15;
  if (weight < 16) return (weight - 8) * -0.005625 + 1.135;
  if (weight < 20) return (weight - 16) * -0.013125 + 1.09;
  if (weight < 30) return (weight - 20) * -0.00375 + 1.0375;
  return 1;
}

/** @returns the effects with equip weight scaled multipliers (byEquipWeight) at the equip weight */
function applyEquipWeight(buffs: readonly BuffEffect[], weight: number): readonly BuffEffect[] {
  if (!buffs.some((effect) => effect.byEquipWeight)) return buffs;
  const scale = (getEquipWeightRate(weight) - 1) / (fullEquipWeightRate - 1);
  const scaleRates = (rates?: readonly number[]) => rates?.map((rate) => 1 + (rate - 1) * scale);
  return buffs.map((effect) =>
    effect.byEquipWeight
      ? {
          ...effect,
          ...(effect.attackPowerRates && {
            attackPowerRates: scaleRates(effect.attackPowerRates),
          }),
          ...(effect.damageRates && { damageRates: scaleRates(effect.damageRates) }),
        }
      : effect,
  );
}

/**
 * @returns the effects with their multipliers against the enemy's types added to their damage
 * multipliers (after defenses, like other damage multipliers)
 */
function applyEnemyTypes(
  buffs: readonly BuffEffect[],
  enemyTypes: readonly EnemyType[],
): readonly BuffEffect[] {
  return buffs.map((effect) => {
    const rate = getEnemyTypeRate(effect.enemyTypeRates, enemyTypes);
    if (rate === 1) return effect;
    return {
      ...effect,
      damageRates: allDamageTypes.map(
        (damageType) => (effect.damageRates?.[damageType] ?? 1) * rate,
      ),
    };
  });
}

/** @returns true if a buff effect applies to a hit of an attack */
function buffAppliesTo(effect: BuffEffect, hit: AttackDataHit, attack: AttackData | undefined) {
  return (
    (!effect.hand || (effect.hand === "off") === !!hit.leftHand) &&
    (!effect.categories ||
      effect.categories.some((category) => hit.categories?.includes(category))) &&
    (!effect.critical || !!attack?.critical) &&
    (!effect.firstHitOnly || !attack || hit === attack.steps[0]?.[0]) &&
    (!effect.physicalTypes || effect.physicalTypes.includes(hit.physicalType))
  );
}

/**
 * @returns the attack with buffs' max HP damage over time on its weapon hits, those without their
 * own
 */
function applyHpDamageBuffs(attack: AttackData, buffs: readonly BuffEffect[]): AttackData {
  if (!buffs.some((effect) => effect.hpDamage)) return attack;
  return {
    ...attack,
    steps: attack.steps.map((step) =>
      step.map((hit) => {
        if (hit.hpDamage || !(hit.motionValue > 0)) return hit;
        const effect = buffs.find(
          (effect) => effect.hpDamage && buffAppliesTo(effect, hit, attack),
        );
        return effect ? { ...hit, hpDamage: effect.hpDamage } : hit;
      }),
    ),
  };
}

/** @returns the attack with buffs' stance damage multipliers applied to its hits */
function applyPoiseBuffs(attack: AttackData, buffs: readonly BuffEffect[]): AttackData {
  if (!buffs.some((effect) => effect.poiseRate)) return attack;
  return {
    ...attack,
    steps: attack.steps.map((step) =>
      step.map((hit) => {
        const rate = buffs
          .filter((effect) => effect.poiseRate && buffAppliesTo(effect, hit, attack))
          .reduce((product, effect) => product * effect.poiseRate!, 1);
        return rate === 1
          ? hit
          : {
              ...hit,
              poiseMotionValue: hit.poiseMotionValue * rate,
              ...(hit.flatPoise != null && { flatPoise: hit.flatPoise * rate }),
            };
      }),
    ),
  };
}

export interface HpDamage {
  label: string;
  rate: number;
  ticks: number;
  /** Flat damage each tick also does, e.g. Poison Moth Flight's poisoned bonus's 250 */
  flat?: number;
}

/**
 * @returns the total damage of a percentage of max HP damage over time, plus any flat damage, each
 * tick rounded down (tested in game on the training dummy's 74212 HP: black flame's 0.1% + 1 is 75
 * a tick, Poison Moth Flight's poisoned bonus's 5% + 250 is 3960)
 */
export function getHpDamage({ rate, ticks, flat = 0 }: HpDamage, enemyHp: number) {
  return ticks * Math.floor(rate * enemyHp + flat);
}

/**
 * A step's timing, in seconds from when its button is pressed (in a chain, when the cancel into it
 * opens): when its hits land, and when it can be cancelled into other actions
 */
/**
 * @returns the earliest attack a step can be cancelled into and when (lead plus the cancel's time),
 * from its R1, R2, and L1 cancels and its right and left hand attack cancels (R1 or R2, and L1);
 * buttons whose cancels open together are joined, e.g. "R1/L1". A mounted attack's buttons are
 * pairs (R1/L1, R2/L2), going on with an attack on the same side: its R1 and R2 cancels, joined
 * with ", " if together, since switching sides takes longer.
 */
export function getEarliestAttack(
  lead: number,
  cancels: Partial<Record<"R1" | "R2" | "L1", number>> | undefined,
  rightHandAttack: number | undefined,
  leftHandAttack?: number,
  mounted = false,
): StepTimes["earliest"] {
  const min = (...times: (number | undefined)[]) => {
    const known = times.filter((time): time is number => time != null);
    return known.length ? Math.min(...known) : undefined;
  };
  const buttons: [string, number | undefined][] = mounted
    ? [
        ["R1/L1", min(cancels?.R1, rightHandAttack)],
        ["R2/L2", min(cancels?.R2, rightHandAttack)],
      ]
    : [
        ["R1", min(cancels?.R1, rightHandAttack)],
        ["R2", min(cancels?.R2, rightHandAttack)],
        ["L1", min(cancels?.L1, leftHandAttack)],
      ];
  const time = min(...buttons.map(([, time]) => time));
  if (time == null) return undefined;
  const attack = buttons
    .filter(([, buttonTime]) => buttonTime != null && buttonTime - time < 1e-6)
    .map(([button]) => button)
    .join(mounted ? ", " : "/");
  return { attack, time: lead + time };
}

export interface StepTimes {
  /** Until its animation starts: a tapped R2's start, or else the step start delay */
  lead: number;
  hits: number[];
  /**
   * For a loop (its hits and cycle being one pass of it), when it starts after the press, e.g. Wild
   * Strikes' opening swing's
   */
  opening?: number;
  /**
   * Each of the step's hits' own time, where known separately from its animation's hits (e.g. a
   * projectile's repeated hits), and which are approximate
   */
  hitTimes?: (number | undefined)[];
  approximate?: boolean[];
  /**
   * The earliest attack it can be cancelled into, and when: the buttons whose cancels open first,
   * joined if they open together (e.g. "R1/R2" for a right hand attack cancel, or "R1/L1")
   */
  earliest?: { attack: string; time: number };
  /**
   * When any right hand attack (R1 or R2) can start: the animations' "cancel - RH attack" flag (4),
   * named rightHandAttack in the data
   */
  rightHandAttack?: number;
  roll?: number;
  block?: number;
  /** When moving can end it: the animations' "cancel - LS movement" flag (11) */
  move?: number;
  /**
   * How long the step lasts when the attack is repeated as fast as possible, if known: until the
   * same button's next attack can start (or an R1/R2, after a chain's last step or for attacks that
   * can't be repeated back to back, or else the animation's end). For one-off attacks (running,
   * backstep, guard counters, critical hits), until the earliest attack, roll, block, or movement.
   */
  cycle?: number;
}

export interface AttackData {
  /** Each step of a chain (one for attacks that aren't chains), each with one or more hits */
  steps: AttackDataHit[][];
  /**
   * True for a skill, which can't be used at all without the weapon's requirements (its damage is
   * 0 while any is unmet)
   */
  needsRequirements?: boolean;
  /** True for critical hits (backstabs and ripostes), which some enemies take less damage from */
  critical?: boolean;
  /** How much each step counts towards the objective, adding up to 1 (0 for a skill's follow-ups) */
  weights: number[];
  /** Labels for each step, e.g. a skill's name and its follow-ups ("R1", "Charged") */
  stepLabels?: string[];
  /**
   * Scaling added to the weapon's for this attack, e.g. War Cry's buff gives its R2s +0.05 Strength
   * scaling (not growing with upgrades)
   */
  scalingBonus?: Partial<Record<Attribute, number>>;
  /**
   * A skill's own weapon buff's flat attack by damage type (e.g. Sacred Blade's 90 holy), already
   * in its hits' buffAttack, for the breakdown
   */
  skillBuff?: readonly number[];
  /**
   * True if the attack is a skill that puts its own weapon buff on the weapon (e.g. Sacred Blade),
   * which replaces any other weapon buff
   */
  ownWeaponBuff?: boolean;
  /**
   * A note shown with the attack's results, e.g. that it can hit more than counted. "{damage}" in it
   * is notedHit's damage.
   */
  note?: string;
  /** A hit left out of the steps, whose damage the note shows (e.g. a projectile that may miss) */
  notedHit?: AttackDataHit;
  /** The skill the weapon always uses whatever Ash of War is chosen, e.g. Moonveil's */
  fixedSkill?: string;
  /** True for a chain, whose steps are weighted by the chain weighting (or added up) */
  chain?: boolean;
  /** The weapon's base stance (poise) damage, which stance motion values multiply */
  poiseBase: number;
  /** The stamina each step costs, if known */
  stamina?: (number | undefined)[];
  /** How much of each step's stamina its left hand hits cost (powerstance attacks), if known */
  leftStamina?: number[];
  /** What each hit of each step costs (its attack windows'), for steps of more than one hit, if known */
  hitStamina?: (number[] | undefined)[];
  /** How long each step takes when the attack is repeated as fast as possible, if known */
  cycleTimes?: number[];
  /** Each step's timing (when its hits land and it can be cancelled), if known */
  stepTimes?: StepTimes[];
  /**
   * The step a chain goes back to after its last (its index), if not the first: the steps before it
   * are only done once (e.g. Storm Blade's first)
   */
  repeatFrom?: number;
}

/** One hit of an attack with the final stats */
export interface AttackResultHit {
  damage: number;
  stance: number;
  status: Partial<Record<AttackPowerType, number>>;
  /** Unset for hits with no physical damage, e.g. a magic projectile */
  physicalType?: PhysicalType;
  kind?: string;
  /** For damage over time, damage per second if the tick interval is known */
  perSecond?: number;
  tick?: boolean;
  /** True for a hit shown but not counted in the totals */
  notCounted?: boolean;
  /** For damage over time, the seconds between ticks and how long it lasts, if known */
  tickInterval?: number;
  tickDuration?: number;
  /** Damage of a percentage of the enemy's max HP (e.g. black flame), if the enemy is known */
  hpDamage?: { label: string; damage: number };
  /** The stamina the hit's step costs, on its first hit */
  stamina?: number;
}

export interface BuildResult {
  weaponName: string;
  /** Wiki page for the weapon, if there is one */
  url: string | null;
  applicable: boolean;
  /** Why the weapon wasn't calculated, if it wasn't for a reason other than the objective */
  unavailableReason?: string;
  /** A note about the buffs applied */
  buffNote?: string;
  exact: boolean;
  startValue: number;
  finalValue: number;
  curve: ValueCurve;
  /** Levels gained relative to the current level */
  levels: number;
  finalLevel: number;
  runes: number;
  reason: LimitReason;
  /** Final leveled attributes, not including bonuses */
  attributes: Attributes;
  /**
   * Final attributes as the game uses them for scaling and requirements: including bonuses (capped
   * at 99) and the two handing Strength bonus
   */
  effectiveAttributes: Attributes;
  /** Attributes that don't meet the weapon's requirements with the final allocation */
  ineffectiveAttributes: Attribute[];
  /** The weapon's attribute requirements */
  requirements: Partial<Record<Attribute, number>>;
  /** Where the final value comes from, by damage type and attribute */
  breakdown: BreakdownRow[];
  /** Status effect buildup with the final attributes, for statuses the weapon has */
  statusBuildup: Partial<Record<AttackPowerType, number>>;
  /** Each step and hit of the chosen attack with the final stats */
  attackSteps?: AttackResultHit[][];
  /** Stance damage of the chosen attack, weighted across a chain the same way as damage */
  attackStance?: number;
  /** Stamina cost of the chosen attack, weighted across a chain the same way, if known */
  attackStamina?: number;
  /**
   * Damage (or attack power) per second of the chosen attack repeated as fast as possible: the whole
   * chain's, over the time it takes, if known
   */
  attackDps?: number;
  /** Poise damage per second of the chosen attack, repeated the same way as attackDps, if known */
  attackPoisePerSecond?: number;
  /** Stamina spent per second of the chosen attack, repeated the same way as attackDps, if known */
  attackStaminaPerSecond?: number;
  /** Each step's timing of the chosen attack, if known */
  attackStepTimes?: StepTimes[];
  /** The step the chosen attack's chain goes back to, if not the first (AttackData repeatFrom) */
  attackRepeatFrom?: number;
  /** Status buildup per second of the chosen attack, repeated the same way as attackDps, if known */
  attackStatusPerSecond?: Partial<Record<AttackPowerType, number>>;
  /**
   * Damage over time of a percentage of the enemy's max HP (e.g. "Black flame"), not counted since
   * the enemy isn't known
   */
  uncountedHpDamage?: HpDamage;
  /** A note about the chosen attack, e.g. that it can hit more than counted */
  attackNote?: string;
  /** The skill the weapon used, if it can't take the chosen Ash of War's, e.g. Moonveil's */
  fixedSkill?: string;
  /** Which version of its fixed skill, if it has several (each is its own result) */
  /** True for a skill that can't be used because the weapon's requirements aren't met */
  skillRequirementsUnmet?: boolean;
  skillVariant?: { label: string; short: string };
  /** Damage of a percentage of the enemy's max HP included in the value, e.g. "Black flame" */
  hpDamage?: { label: string; damage: number };
  /**
   * True for a staff or seal whose physical (etc.) attack power uses its own scaling, as the game's
   * menu shows, though its melee hits use standard weapon scaling
   */
  menuAttackPower?: boolean;
  /** Status buildup of the chosen attack, weighted across a chain the same way as damage */
  attackStatus?: Partial<Record<AttackPowerType, number>>;
  /**
   * Status buildup at 99 Arcane, for status that scales with Arcane on a weapon whose damage doesn't
   * (so the optimizer never raises Arcane for it), unless Arcane is already 99
   */
  statusAtMaxArcane?: Partial<Record<AttackPowerType, number>>;
  /** The weapon's scaling for each attribute at its upgrade level (1 = 100) */
  scaling: Partial<Record<Attribute, number>>;
}

/**
 * Status buildup with Arcane raised to 99, if the weapon's status scales with Arcane but none of its
 * damage does, so leveling Arcane is up to the user
 */
function getStatusAtMaxArcane(
  weapon: Weapon,
  upgradeLevel: number,
  twoHanding: boolean,
  attributes: Attributes,
  bonusAttributes: Attributes,
  attack: AttackData | undefined,
  buffs: readonly BuffEffect[],
  getHitStatusOf: (leveled: Attributes) => (hit: AttackDataHit) => StatusBuildup,
): Partial<Record<AttackPowerType, number>> | undefined {
  const baseAttack = weapon.attack[upgradeLevel];
  const scalesWithArcane = (types: readonly AttackPowerType[]) =>
    types.some(
      (type) => baseAttack[type] && getAttributeScaling(weapon, upgradeLevel, type, "arc") > 0,
    );
  if (
    attributes.arc >= maxAttributeValue ||
    !scalesWithArcane(allStatusTypes) ||
    scalesWithArcane(allDamageTypes)
  ) {
    return undefined;
  }
  const { attackPower } = getWeaponAttack({
    weapon,
    attributes: getEffectiveAttributes({ ...attributes, arc: maxAttributeValue }, bonusAttributes),
    twoHanding,
    upgradeLevel,
  });
  const status = attack
    ? getAttackStatus(
        attack,
        attackPower,
        getHitStatusOf({ ...attributes, arc: maxAttributeValue }),
      )
    : getStatusBuildup(
        addStatus(
          attackPower,
          buffs.map((effect) => effect.hitStatus ?? {}),
        ),
      );
  return Object.fromEntries(
    allStatusTypes
      .filter((type) => getAttributeScaling(weapon, upgradeLevel, type, "arc") > 0 && status[type])
      .map((type) => [type, status[type]]),
  );
}

/**
 * @returns the weapon with the buffs' status buildup (e.g. Poison Grease's) added to its base status
 * at the upgrade level. The game scales it with the weapon's status correction
 * (isUseStatusAilmentAtkPowerCorrect), e.g. Arcane for poison, blood loss, sleep, and madness on
 * weapons that scale with Arcane, and the hits' status motion values scale it the same way.
 */
function withBuffStatus(
  weapon: Weapon,
  upgradeLevel: number,
  buffs: readonly BuffEffect[],
): Weapon {
  if (!buffs.some((effect) => effect.status)) return weapon;
  const attack = { ...weapon.attack[upgradeLevel] };
  for (const effect of buffs) {
    for (const [statusType, buildup] of Object.entries(effect.status ?? {})) {
      const type = +statusType as AttackPowerType;
      attack[type] = (attack[type] ?? 0) + buildup;
    }
  }
  return {
    ...weapon,
    attack: weapon.attack.map((levelAttack, level) =>
      level === upgradeLevel ? attack : levelAttack,
    ),
  };
}

/** The other hand */
function otherHand(hand: "main" | "off") {
  return hand === "main" ? "off" : "main";
}

/** @returns the weapon with a buff's scaling bonus added to its scaling at its upgrade level */
function withScalingBonus(
  weapon: Weapon,
  upgradeLevel: number,
  bonus: Partial<Record<Attribute, number>> | undefined,
): Weapon {
  if (!bonus) return weapon;
  return {
    ...weapon,
    attributeScaling: weapon.attributeScaling.map((scaling, level) =>
      level === upgradeLevel
        ? Object.fromEntries(
            allAttributes.map((attribute) => [
              attribute,
              (scaling[attribute] ?? 0) + (bonus[attribute] ?? 0),
            ]),
          )
        : scaling,
    ),
  };
}

/**
 * @returns the weapon with its attack and scaling at one upgrade level moved to another, so an off
 * hand weapon can be scaled at the main weapon's upgrade level (OptimizeOptions offhandWeapon)
 */
function alignWeapon(weapon: Weapon, fromLevel: number, toLevel: number): Weapon {
  const align = <T>(values: readonly T[]) =>
    Array.from({ length: Math.max(values.length, toLevel + 1) }, (_, level) =>
      level === toLevel ? values[fromLevel] : values[Math.min(level, values.length - 1)],
    );
  return {
    ...weapon,
    attack: align(weapon.attack),
    attributeScaling: align(weapon.attributeScaling),
    ...(weapon.attributeScalingRates && {
      attributeScalingRates: align(weapon.attributeScalingRates),
    }),
  };
}

/** Status buildup by status type */
type StatusBuildup = Partial<Record<AttackPowerType, number>>;

/**
 * One hit's status buildup: the status attack power times its status motion value, plus buffs'
 * unscaled buildup for the hit (hitStatusOf, e.g. Bloodflame Blade's 40 blood loss)
 */
function getHitStatus(
  hit: AttackDataHit,
  attackPower: StatusBuildup,
  hitStatusOf?: (hit: AttackDataHit) => StatusBuildup,
): StatusBuildup {
  const status: StatusBuildup = {};
  const hitStatus = hitStatusOf?.(hit) ?? {};
  const power = hit.statusAttackPower ?? attackPower;
  for (const statusType of allStatusTypes) {
    const buildup =
      ((power[statusType] ?? 0) * hit.statusMotionValue) / 100 + (hitStatus[statusType] ?? 0);
    if (buildup) status[statusType] = buildup;
  }
  return status;
}

/**
 * @returns how many times a tick hits if the target stays in range: every interval for its duration
 * after its delay (e.g. 4 for Ghostflame Call's, every 0.4s for 1.46s, tested in game point blank;
 * 5 for the mists' clouds, every 0.7s for 4s after 0.7s, tested in game with Poisonous Mist), or 1 if
 * either isn't known
 */
function getTickCount(hit: AttackDataHit) {
  // A hit shown but not counted counts no times, in damage, poise, and status
  if (hit.notCounted) return 0;
  return hit.tickDuration && hit.tickInterval
    ? Math.max(1, Math.ceil((hit.tickDuration - (hit.tickDelay ?? 0)) / hit.tickInterval - 1e-9))
    : 1;
}

/**
 * An attack's status buildup: each step's hits added up, weighted by step. A tick's counts every
 * time it hits.
 */
function getAttackStatus(
  attack: AttackData,
  attackPower: StatusBuildup,
  hitStatusOf?: (hit: AttackDataHit) => StatusBuildup,
): StatusBuildup {
  const status: StatusBuildup = {};
  attack.steps.forEach((step, i) => {
    for (const hit of step) {
      for (const [statusType, buildup] of Object.entries(
        getHitStatus(hit, attackPower, hitStatusOf),
      )) {
        const type = +statusType as AttackPowerType;
        status[type] = (status[type] ?? 0) + attack.weights[i] * buildup * getTickCount(hit);
      }
    }
  });
  return status;
}

/**
 * @returns the breakdown with weapon buffs' attack power added to each damage type's. A damage type
 * the weapon doesn't have gets a row of the buff's alone (e.g. Bloodflame Blade's fire on a
 * Longsword), with no damage if the attack's hits get none of it (e.g. Blood Blade's).
 */
function addBuffAttack(
  rows: BreakdownRow[],
  buffAttackPower: Partial<Record<AttackPowerType, number>>,
): BreakdownRow[] {
  const result = rows.map((row) => {
    const buff = buffAttackPower[row.damageType];
    return buff ? { ...row, buff, total: row.total + buff } : row;
  });
  for (const [type, buff] of Object.entries(buffAttackPower)) {
    const damageType = +type as AttackPowerType;
    if (buff && !result.some((row) => row.damageType === damageType)) {
      result.push({
        damageType,
        base: 0,
        attributes: {},
        penalized: false,
        buff,
        total: buff,
        maximized: false,
        flatOnly: true,
      });
    }
  }
  return result.sort((a, b) => a.damageType - b.damageType);
}

/** An attack's stance damage: each step's hits added up, weighted by step */
function getAttackStance(attack: AttackData, poiseDamageRate = 1) {
  return (
    poiseDamageRate *
    attack.steps.reduce(
      (total, step, i) =>
        total +
        attack.weights[i] *
          step.reduce(
            (sum, hit) =>
              sum +
              (((hit.poiseBase ?? attack.poiseBase) * hit.poiseMotionValue) / 100 +
                (hit.flatPoise ?? 0)) *
                getTickCount(hit),
            0,
          ),
      0,
    )
  );
}

/**
 * @returns the steps an attack repeats (from its repeatFrom step, or all of them) and how long they
 * take, or undefined if the timing isn't known
 */
function getRepeatedSteps(attack: AttackData) {
  if (!attack.cycleTimes) return undefined;
  const from = attack.repeatFrom ?? 0;
  const time = attack.cycleTimes.slice(from).reduce((sum, stepTime) => sum + stepTime, 0);
  return time > 0 ? { from, time } : undefined;
}

/**
 * An attack's damage per second repeated as fast as possible (the steps it repeats, see
 * getRepeatedSteps), or undefined if the timing isn't known
 */
function getAttackDps(attack: AttackData, steps: AttackResultHit[][]) {
  const repeated = getRepeatedSteps(attack);
  if (!repeated) return undefined;
  const damage = steps
    .slice(repeated.from)
    .flat()
    .reduce((sum, hit) => sum + (hit.notCounted ? 0 : hit.damage), 0);
  return damage / repeated.time;
}

/**
 * An attack's status buildup per second repeated as fast as possible, like getAttackDps: every
 * step's (not weighted) over the time they take
 */
function getAttackStatusPerSecond(
  attack: AttackData,
  attackPower: StatusBuildup,
  hitStatusOf?: (hit: AttackDataHit) => StatusBuildup,
): StatusBuildup | undefined {
  const repeated = getRepeatedSteps(attack);
  if (!repeated) return undefined;
  const total = getAttackStatus(
    { ...attack, weights: attack.steps.map((_, i) => (i >= repeated.from ? 1 : 0)) },
    attackPower,
    hitStatusOf,
  );
  return Object.fromEntries(
    Object.entries(total).map(([statusType, buildup]) => [statusType, buildup / repeated.time]),
  );
}

/** An attack's poise damage per second repeated as fast as possible, like getAttackDps */
function getAttackPoisePerSecond(attack: AttackData) {
  const repeated = getRepeatedSteps(attack);
  if (!repeated) return undefined;
  const poise = attack.steps
    .slice(repeated.from)
    .flat()
    .reduce(
      (sum, hit) =>
        sum +
        (((hit.poiseBase ?? attack.poiseBase) * hit.poiseMotionValue) / 100 +
          (hit.flatPoise ?? 0)) *
          getTickCount(hit),
      0,
    );
  return poise / repeated.time;
}

/**
 * @returns the stamina a hit shows: its own (hitStamina) if known, or else its step's on its first
 * hit, or for a powerstance attack whose left hand hits cost some of it (leftStamina), each hand's on
 * its first hit
 */
function getHitStamina(
  attack: AttackData,
  step: AttackDataHit[],
  stepIndex: number,
  hitIndex: number,
): { stamina?: number } {
  const total = attack.stamina?.[stepIndex];
  if (total == null) return {};
  // Each hit's own cost, where known
  const costs = attack.hitStamina?.[stepIndex];
  if (costs?.length === step.length) return { stamina: costs[hitIndex] };
  const left = attack.leftStamina?.[stepIndex] ?? 0;
  const hit = step[hitIndex];
  const firstOfHand = step.findIndex((other) => !!other.leftHand === !!hit.leftHand) === hitIndex;
  if (!left || !step.some((other) => other.leftHand))
    return hitIndex === 0 ? { stamina: total } : {};
  if (!firstOfHand) return {};
  return { stamina: hit.leftHand ? left : total - left };
}

/** An attack's stamina cost: each step's, weighted by step, or undefined if any isn't known */
function getAttackStamina(attack: AttackData) {
  const { stamina } = attack;
  if (!stamina || attack.steps.some((_, i) => stamina[i] == null)) return undefined;
  return attack.steps.reduce((total, _, i) => total + attack.weights[i] * stamina[i]!, 0);
}

/**
 * An attack's stamina cost per second repeated as fast as possible, like getAttackDps (what it
 * spends, not counting stamina recovery)
 */
function getAttackStaminaPerSecond(attack: AttackData) {
  const { stamina } = attack;
  const repeated = getRepeatedSteps(attack);
  if (!stamina || !repeated || attack.steps.some((_, i) => stamina[i] == null)) return undefined;
  const total = attack.steps
    .slice(repeated.from)
    .reduce((sum, _, i) => sum + stamina[i + repeated.from]!, 0);
  return total / repeated.time;
}

/**
 * Each hit of an attack's damage (unweighted, including flat attack), poise damage, and status
 * buildup with the given attack power, and each step's stamina cost on its first hit
 */
function getAttackSteps(
  attack: AttackData,
  attackPower: Partial<Record<AttackPowerType, number>>,
  getHitDamageFor: (hit: AttackDataHit) => number,
  enemyHp: number | undefined,
  hitStatusOf?: (hit: AttackDataHit) => StatusBuildup,
  poiseDamageRate = 1,
): AttackResultHit[][] {
  return attack.steps.map((step, stepIndex) =>
    step.map((hit, hitIndex) => {
      const status = getHitStatus(hit, attackPower, hitStatusOf);
      const damage = getHitDamageFor(hit);
      return {
        damage,
        ...(hit.tickInterval != null && {
          tick: true,
          ...(hit.tickInterval > 0 && { tickInterval: hit.tickInterval }),
          ...(hit.tickDuration && { tickDuration: hit.tickDuration }),
          ...(hit.tickInterval > 0 && { perSecond: damage / hit.tickInterval }),
        }),
        stance:
          (((hit.poiseBase ?? attack.poiseBase) * hit.poiseMotionValue) / 100 +
            (hit.flatPoise ?? 0)) *
          poiseDamageRate,
        status,
        // Physical damage from the weapon's attack, flat attack (e.g. Beast's Roar's bullet), or a buff
        physicalType:
          (hit.motionValues?.[AttackPowerType.PHYSICAL] ?? hit.motionValue) > 0 ||
          (hit.flatAttack?.[AttackPowerType.PHYSICAL] ?? 0) > 0 ||
          (hit.buffAttack?.[AttackPowerType.PHYSICAL] ?? 0) > 0
            ? hit.physicalType
            : undefined,
        kind: hit.kind,
        ...(hit.notCounted && { notCounted: true }),
        ...(hit.hpDamage &&
          enemyHp != null && {
            hpDamage: { label: hit.hpDamage.label, damage: getHpDamage(hit.hpDamage, enemyHp) },
          }),
        ...getHitStamina(attack, step, stepIndex, hitIndex),
      };
    }),
  );
}

/**
 * @returns the damage of hits that do a percentage of the enemy's max HP, weighted across a chain
 * the same way as damage. It doesn't depend on stats, so it's added to the optimized value.
 */
function getAttackHpDamage(attack: AttackData | undefined, enemyHp: number | undefined) {
  if (!attack || enemyHp == null) return 0;
  return attack.steps.reduce(
    (total, step, i) =>
      total +
      attack.weights[i] *
        step.reduce((sum, hit) => sum + (hit.hpDamage ? getHpDamage(hit.hpDamage, enemyHp) : 0), 0),
    0,
  );
}

/** @returns the status buildup with others' added */
function addStatus(status: StatusBuildup, others: StatusBuildup[]): StatusBuildup {
  const result = { ...status };
  for (const other of others) {
    for (const [statusType, buildup] of Object.entries(other)) {
      const type = +statusType as AttackPowerType;
      result[type] = (result[type] ?? 0) + buildup;
    }
  }
  return result;
}

function getStatusBuildup(attackPower: Partial<Record<AttackPowerType, number>>) {
  const buildup: Partial<Record<AttackPowerType, number>> = {};
  for (const statusType of allStatusTypes) {
    if (attackPower[statusType]) buildup[statusType] = attackPower[statusType];
  }
  return buildup;
}

function getEffectiveAttributes(leveled: Attributes, bonusAttributes: Attributes): Attributes {
  const attributes = {} as Attributes;
  for (const attribute of allAttributes) {
    attributes[attribute] = Math.min(99, leveled[attribute] + bonusAttributes[attribute]);
  }
  return attributes;
}

/**
 * @returns the lowest leveled attributes at or above the given ones that meet the weapon's
 * requirements, taking bonuses and two handing into account
 */
function getRequiredAttributes(
  weapon: Weapon,
  twoHanding: boolean,
  attributes: Attributes,
  bonusAttributes: Attributes,
): Attributes {
  const required = { ...attributes };
  for (const attribute of allAttributes) {
    const requirement = weapon.requirements[attribute] ?? 0;
    const meetsRequirement = () =>
      adjustAttributesForTwoHanding({
        twoHanding,
        weapon,
        attributes: getEffectiveAttributes(required, bonusAttributes),
      })[attribute] >= requirement;

    while (required[attribute] < 99 && !meetsRequirement()) {
      required[attribute]++;
    }
  }
  return required;
}

/**
 * Determine where to put levels for one weapon, subject to the given limits
 *
 * @param findCurve the expensive part of the calculation, which doesn't depend on the limits, so it
 * can be cached
 */
export function optimizeBuild(
  {
    weapon: requestedWeapon,
    regularUpgradeLevel,
    twoHanding,
    startLevel,
    attributes,
    bonusAttributes,
    objective,
    defenses,
    motionValue,
    limits,
    meetRequirements = false,
    fast = false,
    unavailableReason,
    buffNote,
    skillVariant,
    catalyst,
    catalystUpgradeLevel = maxRegularUpgradeLevel,
    castingRequirements,
    attack: requestedAttack,
    physicalNegation,
    enemyHp,
    criticalDamageRate = 1,
    poiseDamageRate = 1,
    enemyTypes = [],
    offhand,
    buffs: requestedBuffs = [],
    equipWeight = 0,
    currentLevel = startLevel,
  }: BuildRequest,
  findCurve: CurveFinder = optimizeAttributes,
): BuildResult {
  const upgradeLevel = getWeaponUpgradeLevel(requestedWeapon, regularUpgradeLevel);
  // The weapons held count towards equip weight
  const totalEquipWeight =
    equipWeight + (requestedWeapon.weight ?? 0) + (offhand?.weapon.weight ?? 0);
  const buffs = applyEnemyTypes(applyEquipWeight(requestedBuffs, totalEquipWeight), enemyTypes);
  // Whether two handing's Strength bonus applies is decided by each hit (isDisableBothHandsAtkBonus):
  // e.g. paired weapons' two handed R1s don't get it, but the Golem Fist's charged R2s do. Without a
  // chosen attack, paired weapons never get it.
  const pairedWeapon =
    requestedAttack && requestedWeapon.paired
      ? { ...requestedWeapon, paired: false }
      : requestedWeapon;
  // A buff's scaling bonus (the chosen attack's chain buff, or a chosen weapon buff's) is added to
  // the weapon's own at its upgrade level
  // A powerstance attack with an off hand weapon uses it for its left hand's hits
  const usesOffhand =
    !!offhand && !!requestedAttack?.steps.some((step) => step.some((hit) => hit.leftHand));
  const getScalingBonus = (hand: "main" | "off") =>
    [
      ...(hand === "main" ? [requestedAttack?.scalingBonus] : []),
      ...buffs
        .filter((effect) => effect.hand !== otherHand(hand))
        .map((effect) => effect.scalingBonus),
    ]
      .filter((bonus) => bonus != null)
      .reduce<Partial<Record<Attribute, number>> | undefined>(
        (total, bonus) =>
          Object.fromEntries(
            allAttributes.map((attribute) => [
              attribute,
              (total?.[attribute] ?? 0) + (bonus[attribute] ?? 0),
            ]),
          ),
        undefined,
      );
  // Both weapons need their requirements met: the optimizer's model has one set of requirements, so
  // they share the higher of each (which only matters if one isn't met)
  const requirements = usesOffhand
    ? Object.fromEntries(
        allAttributes
          .map((attribute) => [
            attribute,
            Math.max(
              pairedWeapon.requirements[attribute] ?? 0,
              offhand.weapon.requirements[attribute] ?? 0,
            ),
          ])
          .filter(([, value]) => value),
      )
    : pairedWeapon.requirements;
  const weapon: Weapon = {
    ...withScalingBonus(pairedWeapon, upgradeLevel, getScalingBonus("main")),
    requirements,
  };
  const offhandUpgradeLevel = usesOffhand
    ? getWeaponUpgradeLevel(offhand.weapon, offhand.regularUpgradeLevel)
    : 0;
  const offhandWeapon = usesOffhand
    ? alignWeapon(
        {
          ...withScalingBonus(offhand.weapon, offhandUpgradeLevel, getScalingBonus("off")),
          requirements,
        },
        offhandUpgradeLevel,
        upgradeLevel,
      )
    : undefined;
  const attack =
    requestedAttack && applyHpDamageBuffs(applyPoiseBuffs(requestedAttack, buffs), buffs);
  const spellScaling = buffs.find((effect) => effect.flat && effect.spellScaling)?.spellScaling;
  const spellBuffWeapon =
    catalyst && spellScaling
      ? getSpellBuffWeapon(weapon, catalyst, catalystUpgradeLevel, spellScaling)
      : undefined;
  // Hits' flat attack is scaled by the weapon's base attack rate for its upgrade level
  const baseAttackRate = getBaseAttackRate(weapon, upgradeLevel);
  const offhandBaseAttackRate = usesOffhand
    ? getBaseAttackRate(offhand.weapon, offhandUpgradeLevel)
    : baseAttackRate;
  // The off hand weapon's own multiplier against the enemy's types, instead of the main weapon's
  const offhandEnemyRate = usesOffhand
    ? getEnemyTypeRate(offhand.weapon.enemyTypeRates, enemyTypes) /
      getEnemyTypeRate(weapon.enemyTypeRates, enemyTypes)
    : 1;
  const toHit = (hit: AttackDataHit, weight: number): AttackHit => {
    const offhandHit = usesOffhand && !!hit.leftHand;
    // Buffs that apply to this hit: multipliers multiply, and flat attack adds
    const applied = buffs.filter((effect) => buffAppliesTo(effect, hit, attack));
    const attackPowerRates = allDamageTypes.map((damageType) =>
      applied.reduce((rate, effect) => rate * (effect.attackPowerRates?.[damageType] ?? 1), 1),
    );
    const damageRates = allDamageTypes.map((damageType) =>
      applied.reduce(
        (rate, effect) => rate * (effect.damageRates?.[damageType] ?? 1),
        (hit.damageRates?.[damageType] ?? 1) * (offhandHit ? offhandEnemyRate : 1),
      ),
    );
    // Weapon buffs only apply to hits with the weapon, not e.g. a skill's projectiles. Spell buffs
    // scale with the catalyst (unscaled without one).
    const getBuffFlat = (scaled: boolean) =>
      allDamageTypes.map((damageType) =>
        hit.motionValue > 0
          ? (applied
              .filter((effect) => !!effect.spellScaling === scaled)
              .reduce((sum, effect) => sum + (effect.flat?.[damageType] ?? 0), 0) *
              (hit.buffMotionValue ?? 100)) /
            100
          : 0,
      );
    const buffFlat = getBuffFlat(false);
    const spellBuffFlat = getBuffFlat(true);
    const hasRates = attackPowerRates.some((rate) => rate !== 1);
    const buffAttack =
      hit.buffAttack || buffFlat.some(Boolean)
        ? allDamageTypes.map(
            (damageType) =>
              ((hit.buffAttack?.[damageType] ?? 0) + buffFlat[damageType]) *
              attackPowerRates[damageType],
          )
        : undefined;
    // Attack power multipliers are the same as multiplying motion values and flat attack
    const motionValues = hasRates
      ? allDamageTypes.map(
          (damageType) =>
            (hit.motionValues?.[damageType] ?? hit.motionValue) * attackPowerRates[damageType],
        )
      : hit.motionValues;
    return {
      motionValue: motionValues ? Math.max(...motionValues) : hit.motionValue,
      motionValues,
      physicalType: hit.physicalType,
      noTwoHandBonus: hit.noTwoHandBonus,
      flatAttack: hit.flatAttack?.map(
        (flat, damageType) =>
          (hit.fixedFlatAttack
            ? flat
            : flat * (offhandHit ? offhandBaseAttackRate : baseAttackRate)) *
          attackPowerRates[damageType],
      ),
      fixedFlatAttack: hit.fixedFlatAttack,
      buffAttack,
      ...(spellBuffFlat.some(Boolean) && {
        spellBuffAttack: spellBuffFlat.map(
          (flat, damageType) => flat * attackPowerRates[damageType],
        ),
      }),
      ...(damageRates.some((rate) => rate !== 1) && { damageRates }),
      attackElementCorrect: hit.attackElementCorrect,
      ...(offhandHit && { offhand: true }),
      weight,
    };
  };

  // Levels spent meeting requirements are always taken, and count towards the level and rune
  // limits (not the spell buff's: it applies anyway, with a note if they aren't met)
  const requiredAttributes = meetRequirements
    ? getRequiredAttributes(weapon, twoHanding, attributes, bonusAttributes)
    : attributes;
  const requiredLevels = allAttributes.reduce(
    (sum, attribute) => sum + requiredAttributes[attribute] - attributes[attribute],
    0,
  );
  const requiredRunes = getCumulativeLevelUpCosts(startLevel, requiredLevels, currentLevel)[
    requiredLevels
  ];

  // Runes for the planned stats beyond the current level count towards the budget too
  const plannedRunes = getCumulativeLevelUpCosts(
    currentLevel,
    Math.max(0, startLevel - currentLevel),
  ).at(-1)!;
  const levelLimits: Limits = {
    ...limits,
    maxLevels: limits.maxLevels == null ? null : Math.max(0, limits.maxLevels - requiredLevels),
    runeBudget:
      limits.runeBudget == null
        ? null
        : Math.max(0, limits.runeBudget - plannedRunes - requiredRunes),
  };
  // Fast mode only optimizes the level that the level and rune limits stop at
  const fastLimit = fast
    ? applyLimits(
        Array.from(
          { length: Math.max(1, maxCharacterLevel - startLevel - requiredLevels + 1) },
          (_, n) => n,
        ),
        startLevel + requiredLevels,
        { ...levelLimits, minGainPerLevel: null, minRelativeGainPerLevel: null, targetValue: null },
        currentLevel,
      )
    : null;

  const enemyRate =
    (attack?.critical ? criticalDamageRate : 1) *
    getEnemyTypeRate(weapon.enemyTypeRates, enemyTypes);
  const options = {
    ...(fastLimit && { onlyLevels: fastLimit.levels }),
    weapon,
    upgradeLevel,
    twoHanding,
    attributes: requiredAttributes,
    bonusAttributes,
    objective,
    defenses: objective === "spellScaling" ? undefined : defenses,
    motionValue,
    // Spell scaling isn't affected by a weapon's attacks
    hits:
      attack && objective !== "spellScaling"
        ? attack.steps.flatMap((step, i) =>
            // Steps that don't count (a skill's follow-ups) are left out
            // Ticks count every time they hit
            attack.weights[i] > 0
              ? step.map((hit) => toHit(hit, attack.weights[i] * getTickCount(hit)))
              : [],
          )
        : undefined,
    physicalNegation,
    ...(attack?.needsRequirements && objective !== "spellScaling" && { needsRequirements: true }),
    ...(spellBuffWeapon && { spellBuffWeapon }),
    ...(offhandWeapon && { offhandWeapon }),
    // Some enemies take less damage from critical hits (assumed to apply after defenses), and some
    // weapons do more to some enemy types
    damageMultipliers:
      enemyRate !== 1
        ? Object.fromEntries(
            allDamageTypes.map((damageType) => [
              damageType,
              (weapon.damageMultipliers?.[damageType] ?? 1) * enemyRate,
            ]),
          )
        : weapon.damageMultipliers,
  };

  const curve = unavailableReason ? null : findCurve(options);
  if (!curve) {
    return {
      unavailableReason,
      weaponName: weapon.name,
      url: weapon.url,
      applicable: false,
      exact: true,
      startValue: 0,
      finalValue: 0,
      curve: { startLevel, values: [] },
      levels: startLevel - currentLevel,
      finalLevel: startLevel,
      runes: getCumulativeLevelUpCosts(currentLevel, Math.max(0, startLevel - currentLevel)).at(
        -1,
      )!,
      reason: "maxedOut",
      attributes,
      effectiveAttributes: adjustAttributesForTwoHanding({
        twoHanding,
        weapon,
        attributes: getEffectiveAttributes(attributes, bonusAttributes),
      }),
      ineffectiveAttributes: [],
      scaling: weapon.attributeScaling[options.upgradeLevel],
      requirements: weapon.requirements,
      breakdown: [],
      statusBuildup: getStatusBuildup(
        getWeaponAttack({
          weapon,
          attributes: getEffectiveAttributes(attributes, bonusAttributes),
          twoHanding,
          upgradeLevel: options.upgradeLevel,
        }).attackPower,
      ),
    };
  }

  // In fast mode the curve is just the final level (fewer levels if every stat is maxed)
  const { levels, runes, reason } =
    fastLimit && curve.levels != null
      ? {
          levels: curve.levels,
          runes: getCumulativeLevelUpCosts(startLevel + requiredLevels, curve.levels, currentLevel)[
            curve.levels
          ],
          reason: curve.levels < fastLimit.levels ? ("maxedOut" as const) : fastLimit.reason,
        }
      : applyLimits(curve.values, startLevel + requiredLevels, levelLimits, currentLevel);
  const curveIndex = curve.levels != null ? 0 : levels;
  const finalAttributes = curve.allocations[curveIndex];
  const hpDamage = getAttackHpDamage(attack, enemyHp);

  const effectiveAttributes = adjustAttributesForTwoHanding({
    twoHanding,
    weapon,
    attributes: getEffectiveAttributes(finalAttributes, bonusAttributes),
  });
  // The catalyst is held one handed, so only bonuses count towards casting the buff spell
  const castingAttributes = getEffectiveAttributes(finalAttributes, bonusAttributes);
  const meetsCastingRequirements = allAttributes.every(
    (attribute) => castingAttributes[attribute] >= (castingRequirements?.[attribute] ?? 0),
  );
  const statusWeapon = withBuffStatus(
    weapon,
    options.upgradeLevel,
    buffs.filter((effect) => effect.hand !== "off"),
  );
  const { ineffectiveAttributes, attackPower: weaponAttackPower } = getWeaponAttack({
    weapon,
    attributes: getEffectiveAttributes(finalAttributes, bonusAttributes),
    twoHanding,
    upgradeLevel: options.upgradeLevel,
  });
  // Status buildup including the buffs'
  const { attackPower: statusAttackPower } = getWeaponAttack({
    weapon: statusWeapon,
    attributes: getEffectiveAttributes(finalAttributes, bonusAttributes),
    twoHanding,
    upgradeLevel: options.upgradeLevel,
  });
  const attackPower = {
    ...weaponAttackPower,
    ...Object.fromEntries(allStatusTypes.map((type) => [type, statusAttackPower[type]])),
  };
  /**
   * @returns a function for the status buildup each hit adds on its own with the leveled
   * attributes: its own effects' (scaledStatus with the weapon's status correction), and buffs'
   * unscaled buildup for each weapon hit they apply to
   */
  const getHitStatusOf = (leveled: Attributes) => {
    const statusCorrection = getWeaponAttack({
      weapon: {
        ...weapon,
        attack: weapon.attack.map((levelAttack, level) =>
          level === options.upgradeLevel
            ? Object.fromEntries(allStatusTypes.map((type) => [type, 1]))
            : levelAttack,
        ),
      },
      attributes: getEffectiveAttributes(leveled, bonusAttributes),
      twoHanding,
      upgradeLevel: options.upgradeLevel,
    }).attackPower;
    return (hit: AttackDataHit) =>
      addStatus(hit.status ?? {}, [
        Object.fromEntries(
          Object.entries(hit.scaledStatus ?? {}).map(([type, buildup]) => [
            type,
            buildup * (statusCorrection[+type as AttackPowerType] ?? 1),
          ]),
        ),
        ...buffs
          .filter(
            (effect) =>
              effect.hitStatus && hit.motionValue > 0 && buffAppliesTo(effect, hit, attack),
          )
          .map((effect) => effect.hitStatus!),
      ]);
  };
  const hitStatusOf = getHitStatusOf(finalAttributes);
  // An off hand weapon's hits' status attack power and poise are its own
  const offhandStatusPower =
    offhandWeapon &&
    getWeaponAttack({
      weapon: withBuffStatus(
        offhandWeapon,
        options.upgradeLevel,
        buffs.filter((effect) => effect.hand !== "main"),
      ),
      attributes: getEffectiveAttributes(finalAttributes, bonusAttributes),
      upgradeLevel: options.upgradeLevel,
    }).attackPower;
  const resultAttack =
    attack && offhandWeapon
      ? {
          ...attack,
          steps: attack.steps.map((step) =>
            step.map((hit) =>
              hit.leftHand
                ? {
                    ...hit,
                    poiseBase: offhand!.poiseBase,
                    statusAttackPower: offhandStatusPower,
                  }
                : hit,
            ),
          ),
        }
      : attack;
  // Weapon buffs' attack power, as the game's menu shows it: the skill's own and the chosen ones' flat
  // attack, and spells' times the catalyst's spell scaling (hits get a percentage of it,
  // buffMotionValue)
  const buffAttackPower: Partial<Record<AttackPowerType, number>> = {};
  attack?.skillBuff?.forEach((flat, damageType) => {
    if (flat) buffAttackPower[damageType as AttackPowerType] = flat;
  });
  for (const effect of buffs) {
    effect.flat?.forEach((flat, damageType) => {
      if (!flat) return;
      const attackPower =
        effect.spellScaling && spellBuffWeapon
          ? getWeaponAttack({
              weapon: {
                ...spellBuffWeapon,
                attack: spellBuffWeapon.attack.map((levelAttack, level) =>
                  level === options.upgradeLevel ? { [damageType]: flat } : levelAttack,
                ),
              },
              attributes: getEffectiveAttributes(finalAttributes, bonusAttributes),
              upgradeLevel: options.upgradeLevel,
            }).attackPower[damageType as AttackPowerType] ?? flat
          : flat;
      buffAttackPower[damageType as AttackPowerType] =
        (buffAttackPower[damageType as AttackPowerType] ?? 0) + attackPower;
    });
  }
  // Damage is rounded down for each hit, like the game. The optimizer works with unrounded damage
  // (less than 1 off per hit), so the curve isn't rounded; the start and final values are.
  const roundHits = !!options.defenses;
  const hitDamage = (hit: AttackDataHit, leveled: Attributes) => {
    const damage = getHitDamage(options, toHit(hit, 1), leveled);
    return roundHits ? Math.floor(damage) : damage;
  };
  /** The objective's value with each hit rounded down (the base attack is one hit) */
  const getRoundedValue = (leveled: Attributes) =>
    attack && options.hits
      ? attack.steps.reduce(
          (total, step, i) =>
            total +
            (attack.weights[i] > 0
              ? attack.weights[i] *
                step.reduce((sum, hit) => sum + hitDamage(hit, leveled) * getTickCount(hit), 0)
              : 0),
          0,
        )
      : Math.floor(evaluateObjective(options, leveled)!);
  const attackSteps =
    resultAttack && options.hits
      ? getAttackSteps(
          resultAttack,
          attackPower,
          (hit) => hitDamage(hit, finalAttributes),
          enemyHp,
          hitStatusOf,
          poiseDamageRate,
        )
      : undefined;
  const notedHitDamage =
    attack?.notedHit && options.hits ? hitDamage(attack.notedHit, finalAttributes) : undefined;

  return {
    weaponName: weapon.name,
    url: weapon.url,
    applicable: true,
    ...((buffNote || !meetsCastingRequirements) && {
      buffNote:
        buffNote ??
        "The weapon buff spell's or its catalyst's requirements to cast it aren't met with these stats",
    }),
    exact: curve.exact,
    startValue:
      (roundHits ? getRoundedValue(attributes) : evaluateObjective(options, attributes)!) +
      hpDamage,
    finalValue:
      (roundHits ? getRoundedValue(finalAttributes) : curve.values[curveIndex]) + hpDamage,
    curve: {
      startLevel: startLevel + requiredLevels + (curve.levels ?? 0),
      values: curve.values
        .slice(0, Math.max(1, maxCharacterLevel - startLevel - requiredLevels + 1))
        .map((value) => Math.round((value + hpDamage) * 100) / 100),
      allocations: curve.allocations.slice(
        0,
        Math.max(1, maxCharacterLevel - startLevel - requiredLevels + 1),
      ),
    },
    levels: startLevel + requiredLevels + levels - currentLevel,
    finalLevel: startLevel + requiredLevels + levels,
    runes: plannedRunes + requiredRunes + runes,
    reason,
    attributes: finalAttributes,
    effectiveAttributes,
    ineffectiveAttributes,
    scaling: getAttackScaling(options),
    requirements: weapon.requirements,
    breakdown: addBuffAttack(getBreakdown(options, finalAttributes), buffAttackPower),
    // Only staves and seals: the Carian Sorcery Sword is a catalyst too, but its melee hits use its
    // own scaling
    menuAttackPower:
      (weapon.weaponType === WeaponType.GLINTSTONE_STAFF ||
        weapon.weaponType === WeaponType.SACRED_SEAL) &&
      objective !== "spellScaling" &&
      !options.hits?.some((hit) => hit.attackElementCorrect),
    // Buffs' unscaled buildup for each hit counts like the weapon's own
    statusBuildup: getStatusBuildup(
      addStatus(
        attackPower,
        buffs.map((effect) => effect.hitStatus ?? {}),
      ),
    ),
    attackSteps,
    // A skill whose weapon's requirements aren't met can't be used
    ...(attack?.needsRequirements &&
      objective !== "spellScaling" &&
      ineffectiveAttributes.length > 0 && { skillRequirementsUnmet: true }),
    ...(hpDamage > 0 && {
      hpDamage: {
        label: attack!.steps.flat().find((hit) => hit.hpDamage)!.hpDamage!.label,
        damage: hpDamage,
      },
    }),
    uncountedHpDamage:
      enemyHp == null ? attack?.steps.flat().find((hit) => hit.hpDamage)?.hpDamage : undefined,
    attackNote:
      notedHitDamage != null
        ? attack?.note?.replace("{damage}", String(Math.floor(notedHitDamage)))
        : attack?.note,
    fixedSkill: attack?.fixedSkill,
    skillVariant,
    attackStance: resultAttack ? getAttackStance(resultAttack, poiseDamageRate) : undefined,
    attackStamina: attack ? getAttackStamina(attack) : undefined,
    attackDps:
      attack?.needsRequirements && objective !== "spellScaling" && ineffectiveAttributes.length > 0
        ? 0
        : resultAttack && attackSteps
        ? getAttackDps(resultAttack, attackSteps)
        : undefined,
    attackPoisePerSecond: resultAttack ? getAttackPoisePerSecond(resultAttack) : undefined,
    attackStaminaPerSecond: resultAttack ? getAttackStaminaPerSecond(resultAttack) : undefined,
    attackStepTimes: resultAttack?.stepTimes,
    ...(resultAttack?.repeatFrom && { attackRepeatFrom: resultAttack.repeatFrom }),
    attackStatusPerSecond: resultAttack
      ? getAttackStatusPerSecond(resultAttack, attackPower, hitStatusOf)
      : undefined,
    attackStatus: resultAttack
      ? getAttackStatus(resultAttack, attackPower, hitStatusOf)
      : undefined,
    statusAtMaxArcane: getStatusAtMaxArcane(
      statusWeapon,
      options.upgradeLevel,
      twoHanding,
      finalAttributes,
      bonusAttributes,
      attack,
      buffs,
      getHitStatusOf,
    ),
  };
}
