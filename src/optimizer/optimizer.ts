import getWeaponAttack, {
  adjustAttributesForTwoHanding,
  allAttributes,
  allDamageTypes,
  AttackPowerType,
  type Attribute,
  type Attributes,
  getAttributeBonus,
  getAttributeScaling,
  ineffectivePenaltyMultiplier,
  type Weapon,
} from "../calculator/calculator.ts";
import { packAllocations, type PackedAllocations } from "./allocations.ts";
import { applyDefense, type Defense, type Defenses, type PhysicalType } from "./defense.ts";

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
  damageOptions: DamageOptions,
) {
  return getPlanDamage(
    buildDamagePlan([{ damageType, base: attackPower, defense }], damageOptions, false),
    Float64Array.of(attackPower),
  );
}

export interface OptimizationCurve {
  /**
   * values[n] is the best objective value achievable by gaining at most n levels. With onlyLevels,
   * values[0] is the value for `levels` levels instead.
   */
  values: number[];

  /** Allocation n (see getAllocation) is the leveled attributes that achieve values[n] */
  allocations: PackedAllocations;

  /** False if a heuristic search was used, so the values may be slightly below optimal */
  exact: boolean;

  /** With onlyLevels, the number of levels values[0] is for (fewer if every stat is maxed) */
  levels?: number;
}

/** Maximum number of attribute combinations to try in an exhaustive search */
const bruteForceLimit = 2_000_000;

/**
 * Maximum work (see getSeparableWork) for an exact search when the alternative is an approximate
 * one: up to about half a second for the few weapons that need it, e.g. Madding Hand
 */
const exactWorkLimit = 100_000_000;

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
 * The damage of terms with the given attack powers, from their damage plan (see buildDamagePlan)
 *
 * @param combine whether a hit's attack of the same damage type from several terms is added up
 * before defenses (see needsCombining)
 */
