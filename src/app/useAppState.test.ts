import { describe, expect, it } from "vitest";
import { AttackPowerType } from "../calculator/attackPowerTypes.ts";
import type { Pin } from "./pins.ts";
import { ashAttack, fixedSkillsChoice } from "./useAshes.ts";
import { defaultAppState, parseStoredAppState } from "./useAppState.ts";

const parse = (stored: unknown) => parseStoredAppState(JSON.stringify(stored));

const pin = (extra: Partial<Pin> = {}) => ({
  id: "a",
  weaponName: "Uchigatana",
  attack: "R1",
  ashOfWar: "",
  upgradeLevel: 25,
  twoHanding: false,
  label: "R1",
  ...extra,
});

describe("saved settings", () => {
  it("uses the defaults when nothing is saved or it can't be read", () => {
    expect(parseStoredAppState(null)).toEqual(defaultAppState);
    expect(parseStoredAppState("{")).toEqual(defaultAppState);
    expect(parseStoredAppState("null")).toEqual(defaultAppState);
  });

  it("gets back what this version saves", () => {
    const saved = {
      ...defaultAppState,
      stats: { ...defaultAppState.stats, strength: 40 },
      selectedWeapons: ["Dagger", "Longsword"],
      attacks: ["R1", "R2"],
      ashesOfWar: [fixedSkillsChoice, "Bloody Slash"],
      upgradeLevels: [10, 25],
      grips: ["1h", "2h"],
      plannedStats: { dexterity: 50 },
      pins: [pin()],
      chartWeapons: ["pin:a"],
      sortBy: `status:${AttackPowerType.BLEED}`,
    };
    expect(parse(saved)).toEqual(saved);
  });

  it("fills in settings added since they were saved", () => {
    const { defenses: _, physicalNegation: __, ...old } = defaultAppState;
    const state = parse({
      ...old,
      defenses: { [AttackPowerType.FIRE]: { defense: 80, negation: 20 } },
      weaponFilters: { baseGameOnly: true },
      tooltipTimings: {},
      chainLimit: {},
    });
    expect(state.defenses[AttackPowerType.FIRE]).toEqual({ defense: 80, negation: 20 });
    expect(state.defenses[AttackPowerType.PHYSICAL]).toEqual(
      defaultAppState.defenses[AttackPowerType.PHYSICAL],
    );
    expect(state.physicalNegation).toEqual(defaultAppState.physicalNegation);
    expect(state.weaponFilters).toEqual({ ...defaultAppState.weaponFilters, baseGameOnly: true });
    expect(state.tooltipTimings).toEqual(defaultAppState.tooltipTimings);
    expect(state.chainLimit).toEqual(defaultAppState.chainLimit);
  });

  it("drops sort columns that are gone", () => {
    expect(parse({ sortBy: "bestClass" }).sortBy).toBe(defaultAppState.sortBy);
    expect(parse({ sortBy: "scaling:str" }).sortBy).toBe("scaling:str");
  });

  it("drops planned stats saved as 0", () => {
    expect(parse({ plannedStats: { strength: 0, dexterity: 40 } }).plannedStats).toEqual({
      dexterity: 40,
    });
  });

  it("splits Great Arrows and Radahn's Spears, once one choice", () => {
    expect(
      parse({ selectedAmmo: ["arrow:Arrow", "greatarrow:Great Arrow/Radahn's Spear"] })
        .selectedAmmo,
    ).toEqual(["arrow:Arrow", "greatarrow:Great Arrow", "greatarrow:Radahn's Spear"]);
  });

  it("moves the Twinbird Kite Shield to the passives, in buffs and buff setups", () => {
    const twinbird = ["talisman:Axe Talisman", "weaponEffect:Twinbird Kite Shield"];
    const moved = ["talisman:Axe Talisman", "offhand:Twinbird Kite Shield"];
    const state = parse({
      buffs: twinbird,
      buffSetups: [{ ...defaultAppState, name: "Low HP", buffs: twinbird }],
    });
    expect(state.buffs).toEqual(moved);
    expect(state.buffSetups[0].buffs).toEqual(moved);
  });
});

