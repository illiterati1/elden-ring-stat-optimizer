import { allDamageTypes, allStatusTypes, AttackPowerType } from "../calculator/attackPowerTypes.ts";
import { allAttributes, type Attribute } from "../calculator/attributes.ts";
import type { Weapon } from "../calculator/weapon.ts";
import {
  getWeaponUpgradeLevel,
  type AttackDataHit,
  type BuildRequest,
} from "../optimizer/build.ts";
import { allPhysicalTypes, type PhysicalType } from "../optimizer/defense.ts";
import type { Movesets } from "./useMovesets.ts";

/** Filters on the weapons calculated, from the weapon settings' Filters section */
export interface WeaponFilters {
  /** Only weapons from the base game, not Shadow of the Erdtree */
  readonly baseGameOnly: boolean;
  /** Only weapons that deal any of these damage types (none for no filter) */
  readonly damageTypes: readonly AttackPowerType[];
  /** Only weapons that build up any of these statuses (none for no filter) */
  readonly statusTypes: readonly AttackPowerType[];
  /** Only weapons that weigh at most this much */
  readonly maxWeight: { readonly enabled: boolean; readonly value: number };
  /**
   * Only weapons whose listed requirements are at most these (and the off hand weapon's, when
   * powerstancing with another weapon)
   */
  readonly maxRequirements: {
    readonly enabled: boolean;
    readonly value: Readonly<Record<Attribute, number>>;
  };
  /** Only weapons that scale with all of these stats at their upgrade level (none for no filter) */
  readonly scalesWith: readonly Attribute[];
  /**
   * Only weapons whose chosen attack's hits deal physical damage of any of these types (or, with no
   * attack chosen, whose own physical damage type or their ammunition's is any of these; none for no
   * filter)
   */
  readonly physicalTypes: readonly PhysicalType[];
  /** Only the first results by the sort column */
  readonly topN: { readonly enabled: boolean; readonly value: number };
}

export const defaultWeaponFilters: WeaponFilters = {
  baseGameOnly: false,
  damageTypes: [],
  statusTypes: [],
  maxWeight: { enabled: false, value: 10 },
  maxRequirements: { enabled: false, value: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 } },
  scalesWith: [],
  physicalTypes: [],
  topN: { enabled: false, value: 10 },
};

/** @returns the number of filters in use, for the section's title */
export function countActiveFilters(filters: WeaponFilters, onlyBuffable: boolean) {
  return (
    +onlyBuffable +
    +filters.baseGameOnly +
    +(filters.damageTypes.length > 0) +
    +(filters.statusTypes.length > 0) +
    +filters.maxWeight.enabled +
    +filters.maxRequirements.enabled +
    +(filters.scalesWith.length > 0) +
    +(filters.physicalTypes.length > 0) +
    +filters.topN.enabled
  );
}

function baseAttack(weapon: Weapon, regularUpgradeLevel: number) {
  return weapon.attack[getWeaponUpgradeLevel(weapon, regularUpgradeLevel)] ?? {};
}

/**
 * @returns the damage types and statuses a request's attack can deal or build up, before any
 * stats: from the weapon's (and off hand weapon's) base attack and the hits' motion values, the
 * hits' own flat attack and status, and weapon buffs' (e.g. a grease's)
 */
export function getRequestTypes(request: BuildRequest): Set<AttackPowerType> {
  const { bases, hits, buffs } = getRequestSources(request);
  const types = new Set<AttackPowerType>();

  for (const type of allDamageTypes) {
    const inBase = bases.some((base) => (base[type] ?? 0) > 0);
    const fromBuff = buffs.some((buff) => (buff.flat?.[type] ?? 0) > 0);
    const dealt = !hits
      ? inBase || fromBuff
      : hits.some((hit) => hitDeals(hit, type, inBase, fromBuff));
    if (dealt) types.add(type);
  }

  for (const type of allStatusTypes) {
    const inBase = bases.some((base) => (base[type] ?? 0) > 0);
    const fromBuff = buffs.some(
      (buff) => (buff.status?.[type] ?? 0) > 0 || (buff.hitStatus?.[type] ?? 0) > 0,
    );
    const builtUp = !hits
      ? inBase || fromBuff
      : hits.some(
          (hit) =>
            ((inBase || fromBuff) && hit.statusMotionValue > 0) ||
            (hit.status?.[type] ?? 0) > 0 ||
            (hit.scaledStatus?.[type] ?? 0) > 0,
        );
    if (builtUp) types.add(type);
  }
  return types;
}

