import getWeaponAttack, {
  adjustAttributesForTwoHanding,
  allAttributes,
  allDamageTypes,
  AttackPowerType,
  type Attribute,
  type Attributes,
  type Weapon,
} from "../calculator/calculator.ts";
import {
  getDamageAfterDefense,
  type Defense,
  type Defenses,
  type PhysicalType,
} from "./defense.ts";

export const maxAttributeValue = 99;

/**
 * What to maximize: total AR, AR of a single damage type, or spell scaling
 */
export type Objective = "totalAttack" | "spellScaling" | AttackPowerType;

export interface OptimizeOptions {
  weapon: Weapon;

  /** The actual upgrade level of this weapon (i.e. already converted for somber weapons) */
  upgradeLevel: number;

  twoHanding: boolean;

  /** The character's current leveled attributes */
  attributes: Attributes;

  /** Extra attribute points that don't count towards level, e.g. from talismans */
  bonusAttributes: Attributes;

  objective: Objective;

  /** Enemy defenses. Only applies to AR objectives, not spell scaling */
  defenses?: Defenses;

  /** Motion value of the attack in percent, used along with defenses. Defaults to 100 */
  motionValue?: number;

  /**
   * The hits of a chosen attack. If set, the objective is the weighted sum of each hit's damage,
   * each with its own motion value, rather than attack power (or damage with motionValue).
   */
  hits?: AttackHit[];

  /** Multipliers to damage dealt by damage type, after defenses */
  damageMultipliers?: Weapon["damageMultipliers"];

  /**
   * If set, only find the best allocation for (at most) this many levels, rather than for every
   * number of levels, which is much faster (e.g. for a respec at a fixed level)
   */
  onlyLevels?: number;

  /** Enemy negation for each physical type, used for each hit's physical damage */
  physicalNegation?: Record<PhysicalType, number>;

  /**
   * True for an attack that can't be done at all without the weapon's requirements (a skill): it
   * does nothing while any is unmet, rather than having its scaling penalized
   */
  needsRequirements?: boolean;

  /**
   * The weapon whose scaling hits' spellBuffAttack uses: the catalyst's spell scaling for one stat,
   * for every damage type (see getSpellBuffWeapon)
   */
  spellBuffWeapon?: Weapon;

  /**
   * The off hand weapon that powerstance hits with the left hand (offhand) use, with its attack and
   * scaling at its own upgrade level placed at upgradeLevel (see alignWeapon)
   */
  offhandWeapon?: Weapon;
}

export interface AttackHit {
  motionValue: number;
  /**
   * Motion values for each damage type (by AttackPowerType) if they differ, e.g. a magic-only
   * projectile. Otherwise motionValue applies to every damage type.
   */
  motionValues?: readonly number[];
  /** How much this hit counts, e.g. less for later hits of a chain */
  weight: number;
  /** True if this hit doesn't get two handing's Strength bonus, e.g. the Lizard Greatsword's R2 projectile */
  noTwoHandBonus?: boolean;
  physicalType: PhysicalType;
  /**
   * Flat attack for each damage type (by AttackPowerType), already multiplied by the weapon's base
   * attack rate, that scales with stats like base attack, e.g. Bloodfiend's Arm's R2 area attack
   */
  flatAttack?: readonly number[];
  /** True for flat attack not added to the weapon's base attack, which doesn't scale */
  fixedFlatAttack?: boolean;
  /**
   * A weapon buff's flat attack for each damage type (by AttackPowerType), already multiplied by its
   * motion value, which doesn't scale, e.g. Sacred Blade's 90 holy
   */
  buffAttack?: readonly number[];
  /**
   * A weapon buff's flat attack for each damage type, which scales like options.spellBuffWeapon,
   * e.g. Electrify Armament's 75 lightning times the seal's Faith spell scaling
   */
  spellBuffAttack?: readonly number[];
  /** Damage multipliers for this hit by damage type, after defenses, e.g. from talismans */
  damageRates?: readonly number[];
  /** For a term's copy of a hit (e.g. for its flat attack), the hit it's part of */
  source?: AttackHit;
  /**
   * Which stats scale this hit (its motion values' attack power and its flat attack), if not the
   * weapon's own (overwriteAttackElementCorrectId), e.g. staves' melee hits use standard scaling
   */
  attackElementCorrect?: Weapon["attackElementCorrect"];
  /** True for a powerstance hit with the off hand weapon (options.offhandWeapon), if there is one */
  offhand?: boolean;
}

type DamageOptions = Pick<OptimizeOptions, "motionValue" | "hits" | "physicalNegation"> & {
  damageMultipliers?: Weapon["damageMultipliers"];
};

/**
 * When two handing, an attack's hits that don't get the Strength bonus need attack power without
 * it. @returns the hits with and without the bonus, or null if there's no need to split them
 */
function splitHitsByTwoHandBonus({
  weapon,
  twoHanding,
  hits,
}: Pick<OptimizeOptions, "weapon" | "twoHanding" | "hits">): [AttackHit[], AttackHit[]] | null {
  if (!twoHanding || weapon.paired || !hits?.some((hit) => hit.noTwoHandBonus)) return null;
  return [hits.filter((hit) => !hit.noTwoHandBonus), hits.filter((hit) => hit.noTwoHandBonus)];
}

