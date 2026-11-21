import { allAttributes, type Attribute, type Attributes } from "./attributes.ts";
import { AttackPowerType, allDamageTypes, allStatusTypes } from "./attackPowerTypes.ts";
import type { Weapon } from "./weapon.ts";
import { WeaponType } from "./weaponTypes.ts";

interface WeaponAttackOptions {
  weapon: Weapon;
  attributes: Attributes;
  twoHanding?: boolean;
  /**
   * True if two handing's Strength bonus counts towards the requirements but not scaling, like
   * critical hits (the weapon is still wielded two handed)
   */
  noTwoHandingScaling?: boolean;
  upgradeLevel: number;
}

export interface WeaponAttackResult {
  upgradeLevel: number;
  attackPower: Partial<Record<AttackPowerType, number>>;
  spellScaling: Partial<Record<AttackPowerType, number>>;
  ineffectiveAttributes: Attribute[];
  ineffectiveAttackPowerTypes: AttackPowerType[];
}

/**
 * Adjust a set of character attributes to take into account the 50% Strength bonus when two
 * handing a weapon
 */
export function adjustAttributesForTwoHanding({
  twoHanding = false,
  weapon,
  attributes,
}: {
  twoHanding?: boolean;
  weapon: Weapon;
  attributes: Attributes;
}): Attributes {
  let twoHandingBonus = twoHanding;

  // Paired weapons do not get the two handing bonus
  if (weapon.paired) {
    twoHandingBonus = false;
  }

  // Bows and ballistae can only be two handed
  if (
    weapon.weaponType === WeaponType.LIGHT_BOW ||
    weapon.weaponType === WeaponType.BOW ||
    weapon.weaponType === WeaponType.GREATBOW ||
    weapon.weaponType === WeaponType.BALLISTA
  ) {
    twoHandingBonus = true;
  }

  if (twoHandingBonus) {
    return {
      ...attributes,
      str: Math.floor(attributes.str * 1.5),
    };
  }

  return attributes;
}

/** Attack power is multiplied by this when a weapon's attribute requirements aren't met */
export const ineffectivePenaltyMultiplier = 0.6;

/**
 * The scaling rate of one attribute on one damage type at an upgrade level: the weapon's own
 * scaling, or an overwritten rate that grows with upgrades like the weapon's own scaling
 */
export function getAttributeScaling(
  weapon: Weapon,
  upgradeLevel: number,
  attackPowerType: AttackPowerType,
  attribute: Attribute,
) {
  const attributeCorrect = weapon.attackElementCorrect[attackPowerType]?.[attribute];
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
  if (!Number.isFinite(scaling)) {
    throw new Error(
      `${weapon.name} +${upgradeLevel} has no finite ${attribute} scaling for attack type ${attackPowerType}`,
    );
  }
  return scaling;
}

/**
 * The fraction of base attack power one attribute adds to one damage type, e.g. 0.5 adds +50%
 *
 * @param value the attribute's value after bonuses and (if it applies) two handing
 */
export function getAttributeBonus(
  weapon: Weapon,
  upgradeLevel: number,
  attackPowerType: AttackPowerType,
  attribute: Attribute,
  value: number,
) {
  const scaling = getAttributeScaling(weapon, upgradeLevel, attackPowerType, attribute);
  return scaling ? weapon.calcCorrectGraphs[attackPowerType][value] * scaling : 0;
}

/**
 * Determine the damage for a weapon with the given player stats
 */
export default function getWeaponAttack({
  weapon,
  attributes,
  twoHanding,
  noTwoHandingScaling = false,
  upgradeLevel,
}: WeaponAttackOptions): WeaponAttackResult {
  const requirementAttributes = adjustAttributesForTwoHanding({ twoHanding, weapon, attributes });
  const adjustedAttributes = noTwoHandingScaling ? attributes : requirementAttributes;

  const ineffectiveAttributes = (Object.entries(weapon.requirements) as [Attribute, number][])
    .filter(([attribute, requirement]) => requirementAttributes[attribute] < requirement)
    .map(([attribute]) => attribute);

  const ineffectiveAttackPowerTypes: AttackPowerType[] = [];

  const attackPower: Partial<Record<AttackPowerType, number>> = {};
  const spellScaling: Partial<Record<AttackPowerType, number>> = {};

  for (const attackPowerType of [...allDamageTypes, ...allStatusTypes]) {
    const isDamageType = allDamageTypes.includes(attackPowerType);

    const baseAttackPower = weapon.attack[upgradeLevel][attackPowerType] ?? 0;
    if (baseAttackPower || weapon.sorceryTool || weapon.incantationTool) {
      // This weapon's AttackElementCorrectParam determines what attributes each damage type scales
      // with
      const scalingAttributes = weapon.attackElementCorrect[attackPowerType] ?? {};

      let totalScaling = 1;

      if (ineffectiveAttributes.some((attribute) => scalingAttributes[attribute])) {
        // If the requirements for this damage type are not met, it's penalized instead of getting
        // a scaling bonus
        totalScaling = ineffectivePenaltyMultiplier;
        ineffectiveAttackPowerTypes.push(attackPowerType);
      } else {
        // Otherwise, the scaling multiplier is equal to the sum of the corrected attribute values
        // multiplied by the scaling for that attribute. Two handing's Strength bonus doesn't
        // apply to status effects.
        const effectiveAttributes = isDamageType ? adjustedAttributes : attributes;
        for (const attribute of allAttributes) {
          totalScaling += getAttributeBonus(
            weapon,
            upgradeLevel,
            attackPowerType,
            attribute,
            effectiveAttributes[attribute],
          );
        }
      }

      // The final scaling multiplier modifies the attack power for this damage type as a
      // percentage boost, e.g. 0.5 adds +50% of the base attack power
      if (baseAttackPower) {
        attackPower[attackPowerType] = baseAttackPower * totalScaling;
      }

      if (isDamageType && (weapon.sorceryTool || weapon.incantationTool)) {
        spellScaling[attackPowerType] = 100 * totalScaling;
      }
    }
  }

  return {
    upgradeLevel,
    attackPower,
    spellScaling,
    ineffectiveAttributes,
    ineffectiveAttackPowerTypes,
  };
}

export * from "./attributes.ts";
export * from "./attackPowerTypes.ts";
export * from "./weapon.ts";
export * from "./weaponTypes.ts";
