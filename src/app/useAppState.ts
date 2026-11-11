import { useEffect, useState } from "react";
import {
  AttackPowerType,
  type Attribute,
  type Attributes,
  type EnemyType,
  type WeaponType,
} from "../calculator/calculator.ts";
import type { Defense } from "../optimizer/defense.ts";
import type { Objective } from "../optimizer/optimizer.ts";
import type { AttackChoice } from "./useMovesets.ts";
import type { ashAttack } from "./useAshes.ts";
import type { StackTier } from "./useBuffs.ts";
import {
  startingClasses,
  type StartingClassName,
  type Stats,
} from "../optimizer/startingClasses.ts";

export interface LimitSetting {
  enabled: boolean;
  value: number;
}

/** What the level limit limits: levels to gain, the level to stop at, or runes to spend */
export type LevelLimitMode = "additional" | "absolute" | "runes";

export interface LevelLimit {
  enabled: boolean;
  mode: LevelLimitMode;
  /** The value for each mode, so switching modes doesn't reinterpret the number */
  values: Record<LevelLimitMode, number>;
}

export interface LimitSettings {
  maxLevels: LevelLimit;
  /** Minimum gain per level, in points or percent of the current value if relative */
  minGain: LimitSetting & { relative: boolean };
  targetValue: LimitSetting;
}

/**
 * Planned stats to respec into or level towards before optimizing damage. Stats that aren't
 * planned are the same as the current ones.
 */
export type PlannedStats = Partial<Stats>;

export type DamageTypeDefenses = Record<
  | typeof AttackPowerType.PHYSICAL
  | typeof AttackPowerType.MAGIC
  | typeof AttackPowerType.FIRE
  | typeof AttackPowerType.LIGHTNING
  | typeof AttackPowerType.HOLY,
  Defense
>;

import { allPhysicalTypes, type PhysicalType } from "../optimizer/defense.ts";
export { allPhysicalTypes, type PhysicalType };

export interface TooltipTimings {
  /** When each hit lands */
  readonly hits: boolean;
  /** When each step can first be cancelled into another attack, and which */
  readonly cancel: boolean;
  /** When each step can be rolled out of */
  readonly roll: boolean;
  /** When each step can be blocked out of */
  readonly block: boolean;
  /** When the next chain can start */
  readonly nextChain: boolean;
}

export interface ChainLimitSetting {
  readonly mode: "none" | "steps" | "seconds";
  readonly steps: number;
  /** From the press until a roll can start after the last step */
  readonly seconds: number;
}

