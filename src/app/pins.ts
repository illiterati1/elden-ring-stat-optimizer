import type { BuildRequest } from "../optimizer/build.ts";
import type { Weapon } from "../calculator/weapon.ts";
import {
  allStats,
  getCharacterLevel,
  getStatLabel,
  type Stats,
} from "../optimizer/startingClasses.ts";
import { AttackPowerType } from "../calculator/calculator.ts";
import { ashAttack } from "./useAshes.ts";
import { getBuffKey, getSpellScalingAttribute, hasStackTiers, type Buff } from "./useBuffs.ts";
import { affinityOptions, objectiveOptions } from "./uiUtils.ts";
import type { AppState } from "./useAppState.ts";

const settingKeys = <K extends keyof AppState>(...keys: K[]) => keys;

/**
 * The settings a row's values depend on besides its weapon and attack: kept with a frozen pin, shown
 * in its tooltip, and restored from it. (Not the attack, upgrade level, or grip, which the pin has,
 * or what's shown.)
 */
export const pinSettingKeys = settingKeys(
  "startingClass",
  "stats",
  "plannedStats",
  "limits",
  "meetRequirements",
  "fastMode",
  "objective",
  "buffs",
  "stackTier",
  "health",
  "equipWeight",
  "catalyst",
  "catalystUpgradeLevel",
  "defenses",
  "physicalNegation",
  "enemyArea",
  "enemyKey",
  "enemyHp",
  "criticalDamageRate",
  "stanceDamageRate",
  "hpBurnDamageRate",
  "enemyRipostes",
  "enemyTypes",
  "enemyInRealmOfShadow",
  "scadutreeBlessing",
  "scadutreeBlessingLevel",
  "ngPlus",
  "radahnBeaten",
  "chainLimit",
  "chainWeight",
  "sumChains",
  "offhandWeapon",
  "offhandUpgradeLevel",
  "offhandAffinityId",
  "offhandBuff",
);

export type PinSettings = Pick<AppState, typeof pinSettingKeys[number]>;

export function getPinSettings(appState: AppState): PinSettings {
  return Object.fromEntries(pinSettingKeys.map((key) => [key, appState[key]])) as PinSettings;
}

/** A row's attack: one of the attacks, or ashAttack for a skill */
export type RowAttack = AppState["attacks"][number] | typeof ashAttack;

/** A row kept at the top of the table until it's unpinned: a weapon with an attack */
export interface Pin {
  readonly id: string;
  /** The weapon's full name as the table shows it (with its affinity, and ammunition if ranged) */
  readonly weaponName: string;
  readonly attack: RowAttack;
  /** The Ash of War picker's choice, for the "ash" attack */
  readonly ashOfWar: string;
  /** On the regular scale (+25), like the upgrade levels picked */
  readonly upgradeLevel: number;
  /** Its grip: the one picked, which for a weapon that can't be two handed is one handed anyway */
  readonly twoHanding: boolean;
  /** Which version of the weapon's fixed skill (its short label), if it has several */
  readonly skillVariant?: string;
  /** Shown after the weapon's name, e.g. "R1 chain" or the skill's name */
  readonly label: string;
  /** Held fixed: the values come from this request rather than the current settings */
  readonly frozen?: FrozenPin;
}

export interface FrozenPin {
  readonly request: StoredRequest;
  /** The settings when it was frozen */
  readonly settings: PinSettings;
}

/**
 * A frozen pin's request, with its weapons (the weapon, off hand weapon, and catalyst) by their full
 * names. Their data comes from the current weapon data, rather than storing it: most of it is the
 * game's scaling curves (about 25 KB a weapon).
 */
export type StoredRequest = Omit<BuildRequest, "weapon" | "offhand" | "catalyst"> & {
  readonly weapon: string;
  readonly offhand?: Omit<NonNullable<BuildRequest["offhand"]>, "weapon"> & {
    readonly weapon: string;
  };
  readonly catalyst?: string;
};

export function storeRequest(request: BuildRequest): StoredRequest {
  const { weapon, offhand, catalyst, ...rest } = request;
  return {
    ...rest,
    weapon: weapon.name,
    ...(offhand && { offhand: { ...offhand, weapon: offhand.weapon.name } }),
    ...(catalyst && { catalyst: catalyst.name }),
  };
}

/**
 * Identifies what a frozen pin's values come from, so the same row isn't frozen twice with the same
 * settings: its stored request as JSON, with object keys in order (requests built at different times
 * can list them differently). Equip weight only counts with a buff that depends on it (the Blue
 * Dancer Charm), though every request has it.
 */
export function getFrozenKey(request: StoredRequest) {
  const { equipWeight, ...rest } = request;
  const used = request.buffs?.some((effect) => effect.byEquipWeight) ? { equipWeight } : {};
  return stableStringify({ ...rest, ...used });
}