/** The base attacks, counted hits (if an attack is chosen), and buffs a request's damage comes from */
function getRequestSources(request: BuildRequest) {
  return {
    bases: [
      baseAttack(request.weapon, request.regularUpgradeLevel),
      ...(request.offhand
        ? [baseAttack(request.offhand.weapon, request.offhand.regularUpgradeLevel)]
        : []),
    ],
    hits: request.attack?.steps.flat().filter((hit) => !hit.notCounted),
    buffs: request.buffs ?? [],
  };
}

/**
 * @returns whether a hit deals a damage type: from the base attack (inBase) by its motion value, its
 * own flat attack or buff attack, or a weapon buff's flat attack (fromBuff)
 */
function hitDeals(hit: AttackDataHit, type: AttackPowerType, inBase: boolean, fromBuff: boolean) {
  return (
    (inBase && (hit.motionValues?.[type] ?? hit.motionValue) > 0) ||
    (hit.flatAttack?.[type] ?? 0) > 0 ||
    (hit.buffAttack?.[type] ?? 0) > 0 ||
    (fromBuff && (hit.buffMotionValue ?? 100) > 0)
  );
}

/**
 * @returns the physical damage types of a request's chosen attack's counted hits that deal physical
 * damage, or with no attack chosen, the weapon's own (getWeaponPhysicalType)
 */
export function getRequestPhysicalTypes(
  request: BuildRequest,
  movesets: Movesets,
): Set<PhysicalType> {
  const { bases, hits, buffs } = getRequestSources(request);
  if (!hits) {
    const physicalType = getWeaponPhysicalType(request.weapon, movesets);
    return new Set(physicalType ? [physicalType] : []);
  }
  const type = AttackPowerType.PHYSICAL;
  const inBase = bases.some((base) => (base[type] ?? 0) > 0);
  const fromBuff = buffs.some((buff) => (buff.flat?.[type] ?? 0) > 0);
  return new Set(
    hits.filter((hit) => hitDeals(hit, type, inBase, fromBuff)).map((hit) => hit.physicalType),
  );
}

/**
 * @returns the weapon's own physical damage type (its ammunition's for a ranged weapon), from the
 * moveset data, if it has a moveset
 */
export function getWeaponPhysicalType(
  weapon: Weapon,
  movesets: Movesets,
): PhysicalType | undefined {
  if (weapon.ammoPhysicalType) return weapon.ammoPhysicalType;
  const moveset = movesets[weapon.weaponName];
  return moveset && (allPhysicalTypes[moveset.type] ?? "standard");
}

/**
 * @returns whether a request passes the filters that apply before optimizing (all but top N), so
 * weapons filtered out aren't calculated at all
 */
export function passesFilters(request: BuildRequest, filters: WeaponFilters, movesets: Movesets) {
  const { weapon } = request;
  if (filters.baseGameOnly && weapon.dlc) return false;
  if (filters.maxRequirements.enabled) {
    const weapons = request.offhand ? [weapon, request.offhand.weapon] : [weapon];
    const tooHigh = weapons.some((weapon) =>
      allAttributes.some(
        (attribute) =>
          (weapon.requirements[attribute] ?? 0) > filters.maxRequirements.value[attribute],
      ),
    );
    if (tooHigh) return false;
  }
  if (filters.scalesWith.length > 0) {
    const scaling =
      weapon.attributeScaling[getWeaponUpgradeLevel(weapon, request.regularUpgradeLevel)] ?? {};
    if (!filters.scalesWith.every((attribute) => (scaling[attribute] ?? 0) > 0)) return false;
  }
  if (filters.physicalTypes.length > 0) {
    const physicalTypes = getRequestPhysicalTypes(request, movesets);
    if (!filters.physicalTypes.some((type) => physicalTypes.has(type))) return false;
  }
  if (
    filters.maxWeight.enabled &&
    weapon.weight != null &&
    weapon.weight > filters.maxWeight.value + 1e-9
  ) {
    return false;
  }
  if (filters.damageTypes.length === 0 && filters.statusTypes.length === 0) return true;
  const types = getRequestTypes(request);
  return (
    (filters.damageTypes.length === 0 || filters.damageTypes.some((type) => types.has(type))) &&
    (filters.statusTypes.length === 0 || filters.statusTypes.some((type) => types.has(type)))
  );
}