describe("saved limits", () => {
  const { limits } = defaultAppState;

  it("keeps the level limit, filling in values it doesn't have", () => {
    const maxLevels = { enabled: false, mode: "absolute", values: { absolute: 150 } };
    expect(parse({ limits: { maxLevels } }).limits.maxLevels).toEqual({
      enabled: false,
      mode: "absolute",
      values: { ...limits.maxLevels.values, absolute: 150 },
    });
  });

  it("converts the earlier level limit", () => {
    expect(
      parse({ limits: { maxLevels: { enabled: true, value: 30, absolute: false } } }).limits
        .maxLevels,
    ).toEqual({
      enabled: true,
      mode: "additional",
      values: { ...limits.maxLevels.values, additional: 30 },
    });
    expect(
      parse({ limits: { maxLevels: { enabled: true, value: 120, absolute: true } } }).limits
        .maxLevels,
    ).toEqual({
      enabled: true,
      mode: "absolute",
      values: { ...limits.maxLevels.values, absolute: 120 },
    });
  });

  it("converts the earlier rune budget limit", () => {
    expect(
      parse({
        limits: {
          maxLevels: { enabled: false, value: 30, absolute: false },
          runeBudget: { enabled: true, value: 250000 },
        },
      }).limits.maxLevels,
    ).toEqual({
      enabled: true,
      mode: "runes",
      values: { ...limits.maxLevels.values, additional: 30, runes: 250000 },
    });
  });

  it("fills in limits added since, and drops ones that are gone", () => {
    const state = parse({ limits: { minGain: { enabled: true, value: 5 }, oldLimit: {} } });
    expect(state.limits).toEqual({
      ...limits,
      minGain: { ...limits.minGain, enabled: true, value: 5 },
    });
  });
});

describe("saved attacks", () => {
  it("converts the earlier single attack", () => {
    const state = parse({ attack: "R2", upgradeLevel: 20 });
    expect(state).toMatchObject({ attacks: ["R2"], ashesOfWar: [], upgradeLevels: [20] });
    expect(state).not.toHaveProperty("attack");
    expect(state).not.toHaveProperty("upgradeLevel");
  });

  it("converts the earlier skill attack, with its Ash of War", () => {
    expect(parse({ attack: ashAttack, ashOfWar: "Bloody Slash" })).toMatchObject({
      attacks: [],
      ashesOfWar: [fixedSkillsChoice, "Bloody Slash"],
    });
    expect(parse({ attack: ashAttack })).toMatchObject({
      attacks: [],
      ashesOfWar: [fixedSkillsChoice],
    });
  });

  it("goes back to R1 for the earlier custom and base attacks", () => {
    expect(parse({ attack: "custom" }).attacks).toEqual(["R1"]);
    expect(parse({ attack: "base" }).attacks).toEqual(["R1"]);
  });

  it("renames mounted attacks", () => {
    expect(parse({ attack: "Mounted R1" }).attacks).toEqual(["Mounted R1/L1"]);
    expect(parse({ attacks: ["Mounted R2", "R1", "custom", ashAttack] }).attacks).toEqual([
      "Mounted R2/L2",
      "R1",
    ]);
  });

  it("uses the default upgrade level when none was saved", () => {
    expect(parse({}).upgradeLevels).toEqual(defaultAppState.upgradeLevels);
  });
});

describe("saved pins", () => {
  it("drops what isn't a pin", () => {
    expect(parse({ pins: [pin(), null, { id: "b" }] }).pins).toEqual([pin()]);
    expect(parse({ pins: "pins" }).pins).toEqual([]);
  });

  it("gives pins from before several upgrade levels the level they were frozen at", () => {
    const { upgradeLevel: _, ...old } = pin();
    const frozen = {
      ...old,
      frozen: { request: { weapon: "Uchigatana", regularUpgradeLevel: 18 }, settings: {} },
    };
    expect(parse({ pins: [frozen], upgradeLevel: 20 }).pins[0].upgradeLevel).toBe(18);
  });

  it("gives live pins from then the upgrade level picked then", () => {
    const { upgradeLevel: _, ...old } = pin();
    expect(parse({ pins: [old], upgradeLevel: 20 }).pins[0].upgradeLevel).toBe(20);
    expect(parse({ pins: [old] }).pins[0].upgradeLevel).toBe(defaultAppState.upgradeLevels[0]);
  });

  it("gives pins from before both grips could be compared the grip they had", () => {
    const { twoHanding: _, ...old } = pin();
    const frozen = {
      ...old,
      frozen: { request: { weapon: "Uchigatana", twoHanding: true }, settings: {} },
    };
    expect(parse({ pins: [frozen] }).pins[0].twoHanding).toBe(true);
    expect(parse({ pins: [old], twoHanding: true }).pins[0].twoHanding).toBe(true);
    expect(parse({ pins: [old] }).pins[0].twoHanding).toBe(false);
  });
});

describe("saved grips", () => {
  it("reads the two handing setting earlier versions saved", () => {
    expect(parse({ twoHanding: true }).grips).toEqual(["2h"]);
    expect(parse({ twoHanding: false }).grips).toEqual(["1h"]);
    expect(parse({ twoHanding: true })).not.toHaveProperty("twoHanding");
  });

  it("never has no grip", () => {
    expect(parse({ grips: [] }).grips).toEqual(defaultAppState.grips);
  });
});
