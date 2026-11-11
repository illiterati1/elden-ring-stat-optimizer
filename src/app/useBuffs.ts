import { useEffect, useState } from "react";
import {
  allAttributes,
  type Attribute,
  type Attributes,
  type EnemyType,
} from "../calculator/calculator.ts";
import type { BuffEffect } from "../optimizer/build.ts";

export type BuffKind =
  | "talisman"
  | "armor"
  | "tear"
  | "consumable"
  | "spell"
  | "skill"
  | "spirit"
  | "rune"
  | "offhand"
  | "weaponEffect"
  | "counter"
  | "debuff";
export type ArmorSlot = "head" | "body" | "arms" | "legs";
/**
 * Consumables', spells', skills', and spirit ashes' in-game stacking groups: only one weapon, body,
 * and aura buff is active at a time, and unique buffs stack with everything
 */
export type BuffType = "weapon" | "body" | "aura" | "unique";

export interface HpRange {
  min?: number;
  max?: number;
}

/** @returns true if an effect with the HP range applies at the HP percentage */
function inHpRange(hp: HpRange | undefined, health: number) {
  return !hp || (health >= (hp.min ?? 0) && health < (hp.max ?? Infinity));
}

/**
 * @returns the HP percentages worth choosing between for the buffs' HP conditions: full HP, and
 * just below each breakpoint, or none if no buff depends on HP
 */
export function getHpStops(buffs: readonly Buff[]): number[] {
  const breakpoints = buffs.flatMap((buff) =>
    buff.effects.flatMap((effect) => [effect.hp?.min, effect.hp?.max]),
  );
  const stops = breakpoints.filter((value): value is number => value != null).map((v) => v - 1);
  return stops.length ? [...new Set([100, ...stops])].sort((a, b) => b - a) : [];
}

export interface Buff {
  kind: BuffKind;
  name: string;
  effects: (BuffEffect & {
    /** Points added to stats */
    stats?: Partial<Attributes>;
    /** Effects of the same group replace each other, e.g. 162 for weapon buffs */
    group?: number;
    /** True if it only applies to counterattacks (the Spear Talisman) */
    counter?: boolean;
    /**
     * For successive attack stacks, the damage multiplier at each tier (damageRates is the last
     * tier's)
     */
    tierRates?: number[];
    /** The HP percentages it applies at: at least min, below max (e.g. Shriek of Sorrow's levels) */
    hp?: HpRange;
  })[];
  /** For talismans, armor, and off-hand weapons, their weight (for the Blue Dancer Charm) */
  weight?: number;
  /** For armor, which slot it goes in */
  slot?: ArmorSlot;
  /** For consumables, spells, skills, and spirit ashes, which stacking group it's in */
  type?: BuffType;
  /**
   * For a weapon's own skill or passive (e.g. the Ornamental Straight Sword's Golden Tempering, or
   * the Inseparable Sword's Sacred Blade, also an Ash of War's), its weapon buff effects on the weapons
   * that have it, by weapon name
   */
  weapons?: Record<string, Buff["effects"]>;
  /**
   * True if weapons can only be one handed with it, e.g. a shield's skill (other than skillOf,
   * which can still be two handed)
   */
  oneHanded?: boolean;
  /** For a skill that only one weapon has, its name */
  skillOf?: string;
  /** For spells, the stats needed to cast them */
  requirements?: Partial<Attributes>;
  /** When it applies, if the data doesn't say, e.g. "Below 20% HP" */
  note?: string;
  /**
   * Keys it can't be used with another buff with, e.g. talismans of the same group, or conditions as
   * "condition:state", which conflict with other states of the same condition ("hp:full" and
   * "hp:low"); see buffsConflict
   */
  exclusive?: string[];
}

/** Identifies a buff in the app state */
/**
 * @returns true if two buffs can't be used together: they share an exclusive key (e.g. talismans of
 * the same group), or have different states of the same condition ("hp:low" and "hp:full")
 */
export function buffsConflict(a: Buff, b: Buff) {
  return (a.exclusive ?? []).some((key) =>
    (b.exclusive ?? []).some((other) => {
      const [condition, state] = key.split(":");
      const [otherCondition, otherState] = other.split(":");
      return state == null ? key === other : condition === otherCondition && state !== otherState;
    }),
  );
}

