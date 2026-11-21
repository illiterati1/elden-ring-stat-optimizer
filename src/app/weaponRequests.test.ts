import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allAttributes, AttackPowerType, type Attributes } from "../calculator/calculator.ts";
import {
  getCharacterLevel,
  getPlannedStats,
  startingClasses,
} from "../optimizer/startingClasses.ts";
import { decodeRegulationData } from "../regulationData.ts";
import { defaultAppState, type AppState } from "./useAppState.ts";
import type { AmmoGroup } from "./useAmmo.ts";
import { getAshChoices, type Ashes } from "./useAshes.ts";
import type { Buffable } from "./useBuffable.ts";
import { getBuffKey, getBuffStats, type Buff } from "./useBuffs.ts";
import type { Movesets } from "./useMovesets.ts";
import { getBuffSelection, getTableRequests, getWeaponRequestBuilder } from "./weaponRequests.ts";

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../public/${file}`, import.meta.url), "utf8"));
const weapons = decodeRegulationData(read("regulation-vanilla-v1.17.js"));
const movesets: Movesets = read("movesets.json");
const ashes: Ashes = read("ashes.json");
const buffable: Buffable = read("buffable.json");
const ammo: AmmoGroup[] = read("ammo.json");
const allBuffs: Buff[] = read("buffs.json").buffs;
const ashLabels = new Map(getAshChoices(ashes).map(({ value, label }) => [value, label]));

const toAttributes = (stats: Record<string, number>) =>
  Object.fromEntries(allAttributes.map((attribute) => [attribute, stats[attribute]])) as Attributes;

/** The table's requests for some settings, worked out the way App does */
function tableRequests(settings: Partial<AppState>) {
  const state = { ...defaultAppState, ...settings };
  const selectedBuffs = allBuffs.filter((buff) => state.buffs.includes(getBuffKey(buff)));
  const plan = getPlannedStats(
    state.stats,
    state.plannedStats,
    startingClasses[state.startingClass],
  );
  const attackActive = state.objective !== "spellScaling";
  const offhandWeaponData = weapons.find(
    (weapon) => weapon.weaponName === state.offhandWeapon && weapon.affinityId === 0,
  );
  const getWeaponRequests = getWeaponRequestBuilder({
    ...state,
    ...getBuffSelection(selectedBuffs, state.stackTier, state.health),
    movesets,
    buffable,
    ashes,
    limit:
      state.chainLimit.mode === "steps"
        ? { steps: state.chainLimit.steps }
        : state.chainLimit.mode === "seconds"
        ? { seconds: state.chainLimit.seconds }
        : undefined,
    countedEnemyHp: state.enemyHp > 0 ? state.enemyHp : undefined,
    scadutreeBlessingRate: 1,
    offhandWeaponData,
    offhandBuffEffects: [],
    showRowLabels: attackActive && state.attacks.length + state.ashesOfWar.length > 0,
    ashLabels,
    bonusAttributes: getBuffStats(selectedBuffs),
    classAttributes: toAttributes(startingClasses[state.startingClass]),
    selectedBuffs,
    catalyst: undefined,
    castingRequirements: undefined,
    attackActive,
    enemyDefenses: {
      ...state.defenses,
      [AttackPowerType.PHYSICAL]: {
        defense: state.defenses[AttackPowerType.PHYSICAL].defense,
        negation: state.physicalNegation.standard,
      },
    },
    planLevel: getCharacterLevel(plan),
    planAttributes: toAttributes(plan),
    startLevel: getCharacterLevel(state.stats),
    passives: new Map(
      allBuffs.filter((buff) => buff.kind === "offhand").map((buff) => [buff.name, buff]),
    ),
  });
  return getTableRequests({
    ...state,
    weapons,
    validSelectedWeapons: state.selectedWeapons,
    ammo,
    buffable,
    ashes,
    getWeaponRequests,
    attackActive,
    upgradeLevels: state.upgradeLevels,
  });
}

/** Each request's row name (with plain spaces), with its reason if it isn't available */
const rows = (settings: Partial<AppState>) =>
  tableRequests(settings).unfilteredRequests.map((request) => {
    const name = request.row?.name.replaceAll("\u00a0", " ");
    return request.unavailableReason ? `${name}: ${request.unavailableReason}` : name;
  });

const fireGrease = getBuffKey({ kind: "consumable", name: "Fire Grease" });

describe("getTableRequests", () => {
  it("makes a row for each selected affinity of a weapon picked by name", () => {
    expect(rows({})).toEqual([
      "Uchigatana +25 · R1",
      "Heavy Uchigatana +25 · R1",
      "Keen Uchigatana +25 · R1",
      "Quality Uchigatana +25 · R1",
    ]);
  });

  it("makes a row for each grip, labeled, when two handing changes the result", () => {
    expect(rows({ grips: ["1h", "2h"], affinityIds: [0] })).toEqual([
      "Uchigatana +25 · 1H R1",
      "Uchigatana +25 · 2H R1",
    ]);
  });

  it("makes one unlabeled row when both grips work out the same", () => {
    expect(
      rows({
        selectedWeapons: ["Moonveil"],
        attacks: [],
        ashesOfWar: ["fixed"],
        grips: ["1h", "2h"],
      }),
    ).toEqual([
      "Moonveil +10 · Transient Moonlight (R1)",
      "Moonveil +10 · Transient Moonlight (R2)",
    ]);
  });

  it("gives critical hits one row with both grips", () => {
    expect(rows({ attacks: ["Backstab", "R1"], grips: ["1h", "2h"], affinityIds: [0] })).toEqual([
      "Uchigatana +25 · Backstab",
      "Uchigatana +25 · 1H R1",
      "Uchigatana +25 · 2H R1",
    ]);
  });

  it("makes a row for each version of a fixed skill", () => {
    expect(rows({ selectedWeapons: ["Moonveil"], attacks: [], ashesOfWar: ["fixed"] })).toEqual([
      "Moonveil +10 · Transient Moonlight (R1)",
      "Moonveil +10 · Transient Moonlight (R2)",
    ]);
  });

  it("leaves out picked upgrade levels that are the same somber level", () => {
    expect(rows({ selectedWeapons: ["Moonveil"], upgradeLevels: [23, 24, 25] })).toEqual([
      "Moonveil +9 · R1",
      "Moonveil +10 · R1",
    ]);
  });

  it("names rows without an attack for spell scaling", () => {
    const settings: Partial<AppState> = {
      objective: "spellScaling",
      selectedWeapons: ["Astrologer's Staff"],
    };
    expect(rows(settings)).toEqual(["Astrologer's Staff +25"]);
    expect(tableRequests(settings).unfilteredRequests[0].attack).toBeUndefined();
  });

  it("shows weapons left out for themselves with the reason", () => {
    expect(rows({ selectedWeapons: ["Longbow", "Moonveil"], affinityIds: [] })).toEqual([
      "Moonveil +10 · R1",
      "Longbow +25 · R1: No ammunition selected",
    ]);
    expect(rows({ selectedWeapons: ["Uchigatana"], affinityIds: [-1] })).toEqual([
      "Uchigatana +25 · R1: No affinity selected",
    ]);
    expect(rows({ selectedWeapons: ["Moonveil"], onlyBuffable: true })).toEqual([
      "Moonveil +10 · R1: Can't be buffed",
    ]);
  });

  it("leaves out unbuffable affinities with only buffable weapons", () => {
    expect(rows({ onlyBuffable: true, affinityIds: [0, 4] })).toEqual(["Uchigatana +25 · R1"]);
  });

  it("shows attacks too slow for the time to dodge with the reason", () => {
    expect(
      rows({
        selectedWeapons: ["Zweihander"],
        affinityIds: [0],
        chainLimit: { mode: "seconds", steps: 3, seconds: 0.5 },
      }),
    ).toEqual([
      "Zweihander +25 · R1: No attack can be performed quickly enough to roll within the time to dodge",
    ]);
  });

  it("shows a powerstance attack with an off hand weapon it doesn't powerstance with", () => {
    expect(
      rows({ attacks: ["Powerstance L1"], offhandWeapon: "Longsword", affinityIds: [0] }),
    ).toEqual(["Uchigatana +25 · Powerstance L1: Doesn't powerstance with Longsword"]);
  });

  it("uses an off hand weapon it powerstances with", () => {
    const [request] = tableRequests({
      attacks: ["Powerstance L1"],
      offhandWeapon: "Nagakiba",
      affinityIds: [0],
    }).unfilteredRequests;
    expect(request.unavailableReason).toBeUndefined();
    expect(request.offhand?.weapon.weaponName).toBe("Nagakiba");
  });

  it("leaves out a weapon without the attack, noting the missing moveset", () => {
    const { unfilteredRequests, movesetsMissing } = tableRequests({
      selectedWeapons: ["Astrologer's Staff"],
    });
    expect(unfilteredRequests).toEqual([]);
    expect(movesetsMissing).toBe(true);
  });
});

describe("getWeaponRequestBuilder", () => {
  const request = (settings: Partial<AppState>) => tableRequests(settings).unfilteredRequests[0];
  const hasFireGrease = (settings: Partial<AppState>) =>
    !!request({ affinityIds: [0], buffs: [fireGrease], ...settings }).buffs?.some(
      (effect) => effect.flat?.[AttackPowerType.FIRE],
    );

  it("applies a weapon buff only to weapons that can be buffed", () => {
    expect(hasFireGrease({})).toBe(true);
    expect(hasFireGrease({ selectedWeapons: ["Moonveil"] })).toBe(false);
  });

  it("counts additional levels from the current or planned level, whichever is higher", () => {
    const stats = { ...defaultAppState.stats, str: 30 };
    expect(request({ stats }).limits.maxLevels).toBe(50);
    expect(request({ stats, plannedStats: { str: 40 } }).limits.maxLevels).toBe(50);
    // (a respec frees 16 levels, which the optimizer counts from the plan)
    expect(request({ stats, plannedStats: { str: 14 } }).limits.maxLevels).toBe(66);
  });

  it("drops the limits fast mode can't apply", () => {
    const limits = {
      ...defaultAppState.limits,
      minGain: { enabled: true, value: 2, relative: false },
      targetValue: { enabled: true, value: 600 },
    };
    expect(request({ limits }).limits).toMatchObject({ minGainPerLevel: 2, targetValue: 600 });
    expect(request({ limits, fastMode: true }).limits).toMatchObject({
      minGainPerLevel: null,
      targetValue: null,
    });
  });

  it("starts from the plan, with the current level", () => {
    const { startLevel, currentLevel, attributes } = request({ plannedStats: { str: 20 } });
    expect(startLevel - currentLevel!).toBe(6);
    expect(attributes.str).toBe(20);
  });
});