/**
 * The objective's value for one damage type with the given attack power: the attack power itself,
 * damage after enemy defenses, or the weighted damage of an attack's hits. Each hit is reduced by
 * defenses separately, since several smaller hits do less damage than one big one.
 */
export function getDamage(
  damageType: AttackPowerType,
  attackPower: number,
  defense: Defense | undefined,
  { motionValue, hits, physicalNegation, damageMultipliers }: DamageOptions,
) {
  return (
    (damageMultipliers?.[damageType] ?? 1) *
    getUnmultipliedDamage(damageType, attackPower, defense, { motionValue, hits, physicalNegation })
  );
}

function getUnmultipliedDamage(
  damageType: AttackPowerType,
  attackPower: number,
  defense: Defense | undefined,
  { motionValue, hits, physicalNegation }: DamageOptions,
) {
  if (!hits) {
    return defense ? getDamageAfterDefense(attackPower, defense, motionValue) : attackPower;
  }
  let total = 0;
  for (const hit of hits) {
    const motionValue = hit.motionValues?.[damageType] ?? hit.motionValue;
    if (!motionValue) continue;
    const hitDefense =
      defense && physicalNegation && damageType === AttackPowerType.PHYSICAL
        ? { ...defense, negation: physicalNegation[hit.physicalType] }
        : defense;
    total +=
      hit.weight *
      (hit.damageRates?.[damageType] ?? 1) *
      (hitDefense
        ? getDamageAfterDefense(attackPower, hitDefense, motionValue)
        : (attackPower * motionValue) / 100);
  }
  return total;
}

export interface OptimizationCurve {
  /**
   * values[n] is the best objective value achievable by gaining at most n levels. With onlyLevels,
   * values[0] is the value for `levels` levels instead.
   */
  values: number[];

  /** allocations[n] is the leveled attributes that achieve values[n] */
  allocations: Attributes[];

  /** False if a heuristic search was used, so the values may be slightly below optimal */
  exact: boolean;

  /** With onlyLevels, the number of levels values[0] is for (fewer if every stat is maxed) */
  levels?: number;
}

/** Attack power is multiplied by this when a weapon's attribute requirements aren't met */
const ineffectivePenaltyMultiplier = 0.6;

/** Maximum number of attribute combinations to try in an exhaustive search */
const bruteForceLimit = 2_000_000;

const epsilon = 1e-9;

function getEffectiveAttributes(leveled: Attributes, bonusAttributes: Attributes): Attributes {
  const attributes = {} as Attributes;
  for (const attribute of allAttributes) {
    attributes[attribute] = Math.min(
      maxAttributeValue,
      leveled[attribute] + bonusAttributes[attribute],
    );
  }
  return attributes;
}

/**
 * @returns the value of the objective for a weapon with the given leveled attributes, or
 * undefined if the objective doesn't apply to this weapon (e.g. spell scaling on a sword)
 */
export function evaluateObjective(
  options: OptimizeOptions,
  leveled: Attributes,
): number | undefined {
  const { weapon, upgradeLevel, twoHanding, bonusAttributes, objective } = options;
  if (objective === "spellScaling") {
    const { spellScaling } = getWeaponAttack({
      weapon,
      attributes: getEffectiveAttributes(leveled, bonusAttributes),
      twoHanding,
      upgradeLevel,
    });
    const values: number[] = [];
    if (weapon.sorceryTool) values.push(spellScaling[AttackPowerType.MAGIC] ?? 0);
    if (weapon.incantationTool) values.push(spellScaling[AttackPowerType.HOLY] ?? 0);
    return values.length ? Math.max(...values) : undefined;
  }

  const terms = getTermGroups(options)?.[0];
  if (!terms) return undefined;
  // An attack that needs the requirements does nothing while any is unmet
  if (
    options.needsRequirements &&
    getWeaponAttack({
      weapon,
      attributes: getEffectiveAttributes(leveled, bonusAttributes),
      twoHanding,
      upgradeLevel,
    }).ineffectiveAttributes.length
  ) {
    return 0;
  }
  return getTermsDamage(
    terms,
    terms.map((term) => getTermAttackPower(options, term, leveled)),
    options,
    getDamageOptions(options),
    needsCombining(terms, options),
  );
}

function getDamageOptions(options: OptimizeOptions): DamageOptions {
  return {
    motionValue: options.motionValue,
    hits: options.hits,
    physicalNegation: options.physicalNegation,
    damageMultipliers: options.damageMultipliers,
  };
}

/**
 * A term's attack power with the given leveled attributes, using the regular calculator (including
 * the penalty for unmet requirements)
 */
function getTermAttackPower(options: OptimizeOptions, term: Term, leveled: Attributes) {
  const { weapon, upgradeLevel, twoHanding, bonusAttributes } = options;
  const termWeapon = term.weapon ?? weapon;
  return (
    getWeaponAttack({
      weapon: {
        ...termWeapon,
        attack: termWeapon.attack.map((attack, level) =>
          level === upgradeLevel ? { [term.damageType]: term.base } : attack,
        ),
      },
      attributes: getEffectiveAttributes(leveled, bonusAttributes),
      twoHanding,
      // Hits without two handing's Strength bonus still meet requirements with it
      noTwoHandingScaling: term.noTwoHandBonus,
      upgradeLevel,
    }).attackPower[term.damageType] ?? 0
  );
}