/**
 * @returns true for a buff only some weapons get from their own skill or passive (e.g. Golden
 * Tempering), not an Ash of War's or item's
 */
export function isWeaponOnlyBuff(buff: Buff) {
  return !!buff.weapons && buff.effects.length === 0;
}

export function getBuffKey({ kind, name }: Pick<Buff, "kind" | "name">) {
  return `${kind}:${name}`;
}

/** @returns the stats the buffs add (not counted towards level) */
export function getBuffStats(buffs: readonly Buff[]): Attributes {
  const stats = Object.fromEntries(allAttributes.map((attribute) => [attribute, 0])) as Attributes;
  for (const buff of buffs) {
    for (const effect of buff.effects) {
      for (const attribute of allAttributes) stats[attribute] += effect.stats?.[attribute] ?? 0;
    }
  }
  return stats;
}

/** Successive attack stack tiers */
export const stackTiers = [1, 2, 3] as const;
export type StackTier = typeof stackTiers[number];

/** @returns true if the buff stacks with successive attacks */
export function hasStackTiers(buff: Buff) {
  return buff.effects.some((effect) => effect.tierRates);
}

/**
 * @returns armor effects with the same conditions merged into one, adding their bonuses rather than
 * multiplying them. Tested in game: Ansbach's set (×1.05 head, ×1.03 each other piece, for dynastic
 * skills) gives Blood Blade ×1.14, not ×1.148.
 */
function mergeArmorEffects(effects: BuffEffect[]): BuffEffect[] {
  const groups = new Map<string, BuffEffect[]>();
  for (const effect of effects) {
    const { attackPowerRates, damageRates, ...conditions } = effect;
    const key = JSON.stringify({
      ...conditions,
      attackPowerRates: !!attackPowerRates,
      damageRates: !!damageRates,
    });
    groups.set(key, [...(groups.get(key) ?? []), effect]);
  }
  const addRates = (rates: (readonly number[] | undefined)[]) =>
    rates[0] && rates[0].map((_, i) => 1 + rates.reduce((sum, rate) => sum + (rate![i] - 1), 0));
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const attackPowerRates = addRates(group.map((effect) => effect.attackPowerRates));
    const damageRates = addRates(group.map((effect) => effect.damageRates));
    return {
      ...group[0],
      ...(attackPowerRates && { attackPowerRates }),
      ...(damageRates && { damageRates }),
    };
  });
}

/**
 * @param stackTier the tier of successive attack stacks
 * @param health the character's HP percentage, for effects that only apply at some HP
 * @returns the buffs' effects on damage, without the ones that only add stats, or that only apply
 * to counterattacks unless the Counterattack buff is one of them, or at other HP. Armor's effects
 * with the same conditions add up (mergeArmorEffects).
 */
export function getBuffEffects(
  buffs: readonly Buff[],
  stackTier: StackTier,
  health = 100,
): BuffEffect[] {
  const armor = buffs.filter((buff) => buff.kind === "armor");
  return [
    ...mergeArmorEffects(getEffects(armor, stackTier, health, buffs)),
    ...getEffects(
      buffs.filter((buff) => buff.kind !== "armor"),
      stackTier,
      health,
      buffs,
    ),
  ];
}

/** getBuffEffects for some of the buffs (all of them for whether Counterattack is one) */
function getEffects(
  buffs: readonly Buff[],
  stackTier: StackTier,
  health: number,
  allBuffs: readonly Buff[],
): BuffEffect[] {
  const counterattack = allBuffs.some((buff) => buff.kind === "counter");
  return buffs.flatMap((buff) =>
    buff.effects
      .filter((effect) => (!effect.counter || counterattack) && inHpRange(effect.hp, health))
      .map((effect) =>
        effect.tierRates
          ? {
              ...effect,
              damageRates: effect.damageRates?.map(() => effect.tierRates![stackTier - 1]),
            }
          : effect,
      )
      .filter(
        (effect) =>
          effect.attackPowerRates ||
          effect.damageRates ||
          effect.flat ||
          effect.status ||
          effect.hitStatus ||
          effect.hpDamage ||
          effect.poiseRate ||
          effect.scalingBonus ||
          effect.enemyTypeRates,
      )
      .map(
        ({
          attackPowerRates,
          damageRates,
          flat,
          status,
          hitStatus,
          hpDamage,
          poiseRate,
          scalingBonus,
          enemyTypeRates,
          categories,
          critical,
          firstHitOnly,
          physicalTypes,
          spellScaling,
          byEquipWeight,
        }) => ({
          ...(attackPowerRates && { attackPowerRates }),
          ...(damageRates && { damageRates }),
          ...(flat && { flat }),
          ...(status && { status }),
          ...(hitStatus && { hitStatus }),
          ...(hpDamage && { hpDamage }),
          ...(poiseRate && { poiseRate }),
          ...(scalingBonus && { scalingBonus }),
          ...(enemyTypeRates && { enemyTypeRates }),
          ...(categories && { categories }),
          ...(critical && { critical }),
          ...(firstHitOnly && { firstHitOnly }),
          ...(physicalTypes && { physicalTypes }),
          ...(spellScaling && { spellScaling }),
          ...(byEquipWeight && { byEquipWeight }),
        }),
      ),
  );
}