/** JSON with object keys in order, to compare values whose keys can be listed differently */
export const stableStringify = (value: unknown) =>
  JSON.stringify(value, (_, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );

/**
 * @param findWeapon a weapon by its full name (including ammunition, for a ranged weapon)
 * @returns the request with its weapons' current data, or undefined if one isn't found (e.g. it's
 * been renamed)
 */
export function restoreRequest(
  stored: StoredRequest,
  findWeapon: (name: string) => Weapon | undefined,
): BuildRequest | undefined {
  const { weapon: name, offhand, catalyst: catalystName, ...rest } = stored;
  const weapon = findWeapon(name);
  const offhandWeapon = offhand && findWeapon(offhand.weapon);
  const catalyst = catalystName && findWeapon(catalystName);
  if (!weapon || (offhand && !offhandWeapon) || (catalystName && !catalyst)) return undefined;
  return {
    ...rest,
    weapon,
    ...(offhand && { offhand: { ...offhand, weapon: offhandWeapon! } }),
    ...(catalyst && { catalyst }),
  };
}

/** What a row is besides its weapon and fixed skill version */
export interface RowChoice {
  readonly attack: RowAttack;
  readonly ashOfWar: string;
  readonly upgradeLevel: number;
  /** The grip picked */
  readonly twoHanding: boolean;
}

/**
 * Identifies a row: its weapon (and fixed skill version) with its attack, upgrade level, and grip.
 * It's JSON, so the row's choices can be read back from it (parseRowKey).
 */
export function getPinKey(
  weaponName: string,
  skillVariant: string | undefined,
  { attack, ashOfWar, upgradeLevel, twoHanding }: RowChoice,
) {
  return JSON.stringify([
    weaponName,
    skillVariant ?? "",
    attack,
    attack === ashAttack ? ashOfWar : "",
    upgradeLevel,
    twoHanding,
  ]);
}

/** @returns the choices of the row with this key (getPinKey) */
export function parseRowKey(key: string): RowChoice {
  const [, , attack, ashOfWar, upgradeLevel, twoHanding] = JSON.parse(key) as [
    string,
    string,
    RowAttack,
    string,
    number,
    boolean,
  ];
  return { attack, ashOfWar, upgradeLevel, twoHanding };
}

export const getKeyOfPin = (pin: Pin) => getPinKey(pin.weaponName, pin.skillVariant, pin);

/** The chart's key for a pinned row (chartWeapons), which can't be a weapon name */
export const getPinChartKey = (pin: Pin) => `pin:${pin.id}`;

export function isPin(value: unknown): value is Pin {
  const pin = value as Partial<Pin> | null;
  return (
    typeof pin === "object" &&
    pin != null &&
    typeof pin.id === "string" &&
    typeof pin.weaponName === "string" &&
    typeof pin.attack === "string" &&
    typeof pin.ashOfWar === "string" &&
    typeof pin.upgradeLevel === "number" &&
    typeof pin.twoHanding === "boolean" &&
    typeof pin.label === "string" &&
    (pin.frozen == null ||
      (typeof pin.frozen.request === "object" && typeof pin.frozen.settings === "object"))
  );
}

export interface PinSettingLine {
  label: string;
  value: string;
  /** Different from the current settings */
  changed: boolean;
}

interface LineSpec {
  label: string;
  value: (settings: PinSettings) => string;
  /** Always shown, rather than only when it isn't the default or it's changed */
  always?: boolean;
  /**
   * Only when the frozen settings use it, e.g. defenses without a picked enemy, or equip weight with
   * a buff that depends on it
   */
  when?: boolean;
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");
const shortStatLabel = (stat: keyof Stats) => getStatLabel(stat).slice(0, 3);
const damageTypes = [
  AttackPowerType.PHYSICAL,
  AttackPowerType.MAGIC,
  AttackPowerType.FIRE,
  AttackPowerType.LIGHTNING,
  AttackPowerType.HOLY,
] as const;

/**
 * @param allBuffs every buff, for their names and which settings the frozen ones use
 * @param attack the pinned row's attack, for settings only some attacks use (the off hand weapon)
 * @param chain true if the frozen attack is a chain, which the chain settings apply to
 * @returns the frozen settings worth showing: ones the frozen row uses that aren't the default or
 * are different now (marked changed), and the main ones always
 */
export function describePinSettings(
  frozen: PinSettings,
  current: PinSettings,
  defaults: PinSettings,
  attack: RowAttack,
  chain: boolean,
  allBuffs: readonly Buff[],
): PinSettingLine[] {
  const buffsByKey = new Map(allBuffs.map((buff) => [getBuffKey(buff), buff]));
  const buffName = (key: string) => buffsByKey.get(key)?.name ?? key.slice(key.indexOf(":") + 1);
  // Like the buff settings, which only offer these with buffs that use them
  const selected = frozen.buffs.flatMap((key) => buffsByKey.get(key) ?? []);
  const usesEffect = (test: (effect: Buff["effects"][number]) => unknown) =>
    selected.some((buff) => buff.effects.some(test));
  const usesCatalyst = !!getSpellScalingAttribute(
    selected.filter((buff) => buff.type === "weapon"),
  );
  const specs: LineSpec[] = [
    { label: "Class", value: (s) => s.startingClass, always: true },
    {
      label: "Stats",
      value: (s) =>
        `Level ${getCharacterLevel(s.stats)}: ` +
        allStats.map((stat) => `${shortStatLabel(stat)} ${s.stats[stat]}`).join(", "),
      always: true,
    },
    {
      label: "Planned stats",
      value: (s) =>
        allStats
          .filter((stat) => s.plannedStats[stat] != null)
          .map((stat) => `${shortStatLabel(stat)} ${s.plannedStats[stat]}`)
          .join(", ") || "None",
    },
    {
      label: "Level limit",
      value: ({ limits: { maxLevels } }) => {
        if (!maxLevels.enabled) return "None";
        const value = maxLevels.values[maxLevels.mode];
        return maxLevels.mode === "additional"
          ? `${value} more levels`
          : maxLevels.mode === "absolute"
          ? `Up to level ${value}`
          : `${value.toLocaleString()} runes`;
      },
      always: true,
    },
    {
      label: "Min gain per level",
      value: ({ limits: { minGain } }) =>
        minGain.enabled ? `${minGain.value}${minGain.relative ? "%" : ""}` : "Off",
    },
    {
      label: "Target value",
      value: ({ limits: { targetValue } }) =>
        targetValue.enabled ? `${targetValue.value}` : "Off",
    },
    {
      label: "Target potential",
      value: ({ limits: { targetPotential } }) =>
        targetPotential?.enabled ? `${targetPotential.value}%` : "Off",
    },
    {
      label: "Min potential left per level",
      value: ({ limits: { minPotentialPerRemainingLevel } }) =>
        minPotentialPerRemainingLevel?.enabled ? `${minPotentialPerRemainingLevel.value}%` : "Off",
    },
    { label: "Meet requirements first", value: (s) => yesNo(s.meetRequirements) },
    { label: "Fast mode", value: (s) => (s.fastMode ? "On" : "Off") },
    {
      label: "Objective",
      value: (s) =>
        objectiveOptions.find(([value]) => value === s.objective)?.[1] ?? String(s.objective),
    },
    {
      label: "Buffs",
      value: (s) => s.buffs.map(buffName).join(", ") || "None",
      always: true,
    },
    {
      label: "Stack tier",
      value: (s) => (s.stackTier ? `${s.stackTier}` : "Inactive"),
      when: selected.some(hasStackTiers),
    },
    { label: "HP", value: (s) => `${s.health}%`, when: usesEffect((effect) => effect.hp) },
    {
      label: "Equip weight",
      value: (s) => `${s.equipWeight}`,
      when: usesEffect((effect) => effect.byEquipWeight),
    },
    {
      label: "Catalyst",
      value: (s) => (s.catalyst ? `${s.catalyst} +${s.catalystUpgradeLevel}` : "None"),
      when: usesCatalyst,
    },
    {
      label: "Enemy",
      value: (s) =>
        s.enemyKey
          ? s.enemyKey.split("|")[0] +
            (s.ngPlus ? ` (NG+${s.ngPlus}${s.radahnBeaten ? ", Radahn beaten" : ""})` : "")
          : "None",
      always: true,
    },
    {
      label: "Defenses",
      value: (s) => damageTypes.map((type) => s.defenses[type].defense).join(" / "),
      when: !frozen.enemyKey,
    },
    {
      label: "Negation",
      value: (s) =>
        [
          ...Object.values(s.physicalNegation),
          ...damageTypes.slice(1).map((type) => s.defenses[type].negation),
        ].join(" / "),
      when: !frozen.enemyKey,
    },
    {
      label: "Enemy HP",
      value: (s) => (s.enemyHp > 0 ? s.enemyHp.toLocaleString() : "Unknown"),
      when: !frozen.enemyKey,
    },
    {
      label: "Scadutree Blessing",
      value: (s) => (s.scadutreeBlessing ? `Level ${s.scadutreeBlessingLevel}` : "Off"),
    },
    {
      label: "Chains",
      value: (s) => (s.sumChains ? "Summed" : `Weighted ×${s.chainWeight}`),
      when: chain,
    },
    {
      label: "Chain cutoff",
      value: ({ chainLimit }) =>
        chainLimit.mode === "steps"
          ? `${chainLimit.steps} steps`
          : chainLimit.mode === "seconds"
          ? `${chainLimit.seconds}s`
          : "None",
      when: chain,
    },
    {
      label: "Off hand",
      value: (s) =>
        s.offhandWeapon
          ? [
              s.offhandAffinityId != null && s.offhandAffinityId !== 0
                ? affinityOptions.get(s.offhandAffinityId)?.text
                : undefined,
              s.offhandWeapon,
              `+${s.offhandUpgradeLevel}`,
              s.offhandBuff ? `with ${buffName(s.offhandBuff)}` : undefined,
            ]
              .filter(Boolean)
              .join(" ")
          : "Same weapon",
      when: attack.startsWith("Powerstance"),
    },
  ];
  return specs.flatMap(({ label, value, always, when = true }) => {
    if (!when) return [];
    const text = value(frozen);
    const changed = text !== value(current);
    return always || changed || text !== value(defaults) ? [{ label, value: text, changed }] : [];
  });
}