/**
 * One damage type contributing to the objective
 */
interface Term {
  damageType: AttackPowerType;
  base: number;
  defense?: Defense;
  /**
   * The hits this term is for, if not all of them: when an attack's hits are split by whether they
   * get two handing's Strength bonus, or for a hit's flat attack
   */
  hits?: AttackHit[];
  /** True if this term scales without two handing's Strength bonus */
  noTwoHandBonus?: boolean;
  /** The weapon whose scaling this term uses, if not the weapon itself, e.g. for flat attack */
  weapon?: Weapon;
  /** True for a hit's flat attack rather than the weapon's base attack */
  flat?: boolean;
  /** True if the weapon's requirements don't affect this term, e.g. a catalyst's spell buff */
  noRequirements?: boolean;
}

/**
 * True if a hit has attack of the same damage type in more than one term (e.g. its weapon damage and
 * flat attack), which the game adds before defenses
 */
function needsCombining(terms: Term[], options: OptimizeOptions) {
  const seen = new Set<string>();
  const ids = new Map<AttackHit, number>();
  for (const term of terms) {
    for (const hit of term.hits ?? options.hits ?? []) {
      const motionValue = hit.motionValues?.[term.damageType] ?? hit.motionValue;
      if (!motionValue) continue;
      const source = hit.source ?? hit;
      if (!ids.has(source)) ids.set(source, ids.size);
      const key = `${term.damageType}:${ids.get(source)}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }
  return false;
}

/**
 * The damage of terms with the given attack powers, adding each hit's attack of each damage type
 * from every term before defenses, like the game
 */
function getCombinedDamage(
  terms: Term[],
  attackPowers: number[],
  options: OptimizeOptions,
  damageOptions: DamageOptions,
) {
  const attacks = new Map<AttackHit, Float64Array>();
  const defenses: (Defense | undefined)[] = [];
  terms.forEach((term, t) => {
    defenses[term.damageType] = term.defense;
    for (const hit of term.hits ?? options.hits ?? []) {
      const motionValue = hit.motionValues?.[term.damageType] ?? hit.motionValue;
      if (!motionValue) continue;
      const source = hit.source ?? hit;
      let attack = attacks.get(source);
      if (!attack) {
        attack = new Float64Array(allDamageTypes.length);
        attacks.set(source, attack);
      }
      attack[term.damageType] += (attackPowers[t] * motionValue) / 100;
    }
  });
  let total = 0;
  for (const [hit, attack] of attacks) {
    attack.forEach((value, damageType) => {
      if (!value) return;
      total += getDamage(damageType as AttackPowerType, value, defenses[damageType], {
        ...damageOptions,
        hits: [{ ...hit, motionValue: 100, motionValues: undefined }],
      });
    });
  }
  return total;
}

/**
 * The damage of terms with the given attack powers
 */
function getTermsDamage(
  terms: Term[],
  attackPowers: number[],
  options: OptimizeOptions,
  damageOptions: DamageOptions,
  combine: boolean,
) {
  if (combine) return getCombinedDamage(terms, attackPowers, options, damageOptions);
  return terms.reduce(
    (total, term, t) =>
      total +
      getDamage(
        term.damageType,
        attackPowers[t],
        term.defense,
        term.hits ? { ...damageOptions, hits: term.hits } : damageOptions,
      ),
    0,
  );
}

/**
 * Groups of an attack's hits that scale the same way, or null if they all scale like the weapon
 */
function getHitGroups(
  options: OptimizeOptions,
): Pick<Term, "hits" | "noTwoHandBonus" | "weapon">[] | null {
  const { weapon, hits } = options;
  if (!hits) return null;
  const split = splitHitsByTwoHandBonus(options) != null;
  const groups = new Map<string, Pick<Term, "hits" | "noTwoHandBonus" | "weapon">>();
  for (const hit of hits) {
    const noTwoHandBonus = split && !!hit.noTwoHandBonus;
    const key = `${noTwoHandBonus}:${JSON.stringify(hit.attackElementCorrect ?? null)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        hits: [],
        noTwoHandBonus,
        weapon: hit.attackElementCorrect
          ? { ...weapon, attackElementCorrect: hit.attackElementCorrect }
          : undefined,
      };
      groups.set(key, group);
    }
    group.hits!.push(hit);
  }
  const [only] = groups.values();
  return groups.size === 1 && !only.noTwoHandBonus && !only.weapon ? null : [...groups.values()];
}

/**
 * The damage of one hit with the given leveled attributes, including its flat attack
 */
export function getHitDamage(options: OptimizeOptions, hit: AttackHit, leveled: Attributes) {
  return (
    evaluateObjective(
      { ...options, objective: "totalAttack", hits: [{ ...hit, weight: 1 }] },
      leveled,
    ) ?? 0
  );
}

/**
 * Terms for hits' flat attack: each hit's flat attack of each damage type is like a weapon base
 * attack scaled by the weapon's stats (or the hit's own attackElementCorrect), dealt only by that hit
 */