export interface AppState {
  readonly startingClass: StartingClassName;
  readonly stats: Stats;
  /** Selected buffs (talismans, armor, etc.), by getBuffKey(), which also give bonus stats */
  readonly buffs: readonly string[];
  /** The tier of successive attack stacks, for buffs like the Winged Sword Insignia */
  readonly stackTier: StackTier;
  /** The staff or seal weapon buff spells are cast with, by weapon name ("" for none) */
  readonly catalyst: string;
  /** The catalyst's upgrade level (its own, e.g. at most 10 for a somber one) */
  readonly catalystUpgradeLevel: number;
  /**
   * Equip weight besides the weapons', for the Blue Dancer Charm (each weapon's own weight, and the
   * left hand weapon's when powerstancing, are added)
   */
  readonly equipWeight: number;
  /** The character's HP percentage, for buffs that depend on it */
  readonly health: number;
  readonly upgradeLevel: number;
  readonly twoHanding: boolean;
  readonly showScaling: boolean;
  readonly showStatus: boolean;
  /** Show the chosen attack's stance damage */
  readonly showStance: boolean;
  /** Show the chosen attack's stamina cost */
  readonly showStamina: boolean;
  /**
   * Show the chosen attack's damage, poise, stamina, and status per second, repeated as fast as
   * possible, instead of per attack
   */
  readonly showDps: boolean;
  /** Timings shown in the hits tooltip, from the start of the chain */
  readonly tooltipTimings: TooltipTimings;
  /** Chains cut short: to a number of steps, or the steps that fit a time budget */
  readonly chainLimit: ChainLimitSetting;
  readonly showRequirements: boolean;
  /**
   * Only optimize the level the level limit stops at (faster, but no chart, and the minimum gain
   * and target value limits don't apply)
   */
  readonly fastMode: boolean;
  /** Alerts closed by the user, by ID, until they choose to show all alerts again */
  readonly closedAlerts: readonly string[];
  readonly meetRequirements: boolean;
  /** Only include weapons that can be buffed, e.g. with greases */
  readonly onlyBuffable: boolean;
  readonly sortBy: SortBy;
  /** Weapons (full names, including affinity) checked to be shown on the chart */
  readonly chartWeapons: string[];
  /** Character levels shown at the left and right of the chart, or null for automatic */
  readonly chartRange: { min: number | null; max: number | null };
  /** Reverse the default order for sortBy (highest total, lowest level, highest value per level) */
  readonly reverse: boolean;
  readonly objective: Objective;
  readonly limits: LimitSettings;
  readonly plannedStats: PlannedStats;
  /** Physical defense is in `defenses`, but negation depends on the attack's physical type */
  readonly defenses: DamageTypeDefenses;
  readonly physicalNegation: Record<PhysicalType, number>;
  /** The area and enemy last picked to fill in the defenses, cleared when they're edited */
  readonly enemyArea: string | null;
  readonly enemyKey: string | null;
  /** The enemy's max HP, for damage that's a percentage of it (e.g. black flame), or 0 if unknown */
  readonly enemyHp: number;
  /** The picked enemy's damage multiplier for critical hits (1 for most) */
  readonly criticalDamageRate: number;
  /** The picked enemy's poise damage multiplier (1 for most, e.g. 0.2 for ancient dragons) */
  readonly poiseDamageRate: number;
  /** The picked enemy's ripostes, to only offer those, or null without an enemy */
  readonly enemyRipostes: readonly string[] | null;
  /** The enemy's types, for weapons and buffs that do more damage to them (e.g. dragons) */
  readonly enemyTypes: readonly EnemyType[];
  readonly showFriendlyEnemies: boolean;
  /** An attack whose motion values are used, "base" for 100 motion values, or "ash" for a skill */
  readonly attack: AttackChoice | typeof ashAttack;
  /** For the "ash" attack, the Ash of War picker's choice (the first choice if empty or unknown) */
  readonly ashOfWar: string;
  /**
   * For powerstance attacks, the off hand weapon (a base weapon name), or null for the same weapon in
   * both hands
   */
  readonly offhandWeapon: string | null;
  /** The off hand weapon's upgrade level, on the regular scale like upgradeLevel */
  readonly offhandUpgradeLevel: number;
  /** The off hand weapon's affinity, or null for its standard (or unique) version */
  readonly offhandAffinityId: number | null;
  /** The off hand weapon's weapon buff (a buff key), or null for none */
  readonly offhandBuff: string | null;
  /** How much each step of a chain counts relative to the one before it */
  readonly chainWeight: number;
  /** Add up a chain's steps rather than taking their weighted average */
  readonly sumChains: boolean;
  /** Base weapon names, e.g. "Uchigatana" rather than "Keen Uchigatana" */
  readonly selectedWeapons: string[];
  readonly affinityIds: number[];
  /** Ammunition fired from ranged weapons (keys from getAmmoKey) */
  readonly selectedAmmo: string[];
  /** Every weapon of these types is included, as well as the selected weapons */
  readonly weaponTypes: WeaponType[];
}

/**
 * Columns the results can be sorted by, including one per status effect, e.g. "status:7", and one
 * per attribute for scaling and requirements, e.g. "scaling:str"
 */
export type SortBy =
  | "total"
  | "name"
  | "level"
  | "stance"
  | "stamina"
  | `status:${AttackPowerType}`
  | `scaling:${Attribute}`
  | `requirement:${Attribute}`;

export const statusSortBy = (statusType: AttackPowerType): SortBy => `status:${statusType}`;

function isSortBy(value: unknown): value is SortBy {
  return (
    value === "total" ||
    value === "name" ||
    value === "level" ||
    value === "stance" ||
    value === "stamina" ||
    (typeof value === "string" &&
      (/^status:\d+$/.test(value) || /^(scaling|requirement):(str|dex|int|fai|arc)$/.test(value)))
  );
}

export type UpdateAppState = (update: Partial<AppState>) => void;

const defaultAppState: AppState = {
  startingClass: "Vagabond",
  stats: startingClasses.Vagabond,
  buffs: [],
  stackTier: 3,
  catalyst: "",
  catalystUpgradeLevel: 25,
  equipWeight: 0,
  health: 100,
  upgradeLevel: 25,
  twoHanding: false,
  showScaling: false,
  showStatus: false,
  showStance: true,
  showStamina: false,
  showDps: false,
  tooltipTimings: { hits: true, cancel: true, roll: true, block: false, nextChain: true },
  chainLimit: { mode: "none", steps: 3, seconds: 2 },
  showRequirements: false,
  closedAlerts: [],
  fastMode: false,
  meetRequirements: true,
  onlyBuffable: false,
  sortBy: "total",
  chartWeapons: [],
  chartRange: { min: null, max: null },
  reverse: false,
  objective: "totalAttack",
  limits: {
    maxLevels: {
      enabled: true,
      mode: "additional",
      values: { additional: 50, absolute: 100, runes: 1000000 },
    },
    minGain: { enabled: false, value: 2, relative: false },
    targetValue: { enabled: false, value: 600 },
  },
  plannedStats: {},
  defenses: {
    [AttackPowerType.PHYSICAL]: { defense: 125, negation: 0 },
    [AttackPowerType.MAGIC]: { defense: 125, negation: 0 },
    [AttackPowerType.FIRE]: { defense: 125, negation: 0 },
    [AttackPowerType.LIGHTNING]: { defense: 125, negation: 0 },
    [AttackPowerType.HOLY]: { defense: 125, negation: 0 },
  },
  physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
  enemyArea: null,
  enemyKey: null,
  enemyHp: 0,
  criticalDamageRate: 1,
  poiseDamageRate: 1,
  enemyRipostes: null,
  enemyTypes: [],
  showFriendlyEnemies: false,
  attack: "R1",
  ashOfWar: "",
  offhandWeapon: null,
  offhandUpgradeLevel: 25,
  offhandAffinityId: null,
  offhandBuff: null,
  chainWeight: 0.5,
  sumChains: false,
  selectedWeapons: ["Uchigatana"],
  affinityIds: [0, 1, 2, 3, -1],
  selectedAmmo: [],
  weaponTypes: [],
};