/** The attack subcategories buffs can be limited to, as shown in the buff summaries */
const categoryLabels: Record<number, string> = {
  100: "charged attacks",
  101: "mounted attacks",
  102: "jump attacks",
  103: "guard counters",
  104: "chain finishers",
  105: "arrows and bolts",
  106: "roars",
  107: "breath attacks",
  108: "pots",
  109: "perfumes",
  110: "charged spells",
  111: "charged skills",
  112: "skills",
  113: "ranged skills",
  118: "arrow and bolt effects",
  119: "thrown items",
  120: "two handed attacks",
  121: "rolling and backstep attacks",
  122: "running attacks",
  123: "magma attacks",
  124: "storm attacks",
  127: "stomps and kicks",
  // Spell schools and skill groups that some skills have
  28: "Aspects of the Crucible: Wings and Devonia's Vortex",
  39: "Causality's Wrath",
  115: "bubble skills",
  116: "Shriek of Milos",
  129: "dancing attacks",
  130: "fire knight skills",
  132: "dynastic skills",
  133: "dragon cult skills",
  134: "Redmane skills",
  // Not the game's: attacks out of a held stance (scripts/build_ash_data.py)
  1000: "stance skill attacks",
};

const damageTypeNames = ["physical", "magic", "fire", "lightning", "holy"];
const statusTypeNames: Record<number, string> = {
  5: "poison",
  6: "scarlet rot",
  7: "blood loss",
  8: "frost",
  9: "sleep",
  10: "madness",
  11: "death blight",
};
const statNames: Record<string, string> = {
  str: "STR",
  dex: "DEX",
  int: "INT",
  fai: "FAI",
  arc: "ARC",
};

function describeRates(rates: readonly number[], what: string) {
  const changed = rates
    .map((rate, damageType) => [rate, damageType] as const)
    .filter(([rate]) => rate !== 1);
  if (changed.length === rates.length && changed.every(([rate]) => rate === changed[0][0])) {
    return [`×${changed[0][0]} ${what}`];
  }
  return changed.map(([rate, damageType]) => `×${rate} ${damageTypeNames[damageType]} ${what}`);
}

/** Enemy types as buff descriptions name them */
const enemyTypeNames: Record<EnemyType, string> = {
  death: "those who live in death",
  dragon: "dragons",
  ancientDragon: "ancient dragons",
  star: "star creatures",
};

