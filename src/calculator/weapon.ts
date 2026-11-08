import type { Attribute } from "./attributes.ts";
import type { AttackPowerType } from "./attackPowerTypes.ts";
import type { WeaponType } from "./weaponTypes.ts";

export type AttackElementCorrect = Partial<
  Record<AttackPowerType, Partial<Record<Attribute, number | true>>>
>;

export interface AmmoShots {
  count: number;
  motionValue: number;
  statusMotionValue: number;
  poiseMotionValue: number;
}

/**
 * Enemy types some weapons and buffs do more damage to (NpcParam isWeakA-D): Fallingstar Beasts,
 * Astel, and Onyx Lords ("star"), those who live in death, ancient dragons, and other dragons
 */
export const allEnemyTypes = ["star", "death", "ancientDragon", "dragon"] as const;
export type EnemyType = typeof allEnemyTypes[number];
export type EnemyTypeRates = Partial<Record<EnemyType, number>>;

/** @returns the product of the rates against any of the enemy's types */
export function getEnemyTypeRate(
  rates: EnemyTypeRates | undefined,
  enemyTypes: readonly EnemyType[],
) {
  return enemyTypes.reduce((rate, enemyType) => rate * (rates?.[enemyType] ?? 1), 1);
}

export interface Weapon {
  /**
   * The full unique name of the weapon, e.g. "Heavy Nightrider Glaive"
   */
  name: string;

  /**
   * The base weapon name without an affinity specified, e.g. "Nightrider Glaive"
   */
  weaponName: string;

  /**
   * A (rarely-used) modifier to differentiate variants of weapons beyond what's shown in-game
   */
  variant?: string;

  /**
   * A wiki link for the weapon
   */
  url: string | null;

  /**
   * The affinity of the weapon for filtering, see uiUtils.tsx for a full list of vanilla affinities
   */
  affinityId: number;

  /**
   * The category of the weapon for filtering
   */
  weaponType: WeaponType;

  /**
   * Player attribute requirements to use the weapon effectively (without an attack rating penalty)
   */
  requirements: Partial<Record<Attribute, number>>;

  /**
   * Scaling amount for each player attribute at each upgrade level
   */
  attributeScaling: Partial<Record<Attribute, number>>[];

  /**
   * The upgrade multiplier for each attribute's scaling at each upgrade level (ReinforceParamWeapon),
   * which also applies to overwritten scaling rates, e.g. a skill's 25% Faith scaling
   */
  attributeScalingRates?: Partial<Record<Attribute, number>>[];

  /**
   * Base attack power for each damage type, status effect, and spell scaling at each upgrade level
   */
  attack: Partial<Record<AttackPowerType, number>>[];

  /**
   * Map indicating which damage types scale with which player attributes
   */
  attackElementCorrect: AttackElementCorrect;

  /**
   * Map indicating which scaling curve is used for each damage type, status effect, or spell scaling
   */
  calcCorrectGraphs: Record<AttackPowerType, number[]>;

  /**
   * True if the weapon doesn't get a strength bonus when two-handing
   */
  paired?: boolean;

  /**
   * Multipliers to damage dealt, by damage type, applied after enemy defenses, e.g. the Lion
   * Greatbow's ×1.2 physical for Radahn's Spears
   */
  damageMultipliers?: Partial<Record<AttackPowerType, number>>;

  /**
   * Damage multipliers against enemy types, e.g. the Golden Epitaph's ×1.3 against those who live in
   * death
   */
  enemyTypeRates?: EnemyTypeRates;

  /** The weapon's weight, which counts towards equip weight (e.g. for the Blue Dancer Charm) */
  weight?: number;

  /** Poise damage of the ammunition a ranged weapon is firing, which replaces the weapon's own */
  ammoPoise?: number;

  /** Names of the ammunition a ranged weapon is firing, for skills that fire some differently */
  ammoNames?: readonly string[];

  /**
   * For a weapon firing several bolts per shot, e.g. the Spread Crossbow's spread or the Pulley
   * Crossbow's three in quick succession, how many and their motion values
   */
  ammoShots?: AmmoShots;

  /** Physical damage type of the ammunition a ranged weapon is firing, e.g. "pierce" */
  ammoPhysicalType?: "standard" | "slash" | "strike" | "pierce";

  /**
   * True if this weapon can cast glintstone sorceries
   */
  sorceryTool?: boolean;

  /**
   * True if this weapon can cast incantations
   */
  incantationTool?: boolean;

  /**
   * Thresholds and labels for each scaling grade (S, A, B, etc.) for this weapon. This isn't
   * hardcoded for all weapons because it can be changed by mods.
   */
  scalingTiers: [number, string][];

  /**
   * If true, this weapon is from the Shadow of the Erdtree expansion
   */
  dlc: boolean;
}