function getFlatTerms(options: OptimizeOptions, damageTypes: readonly AttackPowerType[]): Term[] {
  const { weapon, twoHanding, defenses, hits, spellBuffWeapon } = options;
  const split = splitHitsByTwoHandBonus(options) != null || (twoHanding && !weapon.paired);
  const terms: Term[] = [];
  const unscaledWeapon = { ...weapon, attackElementCorrect: {} };
  for (const hit of hits ?? []) {
    const hitWeapon = (hit.offhand && options.offhandWeapon) || weapon;
    const parts: [readonly number[] | undefined, Weapon, boolean?][] = [
      [
        hit.flatAttack,
        hit.fixedFlatAttack
          ? unscaledWeapon
          : hit.attackElementCorrect
          ? { ...hitWeapon, attackElementCorrect: hit.attackElementCorrect }
          : hitWeapon,
      ],
      [hit.buffAttack, unscaledWeapon],
      [hit.spellBuffAttack, spellBuffWeapon ?? unscaledWeapon, true],
    ];
    for (const [attack, scalingWeapon, noRequirements] of parts) {
      if (!attack) continue;
      for (const damageType of damageTypes) {
        const base = attack[damageType];
        if (!base) continue;
        terms.push({
          damageType,
          base,
          defense: defenses?.[damageType],
          weapon: scalingWeapon,
          hits: [
            {
              ...hit,
              motionValue: 100,
              motionValues: undefined,
              flatAttack: undefined,
              buffAttack: undefined,
              spellBuffAttack: undefined,
              source: hit,
            },
          ],
          noTwoHandBonus: split && hit.noTwoHandBonus,
          flat: true,
          ...(noRequirements && { noRequirements }),
        });
      }
    }
  }
  return terms;
}

/**
 * @returns alternative groups of terms to maximize (the objective is the best group), or null if
 * the objective doesn't apply to this weapon
 */
function getTermGroups(options: OptimizeOptions, splitHits = true): Term[][] | null {
  const { weapon, upgradeLevel, objective, defenses } = options;
  if (objective === "spellScaling") {
    const groups: Term[][] = [];
    if (weapon.sorceryTool) groups.push([{ damageType: AttackPowerType.MAGIC, base: 100 }]);
    if (weapon.incantationTool) groups.push([{ damageType: AttackPowerType.HOLY, base: 100 }]);
    return groups.length ? groups : null;
  }

  const damageTypes = objective === "totalAttack" ? allDamageTypes : [objective];
  // Powerstance hits with an off hand weapon use its attack instead
  const { offhandWeapon, hits } = options;
  const offhandHits = offhandWeapon && hits?.filter((hit) => hit.offhand);
  const mainOptions = offhandHits?.length
    ? { ...options, hits: hits!.filter((hit) => !hit.offhand) }
    : options;
  const weaponTerms = (termWeapon: Weapon, termOptions: OptimizeOptions): Term[] => {
    let terms: Term[] = damageTypes
      .filter((damageType) => termWeapon.attack[upgradeLevel][damageType])
      .map((damageType) => ({
        damageType,
        base: termWeapon.attack[upgradeLevel][damageType]!,
        defense: defenses?.[damageType],
        ...(termWeapon !== weapon && { weapon: termWeapon, hits: termOptions.hits }),
      }));
    // Hits that scale differently (without two handing's Strength bonus, or with their own attack
    // element correction) get their own terms
    const groups = splitHits ? getHitGroups({ ...termOptions, weapon: termWeapon }) : null;
    if (groups) {
      terms = terms.flatMap((term) =>
        groups.map((group) => ({ ...term, ...group, weapon: group.weapon ?? term.weapon })),
      );
    } else if (termOptions !== options) {
      terms = terms.map((term) => ({ ...term, hits: termOptions.hits }));
    }
    return terms;
  };
  const terms = [
    ...(mainOptions.hits?.length || !offhandHits?.length ? weaponTerms(weapon, mainOptions) : []),
    ...(offhandHits?.length
      ? weaponTerms(offhandWeapon!, { ...options, weapon: offhandWeapon!, hits: offhandHits })
      : []),
  ];
  if (!terms.length) return null;
  return [[...terms, ...(splitHits ? getFlatTerms(options, damageTypes) : [])]];
}

/**
 * @returns an attack's scaling for each attribute: the highest of any damage it does (each term
 * whose hits have a motion value for it), e.g. Flame of the Redmanes's fire, which only scales with
 * Strength, whatever the weapon's own scaling. Without hits, the weapon's own.
 */
export function getAttackScaling(options: OptimizeOptions): Partial<Record<Attribute, number>> {
  const { weapon, upgradeLevel, hits } = options;
  const terms = hits?.length ? getTermGroups(options)?.[0] : undefined;
  if (!terms) return weapon.attributeScaling[upgradeLevel];
  const scaling: Partial<Record<Attribute, number>> = {};
  for (const term of terms) {
    const termHits = term.hits ?? hits!;
    if (!termHits.some((hit) => (hit.motionValues?.[term.damageType] ?? hit.motionValue) > 0)) {
      continue;
    }
    for (const attribute of allAttributes) {
      const value = getAttributeScaling(
        term.weapon ?? weapon,
        upgradeLevel,
        term.damageType,
        attribute,
      );
      if (value > (scaling[attribute] ?? 0)) scaling[attribute] = value;
    }
  }
  return scaling;
}