/** @returns a short description of what a buff does, e.g. "×1.15 damage (skills)" */
export function describeBuff(buff: Buff) {
  const effects = isWeaponOnlyBuff(buff) ? Object.values(buff.weapons!)[0] ?? [] : buff.effects;
  // A buff with a damage rate for each HP range (Shriek of Sorrow), from the lowest HP's to the
  // highest's, with the damage types it's for and any scaling bonus, e.g. "1.25-1.1x physical damage
  // depending on HP, +5 Strength scaling"
  if (effects.length > 1 && effects.every((effect) => effect.hp && effect.damageRates)) {
    const rates = effects.map((effect) => Math.max(...effect.damageRates!));
    const [first] = effects;
    const types = first.damageRates!.flatMap((rate, damageType) =>
      rate !== 1 ? [damageTypeNames[damageType]] : [],
    );
    const damage =
      types.length === first.damageRates!.length ? "damage" : `${types.join(", ")} damage`;
    return [
      `${rates[0]}-${rates[rates.length - 1]}x ${damage} depending on HP`,
      ...Object.entries(first.scalingBonus ?? {}).map(
        ([stat, bonus]) => `+${Math.round(bonus * 100)} ${statNames[stat]} scaling`,
      ),
    ].join(", ");
  }
  return effects
    .map((effect) => {
      const parts = [
        ...Object.entries(effect.stats ?? {}).map(
          ([stat, points]) => `+${points} ${statNames[stat]}`,
        ),
        ...(effect.attackPowerRates ? describeRates(effect.attackPowerRates, "attack") : []),
        ...(effect.tierRates
          ? [`×${effect.tierRates.join("/")} damage by successive attack tier`]
          : effect.damageRates
          ? describeRates(effect.damageRates, "damage")
          : []),
        ...(effect.flat ?? []).flatMap((value, damageType) =>
          value
            ? [
                `+${value} ${damageTypeNames[damageType]} on the weapon` +
                  (effect.spellScaling
                    ? ` × the catalyst's ${statNames[effect.spellScaling]} spell scaling %`
                    : ""),
              ]
            : [],
        ),
        ...Object.entries(effect.status ?? {}).map(
          ([statusType, buildup]) => `+${buildup} ${statusTypeNames[+statusType]} buildup`,
        ),
        ...Object.entries(effect.hitStatus ?? {}).map(
          ([statusType, buildup]) =>
            `+${buildup} ${statusTypeNames[+statusType]} buildup per hit (unscaled)`,
        ),
        ...Object.entries(effect.enemyTypeRates ?? {}).map(
          ([enemyType, rate]) =>
            `×${rate} damage against ${enemyTypeNames[enemyType as EnemyType]}`,
        ),
        ...(effect.hpDamage
          ? [
              `${effect.hpDamage.label} per hit: ${effect.hpDamage.ticks} ticks of ${
                effect.hpDamage.rate * 100
              }% max HP` + (effect.hpDamage.flat ? ` + ${effect.hpDamage.flat}` : ""),
            ]
          : []),
        ...(effect.poiseRate ? [`×${effect.poiseRate} poise damage`] : []),
        ...Object.entries(effect.scalingBonus ?? {}).map(
          ([stat, bonus]) => `+${Math.round(bonus * 100)} ${statNames[stat]} scaling`,
        ),
      ];
      const conditions = [
        // Charged skills are skills, so "skills" covers both
        ...(effect.categories ?? [])
          .filter((category) => category !== 111 || !effect.categories!.includes(112))
          .map((category) => categoryLabels[category] ?? "some attacks"),
        ...(effect.critical ? ["critical hits"] : []),
        ...(effect.firstHitOnly ? ["first hit"] : []),
        ...(effect.physicalTypes ? [`${effect.physicalTypes.join(", ")} damage`] : []),
        ...(effect.counter ? ["counterattacks"] : []),
        ...(effect.hp?.min === 100
          ? ["at full HP"]
          : effect.hp
          ? [
              [
                effect.hp.min != null && `at ${effect.hp.min}%+ HP`,
                effect.hp.max != null && `below ${effect.hp.max}% HP`,
              ]
                .filter(Boolean)
                .join(" and "),
            ]
          : []),
      ];
      return parts.join(", ") + (conditions.length ? ` (${conditions.join(", ")})` : "");
    })
    .join("; ");
}

let buffsPromise: Promise<Buff[]> | undefined;

/**
 * Loads the buff data generated by scripts/build_buff_data.py
 */
export default function useBuffs() {
  const [buffs, setBuffs] = useState<Buff[]>([]);
  useEffect(() => {
    buffsPromise ??= fetch("/buffs.json")
      .then((res) => res.json())
      .then((data: { buffs: Buff[] }) => data.buffs);
    buffsPromise.then(setBuffs).catch(() => setBuffs([]));
  }, []);
  return buffs;
}

/**
 * @returns the stat whose part of a catalyst's spell scaling multiplies the buffs' flat attack (e.g.
 * Faith for Electrify Armament), or undefined if none does
 */
export function getSpellScalingAttribute(buffs: readonly Buff[]): Attribute | undefined {
  return buffs.flatMap((buff) => buff.effects).find((effect) => effect.spellScaling)?.spellScaling;
}
