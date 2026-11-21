import type { AttackPowerType } from "../calculator/calculator.ts";
import type { Attribute } from "../calculator/attributes.ts";
import { getAllocation, getAllocationCount } from "../optimizer/allocations.ts";
import type { BuildResult, ValueCurve } from "../optimizer/build.ts";
import type { SortBy } from "./useAppState.ts";

const epsilon = 1e-9;

/**
 * @returns the best value achievable at the given character level, or null if the weapon's
 * requirements can't be met by then
 */
export function getValueAtLevel({ startLevel, values }: ValueCurve, level: number) {
  const index = level - startLevel;
  if (index < 0 || values.length === 0) {
    return null;
  }
  return values[Math.min(index, values.length - 1)];
}

/**
 * @returns the leveled attributes that achieve the best value at the given character level, or null
 * if the weapon's requirements can't be met by then
 */
export function getAllocationAtLevel({ startLevel, allocations }: ValueCurve, level: number) {
  const index = level - startLevel;
  const count = allocations ? getAllocationCount(allocations) : 0;
  if (index < 0 || !count) {
    return null;
  }
  return getAllocation(allocations!, Math.min(index, count - 1));
}

/**
 * Status buildup of the chosen attack, or the weapon's own buildup, or per second (with DPS shown),
 * none if the attack's timing isn't known
 */
export function getResultStatus(result: BuildResult, perSecond = false) {
  if (perSecond) return result.attackStatusPerSecond ?? {};
  return result.attackStatus ?? result.statusBuildup;
}

/**
 * Damage per point of stamina the chosen attack costs, or DPS per point of
 * stamina (with DPS shown), if its stamina cost is known
 */
export function getDamagePerStamina(result: BuildResult, perSecond = false) {
  const damage = perSecond ? result.attackDps : result.finalValue;
  return damage != null && result.attackStamina ? damage / result.attackStamina : undefined;
}

/**
 * Stance damage per point of stamina the chosen attack costs, or stance damage per second per point
 * of stamina (with DPS shown), if both are known
 */
export function getStancePerStamina(result: BuildResult, perSecond = false) {
  const stance = perSecond ? result.attackStancePerSecond : result.attackStance;
  return stance != null && result.attackStamina ? stance / result.attackStamina : undefined;
}

/**
 * Sort keys where a higher number comes first by default
 */
function getSortKey(result: BuildResult, sortBy: SortBy, perSecond: boolean) {
  switch (sortBy) {
    // Per second, the attack's damage, stance, and stamina repeated as fast as possible
    case "total":
      return perSecond ? result.attackDps ?? -Infinity : result.finalValue;
    // Names are compared separately (sortResults)
    case "name":
      return result.finalValue;
    case "level":
      return -result.finalLevel;
    case "stance":
      return (perSecond ? result.attackStancePerSecond : result.attackStance) ?? -Infinity;
    // The lowest stamina cost first
    case "stamina": {
      const stamina = perSecond ? result.attackStaminaPerSecond : result.attackStamina;
      return stamina != null ? -stamina : -Infinity;
    }
    case "damagePerStamina":
      return getDamagePerStamina(result, perSecond) ?? -Infinity;
    case "stancePerStamina":
      return getStancePerStamina(result, perSecond) ?? -Infinity;
    case "potential":
      return result.potential ?? -Infinity;
    default:
      if (sortBy.startsWith("scaling:")) {
        return result.scaling[sortBy.slice("scaling:".length) as Attribute] ?? 0;
      }
      // The lowest requirement first
      if (sortBy.startsWith("requirement:")) {
        return -(result.requirements[sortBy.slice("requirement:".length) as Attribute] ?? 0);
      }
      return (
        getResultStatus(result, perSecond)[+sortBy.slice("status:".length) as AttackPowerType] ?? 0
      );
  }
}

/** @param perSecond true to sort by per second values (damage, stance, stamina, and status) */
export function sortResults(
  results: BuildResult[],
  sortBy: SortBy,
  reverse: boolean,
  perSecond = false,
) {
  return [...results].sort((a, b) => {
    if (a.applicable !== b.applicable) return +b.applicable - +a.applicable;
    // Alphabetically, A to Z first
    if (sortBy === "name") {
      // (by the row's name, with its upgrade level: +9 before +10)
      const order = (a.row?.name ?? a.weaponName).localeCompare(
        b.row?.name ?? b.weaponName,
        undefined,
        { numeric: true },
      );
      if (order) return reverse ? -order : order;
      return b.finalValue - a.finalValue;
    }
    const keyA = getSortKey(a, sortBy, perSecond);
    const keyB = getSortKey(b, sortBy, perSecond);
    if (keyA !== keyB) return reverse ? keyA - keyB : keyB - keyA;
    return b.finalValue - a.finalValue;
  });
}