/**
 * The scaling multiplier for one attribute on one damage type, mirroring getWeaponAttack()
 */
export function getAttributeScaling(
  weapon: Weapon,
  upgradeLevel: number,
  damageType: AttackPowerType,
  attribute: Attribute,
) {
  const attributeCorrect = weapon.attackElementCorrect[damageType]?.[attribute];
  if (!attributeCorrect) {
    return 0;
  }
  const scaling =
    attributeCorrect === true
      ? weapon.attributeScaling[upgradeLevel][attribute] ?? 0
      : attributeCorrect *
        (weapon.attributeScalingRates?.[upgradeLevel][attribute] ??
          (weapon.attributeScaling[upgradeLevel][attribute] ?? 0) /
            (weapon.attributeScaling[0][attribute] ?? 0));
  return Number.isFinite(scaling) ? scaling : 0;
}

/**
 * Precomputed per-attribute data for quickly evaluating one group of terms. Only attributes that
 * can affect the objective are included.
 */
interface Model {
  attributes: Attribute[];
  terms: Term[];
  damageOptions: DamageOptions;
  /** Damage options for each term, with only its hits if the attack's hits are split */
  termDamageOptions: DamageOptions[];
  options: OptimizeOptions;
  /** True if hits' attack must be added up across terms before defenses */
  combine: boolean;

  /** The current leveled value of each attribute, i.e. the lowest value allowed */
  min: number[];

  /** contributions[i][t][v] is attack power added to term t when attribute i is leveled to v */
  contributions: Float64Array[][];

  /** unmet[i][v] is 1 if attribute i at leveled value v doesn't meet the weapon requirement */
  unmet: Uint8Array[];

  /** Bitmask of attributes (by index) whose unmet requirement penalizes each term */
  penaltyMasks: number[];

  /** What a penalized term's attack power is multiplied by (0 for attacks that need requirements) */
  penaltyMultiplier: number;
}

function buildModel(options: OptimizeOptions, terms: Term[]): Model {
  const { weapon, upgradeLevel, twoHanding, attributes, bonusAttributes } = options;

  const attributeSet = allAttributes.filter((attribute) =>
    terms.some(({ damageType, weapon: termWeapon = weapon }) => {
      if (!termWeapon.attackElementCorrect[damageType]?.[attribute]) return false;
      // Attributes with no scaling only matter if they can incur a requirement penalty
      return (
        getAttributeScaling(termWeapon, upgradeLevel, damageType, attribute) > 0 ||
        weapon.requirements[attribute] != null
      );
    }),
  );

  const model: Model = {
    attributes: attributeSet,
    terms,
    damageOptions: getDamageOptions(options),
    termDamageOptions: [],
    options,
    combine: needsCombining(terms, options),
    min: attributeSet.map((attribute) => attributes[attribute]),
    contributions: [],
    unmet: [],
    // An attack that needs the requirements does nothing while any is unmet
    penaltyMasks: terms.map(({ damageType, weapon: termWeapon = weapon, noRequirements }) =>
      options.needsRequirements
        ? attributeSet.reduce(
            (mask, attribute, i) => (weapon.requirements[attribute] ? mask | (1 << i) : mask),
            0,
          )
        : noRequirements
        ? 0
        : attributeSet.reduce(
            (mask, attribute, i) =>
              termWeapon.attackElementCorrect[damageType]?.[attribute] ? mask | (1 << i) : mask,
            0,
          ),
    ),
    penaltyMultiplier: options.needsRequirements ? 0 : ineffectivePenaltyMultiplier,
  };

  model.termDamageOptions = terms.map(({ hits }) =>
    hits ? { ...model.damageOptions, hits } : model.damageOptions,
  );

  attributeSet.forEach((attribute, i) => {
    const requirement = weapon.requirements[attribute] ?? 0;
    const unmet = new Uint8Array(maxAttributeValue + 1);
    const contributions = terms.map(() => new Float64Array(maxAttributeValue + 1));

    for (let value = model.min[i]; value <= maxAttributeValue; value++) {
      // The value used for scaling and requirements, after bonuses and two handing
      const effective = getEffectiveAttributes(
        { ...attributes, [attribute]: value },
        bonusAttributes,
      );
      const adjustedValue = adjustAttributesForTwoHanding({
        twoHanding,
        weapon,
        attributes: effective,
      })[attribute];

      unmet[value] = adjustedValue < requirement ? 1 : 0;
      terms.forEach(({ damageType, base, noTwoHandBonus, weapon: termWeapon = weapon }, t) => {
        contributions[t][value] =
          base *
          termWeapon.calcCorrectGraphs[damageType][
            noTwoHandBonus ? effective[attribute] : adjustedValue
          ] *
          getAttributeScaling(termWeapon, upgradeLevel, damageType, attribute);
      });
    }

    model.unmet.push(unmet);
    model.contributions.push(contributions);
  });

  return model;
}

function getMaxLevels(model: Model) {
  return model.min.reduce((sum, min) => sum + maxAttributeValue - min, 0);
}

/**
 * Evaluate the objective for one group of terms, including requirement penalties and defenses
 */
