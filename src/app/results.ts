import type { AttackPowerType } from "../calculator/calculator.ts";
import type { Attribute } from "../calculator/attributes.ts";
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
  if (index < 0 || !allocations?.length) {
    return null;
  }
  return allocations[Math.min(index, allocations.length - 1)];
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
 * Sort keys where a higher number comes first by default
 */
function getSortKey(result: BuildResult, sortBy: SortBy, perSecond: boolean) {
  switch (sortBy) {
    case "total":
    // Names are compared separately (sortResults)
    case "name":
      return result.finalValue;
    case "level":
      return -result.finalLevel;
    case "stance":
      return result.attackStance ?? -Infinity;
    // The lowest stamina cost first
    case "stamina":
      return result.attackStamina != null ? -result.attackStamina : -Infinity;
    case "dps":
      return result.attackDps ?? -Infinity;
    case "poisePerSecond":
      return result.attackPoisePerSecond ?? -Infinity;
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

/** @param perSecond true to sort status by its buildup per second (with DPS shown) */
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
      const order = a.weaponName.localeCompare(b.weaponName);
      if (order) return reverse ? -order : order;
      return b.finalValue - a.finalValue;
    }
    const keyA = getSortKey(a, sortBy, perSecond);
    const keyB = getSortKey(b, sortBy, perSecond);
    if (keyA !== keyB) return reverse ? keyA - keyB : keyB - keyA;
    return b.finalValue - a.finalValue;
  });
}
