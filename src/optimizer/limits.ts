import { getCumulativeLevelUpCosts, maxCharacterLevel } from "./runes.ts";

/**
 * Conditions for when to stop leveling. Each is optional (null = disabled), and the most
 * restrictive enabled condition wins.
 */
export interface Limits {
  /** Maximum number of levels to gain */
  maxLevels: number | null;

  /** Minimum objective points (AR, damage, or spell scaling) gained per level */
  minGainPerLevel: number | null;

  /** Minimum gain per level as a percentage of the current objective value */
  minRelativeGainPerLevel: number | null;

  /** Maximum total runes to spend */
  runeBudget: number | null;

  /** Stop once the objective reaches this value */
  targetValue: number | null;
}

export type LimitReason = keyof Limits | "maxedOut";

const epsilon = 1e-9;

/**
 * @returns the indices of the points on the upper convex hull of (xs[i], ys[i]) for i < count,
 * in increasing order. xs must be strictly increasing.
 */
function getUpperHull(xs: number[], ys: number[], count: number) {
  const hull: number[] = [];
  for (let i = 0; i < count; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      // Drop b if it's on or below the line from a to i
      if ((ys[b] - ys[a]) * (xs[i] - xs[a]) <= (ys[i] - ys[a]) * (xs[b] - xs[a]) + epsilon) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(i);
  }
  return hull;
}

/**
 * Walk along the upper hull and return the start of the first segment that isn't accepted
 */
function findStop(
  xs: number[],
  ys: number[],
  count: number,
  accept: (p: number, q: number) => LimitReason | null,
): { stop: number; reason: LimitReason } | null {
  const hull = getUpperHull(xs, ys, count);
  for (let i = 0; i + 1 < hull.length; i++) {
    const reason = accept(hull[i], hull[i + 1]);
    if (reason) {
      return { stop: hull[i], reason };
    }
  }
  return null;
}

/**
 * Decide how many levels to gain given the best objective value achievable with each number of
 * levels.
 *
 * Limits are evaluated against the upper concave hull of the value curve rather than level by
 * level, so a weapon requirement that takes several levels to reach (and then pays off) is judged
 * by the average gain over those levels instead of being cut off before the payoff.
 *
 * @param values best objective value achievable with at most n levels, for each n (non-decreasing)
 * @param ownedLevel levels below this are already owned, so cost no runes
 */
export function applyLimits(
  values: number[],
  startLevel: number,
  limits: Limits,
  ownedLevel = startLevel,
): { levels: number; runes: number; reason: LimitReason } {
  const last = values.length - 1;

  let stop = Math.max(0, Math.min(last, maxCharacterLevel - startLevel));
  let reason: LimitReason = "maxedOut";
  if (limits.maxLevels != null && limits.maxLevels < stop) {
    stop = Math.max(0, Math.floor(limits.maxLevels));
    reason = "maxLevels";
  }

  const runes = getCumulativeLevelUpCosts(startLevel, last, ownedLevel);

  const { minGainPerLevel, minRelativeGainPerLevel, runeBudget, targetValue } = limits;

  if (runeBudget != null) {
    let affordable = stop;
    while (affordable > 0 && runes[affordable] > runeBudget) affordable--;
    if (affordable < stop) {
      stop = affordable;
      reason = "runeBudget";
    }
  }

  if (targetValue != null) {
    const reached = values.findIndex((value) => value >= targetValue - epsilon);
    if (reached >= 0 && reached < stop) {
      stop = reached;
      reason = "targetValue";
    }
  }

  const count = stop + 1;
  const levels = values.map((_, n) => n);
  const candidates = [];

  if (minGainPerLevel != null || minRelativeGainPerLevel != null) {
    candidates.push(
      findStop(levels, values, count, (p, q) => {
        const gainPerLevel = (values[q] - values[p]) / (q - p);
        if (minGainPerLevel != null && gainPerLevel < minGainPerLevel) {
          return "minGainPerLevel";
        }
        if (
          minRelativeGainPerLevel != null &&
          values[p] > 0 &&
          (100 * gainPerLevel) / values[p] < minRelativeGainPerLevel
        ) {
          return "minRelativeGainPerLevel";
        }
        return null;
      }),
    );
  }

  for (const candidate of candidates) {
    if (candidate && candidate.stop < stop) {
      stop = candidate.stop;
      reason = candidate.reason;
    }
  }

  // Don't spend levels that don't increase the value
  while (stop > 0 && values[stop - 1] >= values[stop] - epsilon) {
    stop--;
  }

  // If nothing more can be gained, that's the reason to stop, whichever limit was reached first
  if (values[stop] >= values[last] - epsilon) {
    reason = "maxedOut";
  }

  return { levels: stop, runes: runes[stop], reason };
}
