import type { Attribute } from "../calculator/calculator.ts";
import { getCumulativeLevelUpCosts } from "./runes.ts";

export const allStats = ["vig", "min", "end", "str", "dex", "int", "fai", "arc"] as const;

export type Stat = typeof allStats[number];
export type Stats = Record<Stat, number>;

export function getStatLabel(stat: Stat | Attribute) {
  switch (stat) {
    case "vig":
      return "Vigor";
    case "min":
      return "Mind";
    case "end":
      return "Endurance";
    case "str":
      return "Strength";
    case "dex":
      return "Dexterity";
    case "int":
      return "Intelligence";
    case "fai":
      return "Faith";
    case "arc":
      return "Arcane";
  }
}

/**
 * A character's level is the sum of their stats minus this number
 */
const levelOffset = 79;

export function getCharacterLevel(stats: Stats) {
  return allStats.reduce((sum, stat) => sum + stats[stat], 0) - levelOffset;
}

export type StartingClassName =
  | "Vagabond"
  | "Warrior"
  | "Hero"
  | "Bandit"
  | "Astrologer"
  | "Prophet"
  | "Samurai"
  | "Prisoner"
  | "Confessor"
  | "Wretch"
  | "Idus Knight"
  | "Heavy Knight";

export const startingClasses: Record<StartingClassName, Stats> = {
  Vagabond: { vig: 15, min: 10, end: 11, str: 14, dex: 13, int: 9, fai: 9, arc: 7 },
  Warrior: { vig: 11, min: 12, end: 11, str: 10, dex: 16, int: 10, fai: 8, arc: 9 },
  Hero: { vig: 14, min: 9, end: 12, str: 16, dex: 9, int: 7, fai: 8, arc: 11 },
  Bandit: { vig: 10, min: 11, end: 10, str: 9, dex: 13, int: 9, fai: 8, arc: 14 },
  Astrologer: { vig: 9, min: 15, end: 9, str: 8, dex: 12, int: 16, fai: 7, arc: 9 },
  Prophet: { vig: 10, min: 14, end: 8, str: 11, dex: 10, int: 7, fai: 16, arc: 10 },
  Samurai: { vig: 12, min: 11, end: 13, str: 12, dex: 15, int: 9, fai: 8, arc: 8 },
  Prisoner: { vig: 11, min: 12, end: 11, str: 11, dex: 14, int: 14, fai: 6, arc: 9 },
  Confessor: { vig: 10, min: 13, end: 10, str: 12, dex: 12, int: 9, fai: 14, arc: 9 },
  Wretch: { vig: 10, min: 10, end: 10, str: 10, dex: 10, int: 10, fai: 10, arc: 10 },
  // Added after the original ten (CharaInitParam rows 3010 and 3011)
  "Idus Knight": { vig: 10, min: 12, end: 11, str: 13, dex: 15, int: 8, fai: 11, arc: 6 },
  "Heavy Knight": { vig: 14, min: 8, end: 17, str: 15, dex: 11, int: 7, fai: 8, arc: 9 },
};

/** The lowest of each stat across the starting classes */
export const minimumStats = Object.fromEntries(
  allStats.map((stat) => [
    stat,
    Math.min(...Object.values(startingClasses).map((base) => base[stat])),
  ]),
) as Stats;

/**
 * Planned stats to respec into or level towards before optimizing damage. Stats that aren't planned
 * are the current ones. A stat at the lowest any class has ("-") doesn't matter for the best class:
 * no class needs levels for it. Unplanned stats at the class's base are "-" for it too.
 */
export type PlannedStats = Partial<Stats>;

/** @returns true if the current stats are the starting class's, so the class can still be picked */
export function isAtBaseStats(stats: Stats, baseStats: Stats) {
  return allStats.every((stat) => stats[stat] === baseStats[stat]);
}

/**
 * @returns the stats to optimize from: planned stats where set (at least the class's base, since a
 * respec can't go lower, and at most 99), and the current stats otherwise
 */
export function getPlannedStats(stats: Stats, planned: PlannedStats, baseStats: Stats): Stats {
  const plan = { ...stats };
  for (const stat of allStats) {
    const value = planned[stat];
    if (value != null) plan[stat] = Math.min(99, Math.max(baseStats[stat], value));
  }
  return plan;
}

/**
 * @returns the planned stats as their fields show them and the best class counts them: planned
 * stats where set (at least the lowest any class has, "-"), and otherwise the current stats, or "-"
 * for those at the class's base
 */
export function getShownPlannedStats(stats: Stats, planned: PlannedStats, baseStats: Stats): Stats {
  const plan = { ...stats };
  for (const stat of allStats) {
    const value = planned[stat];
    plan[stat] =
      value != null
        ? Math.min(99, Math.max(minimumStats[stat], value))
        : stats[stat] <= baseStats[stat]
        ? minimumStats[stat]
        : stats[stat];
  }
  return plan;
}

export interface OptimalStartingClasses {
  /** The classes, in the game's order */
  classes: StartingClassName[];
  /** The runes each of them needs */
  runes: number;
  /** Each class's starting and final levels; a class may end higher if it starts above a stat */
  levels: { start: number; end: number }[];
}

/**
 * @returns the starting classes that reach the given stats in the fewest runes. A class levels up
 * each stat below the given value and keeps any stat it starts above it.
 */
export function getOptimalStartingClasses(stats: Stats): OptimalStartingClasses {
  let best: OptimalStartingClasses = { classes: [], runes: Infinity, levels: [] };
  for (const [name, base] of Object.entries(startingClasses) as [StartingClassName, Stats][]) {
    const start = getCharacterLevel(base);
    const levels = allStats.reduce((sum, stat) => sum + Math.max(0, stats[stat] - base[stat]), 0);
    const runes = getCumulativeLevelUpCosts(start, levels)[levels];
    const level = { start, end: start + levels };
    if (runes < best.runes) {
      best = { classes: [name], runes, levels: [level] };
    } else if (runes === best.runes) {
      best.classes.push(name);
      best.levels.push(level);
    }
  }
  return best;
}