function evaluateModel(model: Model, values: number[]) {
  let unmetMask = 0;
  for (let i = 0; i < values.length; i++) {
    if (model.unmet[i][values[i]]) unmetMask |= 1 << i;
  }

  const attackPowers = model.terms.map(({ base }, t) => {
    if (unmetMask & model.penaltyMasks[t]) return base * model.penaltyMultiplier;
    let attackPower = base;
    for (let i = 0; i < values.length; i++) {
      attackPower += model.contributions[i][t][values[i]];
    }
    return attackPower;
  });
  if (model.combine) {
    return getCombinedDamage(model.terms, attackPowers, model.options, model.damageOptions);
  }
  let total = 0;
  model.terms.forEach(({ damageType, defense }, t) => {
    total += getDamage(damageType, attackPowers[t], defense, model.termDamageOptions[t]);
  });
  return total;
}

/**
 * Exact optimization when the objective is a sum of attack power (or a monotonic function of a
 * single damage type's attack power). Given which requirements are met, every attribute adds an
 * independent amount, so a knapsack-style dynamic program over attributes finds the best
 * allocation for every number of levels at once. Each combination of met/unmet requirements is
 * tried separately.
 *
 * @returns the attribute values for each number of levels, indexed by model attribute
 */
function optimizeLinear(model: Model, maxLevels: number): number[][] {
  const { attributes, terms, min, unmet, contributions, penaltyMasks, penaltyMultiplier } = model;
  const k = attributes.length;
  // How much each term's attack power is worth without defenses: e.g. its motion values and damage
  // multiplier. With defenses there's only one term, and any positive weight gives the same result.
  const slopes = terms.map(({ damageType }, t) =>
    getDamage(damageType, 1, undefined, model.termDamageOptions[t]),
  );

  const best = new Float64Array(maxLevels + 1).fill(-Infinity);
  const allocations: number[][] = [];

  const initiallyUnmet = attributes
    .map((_, i) => i)
    .filter((i) => unmet[i][min[i]])
    .reduce((mask, i) => mask | (1 << i), 0);

  for (let metMask = 0; metMask < 1 << k; metMask++) {
    if (metMask & ~initiallyUnmet) continue;

    // Requirements chosen to be met force a minimum value for that attribute
    const lower = [...min];
    let feasible = true;
    for (let i = 0; i < k; i++) {
      if (metMask & (1 << i)) {
        while (lower[i] <= maxAttributeValue && unmet[i][lower[i]]) lower[i]++;
        if (lower[i] > maxAttributeValue) feasible = false;
      }
    }
    if (!feasible) continue;

    // Requirements not chosen are assumed unmet. This undervalues allocations that meet them
    // anyway, but those are covered when the corresponding bit of metMask is set.
    const assumedUnmet = initiallyUnmet & ~metMask;
    const penalized = terms.map((_, t) => (penaltyMasks[t] & assumedUnmet) !== 0);
    const constant = terms.reduce(
      (sum, { base }, t) => sum + slopes[t] * (penalized[t] ? base * penaltyMultiplier : base),
      0,
    );

    let dp = new Float64Array(maxLevels + 1); // at most n levels, so unspent levels are allowed
    const choices: Int16Array[] = [];
    for (let i = 0; i < k; i++) {
      const gain = new Float64Array(maxAttributeValue + 1);
      for (let value = lower[i]; value <= maxAttributeValue; value++) {
        terms.forEach((_, t) => {
          if (!penalized[t]) gain[value] += slopes[t] * contributions[i][t][value];
        });
      }

      const next = new Float64Array(maxLevels + 1).fill(-Infinity);
      const choice = new Int16Array(maxLevels + 1);
      for (let n = 0; n <= maxLevels; n++) {
        for (let value = lower[i]; value <= maxAttributeValue; value++) {
          const cost = value - min[i];
          if (cost > n) break;
          const candidate = dp[n - cost] + gain[value];
          if (candidate > next[n] + epsilon) {
            next[n] = candidate;
            choice[n] = value;
          }
        }
      }
      dp = next;
      choices.push(choice);
    }

    for (let n = 0; n <= maxLevels; n++) {
      const total = constant + dp[n];
      if (total > best[n] + epsilon) {
        best[n] = total;
        const values = new Array<number>(k);
        let remaining = n;
        for (let i = k - 1; i >= 0; i--) {
          values[i] = choices[i][remaining];
          remaining -= values[i] - min[i];
        }
        allocations[n] = values;
      }
    }
  }

  return allocations;
}

/**
 * Exact optimization for any objective by trying every combination of attribute values
 */
/**
 * @returns the values worth trying for each attribute in an exhaustive search. Attributes that
 * only matter because of a requirement penalty only need to be left alone or raised to meet it.
 */
function getCandidateValues(model: Model): number[][] {
  return model.attributes.map((_, i) => {
    const min = model.min[i];
    const range = Array.from({ length: maxAttributeValue - min + 1 }, (_, j) => min + j);
    if (model.contributions[i].some((contributions) => contributions.some(Boolean))) {
      return range;
    }
    const met = range.find((value) => !model.unmet[i][value]);
    return met == null || met === min ? [min] : [min, met];
  });
}