const storageKey = "statCalculatorState";

/** Attacks saved under an earlier name: mounted attacks are named with both sides' buttons */
const renamedAttacks: Record<string, AttackChoice> = {
  "Mounted R1": "Mounted R1/L1",
  "Mounted R2": "Mounted R2/L2",
  "Mounted Charged R2": "Mounted Charged R2/L2",
};

/**
 * Earlier versions stored the level limit as { enabled, value, absolute }, with a separate rune
 * budget limit
 */
function getStoredLevelLimit(stored: Record<string, unknown> | undefined): LevelLimit {
  const defaults = defaultAppState.limits.maxLevels;
  const maxLevels = stored?.maxLevels as Partial<LevelLimit & { value: number; absolute: boolean }>;
  if (maxLevels?.mode && maxLevels.values) {
    return { ...defaults, ...maxLevels, values: { ...defaults.values, ...maxLevels.values } };
  }
  const runeBudget = stored?.runeBudget as LimitSetting | undefined;
  const values = { ...defaults.values };
  if (maxLevels?.value != null)
    values[maxLevels.absolute ? "absolute" : "additional"] = maxLevels.value;
  if (runeBudget?.value != null) values.runes = runeBudget.value;
  return {
    enabled: (maxLevels?.enabled ?? defaults.enabled) || !!runeBudget?.enabled,
    mode:
      runeBudget?.enabled && !maxLevels?.enabled
        ? "runes"
        : maxLevels?.absolute
        ? "absolute"
        : "additional",
    values,
  };
}

function getInitialAppState(): AppState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Omit<
      Partial<AppState>,
      "limits"
    > & { limits?: Record<string, unknown> & Partial<LimitSettings> };
    return {
      ...defaultAppState,
      ...stored,
      // Only known limits, since their settings change between versions
      limits: {
        maxLevels: getStoredLevelLimit(stored.limits),
        minGain: { ...defaultAppState.limits.minGain, ...stored.limits?.minGain },
        targetValue: { ...defaultAppState.limits.targetValue, ...stored.limits?.targetValue },
      },
      // Earlier versions saved 0 for stats that weren't planned
      plannedStats: Object.fromEntries(
        Object.entries(stored.plannedStats ?? {}).filter(([, value]) => value > 0),
      ),
      defenses: { ...defaultAppState.defenses, ...stored.defenses },
      tooltipTimings: { ...defaultAppState.tooltipTimings, ...stored.tooltipTimings },
      chainLimit: { ...defaultAppState.chainLimit, ...stored.chainLimit },
      physicalNegation: { ...defaultAppState.physicalNegation, ...stored.physicalNegation },
      // Earlier versions had a custom motion value instead of the base attack
      // (the base attack is gone: its ranged weapons' shot is the Standard Shot, and others' R1)
      attack:
        stored.attack &&
        stored.attack !== ("custom" as string) &&
        stored.attack !== ("base" as string)
          ? renamedAttacks[stored.attack as string] ?? stored.attack
          : "R1",
      // Great Arrows and Radahn's Spears were one choice before Radahn's Spears got the Lion
      // Greatbow's bonus
      selectedAmmo: (stored.selectedAmmo ?? defaultAppState.selectedAmmo).flatMap((key) =>
        key === "greatarrow:Great Arrow/Radahn's Spear"
          ? ["greatarrow:Great Arrow", "greatarrow:Radahn's Spear"]
          : [key],
      ),
      // Sort columns can be removed between versions
      sortBy: isSortBy(stored.sortBy) ? stored.sortBy : defaultAppState.sortBy,
    };
  } catch {
    return defaultAppState;
  }
}

/**
 * Manages all of the user's inputs, and saves/loads them in localStorage for future page loads
 */
export default function useAppState(): [AppState, UpdateAppState] {
  const [appState, setAppState] = useState<AppState>(getInitialAppState);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(appState));
    } catch {
      // Storage may be unavailable (e.g. private browsing); settings just won't persist
    }
  }, [appState]);

  const [updateAppState] = useState<UpdateAppState>(
    () => (update: Partial<AppState>) =>
      setAppState((prevAppState) => ({ ...prevAppState, ...update })),
  );

  return [appState, updateAppState];
}
