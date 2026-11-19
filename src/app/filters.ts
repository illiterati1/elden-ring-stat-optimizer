import {
  allDamageTypes,
  allStatusTypes,
  type AttackPowerType,
} from "../calculator/attackPowerTypes.ts";
import type { Weapon } from "../calculator/weapon.ts";
import { getWeaponUpgradeLevel, type BuildRequest } from "../optimizer/build.ts";

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
  /** Only the first results by the sort column */
  readonly topN: { readonly enabled: boolean; readonly value: number };
}

export const defaultWeaponFilters: WeaponFilters = {
  baseGameOnly: false,
  damageTypes: [],
  statusTypes: [],
  maxWeight: { enabled: false, value: 10 },
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
  const types = new Set<AttackPowerType>();
  const bases = [
    baseAttack(request.weapon, request.regularUpgradeLevel),
    ...(request.offhand
      ? [baseAttack(request.offhand.weapon, request.offhand.regularUpgradeLevel)]
      : []),
  ];
  const hits = request.attack?.steps.flat().filter((hit) => !hit.notCounted);
  const buffs = request.buffs ?? [];

  for (const type of allDamageTypes) {
    const inBase = bases.some((base) => (base[type] ?? 0) > 0);
    const fromBuff = buffs.some((buff) => (buff.flat?.[type] ?? 0) > 0);
    const dealt = !hits
      ? inBase || fromBuff
      : hits.some(
          (hit) =>
            (inBase && (hit.motionValues?.[type] ?? hit.motionValue) > 0) ||
            (hit.flatAttack?.[type] ?? 0) > 0 ||
            (hit.buffAttack?.[type] ?? 0) > 0 ||
            (fromBuff && (hit.buffMotionValue ?? 100) > 0),
        );
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

/**
 * @returns whether a request passes the filters that apply before optimizing (all but top N), so
 * weapons filtered out aren't calculated at all
 */
export function passesFilters(request: BuildRequest, filters: WeaponFilters) {
  if (filters.baseGameOnly && request.weapon.dlc) return false;
  if (
    filters.maxWeight.enabled &&
    request.weapon.weight != null &&
    request.weapon.weight > filters.maxWeight.value + 1e-9
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