function optimizeBruteForce(model: Model, maxLevels: number): number[][] {
  const k = model.attributes.length;
  const best = new Float64Array(maxLevels + 1).fill(-Infinity);
  const allocations: number[][] = [];

  const candidates = getCandidateValues(model);
  const indices = new Array<number>(k).fill(0);
  const values = candidates.map((values) => values[0]);
  for (;;) {
    let cost = 0;
    for (let i = 0; i < k; i++) cost += values[i] - model.min[i];

    if (cost <= maxLevels) {
      const value = evaluateModel(model, values);
      if (value > best[cost] + epsilon) {
        best[cost] = value;
        allocations[cost] = [...values];
      }
    }

    // Advance to the next combination
    let i = 0;
    while (i < k && indices[i] === candidates[i].length - 1) {
      indices[i] = 0;
      values[i] = candidates[i][0];
      i++;
    }
    if (i === k) break;
    values[i] = candidates[i][++indices[i]];
  }

  // Allow unspent levels
  for (let n = 1; n <= maxLevels; n++) {
    if (best[n - 1] >= best[n]) {
      best[n] = best[n - 1];
      allocations[n] = allocations[n - 1];
    }
  }

  return allocations;
}

/**
 * Approximate optimization for objectives that can't be optimized exactly in a reasonable time,
 * starting from the exact attack power optimum and improving it by moving levels between
 * attributes
 */
function optimizeLocalSearch(model: Model, maxLevels: number, onlyLast = false): number[][] {
  const k = model.attributes.length;
  const seeds = optimizeLinear(model, maxLevels);
  const steps = [1, 2, 3, 5, 10, 20];

  const allocations: number[][] = [];
  let previous = [...model.min];
  for (let n = onlyLast ? maxLevels : 0; n <= maxLevels; n++) {
    // Candidates: the attack power optimum, and the previous result plus one level anywhere
    const candidates = [seeds[n]];
    for (let i = 0; i < k && n > 0 && !onlyLast; i++) {
      if (previous[i] < maxAttributeValue) {
        candidates.push(previous.map((value, j) => (j === i ? value + 1 : value)));
      }
    }

    let current = candidates[0];
    let currentValue = evaluateModel(model, current);
    for (const candidate of candidates.slice(1)) {
      const value = evaluateModel(model, candidate);
      if (value > currentValue + epsilon) {
        current = candidate;
        currentValue = value;
      }
    }

    // Hill climb by moving levels from one attribute to another
    let improved = true;
    while (improved) {
      improved = false;
      for (let from = 0; from < k; from++) {
        for (let to = 0; to < k; to++) {
          if (from === to) continue;
          for (const step of steps) {
            if (current[from] - step < model.min[from] || current[to] + step > maxAttributeValue) {
              continue;
            }
            const candidate = [...current];
            candidate[from] -= step;
            candidate[to] += step;
            const value = evaluateModel(model, candidate);
            if (value > currentValue + epsilon) {
              current = candidate;
              currentValue = value;
              improved = true;
            }
          }
        }
      }
    }

    allocations[n] = current;
    previous = current;
  }

  return allocations;
}

/**
 * Find the best attribute allocation for every number of levels gained
 *
 * @returns null if the objective doesn't apply to this weapon
 */
export function optimizeAttributes(options: OptimizeOptions): OptimizationCurve | null {
  const termGroups = getTermGroups(options);
  if (!termGroups) {
    return null;
  }

  let exact = true;
  const { onlyLevels } = options;
  const curves = termGroups.map((terms) => {
    const model = buildModel(options, terms);
    const maxLevels = Math.min(getMaxLevels(model), onlyLevels ?? Infinity);

    let allocations: number[][];
    const linear = terms.length === 1 || terms.every(({ defense }) => !defense);
    if (linear) {
      allocations = optimizeLinear(model, maxLevels);
    } else if (
      getCandidateValues(model).reduce((product, values) => product * values.length, 1) <=
      bruteForceLimit
    ) {
      allocations = optimizeBruteForce(model, maxLevels);
    } else {
      allocations = optimizeLocalSearch(model, maxLevels, onlyLevels != null);
      exact = false;
    }

    return allocations.map((values) => {
      const attributes = { ...options.attributes };
      model.attributes.forEach((attribute, i) => (attributes[attribute] = values[i]));
      return attributes;
    });
  });

  // With onlyLevels, just the best of the groups' last allocations
  if (onlyLevels != null) {
    let bestValue = -Infinity;
    let bestAllocation = options.attributes;
    let levels = 0;
    for (const curve of curves) {
      const allocation = curve.at(-1)!;
      const value = evaluateObjective(options, allocation)!;
      if (value > bestValue + epsilon) {
        bestValue = value;
        bestAllocation = allocation;
        // Levels that don't increase the value aren't spent
        levels = allAttributes.reduce(
          (sum, attribute) => sum + allocation[attribute] - options.attributes[attribute],
          0,
        );
      }
    }
    return { values: [bestValue], allocations: [bestAllocation], exact, levels };
  }

  // Combine the groups by taking the best at each number of levels, and verify every value with
  // the regular damage calculator
  const length = Math.max(...curves.map((curve) => curve.length));
  const values: number[] = [];
  const allocations: Attributes[] = [];
  for (let n = 0; n < length; n++) {
    let bestValue = n > 0 ? values[n - 1] : -Infinity;
    let bestAllocation = n > 0 ? allocations[n - 1] : options.attributes;
    for (const curve of curves) {
      const allocation = curve[Math.min(n, curve.length - 1)];
      const value = evaluateObjective(options, allocation)!;
      if (value > bestValue + epsilon) {
        bestValue = value;
        bestAllocation = allocation;
      }
    }
    values.push(bestValue);
    allocations.push(bestAllocation);
  }

  return { values, allocations, exact };
}