function getTermsDamage(
  terms: Term[],
  attackPowers: readonly number[],
  damageOptions: DamageOptions,
  combine: boolean,
) {
  return getPlanDamage(
    buildDamagePlan(terms, damageOptions, combine),
    Float64Array.from(attackPowers),
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
  const { weapon, upgradeLevel } = options;
  const sources = getScalingSources(options);
  if (!sources) return weapon.attributeScaling[upgradeLevel];
  const scaling: Partial<Record<Attribute, number>> = {};
  for (const attribute of allAttributes) {
    for (const { value } of sources[attribute] ?? []) {
      if (value > (scaling[attribute] ?? 0)) scaling[attribute] = value;
    }
  }
  return scaling;
}

/** One of the scaling values an attack uses for an attribute, and what it applies to */
export interface ScalingSource {
  value: number;
  damageType: AttackPowerType;
  /**
   * What the scaled attack is, if not the weapon's own: the off hand weapon's attack (powerstance),
   * a hit's flat attack (e.g. a skill's), or a weapon buff's attack scaled by the catalyst
   */
  kind?: "offhand" | "flat" | "spellBuff";
}

/**
 * @returns each attribute's nonzero scaling values for an attack's damage (each term whose hits have
 * a motion value for it), or null if there are no hits (so the weapon's own scaling applies)
 */
function getScalingSources(
  options: OptimizeOptions,
): Partial<Record<Attribute, ScalingSource[]>> | null {
  const { weapon, upgradeLevel, hits } = options;
  const terms = hits?.length ? getTermGroups(options)?.[0] : undefined;
  if (!terms) return null;
  const sources: Partial<Record<Attribute, ScalingSource[]>> = {};
  for (const term of terms) {
    const termHits = term.hits ?? hits!;
    if (!termHits.some((hit) => (hit.motionValues?.[term.damageType] ?? hit.motionValue) > 0)) {
      continue;
    }
    const kind = term.noRequirements
      ? "spellBuff"
      : term.flat
      ? "flat"
      : termHits.every((hit) => (hit.source ?? hit).offhand) && options.offhandWeapon
      ? "offhand"
      : undefined;
    for (const attribute of allAttributes) {
      const value = getAttributeScaling(
        term.weapon ?? weapon,
        upgradeLevel,
        term.damageType,
        attribute,
      );
      if (!value) continue;
      const list = (sources[attribute] ??= []);
      if (
        !list.some(
          (source) =>
            source.value === value && source.damageType === term.damageType && source.kind === kind,
        )
      ) {
        list.push({ value, damageType: term.damageType, ...(kind && { kind }) });
      }
    }
  }
  return sources;
}

/**
 * @returns each attribute's scaling values and what they apply to, only for attributes the attack
 * scales by more than one amount (as shown, in whole percent), e.g. a skill's flat attack that scales
 * with less Faith than the weapon's own holy
 */
export function getMixedScaling(
  options: OptimizeOptions,
): Partial<Record<Attribute, ScalingSource[]>> | undefined {
  const sources = getScalingSources(options);
  if (!sources) return undefined;
  const mixed: Partial<Record<Attribute, ScalingSource[]>> = {};
  for (const attribute of allAttributes) {
    const list = sources[attribute] ?? [];
    if (new Set(list.map(({ value }) => Math.round(value * 100))).size > 1) {
      mixed[attribute] = list;
    }
  }
  return Object.keys(mixed).length ? mixed : undefined;
}

/**
 * Precomputed per-attribute data for quickly evaluating one group of terms. Only attributes that
 * can affect the objective are included.
 */
interface Model {
  attributes: Attribute[];
  terms: Term[];
  damageOptions: DamageOptions;
  options: OptimizeOptions;
  /** The terms' damage, worked out ahead of time for evaluateModel */
  plan: DamagePlan;
  /** Scratch space for evaluateModel's attack power of each term */
  attackPowers: Float64Array;

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

/**
 * The damage of a group of terms as a list of entries that only need the terms' attack powers,
 * since everything else (hits, motion values, defenses, negation, multipliers) is the same for
 * every allocation tried. Entry e deals
 *
 *   factor[e] * f(sum of coefficient[j] * attack power of term termIndex[j], defense[e])
 *
 * over j from entryStart[e] to entryStart[e + 1] - 1, where f applies the defense multiplier, or
 * does nothing if defense[e] is negative (no defense). The optimizer's model builds one plan and
 * evaluates it for every allocation it tries; the regular calculation builds one each time.
 */
interface DamagePlan {
  /** Each term's attack power before scaling */
  base: Float64Array;
  /** Where each entry's terms start in termIndex and coefficient, plus the end of the last */
  entryStart: Int32Array;
  termIndex: Int32Array;
  /** The term's motion value, divided by 100 */
  coefficient: Float64Array;
  defense: Float64Array;
  /** Hit weight, damage rate, damage type multiplier and negation */
  factor: Float64Array;
}

function buildDamagePlan(
  terms: Term[],
  damageOptions: DamageOptions,
  combine: boolean,
): DamagePlan {
  const { motionValue, physicalNegation, damageMultipliers } = damageOptions;
  const entries: {
    parts: [term: number, coefficient: number][];
    defense?: Defense;
    factor: number;
  }[] = [];
  const addEntry = (
    parts: [number, number][],
    damageType: AttackPowerType,
    defense: Defense | undefined,
    factor: number,
  ) =>
    entries.push({
      parts,
      defense,
      factor:
        (damageMultipliers?.[damageType] ?? 1) *
        factor *
        (defense ? (100 - defense.negation) / 100 : 1),
    });
  // Physical damage uses each hit's own negation for its physical type
  const getHitDefense = (damageType: AttackPowerType, hit: AttackHit, defense?: Defense) =>
    defense && physicalNegation && damageType === AttackPowerType.PHYSICAL
      ? { ...defense, negation: physicalNegation[hit.physicalType] }
      : defense;
  const getHitFactor = (damageType: AttackPowerType, hit: AttackHit) =>
    hit.weight * (hit.damageRates?.[damageType] ?? 1);

  if (combine) {
    // Each hit's attack of each damage type, added up across terms like the game
    const defenses: (Defense | undefined)[] = [];
    const combined = new Map<AttackHit, [number, number][][]>();
    terms.forEach((term, t) => {
      defenses[term.damageType] = term.defense;
      for (const hit of term.hits ?? damageOptions.hits ?? []) {
        const hitMotionValue = hit.motionValues?.[term.damageType] ?? hit.motionValue;
        if (!hitMotionValue) continue;
        const source = hit.source ?? hit;
        let byType = combined.get(source);
        if (!byType) {
          byType = allDamageTypes.map(() => []);
          combined.set(source, byType);
        }
        byType[term.damageType].push([t, hitMotionValue / 100]);
      }
    });
    for (const [hit, byType] of combined) {
      byType.forEach((parts, type) => {
        if (!parts.length) return;
        const damageType = type as AttackPowerType;
        addEntry(
          parts,
          damageType,
          getHitDefense(damageType, hit, defenses[damageType]),
          getHitFactor(damageType, hit),
        );
      });
    }
  } else {
    // Each term's damage on its own: attack power (or damage with a motion value) without hits,
    // otherwise each hit's
    terms.forEach(({ damageType, defense, hits = damageOptions.hits }, t) => {
      if (!hits) {
        addEntry([[t, defense ? (motionValue ?? 100) / 100 : 1]], damageType, defense, 1);
        return;
      }
      for (const hit of hits) {
        const hitMotionValue = hit.motionValues?.[damageType] ?? hit.motionValue;
        if (!hitMotionValue) continue;
        addEntry(
          [[t, hitMotionValue / 100]],
          damageType,
          getHitDefense(damageType, hit, defense),
          getHitFactor(damageType, hit),
        );
      }
    });
  }

  const partCount = entries.reduce((sum, { parts }) => sum + parts.length, 0);
  const plan: DamagePlan = {
    base: Float64Array.from(terms, ({ base }) => base),
    entryStart: new Int32Array(entries.length + 1),
    termIndex: new Int32Array(partCount),
    coefficient: new Float64Array(partCount),
    defense: Float64Array.from(entries, ({ defense }) => defense?.defense ?? -1),
    factor: Float64Array.from(entries, ({ factor }) => factor),
  };
  let j = 0;
  entries.forEach(({ parts }, e) => {
    plan.entryStart[e] = j;
    for (const [t, coefficient] of parts) {
      plan.termIndex[j] = t;
      plan.coefficient[j] = coefficient;
      j++;
    }
  });
  plan.entryStart[entries.length] = j;
  return plan;
}

function buildModel(options: OptimizeOptions, terms: Term[]): Model {
  const { weapon, upgradeLevel, twoHanding, attributes, bonusAttributes } = options;

  const attributeSet = allAttributes.filter(
    (attribute) =>
      // An attack that needs the requirements (a skill) needs every one, even of an attribute its
      // hits don't scale with (e.g. Beast's Roar's bullet only scales with Dex, but a Giant-Crusher
      // can't use it without 60 Strength)
      (options.needsRequirements && weapon.requirements[attribute] != null) ||
      terms.some(({ damageType, weapon: termWeapon = weapon }) => {
        if (!termWeapon.attackElementCorrect[damageType]?.[attribute]) return false;
        // Attributes with no scaling only matter if they can incur a requirement penalty
        return (
          getAttributeScaling(termWeapon, upgradeLevel, damageType, attribute) > 0 ||
          weapon.requirements[attribute] != null
        );
      }),
  );

  const damageOptions = getDamageOptions(options);
  const model: Model = {
    attributes: attributeSet,
    terms,
    damageOptions,
    options,
    plan: buildDamagePlan(terms, damageOptions, needsCombining(terms, options)),
    attackPowers: new Float64Array(terms.length),
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
          getAttributeBonus(
            termWeapon,
            upgradeLevel,
            damageType,
            attribute,
            noTwoHandBonus ? effective[attribute] : adjustedValue,
          );
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
function evaluateModel(model: Model, values: readonly number[]) {
  const { unmet, contributions, penaltyMasks, penaltyMultiplier, attackPowers, plan } = model;
  const { base } = plan;
  const k = values.length;

  let unmetMask = 0;
  for (let i = 0; i < k; i++) {
    if (unmet[i][values[i]]) unmetMask |= 1 << i;
  }

  for (let t = 0; t < base.length; t++) {
    if (unmetMask & penaltyMasks[t]) {
      attackPowers[t] = base[t] * penaltyMultiplier;
      continue;
    }
    let attackPower = base[t];
    for (let i = 0; i < k; i++) {
      attackPower += contributions[i][t][values[i]];
    }
    attackPowers[t] = attackPower;
  }
  return getPlanDamage(plan, attackPowers);
}

/**
 * The damage of a group of terms with the given attack powers, from its damage plan
 */
function getPlanDamage(plan: DamagePlan, attackPowers: Float64Array) {
  let total = 0;
  for (let e = 0; e < plan.factor.length; e++) {
    total += getEntryDamage(plan, attackPowers, e);
  }
  return total;
}

/**
 * The damage of one of a damage plan's entries with the given attack powers
 */
function getEntryDamage(
  { entryStart, termIndex, coefficient, defense, factor }: DamagePlan,
  attackPowers: Float64Array,
  e: number,
) {
  let attack = 0;
  for (let j = entryStart[e]; j < entryStart[e + 1]; j++) {
    attack += coefficient[j] * attackPowers[termIndex[j]];
  }
  const d = defense[e];
  return factor[e] * (d < 0 ? attack : applyDefense(attack, d));
}

/**
 * How much each term's attack power is worth without defenses: e.g. its motion values and damage
 * multiplier, i.e. its damage with 1 attack power
 */
function getSlopes({ terms, damageOptions }: Model) {
  const plan = buildDamagePlan(
    terms.map((term) => ({ ...term, defense: undefined })),
    damageOptions,
    false,
  );
  return terms.map((_, t) => {
    const attackPowers = new Float64Array(terms.length);
    attackPowers[t] = 1;
    return getPlanDamage(plan, attackPowers);
  });
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
  // With defenses there's only one term, and any positive weight gives the same result
  const slopes = getSlopes(model);

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
  // Nothing to level, e.g. an attack whose damage doesn't scale
  if (k === 0) return [[]];
  const best = new Float64Array(maxLevels + 1).fill(-Infinity);
  const allocations: number[][] = [];

  const candidates = getCandidateValues(model);
  const indices = new Array<number>(k).fill(0);
  const values = candidates.map((values) => values[0]);

  // The first attribute changes fastest, so the others' contributions to each term's attack power
  // (and their unmet requirements and cost) are only added up again when one of them changes
  const { unmet, contributions, penaltyMasks, penaltyMultiplier, attackPowers, plan, min } = model;
  const { base } = plan;
  const termCount = base.length;
  const rest = new Float64Array(termCount);
  let restUnmet = 0;
  let restCost = 0;
  const updateRest = () => {
    restUnmet = 0;
    restCost = 0;
    rest.fill(0);
    for (let i = 1; i < k; i++) {
      if (unmet[i][values[i]]) restUnmet |= 1 << i;
      restCost += values[i] - min[i];
      for (let t = 0; t < termCount; t++) rest[t] += contributions[i][t][values[i]];
    }
  };
  updateRest();

  for (;;) {
    const first = values[0];
    const cost = restCost + first - min[0];
    if (cost <= maxLevels) {
      const unmetMask = restUnmet | unmet[0][first];
      for (let t = 0; t < termCount; t++) {
        attackPowers[t] =
          unmetMask & penaltyMasks[t]
            ? base[t] * penaltyMultiplier
            : base[t] + contributions[0][t][first] + rest[t];
      }
      const value = getPlanDamage(plan, attackPowers);
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
    if (i > 0) updateRest();
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

function countBits(mask: number) {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}

/** @returns a bitmask for each term of the attributes its attack power scales with */
function getTermDependencies(model: Model) {
  const k = model.attributes.length;
  return model.terms.map((_, t) => {
    let mask = 0;
    for (let i = 0; i < k; i++) {
      if (model.contributions[i][t].some(Boolean)) mask |= 1 << i;
    }
    return mask;
  });
}

/**
 * A set of terms whose damage depends on its attributes, but not on any other attributes except
 * the fixed ones (see optimizeSeparable)
 */
interface Component {
  terms: number[];
  /** The damage plan's entries for the terms */
  entries: number[];
  /** Bitmask of the attributes the terms scale with, apart from the fixed ones */
  attributes: number;
  /** The terms that scale with those attributes */
  scaling: number[];
}

/**
 * Splits terms into components that don't share attributes (apart from the fixed ones) or damage
 * plan entries
 *
 * @param penalized which terms' attack power is constant, since a requirement is assumed unmet
 */
function getComponents(
  model: Model,
  dependencies: readonly number[],
  free: number,
  penalized?: readonly boolean[],
): Component[] {
  const { plan } = model;
  const termCount = dependencies.length;
  const parent = Array.from({ length: termCount }, (_, t) => t);
  const find = (t: number): number => (parent[t] === t ? t : (parent[t] = find(parent[t])));
  const union = (a: number, b: number) => (parent[find(a)] = find(b));
  for (let e = 0; e + 1 < plan.entryStart.length; e++) {
    for (let j = plan.entryStart[e] + 1; j < plan.entryStart[e + 1]; j++) {
      union(plan.termIndex[j], plan.termIndex[plan.entryStart[e]]);
    }
  }
  const scales = (t: number) => (penalized?.[t] ? 0 : dependencies[t] & free);
  for (let i = 0; free >> i; i++) {
    if (!(free & (1 << i))) continue;
    let first = -1;
    for (let t = 0; t < termCount; t++) {
      if (!(scales(t) & (1 << i))) continue;
      if (first < 0) first = t;
      else union(t, first);
    }
  }

  const components = new Map<number, Component>();
  const getComponent = (t: number) => {
    const root = find(t);
    let component = components.get(root);
    if (!component) {
      component = { terms: [], entries: [], attributes: 0, scaling: [] };
      components.set(root, component);
    }
    return component;
  };
  for (let t = 0; t < termCount; t++) {
    const component = getComponent(t);
    component.terms.push(t);
    if (scales(t)) {
      component.attributes |= scales(t);
      component.scaling.push(t);
    }
  }
  for (let e = 0; e + 1 < plan.entryStart.length; e++) {
    getComponent(plan.termIndex[plan.entryStart[e]]).entries.push(e);
  }
  return [...components.values()];
}

/**
 * True if a component's damage only depends on one quantity of its attributes: either it has at
 * most one attribute, or they add the same multiple of each term's base attack power to every term
 * (e.g. a hit's flat attack scales like the weapon), so the terms' attack powers all rise together
 */
function isSolvable(model: Model, { attributes, scaling }: Component) {
  if (countBits(attributes) <= 1) return true;
  const { contributions, plan } = model;
  const [first, ...rest] = scaling;
  if (!(plan.base[first] > 0)) return false;
  for (let i = 0; attributes >> i; i++) {
    if (!(attributes & (1 << i))) continue;
    for (const t of rest) {
      if (!(plan.base[t] > 0)) return false;
      for (let value = 0; value <= maxAttributeValue; value++) {
        const scaled = contributions[i][t][value] * plan.base[first];
        const expected = contributions[i][first][value] * plan.base[t];
        if (Math.abs(scaled - expected) > 1e-9 * Math.max(1, Math.abs(expected))) return false;
      }
    }
  }
  return true;
}

/**
 * @returns the cheapest set of attributes (as a bitmask) that optimizeSeparable can fix, and how
 * many combinations of their values there are, or null if there's none
 */
function chooseFixedAttributes(model: Model, dependencies: readonly number[]) {
  const k = model.attributes.length;
  const sizes = getCandidateValues(model).map((values) => values.length);
  let best: { fixed: number; combinations: number } | null = null;
  for (let fixed = 0; fixed < 1 << k; fixed++) {
    let combinations = 1;
    for (let i = 0; i < k; i++) if (fixed & (1 << i)) combinations *= sizes[i];
    if (best && combinations >= best.combinations) continue;
    const free = ((1 << k) - 1) & ~fixed;
    const components = getComponents(model, dependencies, free);
    if (components.every((component) => isSolvable(model, component))) {
      best = { fixed, combinations };
    }
  }
  return best;
}

function getInitiallyUnmet({ attributes, unmet, min }: Model) {
  let mask = 0;
  attributes.forEach((_, i) => {
    if (unmet[i][min[i]]) mask |= 1 << i;
  });
  return mask;
}

/**
 * @returns roughly how many evaluations optimizeSeparable takes, comparable to the number of
 * combinations an exhaustive search tries
 */
function getSeparableWork(
  model: Model,
  dependencies: readonly number[],
  { fixed, combinations }: { fixed: number; combinations: number },
  maxLevels: number,
) {
  const k = model.attributes.length;
  const free = ((1 << k) - 1) & ~fixed;
  let perValue = 0;
  // The length of the components' curves combined so far
  let length = 0;
  for (const { attributes } of getComponents(model, dependencies, free)) {
    let levels = 0;
    for (let i = 0; i < k; i++) {
      if (attributes & (1 << i)) levels += maxAttributeValue - model.min[i];
    }
    levels = Math.min(levels, maxLevels);
    // Evaluating the component at each number of levels, then combining it with the others
    perValue += levels + 1;
    if (length) perValue += length * (levels + 1);
    length = length ? Math.min(length + levels, maxLevels + 1) : levels + 1;
  }
  return (1 << countBits(getInitiallyUnmet(model))) * combinations * perValue;
}

/**
 * For each number of a component's extra levels (above each attribute's lower bound), the values
 * of its attributes that do the most damage
 */
interface ComponentChoices {
  attributes: number[];
  /** The most extra levels it can use */
  levels: number;
  /** values[m * attributes.length + j] is attribute j's value with m extra levels */
  values: Uint8Array;
}

/**
 * The knapsack-style dynamic program of optimizeLinear for one component's attributes, maximizing
 * the attack power they add (to any of its terms, since they all rise together). With one
 * attribute, every value is a choice.
 */
function getComponentChoices(
  model: Model,
  { attributes: mask, scaling }: Component,
  lower: readonly number[],
  maxLevels: number,
): ComponentChoices {
  const attributes = model.attributes.map((_, i) => i).filter((i) => mask & (1 << i));
  const levels = Math.min(
    maxLevels,
    attributes.reduce((sum, i) => sum + maxAttributeValue - lower[i], 0),
  );
  const values = new Uint8Array((levels + 1) * attributes.length);
  if (attributes.length === 1) {
    for (let m = 0; m <= levels; m++) values[m] = lower[attributes[0]] + m;
    return { attributes, levels, values };
  }

  let dp = new Float64Array(levels + 1); // at most m levels, so unspent levels are allowed
  const choices: Uint8Array[] = [];
  for (const i of attributes) {
    const gain = new Float64Array(maxAttributeValue + 1);
    for (let value = lower[i]; value <= maxAttributeValue; value++) {
      for (const t of scaling) gain[value] += model.contributions[i][t][value];
    }
    const next = new Float64Array(levels + 1).fill(-Infinity);
    const choice = new Uint8Array(levels + 1);
    for (let m = 0; m <= levels; m++) {
      for (let value = lower[i]; value <= maxAttributeValue; value++) {
        const cost = value - lower[i];
        if (cost > m) break;
        const candidate = dp[m - cost] + gain[value];
        if (candidate > next[m] + epsilon) {
          next[m] = candidate;
          choice[m] = value;
        }
      }
    }
    dp = next;
    choices.push(choice);
  }
  for (let m = 0; m <= levels; m++) {
    let remaining = m;
    for (let j = attributes.length - 1; j >= 0; j--) {
      const value = choices[j][remaining];
      values[m * attributes.length + j] = value;
      remaining -= value - lower[attributes[j]];
    }
  }
  return { attributes, levels, values };
}

/**
 * The best of a + b for every total length, with the length of b used for each
 */
function combineCurves(a: Float64Array, b: Float64Array, maxLength: number) {
  const length = Math.min(a.length + b.length - 1, maxLength);
  const curve = new Float64Array(length).fill(-Infinity);
  const split = new Int16Array(length);
  for (let i = 0; i < a.length && i < length; i++) {
    for (let j = 0; j < b.length && i + j < length; j++) {
      const value = a[i] + b[j];
      if (value > curve[i + j]) {
        curve[i + j] = value;
        split[i + j] = j;
      }
    }
  }
  return { curve, split };
}

/**
 * Exact optimization for any objective whose attributes can be split into independent groups once
 * a few of them are fixed. Damage is a sum over the damage plan's entries, and each term's attack
 * power a sum over attributes, so terms that share no attributes (or entries) can be optimized
 * separately. Within a group, if every term's attack power rises with the same quantity (e.g. it's
 * one term), the most damage for each number of levels comes from the most of that quantity, which
 * optimizeLinear's dynamic program finds. Attributes that would link groups, like Strength for a
 * Fire weapon's physical and fire damage, are fixed to each of their values in turn.
 *
 * Like optimizeLinear, each combination of met/unmet requirements is tried separately, so
 * requirement penalties don't link attributes.
 *
 * @param fixed bitmask of the attributes to fix, from chooseFixedAttributes
 */
function optimizeSeparable(model: Model, maxLevels: number, fixed: number): number[][] {
  const { attributes, min, unmet, contributions, penaltyMasks, penaltyMultiplier } = model;
  const { attackPowers, plan } = model;
  const k = attributes.length;
  if (k === 0) return [[]];
  const termCount = plan.base.length;
  const dependencies = getTermDependencies(model);
  const fixedAttributes = attributes.map((_, i) => i).filter((i) => fixed & (1 << i));
  const free = ((1 << k) - 1) & ~fixed;

  const best = new Float64Array(maxLevels + 1).fill(-Infinity);
  const allocations: number[][] = [];
  const initiallyUnmet = getInitiallyUnmet(model);
  const fixedAttackPowers = new Float64Array(termCount);

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
    const forcedLevels = lower.reduce((sum, value, i) => sum + value - min[i], 0);
    if (!feasible || forcedLevels > maxLevels) continue;

    // Requirements not chosen are assumed unmet, as in optimizeLinear
    const assumedUnmet = initiallyUnmet & ~metMask;
    const penalized = Array.from(plan.base, (_, t) => (penaltyMasks[t] & assumedUnmet) !== 0);
    const components = getComponents(model, dependencies, free, penalized);
    const choices = components.map((component) =>
      getComponentChoices(model, component, lower, maxLevels - forcedLevels),
    );

    // Try every combination of the fixed attributes' values, starting from their lower bounds.
    // Attributes in no component only matter for their requirements, so stay at their lower bound.
    const values = [...lower];
    for (;;) {
      const fixedLevels =
        forcedLevels + fixedAttributes.reduce((sum, i) => sum + values[i] - lower[i], 0);
      if (fixedLevels <= maxLevels) {
        for (let t = 0; t < termCount; t++) {
          let attackPower = plan.base[t];
          if (penalized[t]) {
            attackPower *= penaltyMultiplier;
          } else {
            for (const i of fixedAttributes) attackPower += contributions[i][t][values[i]];
          }
          fixedAttackPowers[t] = attackPower;
        }

        // Each component's damage for every number of extra levels, added up
        const budget = maxLevels - fixedLevels;
        let total: Float64Array | null = null;
        const splits: Int16Array[] = [];
        components.forEach(({ terms, entries }, c) => {
          const { attributes: componentAttributes, values: componentValues } = choices[c];
          const count = componentAttributes.length;
          const curve = new Float64Array(Math.min(choices[c].levels, budget) + 1);
          for (let m = 0; m < curve.length; m++) {
            for (const t of terms) {
              let attackPower = fixedAttackPowers[t];
              if (!penalized[t]) {
                for (let j = 0; j < count; j++) {
                  attackPower +=
                    contributions[componentAttributes[j]][t][componentValues[m * count + j]];
                }
              }
              attackPowers[t] = attackPower;
            }
            let damage = 0;
            for (const e of entries) damage += getEntryDamage(plan, attackPowers, e);
            curve[m] = damage;
          }
          if (!total) {
            total = curve;
          } else {
            const combined = combineCurves(total, curve, budget + 1);
            total = combined.curve;
            splits.push(combined.split);
          }
        });

        const curve = total ?? new Float64Array(1);
        for (let r = 0; r < curve.length; r++) {
          const n = fixedLevels + r;
          if (!(curve[r] > best[n] + epsilon)) continue;
          best[n] = curve[r];
          // Each component's share of the extra levels, from the last combined to the first
          const allocation = [...values];
          let remaining = r;
          for (let c = components.length - 1; c >= 0; c--) {
            const m = c > 0 ? splits[c - 1][remaining] : remaining;
            remaining -= m;
            const { attributes: componentAttributes, values: componentValues } = choices[c];
            componentAttributes.forEach((i, j) => {
              allocation[i] = componentValues[m * componentAttributes.length + j];
            });
          }
          allocations[n] = allocation;
        }
      }

      // Advance to the next combination of the fixed attributes' values
      let j = 0;
      while (j < fixedAttributes.length && values[fixedAttributes[j]] === maxAttributeValue) {
        values[fixedAttributes[j]] = lower[fixedAttributes[j]];
        j++;
      }
      if (j === fixedAttributes.length) break;
      values[fixedAttributes[j]]++;
    }
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
    } else {
      // Split the attributes into independent groups if that's quicker than trying everything
      const combinations = getCandidateValues(model).reduce(
        (product, values) => product * values.length,
        1,
      );
      const dependencies = getTermDependencies(model);
      const separation = chooseFixedAttributes(model, dependencies);
      // Exact searches are worth more time when the alternative is an approximate one
      const workLimit = combinations <= bruteForceLimit ? combinations : exactWorkLimit;
      if (separation && getSeparableWork(model, dependencies, separation, maxLevels) <= workLimit) {
        allocations = optimizeSeparable(model, maxLevels, separation.fixed);
      } else if (combinations <= bruteForceLimit) {
        allocations = optimizeBruteForce(model, maxLevels);
      } else {
        allocations = optimizeLocalSearch(model, maxLevels, onlyLevels != null);
        exact = false;
      }
    }

    return allocations.map((values) => {
      const attributes = { ...options.attributes };
      model.attributes.forEach((attribute, i) => (attributes[attribute] = values[i]));
      // The model's value is the regular calculator's (the tests check that), only much quicker
      return { attributes, value: evaluateModel(model, values) };
    });
  });

  // With onlyLevels, just the best of the groups' last allocations
  if (onlyLevels != null) {
    let bestValue = -Infinity;
    let bestAllocation = options.attributes;
    let levels = 0;
    for (const curve of curves) {
      const { attributes: allocation, value } = curve.at(-1)!;
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
    return { values: [bestValue], allocations: packAllocations([bestAllocation]), exact, levels };
  }

  // Combine the groups by taking the best at each number of levels
  const length = Math.max(...curves.map((curve) => curve.length));
  const values: number[] = [];
  const allocations: Attributes[] = [];
  for (let n = 0; n < length; n++) {
    let bestValue = n > 0 ? values[n - 1] : -Infinity;
    let bestAllocation = n > 0 ? allocations[n - 1] : options.attributes;
    for (const curve of curves) {
      const { attributes: allocation, value } = curve[Math.min(n, curve.length - 1)];
      if (value > bestValue + epsilon) {
        bestValue = value;
        bestAllocation = allocation;
      }
    }
    values.push(bestValue);
    allocations.push(bestAllocation);
  }

  return { values, allocations: packAllocations(allocations), exact };
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
        if (getAttributeScaling(scalingWeapon, upgradeLevel, damageType, attribute)) {
          const bonus =
            base *
            getAttributeBonus(
              scalingWeapon,
              upgradeLevel,
              damageType,
              attribute,
              adjustedAttributes[attribute],
            );
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
