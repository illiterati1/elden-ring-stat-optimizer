import type { AttackPowerType } from "../calculator/calculator.ts";

/**
 * An enemy's defense and damage negation against one damage type
 */
export interface Defense {
  /** Flat defense, compared against attack power to determine the defense multiplier */
  defense: number;

  /** Damage negation in percent. Negative values are weaknesses that increase damage taken */
  negation: number;
}

export type Defenses = Partial<Record<AttackPowerType, Defense>>;

/** Physical damage is split into these types, each with its own enemy negation */
export const allPhysicalTypes = ["standard", "slash", "strike", "pierce"] as const;
export type PhysicalType = typeof allPhysicalTypes[number];

/**
 * @param attackRatio attack power divided by the target's defense
 * @returns the fraction of attack power that is dealt as damage, between 0.1 and 0.9
 */
export function getDefenseMultiplier(attackRatio: number) {
  if (attackRatio < 0.125) {
    return 0.1;
  }
  if (attackRatio < 1) {
    return 0.1 + (attackRatio - 0.125) ** 2 / 2.552;
  }
  if (attackRatio < 2.5) {
    return 0.7 - (2.5 - attackRatio) ** 2 / 7.5;
  }
  if (attackRatio < 8) {
    return 0.9 - (8 - attackRatio) ** 2 / 151.25;
  }
  return 0.9;
}

/**
 * Determine the damage dealt by one damage type of an attack after the target's defense and
 * damage negation are applied
 *
 * @param motionValue the attack's motion value in percent, e.g. 100 for a typical R1
 */
export function getDamageAfterDefense(
  attackPower: number,
  { defense, negation }: Defense,
  motionValue = 100,
) {
  const attack = (attackPower * motionValue) / 100;
  const attackRatio = defense > 0 ? attack / defense : Infinity;
  return (attack * getDefenseMultiplier(attackRatio) * (100 - negation)) / 100;
}