/**
 * One damage type's contribution to the objective, split into base attack and the bonus from
 * each attribute
 */
export interface BreakdownRow {
  damageType: AttackPowerType;

  /** Base attack (or 100 for spell scaling), after the penalty if requirements aren't met */
  base: number;

  /** Attack power added by each attribute */
  attributes: Partial<Record<Attribute, number>>;

  /** True if requirements aren't met, so the base is reduced and attributes add nothing */
  penalized: boolean;

  /** Attack power added by weapon buffs (e.g. a grease, or Bloodflame Blade scaled by the catalyst) */
  buff?: number;

  /** Attack power (or spell scaling) for this damage type, including buffs' */
  total: number;

  /** Damage after enemy defenses, if enabled */
  damage?: number;

  /** True if this is the single damage type being maximized */
  maximized: boolean;

  /**
   * True if the weapon has no attack power of this type, and only a chosen attack's flat attack
   * deals it (so only damage applies, and any buff's attack power)
   */
  flatOnly?: boolean;
}

/**
 * Break down where the objective value comes from for the given leveled attributes. When
 * maximizing a single damage type, every damage type the weapon deals is still included.
 */
export function getBreakdown(options: OptimizeOptions, leveled: Attributes): BreakdownRow[] {
  const { weapon, upgradeLevel, twoHanding, bonusAttributes } = options;
  const attributes = getEffectiveAttributes(leveled, bonusAttributes);
  const adjustedAttributes = adjustAttributesForTwoHanding({ twoHanding, weapon, attributes });
  const { ineffectiveAttributes } = getWeaponAttack({
    weapon,
    attributes,
    twoHanding,
    upgradeLevel,
  });

  const { objective } = options;
  const singleDamageType = objective !== "totalAttack" && objective !== "spellScaling";
  const totalOptions: OptimizeOptions = singleDamageType
    ? { ...options, objective: "totalAttack" }
    : options;
  const terms = getTermGroups(totalOptions, false);
  // Damage by damage type, from every term including those for hits that scale differently and
  // flat attack
  const damageOptions = getDamageOptions(options);
  const damageByType = new Map<AttackPowerType, number>();
  if (options.hits || options.defenses || options.damageMultipliers) {
    const allTerms = getTermGroups(totalOptions)?.[0] ?? [];
    const combine = needsCombining(allTerms, options);
    for (const damageType of allDamageTypes) {
      const typeTerms = allTerms.filter((term) => term.damageType === damageType);
      if (!typeTerms.length) continue;
      damageByType.set(
        damageType,
        getTermsDamage(
          typeTerms,
          typeTerms.map((term) => getTermAttackPower(options, term, leveled)),
          options,
          damageOptions,
          combine,
        ),
      );
    }
  }

  // Attack power is shown with the scaling the chosen attack's hits use, if they all overwrite it
  // the same way, e.g. staves' melee hits scale like regular weapons, not with the staff's own
  // scaling the game's menu shows
  const weaponHits = options.hits?.filter((hit) =>
    (hit.motionValues ?? [hit.motionValue]).some((motionValue) => motionValue > 0),
  );
  const correct = weaponHits?.[0]?.attackElementCorrect;
  const scalingWeapon =
    correct &&
    weaponHits.every((hit) => JSON.stringify(hit.attackElementCorrect) === JSON.stringify(correct))
      ? { ...weapon, attackElementCorrect: correct }
      : weapon;

  const rows = (terms ?? []).flat().map(({ damageType, base, defense }) => {
    const penalized = ineffectiveAttributes.some(
      (attribute) => scalingWeapon.attackElementCorrect[damageType]?.[attribute],
    );

    const row: BreakdownRow = {
      damageType,
      base: penalized ? base * ineffectivePenaltyMultiplier : base,
      attributes: {},
      penalized,
      total: 0,
      maximized: singleDamageType && damageType === objective,
    };
    row.total = row.base;

    if (!penalized) {
      for (const attribute of allAttributes) {
        const scaling = getAttributeScaling(scalingWeapon, upgradeLevel, damageType, attribute);
        if (scaling) {
          const bonus =
            base * weapon.calcCorrectGraphs[damageType][adjustedAttributes[attribute]] * scaling;
          row.attributes[attribute] = bonus;
          row.total += bonus;
        }
      }
    }

    if (defense || options.hits || options.damageMultipliers?.[damageType]) {
      row.damage = damageByType.get(damageType) ?? 0;
    }
    return row;
  });

  // Flat attack of a damage type the weapon has no attack power in gets a row of its own
  for (const [damageType, damage] of damageByType) {
    if (!rows.some((row) => row.damageType === damageType)) {
      rows.push({
        damageType,
        base: 0,
        attributes: {},
        penalized: false,
        total: 0,
        damage,
        maximized: singleDamageType && damageType === objective,
        flatOnly: true,
      });
    }
  }
  return rows;
}
