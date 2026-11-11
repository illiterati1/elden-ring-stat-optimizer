import { stepValue } from "../app/NumberTextField.tsx";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import getWeaponAttack, {
  allAttributes,
  allDamageTypes,
  AttackPowerType,
  type Attributes,
  type Weapon,
} from "../calculator/calculator.ts";
import { decodeRegulationData } from "../regulationData.ts";
import { allPhysicalTypes, getDamageAfterDefense, getDefenseMultiplier } from "./defense.ts";
import { applyLimits, type Limits } from "./limits.ts";
import { getCumulativeLevelUpCosts, getLevelUpCost } from "./runes.ts";
import { getCharacterLevel, startingClasses } from "./startingClasses.ts";
import { getAmmoLabel, withAmmo, type AmmoGroup } from "../app/useAmmo.ts";
import {
  canTwoHand,
  getAttackData,
  withOffhandRows,
  type AttackChoice,
  type Movesets,
} from "../app/useMovesets.ts";
import {
  describeBuff,
  getBuffEffects,
  getHpStops,
  isWeaponOnlyBuff,
  type Buff,
} from "../app/useBuffs.ts";
import {
  getAshAttack,
  getAshAttacks,
  getAshChoices,
  getSkillUpkeep,
  withFollowUp,
  type Ashes,
} from "../app/useAshes.ts";
import type { AttackData, BuildRequest } from "./build.ts";
import { getDamage } from "./optimizer.ts";
import { getEquipWeightRate, optimizeBuild, type BuffEffect } from "./build.ts";
import {
  evaluateObjective,
  getBreakdown,
  optimizeAttributes,
  type Objective,
  type OptimizeOptions,
} from "./optimizer.ts";

const weapons = decodeRegulationData(
  JSON.parse(
    readFileSync(new URL("../../public/regulation-vanilla-v1.17.js", import.meta.url), "utf8"),
  ),
);

/** A single hit with 100 motion values, i.e. the weapon's plain attack power */
function plainHit(movesets: Movesets, weapon: Weapon): AttackData {
  const moveset = movesets[weapon.weaponName];
  return {
    steps: [
      [
        {
          motionValue: 100,
          statusMotionValue: 100,
          poiseMotionValue: 100,
          physicalType: allPhysicalTypes[moveset.type] ?? "standard",
        },
      ],
    ],
    weights: [1],
    poiseBase: moveset.poise,
  };
}

function getWeapon(name: string) {
  const weapon = weapons.find((weapon) => weapon.name === name);
  if (!weapon) throw new Error(`No weapon named ${name}`);
  return weapon;
}

const noBonus: Attributes = { str: 0, dex: 0, int: 0, fai: 0, arc: 0 };
const noLimits: Limits = {
  maxLevels: null,
  minGainPerLevel: null,
  minRelativeGainPerLevel: null,
  runeBudget: null,
  targetValue: null,
};
const defenses = Object.fromEntries(
  [0, 1, 2, 3, 4].map((damageType) => [damageType, { defense: 120, negation: 10 }]),
);

/**
 * Best objective value with at most n levels, by trying every allocation
 */
function bruteForce(options: OptimizeOptions, maxLevels: number) {
  const best = new Array<number>(maxLevels + 1).fill(-Infinity);
  function search(i: number, spent: number, attributes: Attributes) {
    if (i === allAttributes.length) {
      best[spent] = Math.max(best[spent], evaluateObjective(options, attributes)!);
      return;
    }
    const attribute = allAttributes[i];
    for (let add = 0; spent + add <= maxLevels && attributes[attribute] + add <= 99; add++) {
      search(i + 1, spent + add, { ...attributes, [attribute]: attributes[attribute] + add });
    }
  }
  search(0, 0, options.attributes);
  for (let n = 1; n <= maxLevels; n++) best[n] = Math.max(best[n], best[n - 1]);
  return best;
}

describe("getLevelUpCost", () => {
  it("matches known rune costs", () => {
    expect(getLevelUpCost(1)).toBe(673);
    expect(getLevelUpCost(2)).toBe(689);
    expect(getLevelUpCost(3)).toBe(706);
  });
});

describe("getDefenseMultiplier", () => {
  it("is continuous between 0.1 and 0.9", () => {
    for (const ratio of [0.125, 1, 2.5, 8]) {
      expect(getDefenseMultiplier(ratio - 1e-9)).toBeCloseTo(getDefenseMultiplier(ratio), 4);
    }
    expect(getDefenseMultiplier(0)).toBe(0.1);
    expect(getDefenseMultiplier(1)).toBeCloseTo(0.4, 3);
    expect(getDefenseMultiplier(2.5)).toBeCloseTo(0.7);
    expect(getDefenseMultiplier(100)).toBe(0.9);
  });

  it("applies motion value before comparing attack to defense", () => {
    const defense = { defense: 100, negation: 20 };
    // 150 AR at 200% MV is 300 attack, 3x defense
    expect(getDamageAfterDefense(150, defense, 200)).toBeCloseTo(
      300 * getDefenseMultiplier(3) * 0.8,
    );
    expect(getDamageAfterDefense(150, defense)).toBeCloseTo(150 * getDefenseMultiplier(1.5) * 0.8);
  });
});

describe("optimizeAttributes", () => {
  const cases: [string, Objective, Partial<OptimizeOptions>][] = [
    ["Uchigatana", "totalAttack", {}],
    ["Heavy Greatsword", "totalAttack", { twoHanding: true }],
    ["Quality Claymore", AttackPowerType.PHYSICAL, { defenses }],
    ["Sword of Night and Flame", "totalAttack", { defenses }],
    ["Sword of Night and Flame", AttackPowerType.FIRE, {}],
    ["Rivers of Blood", "totalAttack", { defenses }],
    ["Golden Order Flail", "totalAttack", {}],
    ["Fire Knight's Fire Greatsword", "totalAttack", { defenses, twoHanding: true }],
    ["Madding Hand", "totalAttack", { defenses }],
    ["Bloody Helice", "totalAttack", { defenses, motionValue: 160 }],
    ["Glintstone Staff", "spellScaling", {}],
    ["Erdtree Seal", "spellScaling", {}],
    ["Flame Art Longsword", "totalAttack", { defenses, bonusAttributes: { ...noBonus, fai: 5 } }],
  ];

  for (const [name, objective, overrides] of cases) {
    it(`finds the best allocation for ${name} (${objective})`, () => {
      const weapon = getWeapon(name);
      // Start just below the requirements, so meeting them is part of the problem
      const attributes = { str: 10, dex: 10, int: 10, fai: 10, arc: 10 };
      for (const attribute of allAttributes) {
        const requirement = weapon.requirements[attribute];
        if (requirement) attributes[attribute] = Math.max(8, requirement - 3);
      }

      const options: OptimizeOptions = {
        weapon,
        upgradeLevel: weapon.attack.length - 1,
        twoHanding: false,
        attributes,
        bonusAttributes: noBonus,
        objective,
        ...overrides,
      };

      const curve = optimizeAttributes(options)!;
      const expected = bruteForce(options, 10);
      for (let n = 0; n <= 10; n++) {
        expect(curve.values[n]).toBeCloseTo(expected[n], 6);
        expect(evaluateObjective(options, curve.allocations[n])).toBeCloseTo(curve.values[n], 6);
      }
    });
  }

  it("finds the best allocation at every level for a two-attribute weapon", () => {
    const options: OptimizeOptions = {
      weapon: getWeapon("Keen Uchigatana"),
      upgradeLevel: 25,
      twoHanding: true,
      attributes: { str: 12, dex: 15, int: 9, fai: 8, arc: 8 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses,
    };
    const curve = optimizeAttributes(options)!;

    const expected = new Array<number>(curve.values.length).fill(-Infinity);
    for (let str = 12; str <= 99; str++) {
      for (let dex = 15; dex <= 99; dex++) {
        const n = str - 12 + dex - 15;
        const value = evaluateObjective(options, { ...options.attributes, str, dex })!;
        expected[n] = Math.max(expected[n], value);
      }
    }
    for (let n = 1; n < expected.length; n++) expected[n] = Math.max(expected[n], expected[n - 1]);

    expect(curve.values).toHaveLength(expected.length);
    curve.values.forEach((value, n) => expect(value).toBeCloseTo(expected[n], 6));
  });

  it("doesn't apply spell scaling to non-catalysts", () => {
    expect(
      optimizeAttributes({
        weapon: getWeapon("Uchigatana"),
        upgradeLevel: 25,
        twoHanding: false,
        attributes: { str: 10, dex: 10, int: 10, fai: 10, arc: 10 },
        bonusAttributes: noBonus,
        objective: "spellScaling",
      }),
    ).toBeNull();
  });
});

describe("applyLimits", () => {
  // A requirement jump at level 5, then diminishing returns
  const values = [100, 100, 100, 100, 100, 160, 170, 178, 184, 188, 190, 191, 191, 191];

  it("stops at the level limit", () => {
    expect(applyLimits(values, 50, { ...noLimits, maxLevels: 7 })).toMatchObject({
      levels: 7,
      reason: "maxLevels",
    });
  });

  it("doesn't spend levels that don't help", () => {
    expect(applyLimits(values, 50, noLimits)).toMatchObject({ levels: 11, reason: "maxedOut" });
    expect(applyLimits(values, 50, { ...noLimits, maxLevels: 3 })).toMatchObject({ levels: 0 });
  });

  it("judges a requirement jump by its average gain", () => {
    // 60 AR over 5 levels is 12/level, so it's worth it at a minimum of 10.5/level
    expect(applyLimits(values, 50, { ...noLimits, minGainPerLevel: 10.5 })).toMatchObject({
      levels: 5,
      reason: "minGainPerLevel",
    });
    expect(applyLimits(values, 50, { ...noLimits, minGainPerLevel: 7 })).toMatchObject({
      levels: 7,
    });
  });

  it("supports relative gain limits", () => {
    // 170 -> 178 is 4.7%, 178 -> 184 is 3.4%
    expect(applyLimits(values, 50, { ...noLimits, minRelativeGainPerLevel: 4 })).toMatchObject({
      levels: 7,
      reason: "minRelativeGainPerLevel",
    });
  });

  it("reports no further gain when maxed out before a limit applies", () => {
    const flat = [100, 110, 120, 125, 125, 125];
    expect(applyLimits(flat, 50, { ...noLimits, minGainPerLevel: 1 })).toMatchObject({
      levels: 3,
      reason: "maxedOut",
    });
    expect(applyLimits(flat, 50, { ...noLimits, runeBudget: 1e9 })).toMatchObject({
      levels: 3,
      reason: "maxedOut",
    });
  });

  it("stops within the rune budget", () => {
    // Levels 50 -> 57 cost a little under 150,000 runes, and 50 -> 58 a little over
    const costs = [0];
    for (let level = 50; level < 60; level++) costs.push(costs.at(-1)! + getLevelUpCost(level));
    const budget = (costs[7] + costs[8]) / 2;
    expect(applyLimits(values, 50, { ...noLimits, runeBudget: budget })).toMatchObject({
      levels: 7,
      runes: costs[7],
      reason: "runeBudget",
    });
  });

  it("stops once the target value is reached", () => {
    expect(applyLimits(values, 50, { ...noLimits, targetValue: 175 })).toMatchObject({
      levels: 7,
      reason: "targetValue",
    });
    // An unreachable target doesn't stop anything
    expect(applyLimits(values, 50, { ...noLimits, targetValue: 500 })).toMatchObject({
      levels: 11,
      reason: "maxedOut",
    });
  });
});

describe("getBreakdown", () => {
  const cases: [string, Objective, Partial<OptimizeOptions>][] = [
    ["Sword of Night and Flame", "totalAttack", { defenses, twoHanding: true }],
    [
      "Heavy Greatsword",
      "totalAttack",
      { attributes: { str: 10, dex: 10, int: 10, fai: 10, arc: 10 } },
    ],
    ["Erdtree Seal", "spellScaling", { bonusAttributes: { ...noBonus, fai: 5 } }],
  ];

  for (const [name, objective, overrides] of cases) {
    it(`adds up to the objective for ${name} (${objective})`, () => {
      const weapon = getWeapon(name);
      const options: OptimizeOptions = {
        weapon,
        upgradeLevel: weapon.attack.length - 1,
        twoHanding: false,
        attributes: { str: 30, dex: 30, int: 30, fai: 30, arc: 30 },
        bonusAttributes: noBonus,
        objective,
        ...overrides,
      };
      const rows = getBreakdown(options, options.attributes);
      for (const row of rows) {
        const sum = Object.values(row.attributes).reduce((a, b) => a + b, row.base);
        expect(sum).toBeCloseTo(row.total, 9);
      }
      // Spell scaling is the best school; AR objectives are the sum over damage types
      const value =
        objective === "spellScaling"
          ? Math.max(...rows.map((row) => row.total))
          : rows.reduce((sum, row) => sum + (row.damage ?? row.total), 0);
      expect(value).toBeCloseTo(evaluateObjective(options, options.attributes)!, 9);
    });
  }

  it("shows every damage type when maximizing one of them", () => {
    const weapon = getWeapon("Sword of Night and Flame");
    const options: OptimizeOptions = {
      weapon,
      upgradeLevel: 10,
      twoHanding: false,
      attributes: { str: 30, dex: 30, int: 30, fai: 30, arc: 30 },
      bonusAttributes: noBonus,
      objective: AttackPowerType.FIRE,
      defenses,
    };
    const rows = getBreakdown(options, options.attributes);
    expect(rows.map((row) => row.damageType)).toEqual([
      AttackPowerType.PHYSICAL,
      AttackPowerType.MAGIC,
      AttackPowerType.FIRE,
    ]);
    const maximized = rows.filter((row) => row.maximized);
    expect(maximized).toHaveLength(1);
    expect(maximized[0].damage).toBeCloseTo(evaluateObjective(options, options.attributes)!, 9);
  });

  it("shows the requirement penalty", () => {
    const weapon = getWeapon("Heavy Greatsword");
    const [physical] = getBreakdown(
      {
        weapon,
        upgradeLevel: 25,
        twoHanding: false,
        attributes: { str: 10, dex: 10, int: 10, fai: 10, arc: 10 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
      },
      { str: 10, dex: 10, int: 10, fai: 10, arc: 10 },
    );
    expect(physical.penalized).toBe(true);
    expect(physical.base).toBeCloseTo(weapon.attack[25][AttackPowerType.PHYSICAL]! * 0.6);
    expect(physical.attributes).toEqual({});
  });
});

describe("optimizeBuild", () => {
  const request = {
    weapon: getWeapon("Sword of Night and Flame"),
    regularUpgradeLevel: 25,
    twoHanding: false,
    startLevel: 9,
    attributes: { str: 14, dex: 13, int: 9, fai: 9, arc: 7 },
    bonusAttributes: noBonus,
    objective: AttackPowerType.MAGIC,
    limits: { ...noLimits, maxLevels: 30 },
  };

  it("levels to meet requirements first when asked", () => {
    const result = optimizeBuild({ ...request, meetRequirements: true });
    expect(result.ineffectiveAttributes).toEqual([]);
    // Fire scaling needs Faith 24, which doesn't help magic damage
    expect(result.attributes.fai).toBeGreaterThanOrEqual(24);
    expect(result.levels).toBe(30);
    expect(result.finalLevel).toBe(39);
  });

  it("can ignore requirements that don't help the objective", () => {
    const result = optimizeBuild({ ...request, meetRequirements: false });
    expect(result.attributes.fai).toBe(9);
    expect(result.ineffectiveAttributes).toContain("fai");
  });

  it("counts two handing Strength when meeting requirements", () => {
    const weapon = getWeapon("Sword of Night and Flame");
    const wretch = { str: 10, dex: 10, int: 10, fai: 10, arc: 10 };
    // Requirements are 12 Str, 12 Dex, 24 Int, 24 Fai. Two handed, 10 Str counts as 15.
    const result = optimizeBuild({
      ...request,
      weapon,
      twoHanding: true,
      startLevel: 1,
      attributes: wretch,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 30 },
      meetRequirements: true,
    });
    expect(result.levels).toBe(30);
    expect(result.attributes).toEqual({ str: 10, dex: 12, int: 24, fai: 24, arc: 10 });
    expect(result.effectiveAttributes.str).toBe(15);
    // The curve starts after the levels spent meeting requirements
    expect(result.curve.startLevel).toBe(31);
    expect(result.curve.values[0]).toBeCloseTo(result.finalValue);
  });

  it("starts from planned stats above the current level", () => {
    const vagabond = { str: 14, dex: 13, int: 9, fai: 9, arc: 7 };
    const base = {
      ...request,
      weapon: getWeapon("Uchigatana"),
      attributes: vagabond,
      objective: "totalAttack" as const,
      // The plan has 10 more Vigor than the current level 9 character
      startLevel: 19,
      currentLevel: 9,
    };
    // A limit of 30 levels from the current level is 20 from the plan
    const result = optimizeBuild({ ...base, limits: { ...noLimits, maxLevels: 20 } });
    expect(result.levels).toBe(30);
    expect(result.finalLevel).toBe(39);
    expect(result.curve.startLevel).toBe(19);
    const damageLevels = Object.values(result.attributes).reduce((a, b) => a + b, 0) - 52;
    expect(damageLevels).toBe(20);
    expect(result.runes).toBe(getCumulativeLevelUpCosts(9, 30).at(-1));

    // The rune budget includes the levels for the plan too
    const budget = optimizeBuild({ ...base, limits: { ...noLimits, runeBudget: result.runes } });
    expect(budget.levels).toBe(30);
  });

  it("spends levels freed by a respec without runes", () => {
    const vagabond = { str: 14, dex: 13, int: 9, fai: 9, arc: 7 };
    const result = optimizeBuild({
      ...request,
      weapon: getWeapon("Uchigatana"),
      attributes: vagabond,
      objective: "totalAttack",
      // The plan respecs 5 levels out of Vigor, back to level 4
      startLevel: 4,
      currentLevel: 9,
      limits: { ...noLimits, maxLevels: 5 },
    });
    expect(result.finalLevel).toBe(9);
    expect(result.levels).toBe(0);
    expect(result.runes).toBe(0);
    const damageLevels = Object.values(result.attributes).reduce((a, b) => a + b, 0) - 52;
    expect(damageLevels).toBe(5);
  });

  it("reports status buildup with the final stats", () => {
    const result = optimizeBuild({
      ...request,
      weapon: getWeapon("Rivers of Blood"),
      attributes: { str: 12, dex: 18, int: 9, fai: 9, arc: 20 },
      objective: "totalAttack",
    });
    expect(Object.keys(result.statusBuildup).map(Number)).toEqual([AttackPowerType.BLEED]);
    // Rivers of Blood's bleed scales with Arcane
    const { attackPower } = getWeaponAttack({
      weapon: getWeapon("Rivers of Blood"),
      attributes: result.attributes,
      twoHanding: false,
      upgradeLevel: 10,
    });
    expect(result.statusBuildup[AttackPowerType.BLEED]).toBeCloseTo(
      attackPower[AttackPowerType.BLEED]!,
    );
  });

  it("takes required levels even past the level limit", () => {
    const result = optimizeBuild({
      ...request,
      limits: { ...noLimits, maxLevels: 5 },
      meetRequirements: true,
    });
    expect(result.ineffectiveAttributes).toEqual([]);
    expect(result.levels).toBeGreaterThan(5);
    expect(result.reason).toBe("maxLevels");
  });
});

describe("startingClasses", () => {
  it("match the starting levels in the game data", () => {
    // Levels from CharaInitParam rows 3000-3011
    const levels = {
      Vagabond: 9,
      Warrior: 8,
      Hero: 7,
      Bandit: 5,
      Astrologer: 6,
      Prophet: 7,
      Samurai: 9,
      Prisoner: 9,
      Confessor: 10,
      Wretch: 1,
      "Idus Knight": 7,
      "Heavy Knight": 10,
    };
    for (const [name, level] of Object.entries(levels)) {
      expect(getCharacterLevel(startingClasses[name as keyof typeof startingClasses])).toBe(level);
    }
  });
});

describe("bows", () => {
  const ammo: AmmoGroup[] = JSON.parse(
    readFileSync(new URL("../../public/ammo.json", import.meta.url), "utf8"),
  );
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const shoot = (bowName: string, arrowName: string) => {
    const group = ammo.find((group) => group.names.includes(arrowName))!;
    const bow = withAmmo(getWeapon(bowName), group);
    const { attackPower } = getWeaponAttack({
      weapon: bow,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      twoHanding: true,
      upgradeLevel: bow.attack.length - 1,
    });
    return {
      attackPower,
      damage: allDamageTypes.reduce<number>(
        (total, damageType) =>
          total +
          (attackPower[damageType]
            ? getDamageAfterDefense(attackPower[damageType]!, { defense: 123.2, negation: 0 })
            : 0),
        0,
      ),
    };
  };

  it("times a Longbow's shot", () => {
    // Tested in game at 60 fps: a Longbow's shot hits 65 frames after the press at point blank
    const shot = getAttackData(movesets, getWeapon("Longbow"), "Standard Shot", true, 0.5)!;
    expect(Math.round(shot.stepTimes![0].hits[0] * 60)).toBe(65);
    // Its release can be cancelled into the next shot 36 frames in (99 from the press: tested on
    // the Black Bow, which hits 65 frames after the press too)
    expect(Math.round(shot.cycleTimes![0] * 60)).toBe(99);
    // A Shortbow's hits 50 frames after the press, then every 73
    const short = getAttackData(movesets, getWeapon("Shortbow"), "Standard Shot", true, 0.5)!;
    expect(Math.round(short.stepTimes![0].hits[0] * 60)).toBe(50);
    expect(Math.round(short.cycleTimes![0] * 60)).toBe(73);
    // Its jump shot then landing shot: 96% and 100%, a pair every 116 frames, the landing shot 56.5
    // after the jump shot
    const pair = getAttackData(
      movesets,
      getWeapon("Shortbow"),
      "Jump Shot + Landing Shot",
      true,
      0.5,
    )!;
    expect(pair.steps[0].map((hit) => hit.motionValue)).toEqual([96, 100]);
    expect(Math.round(pair.cycleTimes![0] * 60)).toBe(116);
    const [jumpHit, landingHit] = pair.stepTimes![0].hits;
    expect(Math.round(jumpHit * 60)).toBe(33);
    expect(Math.round((landingHit - jumpHit) * 60 * 2) / 2).toBe(56.5);
    // A Greatbow's hits 155 frames after the press, then every 220
    const great = getAttackData(movesets, getWeapon("Greatbow"), "Standard Shot", true, 0.5)!;
    expect(Math.round(great.stepTimes![0].hits[0] * 60)).toBe(155);
    expect(Math.round(great.cycleTimes![0] * 60)).toBe(220);
    // An unloaded Heavy Crossbow's hits 75 frames after the press, then every 110.5
    const crossbow = getAttackData(
      movesets,
      getWeapon("Heavy Crossbow"),
      "Standard Shot",
      true,
      0.5,
    )!;
    expect(Math.round(crossbow.stepTimes![0].hits[0] * 60)).toBe(75);
    expect(crossbow.cycleTimes![0] * 60).toBeCloseTo(110.5);
    // The Pulley Crossbow's 3 bolts 10 frames apart, the first 78 after the press, then every 118.5
    const pulley = getAttackData(
      movesets,
      withAmmo(getWeapon("Pulley Crossbow"), ammo.find((group) => group.names.includes("Bolt"))!),
      "Standard Shot",
      true,
      0.5,
    )!;
    expect(pulley.stepTimes![0].hits.map((time) => Math.round(time * 60))).toEqual([78, 88, 98]);
    expect(pulley.cycleTimes![0] * 60).toBeCloseTo(118.5);
    // The Spread Crossbow's 95 then every 137.5, the Repeating Crossbow's 74 then every 111
    for (const [name, first, cycle] of [
      ["Spread Crossbow", 95, 137.5],
      ["Repeating Crossbow", 74, 111],
    ] as const) {
      const shot = getAttackData(movesets, getWeapon(name), "Standard Shot", true, 0.5)!;
      expect(Math.round(shot.stepTimes![0].hits[0] * 60)).toBe(first);
      expect(shot.cycleTimes![0] * 60).toBeCloseTo(cycle);
    }
    // The Jar Cannon's 85 frames after its R2, then every 263.5 (measured in game: 406, then 491,
    // 755, and 1018), each shot costing its ammunition's 40 stamina times its 1.12
    const jarCannon = getAttackData(
      movesets,
      withAmmo(
        getWeapon("Jar Cannon"),
        ammo.find((group) => group.names.includes("Ballista Bolt"))!,
      ),
      "Standard Shot",
      true,
      0.5,
    )!;
    expect(Math.round(jarCannon.stepTimes![0].hits[0] * 60)).toBe(85);
    expect(jarCannon.cycleTimes![0] * 60).toBeCloseTo(263.5);
    expect(jarCannon.stamina).toEqual([44.8]);
    // A Longbow's shot with Arrows costs 13
    const arrowShot = getAttackData(
      movesets,
      withAmmo(getWeapon("Longbow"), ammo.find((group) => group.names.includes("Arrow"))!),
      "Standard Shot",
      true,
      0.5,
    )!;
    expect(arrowShot.stamina).toEqual([13]);
    // The Black Bow and Ansbach's Longbow (light bows' moveset) can do it too
    expect(
      getAttackData(movesets, getWeapon("Black Bow"), "Jump Shot + Landing Shot", true, 0.5),
    ).toBeDefined();
    // Only light bows
    expect(
      getAttackData(movesets, getWeapon("Longbow"), "Jump Shot + Landing Shot", true, 0.5),
    ).toBeUndefined();
  });

  it("matches bows' jumping shots in game", () => {
    // Tested in game at +25 with 99 in every stat: a Longbow's shot does 309 with Arrows, its
    // jumping shot 293 (0.96 times the attack power, from its jumping animations' SpEffect 436)
    const { attackPower } = shoot("Longbow", "Arrow");
    const jumping = getAttackData(movesets, getWeapon("Longbow"), "Jumping R1", true, 0.5)!;
    const motionValue = jumping.steps[0][0].motionValue;
    const damage = (rate: number) =>
      Math.floor(
        getDamageAfterDefense((attackPower[AttackPowerType.PHYSICAL]! * rate) / 100, {
          defense: 123.2,
          negation: 0,
        }),
      );
    expect([damage(100), damage(motionValue)]).toEqual([309, 293]);
    // Greatbows have none
    expect(getAttackData(movesets, getWeapon("Greatbow"), "Jumping R1", true, 0.5)).toBeUndefined();
  });

  it("matches Mighty Shot in game", () => {
    // Tested in game at +25 with 99 in every stat: a Longbow's Mighty Shot with Arrows does 529 (its
    // 153% of the shot's attack)
    const { attackPower } = shoot("Longbow", "Arrow");
    expect(
      Math.floor(
        getDamageAfterDefense((attackPower[AttackPowerType.PHYSICAL]! * 153) / 100, {
          defense: 123.2,
          negation: 0,
        }),
      ),
    ).toBe(529);
  });

  it("matches the Serpent Bow's poison in game", () => {
    // Tested in game at +10 with 99 in every stat: about 243 poison with Serpent Arrows and 40
    // with plain arrows. The bow adds 15 poison to every arrow, and scales poison with its own
    // steeper curve (CalcCorrectGraph 5)
    const poison = (arrowName: string) =>
      shoot("Serpent Bow", arrowName).attackPower[AttackPowerType.POISON] ?? 0;
    expect(poison("Serpent Arrow")).toBeCloseTo(243, -1);
    expect(poison("Arrow")).toBeCloseTo(40, -1);
  });

  it("points out status that only scales with Arcane", () => {
    const build = (bowName: string, arrowName: string) =>
      optimizeBuild({
        weapon: withAmmo(
          getWeapon(bowName),
          ammo.find((group) => group.names.includes(arrowName))!,
        ),
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 20, dex: 20, int: 9, fai: 9, arc: 11 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 40 },
      });
    const serpent = build("Serpent Bow", "Serpent Arrow");
    expect(serpent.attributes.arc).toBe(11);
    expect(serpent.statusAtMaxArcane![AttackPowerType.POISON]).toBeCloseTo(
      shoot("Serpent Bow", "Serpent Arrow").attackPower[AttackPowerType.POISON]!,
    );
    // No status, or none that scales with Arcane
    expect(build("Longbow", "Arrow").statusAtMaxArcane).toBeUndefined();
  });

  it("uses the ammunition's poise", () => {
    // Tested in game: Stormwing Bone Arrows do 5 poise damage from a Longbow, whose own is 2
    const poise = (arrowName: string) =>
      getAttackData(
        movesets,
        withAmmo(getWeapon("Longbow"), ammo.find((group) => group.names.includes(arrowName))!),
        "Standard Shot",
        true,
        0.5,
      )!.poiseBase;
    expect(poise("Stormwing Bone Arrow")).toBe(5);
    expect(poise("Arrow")).toBe(2);
  });

  it("fires three bolts from the Spread Crossbow", () => {
    // Tested in game: about 140 scarlet rot when all three Black-Key Bolts connect (3 × 60 × 80%)
    const weapon = withAmmo(
      getWeapon("Spread Crossbow"),
      ammo.find((group) => group.names.includes("Black-Key Bolt"))!,
    );
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Standard Shot", true, 0.5),
    });
    expect(result.attackSteps![0]).toHaveLength(3);
    expect(result.attackStatus![AttackPowerType.SCARLET_ROT]).toBeCloseTo(144);
    // Bolts are pierce, whatever the crossbow's own type
    expect(result.attackSteps![0][0].physicalType).toBe("pierce");
  });

  it("fires three bolts in quick succession from the Pulley Crossbow", () => {
    const weapon = withAmmo(
      getWeapon("Pulley Crossbow"),
      ammo.find((group) => group.names.includes("Bolt"))!,
    );
    const attack = getAttackData(movesets, weapon, "Standard Shot", true, 0.5)!;
    expect(attack.steps[0].map((hit) => hit.statusMotionValue)).toEqual([100, 100, 100]);
  });

  it("matches the Erdtree Greatbow in game", () => {
    // Tested in game at +10 with 99 in every stat on the training dummy (123.2 defense, no
    // negation)
    expect(Math.floor(shoot("Erdtree Greatbow", "Great Arrow").damage)).toBe(467);
    expect(Math.floor(shoot("Erdtree Greatbow", "Golden Great Arrow").damage)).toBe(524);
  });

  it("gives the Lion Greatbow's bonus to Radahn's Spears after defenses", () => {
    // Tested in game with the same setup: 844, which is ×1.2 damage after defenses (×1.2 attack
    // power would be 859)
    const damageResult = (bowName: string, arrowName: string, defense: number) => {
      const group = ammo.find((group) => group.names.includes(arrowName))!;
      return optimizeBuild({
        weapon: withAmmo(getWeapon(bowName), group),
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: { [AttackPowerType.PHYSICAL]: { defense, negation: 0 } },
        limits: { ...noLimits, maxLevels: 0 },
      });
    };
    const unrounded = (bowName: string, arrowName: string, defense = 123.2) =>
      damageResult(bowName, arrowName, defense).curve.values[0];
    const damage = (bowName: string, arrowName: string, defense = 123.2) =>
      damageResult(bowName, arrowName, defense).finalValue;
    expect(Math.floor(damage("Lion Greatbow", "Radahn's Spear"))).toBe(844);
    // Unrounded, ×1.2 exactly
    expect(unrounded("Lion Greatbow", "Radahn's Spear")).toBeCloseTo(
      unrounded("Lion Greatbow", "Great Arrow") * 1.2,
      1,
    );
    // Only for the Lion Greatbow
    expect(unrounded("Erdtree Greatbow", "Radahn's Spear", 0)).toBeCloseTo(
      unrounded("Erdtree Greatbow", "Great Arrow", 0),
      1,
    );
  });
});

describe("withAmmo", () => {
  it("adds ammunition attack and status to a ranged weapon at every upgrade level", () => {
    const longbow = getWeapon("Longbow");
    const bloodbone: AmmoGroup = {
      class: "arrow",
      names: ["Bloodbone Arrow"],
      attack: { [AttackPowerType.PHYSICAL]: 28 },
      status: { [AttackPowerType.BLEED]: 55 },
    };
    const combined = withAmmo(longbow, bloodbone);
    expect(combined.name).toBe("Longbow (Bloodbone Arrow)");
    combined.attack.forEach((attack, upgradeLevel) => {
      const bow = longbow.attack[upgradeLevel];
      expect(attack[AttackPowerType.PHYSICAL]).toBe((bow[AttackPowerType.PHYSICAL] ?? 0) + 28);
      expect(attack[AttackPowerType.BLEED]).toBe((bow[AttackPowerType.BLEED] ?? 0) + 55);
    });
    // The bow's own data isn't changed
    expect(longbow.attack[0][AttackPowerType.BLEED]).toBeUndefined();

    // The arrow's damage is scaled by the bow
    const stats = { str: 20, dex: 40, int: 10, fai: 10, arc: 10 };
    const bowOnly = getWeaponAttack({ weapon: longbow, attributes: stats, upgradeLevel: 25 });
    const withArrow = getWeaponAttack({ weapon: combined, attributes: stats, upgradeLevel: 25 });
    const scaling =
      bowOnly.attackPower[AttackPowerType.PHYSICAL]! /
      longbow.attack[25][AttackPowerType.PHYSICAL]!;
    expect(withArrow.attackPower[AttackPowerType.PHYSICAL]).toBeCloseTo(
      (longbow.attack[25][AttackPowerType.PHYSICAL]! + 28) * scaling,
    );
  });
});

describe("getAmmoLabel", () => {
  const group = (names: string[]): AmmoGroup => ({ class: "arrow", names, attack: {}, status: {} });

  it("writes a shared ending once", () => {
    expect(
      getAmmoLabel(group(["Piquebone Arrow", "Rainbow Stone Arrow", "Shattershard Arrow"])),
    ).toBe("Piquebone / Rainbow Stone / Shattershard Arrow");
    expect(
      getAmmoLabel(
        group([
          "Piquebone Arrow (Fletched)",
          "Rainbow Stone Arrow (Fletched)",
          "Shattershard Arrow (Fletched)",
        ]),
      ),
    ).toBe("Piquebone / Rainbow Stone / Shattershard Arrow (Fletched)");
  });

  it("keeps names with nothing in common, and single names, as they are", () => {
    expect(getAmmoLabel(group(["Great Arrow", "Radahn's Spear"]))).toBe(
      "Great Arrow / Radahn's Spear",
    );
    expect(getAmmoLabel(group(["Bone Arrow"]))).toBe("Bone Arrow");
  });
});

describe("attacks", () => {
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const longsword = getWeapon("Longsword");

  it("weights chains towards the first hit", () => {
    const r1 = getAttackData(movesets, longsword, "R1", false, 0.5)!;
    expect(r1.steps.map((step) => step.map((hit) => hit.motionValue))).toEqual([
      [100],
      [101],
      [102],
      [103],
      [110],
    ]);
    expect(r1.weights.map((w) => w * 31)).toEqual([16, 8, 4, 2, 1].map((w) => expect.closeTo(w)));

    const r2 = getAttackData(movesets, longsword, "R2", false, 0.5)!;
    expect(r2.weights).toEqual([expect.closeTo(2 / 3), expect.closeTo(1 / 3)]);
    expect(r2.steps.map((step) => step[0].physicalType)).toEqual(["pierce", "standard"]);

    // Two handing uses the two handed attacks
    const r1TwoHanded = getAttackData(movesets, longsword, "R1", true, 0.5)!;
    expect(r1TwoHanded.steps[0][0].motionValue).toBe(103);
  });

  it("optimizes the weighted damage of an attack's hits", () => {
    const attack = getAttackData(movesets, longsword, "R1", false, 0.5)!;
    const result = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      attributes: { str: 14, dex: 13, int: 9, fai: 9, arc: 7 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 30 },
      attack,
    });
    const { attackPower } = getWeaponAttack({
      weapon: longsword,
      attributes: result.attributes,
      upgradeLevel: 25,
    });
    const ar =
      (attackPower[AttackPowerType.PHYSICAL] ?? 0) + (attackPower[AttackPowerType.MAGIC] ?? 0);
    const expected = attack.steps.reduce(
      (total, step, i) => total + (attack.weights[i] * ar * step[0].motionValue) / 100,
      0,
    );
    expect(result.finalValue).toBeCloseTo(expected);
    // Longsword stance is 5, and its R1 stance motion values are 100, 100, 100, 100, 200
    expect(result.attackStance).toBeCloseTo((5 * (16 + 8 + 4 + 2 + 2 * 1)) / 31);
    expect(result.attackSteps!.map((step) => step[0].damage)).toEqual(
      attack.steps.map((step) => expect.closeTo((ar * step[0].motionValue) / 100)),
    );
  });

  it("only shoots with ranged weapons", () => {
    expect(getAttackData(movesets, longsword, "Standard Shot", false, 0.5)).toBeUndefined();
    expect(getAttackData(movesets, getWeapon("Longbow"), "Standard Shot", true, 0.5)).toBeDefined();
  });

  it("weights status buildup across a chain", () => {
    const uchigatana = getWeapon("Uchigatana");
    const request = {
      weapon: uchigatana,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      attributes: { str: 14, dex: 13, int: 9, fai: 9, arc: 7 },
      bonusAttributes: noBonus,
      objective: "totalAttack" as const,
      limits: { ...noLimits, maxLevels: 0 },
    };
    const base = optimizeBuild({
      ...request,
      attack: plainHit(movesets, uchigatana),
    });
    const bleed = base.statusBuildup[AttackPowerType.BLEED]!;
    expect(base.attackStatus![AttackPowerType.BLEED]).toBeCloseTo(bleed);

    const attack: AttackData = {
      steps: [
        [{ motionValue: 100, statusMotionValue: 50, poiseMotionValue: 100, physicalType: "slash" }],
        [
          {
            motionValue: 100,
            statusMotionValue: 100,
            poiseMotionValue: 100,
            physicalType: "slash",
          },
          {
            motionValue: 100,
            statusMotionValue: 100,
            poiseMotionValue: 100,
            physicalType: "slash",
          },
        ],
      ],
      weights: [2 / 3, 1 / 3],
      poiseBase: 5,
    };
    const chain = optimizeBuild({ ...request, attack });
    expect(chain.attackStatus![AttackPowerType.BLEED]).toBeCloseTo(
      (2 / 3) * bleed * 0.5 + (1 / 3) * bleed * 2,
    );
  });

  it("uses motion values for each damage type where they differ", () => {
    // Wing of Astel's R2 projectile is magic only. Tested in game at +10 with 99 in every stat,
    // two handed, on a training dummy with 123.2 defense and no negation: the projectile does 470,
    // and the blade and projectile together 881 (each hit is rounded down)
    const wing = getWeapon("Wing of Astel");
    const attack = getAttackData(movesets, wing, "R2", true, 0.5)!;
    const [blade, projectile] = attack.steps[0];
    expect(projectile.motionValues).toEqual([0, 150, 0, 0, 0]);
    const result = optimizeBuild({
      weapon: wing,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: {
        [AttackPowerType.PHYSICAL]: { defense: 123.2, negation: 0 },
        [AttackPowerType.MAGIC]: { defense: 123.2, negation: 0 },
      },
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack,
    });
    const [bladeHit, projectileHit] = result.attackSteps![0];
    expect(Math.floor(projectileHit.damage)).toBe(470);
    expect(Math.floor(bladeHit.damage) + Math.floor(projectileHit.damage)).toBe(881);
    expect(blade.motionValues).toBeUndefined();
  });

  it("matches Rellana's Twin Blades in game", () => {
    // Tested in game at +10 with 99 in every stat on the training dummy (123.2 defense, no
    // negation). Its one handed attacks and its magic blade have no fire damage.
    const rellana = getWeapon("Rellana's Twin Blades");
    const request = (attack: AttackData, twoHanding = true) =>
      optimizeBuild({
        weapon: rellana,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
      });
    const jumpingR2 = request(getAttackData(movesets, rellana, "Jumping R2", true, 0.5)!);
    expect(Math.floor(jumpingR2.attackSteps![0][0].damage)).toBe(708);

    // Two handed R2s are the one handed ones, with the same damage
    for (const attack of ["R2", "Charged R2"] as const) {
      const damage = (twoHanding: boolean) =>
        request(
          getAttackData(movesets, rellana, attack, twoHanding, 0.5)!,
          twoHanding,
        ).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)));
      expect(damage(true)).toEqual(damage(false));
    }
  });

  it("scales flat attack like base attack", () => {
    // Bloodfiend's Arm's R2 area attack is a flat 50 fire (60 charged), with no motion values.
    // Tested in game at +25 with 99 in every stat on the training dummy (123.2 defense, no
    // negation): Standard does 119 (158 charged), and Flame Art 250 (316 charged).
    const areaDamage = (name: string, attackName: "R2" | "Charged R2") => {
      const weapon = getWeapon(name);
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, getWeapon("Bloodfiend's Arm"), attackName, false, 0.5)!,
      });
      return Math.floor(result.attackSteps![0][1].damage);
    };
    expect(areaDamage("Bloodfiend's Arm", "R2")).toBe(119);
    expect(areaDamage("Bloodfiend's Arm", "Charged R2")).toBe(158);
    expect(areaDamage("Bloodfiend's Flame Art Arm", "R2")).toBe(250);
    expect(areaDamage("Bloodfiend's Flame Art Arm", "Charged R2")).toBe(316);

    // On a Blood affinity, the area attack alone builds up about 144 bleed (187 charged), and a
    // whole R2 (punch and area attack) about 290
    const blood = getWeapon("Bloodfiend's Blood Arm");
    const bleed = (attackName: "R2" | "Charged R2") =>
      optimizeBuild({
        weapon: blood,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, blood, attackName, false, 0.5)!,
      });
    const r2 = bleed("R2");
    expect(r2.attackSteps![0][1].status[AttackPowerType.BLEED]).toBeCloseTo(144, -1);
    expect(r2.attackStatus![AttackPowerType.BLEED]).toBeCloseTo(290, -1);
    const charged = bleed("Charged R2");
    expect(charged.attackSteps![0][1].status[AttackPowerType.BLEED]).toBeCloseTo(187, -1);
  });

  it("leaves out two handing's Strength bonus for hits that don't get it", () => {
    // Tested in game: the Lizard Greatsword's two handed R2 projectile does 328 at +25 with 99 in
    // every stat on the training dummy (340 with the bonus)
    const lizard = getWeapon("Lizard Greatsword");
    const attack = getAttackData(movesets, lizard, "R2", true, 0.5)!;
    expect(attack.steps[0][1].noTwoHandBonus).toBe(true);
    const request = {
      weapon: lizard,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 20, dex: 20, int: 9, fai: 9, arc: 9 },
      bonusAttributes: noBonus,
      objective: "totalAttack" as const,
      defenses: { [AttackPowerType.PHYSICAL]: { defense: 123.2, negation: 0 } },
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      attack,
    };
    const maxed = optimizeBuild({
      ...request,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      limits: { ...noLimits, maxLevels: 0 },
    });
    expect(Math.floor(maxed.attackSteps![0][1].damage)).toBe(328);

    // The optimizer finds the best allocations, with and without defenses, including for hits
    // split between scaling with and without the bonus
    const hits = attack.steps.flatMap((step, i) =>
      step.map((hit) => ({ ...hit, weight: attack.weights[i] })),
    );
    for (const defenses of [undefined, request.defenses]) {
      const options: OptimizeOptions = {
        weapon: lizard,
        upgradeLevel: 25,
        twoHanding: true,
        attributes: { str: 12, dex: 12, int: 9, fai: 9, arc: 9 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses,
        physicalNegation: request.physicalNegation,
        hits,
      };
      const curve = optimizeAttributes(options)!;
      const expected = bruteForce(options, 10);
      for (let n = 0; n <= 10; n++) {
        expect(curve.values[n]).toBeCloseTo(expected[n], 6);
      }
    }
  });

  it("scales flat attack with a hit's own attack element correction", () => {
    // Black Steel Greathammer +25, 99 in every stat, two handed guard counter on the Weeping
    // Peninsula Erdtree Avatar (105.3 defense; 0% strike and 40% holy negation): 148 from the area
    // attack and 964 in total. Its 58 holy scales with Faith at an overwritten 25%
    // (AttackElementCorrectParam 51070), not the weapon's own Faith scaling.
    const weapon = getWeapon("Black Steel Greathammer");
    const defense = 105.3;
    const negation: Partial<Record<AttackPowerType, number>> = {
      0: 0,
      1: 20,
      2: -40,
      3: 20,
      4: 40,
    };
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [
          damageType,
          { defense, negation: negation[damageType] },
        ]),
      ),
      physicalNegation: { standard: 10, slash: 10, strike: 0, pierce: 10 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Guard Counter", true, 0.5)!,
    });
    const [punch, areaAttack] = result.attackSteps![0];
    expect(Math.floor(areaAttack.damage)).toBe(148);
    expect(Math.floor(punch.damage) + Math.floor(areaAttack.damage)).toBe(964);
  });

  it("finds the best allocations with flat attack", () => {
    // Bloodfiend's Flame Art Arm: its R2 area attack's flat fire scales with Faith, while the punch
    // scales with Strength
    const weapon = getWeapon("Bloodfiend's Flame Art Arm");
    const attack = getAttackData(movesets, weapon, "R2", true, 0.5)!;
    const hits = attack.steps.flatMap((step, i) =>
      step.map((hit) => ({
        ...hit,
        flatAttack: hit.flatAttack?.map((flat) => flat * 4),
        weight: attack.weights[i],
      })),
    );
    for (const defenses of [
      undefined,
      Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 120, negation: 0 }]),
      ),
    ]) {
      const options: OptimizeOptions = {
        weapon,
        upgradeLevel: 25,
        twoHanding: true,
        attributes: { str: 12, dex: 12, int: 9, fai: 12, arc: 9 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses,
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        hits,
      };
      const curve = optimizeAttributes(options)!;
      const expected = bruteForce(options, 10);
      for (let n = 0; n <= 10; n++) {
        expect(curve.values[n]).toBeCloseTo(expected[n], 6);
      }
    }
  });

  it("lets each hit of a paired weapon decide whether it gets the Strength bonus", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy: the Golem Fist's two
    // handed charged R2 (punch, projectile, punch, projectile) does 1734 in total on a Standard
    // Golem Fist and 1662 on a Blood one. These hits get two handing's Strength bonus even though
    // it's a paired weapon, unlike its two handed R1s.
    const total = (name: string) => {
      const weapon = getWeapon(name);
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, weapon, "Charged R2", true, 0.5)!,
      });
      return result.attackSteps![0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0);
    };
    expect(total("Golem Fist")).toBe(1734);
    expect(total("Blood Golem Fist")).toBe(1662);
    const r1 = getAttackData(movesets, getWeapon("Golem Fist"), "R1", true, 0.5)!;
    expect(r1.steps[0].every((hit) => hit.noTwoHandBonus)).toBe(true);
  });

  it("uses the Dancing Blade of Ranah's one handed R2s when two handing", () => {
    // Tested in game: its two handed R2 and charged R2 are the one handed ones, with the same damage
    const weapon = getWeapon("Dancing Blade of Ranah");
    for (const attack of ["R2", "Charged R2"] as const) {
      const damage = (twoHanding: boolean) =>
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, weapon, attack, twoHanding, 0.5)!,
        }).attackSteps!.map((step) => step.map((hit) => hit.damage));
      expect(damage(true)).toEqual(damage(false));
    }
  });

  it("gives the Death Knight's Twin Axes' two handed R2 the Strength bonus", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy: R2 844 one handed and 880
    // two handed, charged R2 1255 and 1298
    const weapon = getWeapon("Death Knight's Twin Axes");
    const damage = (twoHanding: boolean, attack: "R2" | "Charged R2" = "R2") =>
      Math.floor(
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, weapon, attack, twoHanding, 0.5)!,
        }).attackSteps![0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
      );
    expect(damage(false)).toBe(844);
    expect(damage(true)).toBe(880);
    expect(damage(false, "Charged R2")).toBe(1255);
    expect(damage(true, "Charged R2")).toBe(1298);
  });

  it("gives the Starscourge Greatsword's two handed R2s the Strength bonus", () => {
    // Tested in game at +10 with 99 in every stat on the training dummy: R2 1140, charged R2 1530
    // (and 1580 for the second), running R2 1091, and jumping R2 1188
    const weapon = getWeapon("Starscourge Greatsword");
    const firstHit = (attack: AttackChoice) =>
      Math.floor(
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: true,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, weapon, attack, true, 0.5)!,
        }).attackSteps![0][0].damage,
      );
    expect(
      (["R2", "Charged R2", "Running R2", "Jumping R2"] as const).map((attack) => firstHit(attack)),
    ).toEqual([1140, 1530, 1091, 1188]);
    const charged = getAttackData(movesets, weapon, "Charged R2", true, 0.5)!;
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: charged,
      }).attackSteps!.map((step) => Math.floor(step[0].damage)),
    ).toEqual([1530, 1580]);
  });

  it("has four steps in the Ornamental Straight Sword's two handed R1", () => {
    // Tested in game: the sheet lists a fifth step, but there isn't one
    const weapon = getWeapon("Ornamental Straight Sword");
    expect(getAttackData(movesets, weapon, "R1", true, 0.5)!.steps).toHaveLength(4);
    expect(getAttackData(movesets, weapon, "R1", false, 0.5)!.steps).toHaveLength(5);
  });

  it("matches the hand-to-hand arts' two handed R1 chains in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy: 4428 for the Dryleaf Arts'
    // whole chain, whose sixth step hits twice, and 4019 for Dane's Footwork's, whose doesn't
    const chainTotal = (name: string) => {
      const weapon = getWeapon(name);
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, weapon, "R1", true, 0.5)!,
      });
      return result.attackSteps!.flat().reduce((sum, hit) => sum + Math.floor(hit.damage), 0);
    };
    expect(chainTotal("Dryleaf Arts")).toBe(4428);
    expect(chainTotal("Dane's Footwork")).toBe(4019);
  });

  it("scales staves' melee hits like regular weapons", () => {
    // Tested in game: Lusat's Glintstone Staff +10 with 99 in every stat bonks the training dummy for
    // 30 one handed and 34 two handed. Its melee hits use standard weapon scaling
    // (AttackElementCorrectParam 10000), not the staff's Intelligence scaling.
    const weapon = getWeapon("Lusat's Glintstone Staff");
    expect(getAttackData(movesets, weapon, "R1", false, 0.5)).toBeUndefined();
    const bonk = (twoHanding: boolean) =>
      Math.floor(
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          // (a catalyst's melee strikes are its R2, its R1 casting)
          attack: getAttackData(movesets, weapon, "R2", twoHanding, 0.5)!,
        }).attackSteps![0][0].damage,
      );
    expect(bonk(false)).toBe(30);
    expect(bonk(true)).toBe(34);

    // The breakdown shows the attack's scaling: about 103 physical attack power, not the 252 the
    // game's menu shows with the staff's own Intelligence scaling
    const breakdown = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "R2", false, 0.5)!,
    }).breakdown;
    expect(breakdown[0].total).toBeCloseTo(102.9, 0);
    expect(breakdown[0].attributes.int).toBeUndefined();

    // The optimizer values Strength and Dexterity for them, not Intelligence
    const attack = getAttackData(movesets, weapon, "R2", false, 0.5)!;
    for (const defenses of [
      undefined,
      Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 50, negation: 0 }]),
      ),
    ]) {
      const options: OptimizeOptions = {
        weapon,
        upgradeLevel: weapon.attack.length - 1,
        twoHanding: false,
        attributes: { str: 10, dex: 10, int: 20, fai: 9, arc: 9 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses,
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        hits: attack.steps.flatMap((step, i) =>
          step.map((hit) => ({ ...hit, weight: attack.weights[i] })),
        ),
      };
      const curve = optimizeAttributes(options)!;
      const expected = bruteForce(options, 10);
      for (let n = 0; n <= 10; n++) {
        expect(curve.values[n]).toBeCloseTo(expected[n], 6);
      }
      expect(curve.allocations[10].int).toBe(20);
    }
  });

  it("scales overwritten scaling with the affinity's upgrade multiplier", () => {
    // From the weapon art damage guide: a Sacred skill's 100 holy, on any Standard +25 weapon
    // (even with no Faith scaling of its own), at 80 Faith: 100 × 4 × (1 + 0.25 × 1.8 × ~0.90) ≈ 562
    const longsword = getWeapon("Longsword");
    const result = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 20, dex: 20, int: 9, fai: 80, arc: 9 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: {
        steps: [
          [
            {
              motionValue: 100,
              statusMotionValue: 100,
              poiseMotionValue: 100,
              physicalType: "standard",
            },
            {
              motionValue: 0,
              motionValues: [0, 0, 0, 0, 0],
              statusMotionValue: 0,
              poiseMotionValue: 100,
              physicalType: "standard",
              flatAttack: [0, 0, 0, 0, 100],
              attackElementCorrect: { [AttackPowerType.HOLY]: { fai: 0.25 } },
            },
          ],
        ],
        weights: [1],
        poiseBase: 5,
      },
    });
    expect(result.attackSteps![0][1].damage).toBeCloseTo(562, -1);
  });

  it("never two hands weapons that can't be", () => {
    const grafted = getWeapon("Grafted Dragon");
    const oneHanded = getAttackData(movesets, grafted, "R1", false, 0.5)!;
    expect(getAttackData(movesets, grafted, "R1", true, 0.5)).toEqual(oneHanded);
    expect(canTwoHand(movesets, grafted)).toBe(false);
    expect(canTwoHand(movesets, longsword)).toBe(true);
  });

  it("applies buffs to the hits they apply to", () => {
    const buffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as { name: string; effects: BuffEffect[] }[];
    // Skills come last, e.g. Golden Vow is the incantation, not the skill
    const effectsOf = (...names: string[]) =>
      names.flatMap((name) => buffs.find((buff) => buff.name === name)!.effects);
    const buildResult = (attack: Parameters<typeof getAttackData>[2], buffEffects: BuffEffect[]) =>
      optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, longsword, attack, false, 0.5),
        buffs: buffEffects,
      });
    // Unrounded (the final value rounds each hit down), so multipliers can be compared exactly
    const build = (attack: Parameters<typeof getAttackData>[2], buffEffects: BuffEffect[]) =>
      buildResult(attack, buffEffects).curve.values[0];
    const r1 = build("R1", []);
    const charged = build("Charged R2", []);
    // Damage multipliers multiply each other's, after defenses: Golden Vow ×1.15 and Flame, Grant
    // Me Strength ×1.2 on physical damage
    expect(build("R1", effectsOf("Golden Vow"))).toBeCloseTo(r1 * 1.15, 1);
    expect(build("R1", effectsOf("Golden Vow", "Flame, Grant Me Strength"))).toBeCloseTo(
      r1 * 1.15 * 1.2,
      1,
    );
    // The Axe Talisman's ×1.1 only applies to charged attacks
    expect(build("R1", effectsOf("Axe Talisman"))).toBeCloseTo(r1, 1);
    expect(build("Charged R2", effectsOf("Axe Talisman"))).toBeCloseTo(charged * 1.1, 1);
    // The Dagger Talisman's only applies to critical hits (×1.16, fitted)
    expect(build("Backstab", effectsOf("Dagger Talisman"))).toBeCloseTo(
      build("Backstab", []) * 1.16,
      0,
    );
    expect(build("R1", effectsOf("Dagger Talisman"))).toBeCloseTo(r1, 1);
    // A grease adds flat attack before defenses
    expect(build("R1", effectsOf("Lightning Grease"))).toBeGreaterThan(r1);
    // Royal Knight's Resolve's ×1.8 only applies to the first hit of a chain
    const resolve = buildResult("R1", effectsOf("Royal Knight's Resolve"));
    const plain = buildResult("R1", []);
    // (hits are rounded down, so within 2)
    expect(
      Math.abs(resolve.attackSteps![0][0].damage - plain.attackSteps![0][0].damage * 1.8),
    ).toBeLessThan(2);
    expect(resolve.attackSteps![1][0].damage).toBe(plain.attackSteps![1][0].damage);
    // A status grease adds buildup, scaled by the hits' status motion values like the weapon's own:
    // Poison Grease's 63 on a Longsword R1 chain
    const poisoned = buildResult("R1", effectsOf("Poison Grease"));
    expect(poisoned.curve.values[0]).toBeCloseTo(r1, 1);
    expect(poisoned.statusBuildup[AttackPowerType.POISON]).toBe(63);
    expect(poisoned.attackStatus?.[AttackPowerType.POISON]).toBeGreaterThan(0);
    // Bloodflame Blade's on-hit blood loss is 40 per hit, not scaled by the hits' status motion
    // values (the Longsword has no blood loss of its own)
    const bloodflame = buildResult(
      "R1",
      buffs.find((buff) => buff.name === "Bloodflame Blade")!.effects,
    );
    expect(bloodflame.statusBuildup[AttackPowerType.BLEED]).toBe(40);
    for (const step of bloodflame.attackSteps!) {
      for (const hit of step) expect(hit.status[AttackPowerType.BLEED]).toBe(40);
    }
    // Successive hit stacks are assumed full: the Winged Sword Insignia's ×1.1
    expect(build("R1", effectsOf("Winged Sword Insignia"))).toBeCloseTo(r1 * 1.1, 1);
    // The Stonebarb Cracked Tear multiplies stance damage, not damage
    const stonebarb = buildResult("R1", effectsOf("Stonebarb Cracked Tear"));
    expect(stonebarb.curve.values[0]).toBeCloseTo(r1, 1);
    expect(stonebarb.attackStance).toBeCloseTo(buildResult("R1", []).attackStance! * 1.3);
  });

  it("applies multipliers to hits that get none of a weapon buff", () => {
    // Tested in game: the Golem Fist +25's one handed charged R2 (99 in every stat, training dummy)
    // does 351 + 613; its fist hit has byPoint, byRate, and byDmg all 0, but with Golden Vow both
    // hits get its ×1.15: 1109 in total (1056 if the fist didn't). Blue Dancer Charm gave 1127, also
    // only possible if both hits get it (at about ×1.137, a lower equip load tier).
    const golemFist = getWeapon("Golem Fist");
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const goldenVow = allBuffs.filter(
      (buff) => buff.kind === "spell" && buff.name === "Golden Vow",
    );
    const hits = (buffs: BuffEffect[], equipWeight?: number) =>
      optimizeBuild({
        weapon: golemFist,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, golemFist, "Charged R2", false, 0.5),
        buffs,
        equipWeight,
      }).attackSteps![0].map((hit) => Math.floor(hit.damage));
    expect(hits([])).toEqual([351, 613]);
    const buffed = hits(getBuffEffects(goldenVow, 3));
    expect(buffed[0] + buffed[1]).toBeCloseTo(1109, -1);
    // The Blue Dancer Charm at 6.9 equip weight (the Golem Fist's 6, added automatically, and the
    // charm's 0.9): ×1.137
    const blueDancer = hits(
      getBuffEffects(
        allBuffs.filter((buff) => buff.name === "Blue Dancer Charm"),
        3,
      ),
      0.9,
    );
    expect(getEquipWeightRate(6.9)).toBeCloseTo(1.137, 3);
    expect(blueDancer[0] + blueDancer[1]).toBe(1127);
  });

  it("scales status buffs with the weapon's Arcane status scaling", () => {
    const buffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const effectsOf = (name: string) => buffs.find((buff) => buff.name === name)!.effects;
    // A buffable weapon that scales with Arcane
    const rippleBlade = getWeapon("Ripple Blade");
    const buffable = JSON.parse(
      readFileSync(new URL("../../public/buffable.json", import.meta.url), "utf8"),
    ) as Record<string, number[]>;
    expect(buffable["Ripple Blade"]).toContain(rippleBlade.affinityId);
    const statusOf = (name: string, arc: number) =>
      optimizeBuild({
        weapon: rippleBlade,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, rippleBlade, "R1", false, 0.5),
        buffs: effectsOf(name),
      }).statusBuildup;
    // Poison, blood loss, and sleep scale with the weapon's Arcane like its own status would: 63 ×
    // (1 + the status curve at 99 Arcane × its Arcane scaling), 188 (tested in game: about 187)
    const factor =
      1 +
      rippleBlade.calcCorrectGraphs[AttackPowerType.POISON][99] *
        rippleBlade.attributeScaling.at(-1)!.arc!;
    expect(statusOf("Poison Grease", 99)[AttackPowerType.POISON]).toBeCloseTo(63 * factor);
    expect(statusOf("Poison Grease", 10)[AttackPowerType.POISON]).toBeLessThan(63 * factor);
    // Rot and frost don't scale with Arcane
    expect(statusOf("Rot Grease", 99)[AttackPowerType.SCARLET_ROT]).toBe(63);
    expect(statusOf("Freezing Grease", 99)[AttackPowerType.FROST]).toBe(63);
  });

  it("scales weapon buff spells with the catalyst's spell scaling", () => {
    const effects = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).find((buff) => buff.kind === "spell" && buff.name === "Electrify Armament")!.effects;
    const stats = { str: 99, dex: 99, int: 99, fai: 99, arc: 99 };
    const buildResult = (
      buffs: BuffEffect[],
      catalyst?: Weapon,
      {
        attributes = stats,
        maxLevels = 0,
        ...options
      }: Partial<
        Pick<BuildRequest, "castingRequirements" | "meetRequirements" | "catalystUpgradeLevel">
      > & {
        attributes?: Attributes;
        maxLevels?: number;
      } = {},
    ) =>
      optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes,
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels },
        attack: getAttackData(movesets, longsword, "R1", false, 0.5),
        buffs,
        catalyst,
        ...options,
      });
    const lightning = (flat: number): BuffEffect[] => [{ flat: [0, 0, 0, flat, 0] }];
    const seal = getWeapon("Erdtree Seal");
    const { spellScaling } = getWeaponAttack({
      weapon: seal,
      attributes: stats,
      upgradeLevel: 10,
    });
    // 75 lightning times the seal's Faith spell scaling
    expect(buildResult(effects, seal).finalValue).toBeCloseTo(
      buildResult(lightning((75 * spellScaling[AttackPowerType.HOLY]!) / 100)).finalValue,
    );
    // Only Faith's part of a seal that also scales with Arcane
    const dragonSeal = getWeapon("Dragon Communion Seal");
    const dragonScaling = getWeaponAttack({
      weapon: dragonSeal,
      attributes: stats,
      upgradeLevel: 10,
    }).spellScaling[AttackPowerType.HOLY]!;
    const faithOnly = getWeaponAttack({
      weapon: {
        ...dragonSeal,
        attackElementCorrect: {
          [AttackPowerType.HOLY]: {
            fai: dragonSeal.attackElementCorrect[AttackPowerType.HOLY]!.fai,
          },
        },
      },
      attributes: stats,
      upgradeLevel: 10,
    }).spellScaling[AttackPowerType.HOLY]!;
    expect(faithOnly).toBeLessThan(dragonScaling);
    expect(buildResult(effects, dragonSeal).finalValue).toBeCloseTo(
      buildResult(lightning((75 * faithOnly) / 100)).finalValue,
    );
    // Without a catalyst, it doesn't scale
    expect(buildResult(effects).finalValue).toBeCloseTo(buildResult(lightning(75)).finalValue);
    // A lower catalyst upgrade level scales less
    expect(buildResult(effects, seal, { catalystUpgradeLevel: 0 }).finalValue).toBeLessThan(
      buildResult(effects, seal).finalValue,
    );
    // No levels are spent on the requirements to cast it, even with meet requirements: it applies
    // anyway, noted when they aren't met
    const low = { str: 10, dex: 10, int: 10, fai: 10, arc: 10 };
    const castingRequirements = { str: 4, fai: 40 };
    for (const meetRequirements of [true, false]) {
      const unmet = buildResult(effects, seal, {
        attributes: low,
        castingRequirements,
        meetRequirements,
      });
      expect(unmet.attributes.fai).toBe(10);
      expect(unmet.finalValue).toBeCloseTo(
        buildResult(effects, seal, { attributes: low, meetRequirements }).finalValue,
      );
      expect(unmet.buffNote).toMatch(/requirements to cast it aren't met/);
    }
    const met = buildResult(effects, seal, {
      attributes: { ...low, fai: 40 },
      castingRequirements,
    });
    expect(met.buffNote).toBeUndefined();

    // Black Flame Blade's hits also do black flame, a percentage of the enemy's max HP. Tested in
    // game with a Finger Seal +0 on a Longsword +25's one handed R1 #1, 99 in every stat on the
    // training dummy: 535, then 1575 of black flame (2110 in all)
    const blackFlameBlade = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).find((buff) => buff.name === "Black Flame Blade")!;
    const blackFlame = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: stats,
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, longsword, "R1", false, 0.5),
      buffs: getBuffEffects([blackFlameBlade], 1),
      catalyst: getWeapon("Finger Seal"),
      catalystUpgradeLevel: 0,
      enemyHp: 74212,
    }).attackSteps![0][0];
    expect(Math.floor(blackFlame.damage)).toBe(535);
    expect(blackFlame.hpDamage).toEqual({ label: "Black flame", damage: 1575 });
  });

  it("matches skill weapon buffs in game, by HP", () => {
    // Tested in game on a Longsword +25's one handed R1 #1 with 99 in every stat on the training
    // dummy: 490 without a buff, 521 with Seppuku, 882 with Royal Knight's Resolve, and 629 with
    // Shriek of Sorrow at its strongest level (below 30% HP)
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const longsword = getWeapon("Longsword");
    const firstHit = (name: string, health?: number) =>
      Math.floor(
        optimizeBuild({
          weapon: longsword,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, longsword, "R1", false, 0.5),
          buffs: getBuffEffects(
            allBuffs.filter((buff) => buff.name === name),
            1,
            health,
          ),
        }).attackSteps![0][0].damage,
      );
    expect(firstHit("")).toBe(490);
    expect(firstHit("Seppuku")).toBe(521);
    // Royal Knight's Resolve, on the first hit only: 882 in game
    expect(firstHit("Royal Knight's Resolve")).toBe(882);
    expect(firstHit("Shriek of Sorrow", 29)).toBe(629);
    // Weaker levels at more HP: ×1.2 below 55%, ×1.15 below 85%, ×1.1 above
    expect([54, 84, 100].map((health) => firstHit("Shriek of Sorrow", health))).toEqual([
      604, 579, 554,
    ]);
    // Talismans that only apply at some HP
    expect(firstHit("Red-Feathered Branchsword", 100)).toBe(490);
    expect(firstHit("Red-Feathered Branchsword", 19)).toBeGreaterThan(490);
    expect(firstHit("Ritual Sword Talisman", 99)).toBe(490);
    expect(firstHit("Ritual Sword Talisman", 100)).toBeGreaterThan(490);
    // The HP field's stops: full HP, and just below each breakpoint
    expect(
      getHpStops(
        allBuffs.filter((buff) =>
          ["Shriek of Sorrow", "Red-Feathered Branchsword", "Ritual Sword Talisman"].includes(
            buff.name,
          ),
        ),
      ),
    ).toEqual([100, 99, 84, 54, 29, 19]);
  });

  it("multiplies successive attack stacks at the chosen tier", () => {
    // A Dagger +0's one handed R2 with the Rotten Winged Sword Insignia and the Thorny Cracked Tear
    // on the training dummy, 99 in every stat: 108, 114, 127 at tiers 1-3 (adding the two
    // multipliers would give 108, 113, 124)
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const stacking = allBuffs.filter((buff) =>
      ["Rotten Winged Sword Insignia", "Thorny Cracked Tear"].includes(buff.name),
    );
    const dagger = getWeapon("Dagger");
    const damage = ([1, 2, 3] as const).map((tier) =>
      Math.floor(
        optimizeBuild({
          weapon: dagger,
          regularUpgradeLevel: 0,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, dagger, "R2", false, 0),
          buffs: getBuffEffects(stacking, tier),
        }).finalValue,
      ),
    );
    expect(damage).toEqual([108, 114, 127]);
  });

  it("gives attacks' damage per second from their animations", () => {
    // Longsword +25, 99 in every stat, on the training dummy, each attack repeated as fast as the
    // timings allow: the one handed R1 chain takes 3.967s (0.567 + 0.6 + 0.633 + 0.533 + 1.467, and
    // a frame more a step); the two handed tapped R2s 2.3s (0.3 + 0.633 + 0.333 + 1.033, with their
    // charging window starts; 2.31s on a recording)
    const dps = (attack: Parameters<typeof getAttackData>[2], twoHanding: boolean) => {
      const weapon = getWeapon("Longsword");
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, weapon, attack, twoHanding, 0.5),
      });
      const damage = result.attackSteps!.flat().reduce((sum, hit) => sum + hit.damage, 0);
      const poise = result.attackSteps!.flat().reduce((sum, hit) => sum + hit.stance, 0);
      return { dps: result.attackDps!, damage, poisePerSecond: result.attackPoisePerSecond, poise };
    };
    const r1 = dps("R1", false);
    expect(r1.dps).toBeCloseTo(r1.damage / (3.8 + 5 / 30), 0);
    expect(r1.poisePerSecond).toBeCloseTo(r1.poise / (3.8 + 5 / 30), 1);
    const r2 = dps("R2", true);
    expect(r2.dps).toBeCloseTo(r2.damage / 2.3, 0);
    expect(r2.poisePerSecond).toBeCloseTo(r2.poise / 2.3, 1);
    // One-off attacks (e.g. running ones) last until anything can follow them: the running R1 until
    // its roll at 0.996s (before its right hand attack at 1.03s), and the step start delay
    const running = dps("Running R1", false);
    expect(running.dps).toBeCloseTo(running.damage / (0.996 + 1 / 30), 0);
  });

  it("gives attacks' stamina costs", () => {
    // BehaviorParam_PC stamina times the weapon's staminaConsumptionRate, from the animations: the
    // Longsword's R1s cost 12 and two handed charged R2s 36; a chain's is weighted like its damage
    const stamina = (
      name: string,
      attack: Parameters<typeof getAttackData>[2],
      twoHanding: boolean,
    ) => {
      const weapon = getWeapon(name);
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, weapon, attack, twoHanding, 0.5),
      });
      return {
        average: result.attackStamina,
        steps: result.attackSteps?.map((step) => step[0].stamina),
      };
    };
    const r1 = stamina("Longsword", "R1", false);
    expect(r1.average).toBeCloseTo(12);
    expect(r1.steps).toEqual([12, 12, 12, 12, 12]);
    const charged = stamina("Longsword", "Charged R2", true);
    expect(charged.average).toBeCloseTo(36);
    expect(charged.steps).toEqual([36, 36]);
    // The Twinblade's two handed charged R2's spins each cost 10
    expect(stamina("Twinblade", "Charged R2", true).average).toBeCloseTo(40);
  });

  it("matches the Backhand Blade's early jumping R2 in game", () => {
    // +25, 99 in every stat, on the training dummy: 702 early in the jump (127, the main animation),
    // 670 late (122, the sheet's)
    const weapon = getWeapon("Backhand Blade");
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Jumping R2", false, 0),
    });
    expect(Math.floor(result.attackSteps![0][0].damage)).toBe(702);
  });

  it("matches the Backhand Blade's two handed guard counter in game", () => {
    // +25, 99 in every stat, on Margit (103.9 defense, -10% slash and 40% holy negation): 1955 in
    // all, with the animations' 80 for the last hit (the sheet's 100 would be 2098)
    const weapon = getWeapon("Backhand Blade");
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType, i) => [
          damageType,
          { defense: 103.9, negation: [0, 0, 0, 0, 40][i] },
        ]),
      ),
      physicalNegation: { standard: 0, slash: -10, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Guard Counter", true, 0),
    });
    const hits = result.attackSteps![0].map((hit) => Math.floor(hit.damage));
    expect(hits.reduce((sum, damage) => sum + damage, 0)).toBe(1955);
  });

  it("matches the Death Knight's Twin Axes' and Rakshasa's Great Katana's fixed attacks in game", () => {
    // 99 in every stat, on the training dummy unless noted: the Death Knight's Twin Axes +10 two
    // handed jumping R2 does 855 (127, with two handing's Strength bonus), and Rakshasa's Great
    // Katana +25's powerstance L1 2 1426 (92 + 92)
    const dummy = {
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
    };
    // 103.9 defense, -10% slash and 40% holy negation
    const margit = {
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType, i) => [
          damageType,
          { defense: 103.9, negation: [0, 0, 0, 0, 40][i] },
        ]),
      ),
      physicalNegation: { standard: 0, slash: -10, strike: 0, pierce: 0 },
    };
    const total = (
      name: string,
      attack: Parameters<typeof getAttackData>[2],
      twoHanding: boolean,
      step: number,
      enemy = dummy,
    ) => {
      const weapon = getWeapon(name);
      const data = getAttackData(movesets, weapon, attack, twoHanding, 0)!;
      const result = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        ...enemy,
        limits: { ...noLimits, maxLevels: 0 },
        attack: { ...data, steps: [data.steps[step]], weights: [1] },
      });
      return result.attackSteps![0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0);
    };
    expect(total("Death Knight's Twin Axes", "Jumping R2", true, 0)).toBe(855);
    expect(total("Rakshasa's Great Katana", "Powerstance L1", false, 1)).toBe(1426);
    // The Death Knight's Twin Axes' two handed guard counter does 866 on Margit (125, with the bonus)
    expect(total("Death Knight's Twin Axes", "Guard Counter", true, 0, margit)).toBe(866);
    // Dane's Footwork +10's two handed guard counter does 1616 on Margit: both kicks and one AoE
    expect(total("Dane's Footwork", "Guard Counter", true, 0, margit)).toBe(1616);
    // A Firespark Perfume Bottle +25's powerstance jumping L1 does 814: each bottle's spray, 82 + 82
    expect(total("Firespark Perfume Bottle", "Powerstance Jumping L1", false, 0)).toBe(814);
  });

  it("matches the Dancing Blade of Ranah's two handed R2 in game", () => {
    // +10, 99 in every stat, on the training dummy: 699 in all. Its two handed R2 1 is the one handed
    // one's rows (85 + 74), as in the animations, not the sheet's 87 + 76 (about 718).
    const weapon = getWeapon("Dancing Blade of Ranah");
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "R2", true, 0),
    });
    const hits = result.attackSteps![0].map((hit) => Math.floor(hit.damage));
    expect(hits.reduce((sum, damage) => sum + damage, 0)).toBe(699);
  });

  it("meets requirements with two handing for hits without its Strength bonus", () => {
    // A Wretch's 10 Strength two handed (15) meets a Lightning Milady's 12, even for a riposte,
    // which doesn't scale with the bonus, so Strength isn't needed until Dexterity is maxed
    const milady = getWeapon("Lightning Milady");
    const result = optimizeBuild({
      weapon: milady,
      regularUpgradeLevel: 13,
      twoHanding: true,
      startLevel: 1,
      currentLevel: 1,
      attributes: { str: 10, dex: 10, int: 10, fai: 10, arc: 10 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 19 },
      attack: getAttackData(movesets, milady, "Riposte", true, 0.5),
    });
    expect(result.attributes.str).toBe(10);
    expect(result.ineffectiveAttributes).toEqual([]);
    expect(Math.round(result.finalValue)).toBe(1293);
  });

  it("has critical hits, powerstance, and mounted attacks", () => {
    const dagger = getWeapon("Dagger");
    const motionValues = (attack: Parameters<typeof getAttackData>[2], twoHanding = false) =>
      getAttackData(movesets, dagger, attack, twoHanding, 0.5)!.steps.map((step) =>
        step.map((hit) => hit.motionValue),
      );
    // The sheet's motion values include the weapon's critical multiplier (a dagger's 130)
    expect(motionValues("Backstab")).toEqual([[382.2]]);
    expect(motionValues("Riposte", true)).toEqual([[546]]);
    expect(motionValues("Large Riposte")).toEqual([[157.3, 517.4]]);
    expect(motionValues("Mounted R1/L1")).toEqual([[110], [110], [110]]);
    // Powerstance is always one handed
    expect(canTwoHand(movesets, dagger, "Powerstance L1")).toBe(false);
    expect(motionValues("Powerstance L1", true)[0]).toEqual([80, 80, 80]);

    // Tested in game: a Longsword +25 with 99 in every stat backstabs the training dummy for 1220,
    // the same two handed (no Strength bonus), and a Cold Dagger +25 for 1879 (its critical
    // multiplier is in the motion value, and applies to its physical and magic damage)
    const backstab = (twoHanding: boolean, weapon = longsword) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, weapon, "Backstab", twoHanding, 0.5),
      });
    expect(Math.floor(backstab(false).finalValue)).toBe(1220);
    expect(Math.floor(backstab(true).finalValue)).toBe(1220);
    expect(Math.floor(backstab(false, getWeapon("Cold Dagger")).finalValue)).toBe(1879);

    // A Longsword +25 large riposte on the Dragonbarrow Putrid Avatar (122 defense, 10% pierce
    // negation in the enemy picker) does 2199 in game
    const largeRiposte = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 122, negation: 0 }]),
      ),
      physicalNegation: { standard: 10, slash: 10, strike: 0, pierce: 10 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, longsword, "Large Riposte", false, 0.5),
    });
    expect(largeRiposte.attackSteps![0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(
      2199,
    );

    // A Longsword +0 riposte on the Writheblood Ruins Sanguine Noble (111 defense, 0% pierce
    // negation) does 596 in game
    const riposte = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 0,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 111, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: -10, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, longsword, "Riposte", false, 0.5),
    });
    expect(Math.floor(riposte.finalValue)).toBe(596);

    // Crucible Knights take 30% less critical damage, after defenses: a Longsword +25 riposte does
    // 833 to the Stormhill Evergaol one in game (104 defense, 35% pierce negation), and +0 does 274
    // (254 before defenses), though other attacks are unaffected
    const crucibleKnight = (attack: "Riposte" | "R1", upgradeLevel = 25) =>
      optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: upgradeLevel,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 104, negation: 0 }]),
        ),
        physicalNegation: { standard: 35, slash: 35, strike: 35, pierce: 35 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: getAttackData(movesets, longsword, attack, false, 0.5),
        criticalDamageRate: 0.7,
      });
    expect(Math.floor(crucibleKnight("Riposte").finalValue)).toBe(833);
    expect(Math.floor(crucibleKnight("Riposte", 0).finalValue)).toBe(274);
    expect(Math.floor(crucibleKnight("R1").attackSteps![0][0].damage)).toBe(331);
  });

  it("applies defenses to each hit separately", () => {
    const defense = { defense: 150, negation: 0 };
    const options = (motionValues: number[]) => ({
      hits: motionValues.map((motionValue) => ({
        motionValue,
        weight: 1,
        physicalType: "standard" as const,
      })),
    });
    const twoHits = getDamage(AttackPowerType.PHYSICAL, 300, defense, options([100, 100]));
    const oneHit = getDamage(AttackPowerType.PHYSICAL, 300, defense, options([200]));
    expect(twoHits).toBeLessThan(oneHit);
  });
});

describe("number field steps", () => {
  it("steps by a decimal step without floating point drift", () => {
    let value = 0;
    for (let i = 1; i <= 10; i++) {
      value = stepValue(value, 0.1, 1);
      expect(value).toBe(i / 10);
    }
    expect(stepValue(0.7000000000000001, 0.1, -1)).toBe(0.6);
    expect(stepValue(0.30000000000000004, 0.1, 1)).toBe(0.4);
    expect(stepValue(0.25, 0.1, 1)).toBe(0.3);
    expect(stepValue(0.25, 0.1, -1)).toBe(0.2);
    expect(stepValue(5, 100000, 1)).toBe(100000);
  });
});

describe("Ashes of War", () => {
  const ashes: Ashes = JSON.parse(
    readFileSync(new URL("../../public/ashes.json", import.meta.url), "utf8"),
  );
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const skillOf = (name: string, ash: string) => {
    const result = getAshAttack(ashes, movesets, getWeapon(name), ash, false);
    return "skill" in result ? result.skill : result.unavailableReason;
  };

  it("shows a skill's own scaling, not its weapon's", () => {
    // Flame of the Redmanes's fire only scales with Strength (25%, grown 1.8x like the weapon's
    // Strength scaling at +25), whatever the Flame Art weapon's Faith scaling
    const weapon = getWeapon("Flame Art Miséricorde");
    const result = getAshAttack(ashes, movesets, weapon, "Flame of the Redmanes", false);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 10, dex: 12, int: 9, fai: 10, arc: 9 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: "attack" in result ? result.attack : undefined,
    });
    expect(Object.keys(build.scaling)).toEqual(["str"]);
    expect(build.scaling.str).toBeCloseTo(0.45);
  });

  it("picks each weapon's skill", () => {
    // Weapons with a fixed skill always use it
    expect(skillOf("Rivers of Blood", "Lion's Claw")).toBe("Corpse Piler");
    expect(skillOf("Longsword", "Square Off")).toBe("Square Off");
    // An Ash of War needs a weapon type and affinity it can go on
    expect(skillOf("Fire Longsword", "Lion's Claw")).toBe("Lion's Claw");
    expect(skillOf("Lance", "Lion's Claw")).toBe("Can't take Lion's Claw");
    expect(skillOf("Magic Longsword", "Lion's Claw")).toBe("Lion's Claw");
    expect(skillOf("Magic Longsword", "Glintstone Pebble")).toBe("Glintstone Pebble");
    expect(skillOf("Fire Longsword", "Glintstone Pebble")).toBe("Can't take Glintstone Pebble");
  });

  it("applies Rellana's Cameo only to stance attacks", () => {
    // Its ×1.45 applies to attacks out of a held stance (e.g. Unsheathe's), not other skills' or
    // normal attacks
    const cameo: BuffEffect[] = [
      { damageRates: [1.45, 1.45, 1.45, 1.45, 1.45], categories: [1000] },
    ];
    const damage = (name: string, ash: string | null, buffs: BuffEffect[]) => {
      const weapon = getWeapon(name);
      const result = ash ? getAshAttack(ashes, movesets, weapon, ash, false) : undefined;
      if (result && !("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 0 },
        attack: result ? result.attack : getAttackData(movesets, weapon, "R1", false, 0.5),
        buffs,
      }).finalValue;
    };
    const unsheathe = withFollowUp("Unsheathe", "R1");
    expect(damage("Uchigatana", unsheathe, cameo)).toBeCloseTo(
      damage("Uchigatana", unsheathe, []) * 1.45,
    );
    expect(damage("Uchigatana", null, cameo)).toBeCloseTo(damage("Uchigatana", null, []));
    expect(damage("Longsword", "Lion's Claw", cameo)).toBeCloseTo(
      damage("Longsword", "Lion's Claw", []),
    );
  });

  it("matches Blind Spot, Blinkbolt, and Blood Blade in game", () => {
    // Tested in game on a Backhand Blade +25 with 99 in every stat on the training dummy: Blind Spot
    // is one hit of 813 (its two attack rows are alternatives, one per animation), Blinkbolt 186
    const weapon = getWeapon("Backhand Blade");
    const skill = (ash: string) => {
      const result = getAshAttack(ashes, movesets, weapon, ash, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack;
    };
    const build = (ash: string, buffs: BuffEffect[] = [], options: Partial<BuildRequest> = {}) =>
      optimizeBuild({
        weapon,
        buffs,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: skill(ash),
        ...options,
      });
    const blindSpot = build("Blind Spot");
    expect(blindSpot.attackSteps!.flat()).toHaveLength(1);
    expect(Math.floor(blindSpot.finalValue)).toBe(813);
    expect(Math.floor(build("Blinkbolt").finalValue)).toBe(186);
    // Blood Blade: the projectile does 560 and the whole skill 807. Its hits apply blood loss
    // through their own effects: the slash 55 (with the weapon's status correction, none here) and
    // the projectile 60.
    const bloodBlade = build("Blood Blade");
    const [slash, projectile] = bloodBlade.attackSteps![0];
    expect(Math.floor(projectile.damage)).toBe(560);
    // The game rounds each hit down
    expect(Math.floor(slash.damage) + Math.floor(projectile.damage)).toBe(807);
    expect(slash.status[AttackPowerType.BLEED]).toBe(55);
    expect(projectile.status[AttackPowerType.BLEED]).toBe(60);
    // With Ansbach's set (Wise Man's Mask ×1.05, the other pieces ×1.03, for dynastic skills): 639
    // and 921, so the pieces add up to ×1.14 rather than multiplying to ×1.148
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const ansbach = allBuffs.filter(
      (buff) =>
        buff.kind === "armor" &&
        ["Wise Man's Mask", "Ansbach's Attire", "Ansbach's Manchettes", "Ansbach's Boots"].includes(
          buff.name,
        ),
    );
    expect(ansbach).toHaveLength(4);
    const [ansbachSlash, ansbachProjectile] = build("Blood Blade", getBuffEffects(ansbach, 3))
      .attackSteps![0];
    expect(Math.floor(ansbachProjectile.damage)).toBe(639);
    expect(Math.floor(ansbachSlash.damage) + Math.floor(ansbachProjectile.damage)).toBe(921);
    // Adding the Shard of Alexander (×1.15 for skills): 1058, so it multiplies with the armor's ×1.14
    // (adding them would give about 1042). The calculator gives 1060: the game seems to round each
    // hit down between the two (639 × 1.15 → 734, 282 × 1.15 → 324).
    const shard = allBuffs.filter((buff) => buff.name === "Shard of Alexander");
    const [shardSlash, shardProjectile] = build(
      "Blood Blade",
      getBuffEffects([...ansbach, ...shard], 3),
    ).attackSteps![0];
    expect(Math.floor(shardSlash.damage) + Math.floor(shardProjectile.damage)).toBeCloseTo(
      1058,
      -1,
    );
    // Adding Bloodflame Blade cast with a Finger Seal +25: Blood Blade still does 1058, since its
    // hits get none of a weapon buff (Weapon Buff MV 0), and a two handed R1's first step does 1028
    // (514 each hit): its hits get 90% of the buff's 40 fire × the seal's 349 Faith scaling
    const bloodflame = getBuffEffects(
      [
        ...ansbach,
        ...shard,
        ...allBuffs.filter((buff) => buff.kind === "spell" && buff.name === "Bloodflame Blade"),
      ],
      3,
    );
    const sealOptions = { catalyst: getWeapon("Finger Seal"), catalystUpgradeLevel: 25 };
    const [flameSlash, flameProjectile] = build("Blood Blade", bloodflame, sealOptions)
      .attackSteps![0];
    expect(flameSlash.damage).toBeCloseTo(shardSlash.damage);
    expect(flameProjectile.damage).toBeCloseTo(shardProjectile.damage);
    const r1 = build("Blood Blade", bloodflame, {
      ...sealOptions,
      twoHanding: true,
      attack: getAttackData(movesets, weapon, "R1", true, 0.5),
    }).attackSteps![0];
    expect(r1.map((hit) => Math.floor(hit.damage))).toEqual([514, 514]);
    // The breakdown shows the buff's attack power before defenses: 40 fire × the seal's 349 Faith
    // scaling, on a weapon with no fire of its own
    const fireRow = build("Blood Blade", bloodflame, sealOptions).breakdown.find(
      (row) => row.damageType === AttackPowerType.FIRE,
    )!;
    expect(fireRow.buff).toBeCloseTo(139.6, 1);
    expect(fireRow.total).toBeCloseTo(139.6, 1);
    // With Blood Grease instead: Blood Blade builds up 145 blood loss, its own 55 + 60 plus the
    // grease's 30 on the slash (by its status motion value, though it gets none of a weapon buff's
    // flat attack); the projectile gets none of the weapon's status
    const greased = build(
      "Blood Blade",
      getBuffEffects(
        [...ansbach, ...shard, ...allBuffs.filter((buff) => buff.name === "Blood Grease")],
        3,
      ),
    );
    expect(greased.attackStatus![AttackPowerType.BLEED]).toBe(145);
  });

  it("matches Blood Tax, Bloody Slash, and Carian skills in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy
    const weapon = getWeapon("Longsword");
    const skillSteps = (ash: string, buffs: BuffEffect[] = []) => {
      const result = getAshAttack(ashes, movesets, weapon, ash, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!;
    };
    // Blood Tax: 1320 (417 + 176 + 176 + 551)
    expect(skillSteps("Blood Tax")[0].map((hit) => hit.damage)).toEqual([417, 176, 176, 551]);
    // Bloody Slash: one hit of 1656, with 10 stance damage and 60 blood loss (and its animation's
    // 20 stamina)
    expect(skillSteps("Bloody Slash")).toEqual([
      [
        {
          damage: 1656,
          stance: 10,
          status: { [AttackPowerType.BLEED]: 60 },
          physicalType: "standard",
          stamina: 20,
        },
      ],
    ]);
    // Carian Grandeur: each charge level is one hit (level 1 1132 with 20 poise, level 2 1620 with
    // 30, level 3 2058 with 45), not the uncharged hit and then the charged one
    const level = (n: number) => skillSteps(withFollowUp("Carian Grandeur", `Level ${n}`)).flat();
    expect(level(1).map(({ damage, stance }) => [damage, stance])).toEqual([[1132, 20]]);
    // Carian Sovereignty is cast again as a follow-up, chosen as a chain: uncharged 1620 then 1620,
    // charged 2282 (821 of it the projectile) then 2058
    const chainSteps = (chain: string) =>
      skillSteps(withFollowUp("Carian Sovereignty", `${chain} chain`)).map((step) =>
        step.map((hit) => hit.damage),
      );
    expect(chainSteps("Uncharged")).toEqual([[1620], [1620]]);
    // Flame Skewer is a chain: 822 (with its own 95 fire weapon buff), then the R2 for 1460 in total
    expect(
      skillSteps(withFollowUp("Flame Skewer", " chain")).map((step) =>
        step.reduce((sum, hit) => sum + hit.damage, 0),
      ),
    ).toEqual([822, 1460 - 822]);
    // Flame Spear uncharged: its thrust gets its own 95 fire weapon buff too, 395, and the projectile
    // 507 (902 in total)
    expect(
      skillSteps(withFollowUp("Flame Spear", "Uncharged"))[0].map((hit) => hit.damage),
    ).toEqual([395, 507]);
    // With the Winged Serpent Helm (×1.1 for fire knight skills): 992 (434 + 558)
    const helm = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Winged Serpent Helm");
    const helmed = skillSteps(withFollowUp("Flame Spear", "Uncharged"), getBuffEffects(helm, 3));
    expect(helmed[0].reduce((sum, hit) => sum + hit.damage, 0)).toBe(992);
    // Charged: 1311 (638 thrust with the buff, 673 projectile)
    expect(skillSteps(withFollowUp("Flame Spear", "Charged"))[0].map((hit) => hit.damage)).toEqual([
      638, 673,
    ]);
    // Flaming Strike is a chain: the projectile 656, then the R2 with its own 90 fire weapon buff,
    // 1622 in total
    expect(
      skillSteps(withFollowUp("Flaming Strike", " chain")).map((step) =>
        step.map((hit) => hit.damage),
      ),
    ).toEqual([[656], [1622 - 656]]);
    // Glintblade Phalanx is a chain: 4 glintblades (203 each, 812), then the R2 848
    expect(skillSteps(withFollowUp("Glintblade Phalanx", " chain"))).toMatchObject([
      [{ damage: 203 }, { damage: 203 }, { damage: 203 }, { damage: 203 }],
      [{ damage: 848 }],
    ]);
    // Glintstone Pebble is a chain: the pebble 691, then the R2 948
    expect(skillSteps(withFollowUp("Glintstone Pebble", " chain"))).toMatchObject([
      [{ damage: 691 }],
      [{ damage: 948 }],
    ]);
    // Hoarah Loux's Earthshaker is a chain: its roar (poise only) and first slam 1075, then its second
    // slam 1222
    expect(skillSteps(withFollowUp("Hoarah Loux's Earthshaker", " chain"))).toMatchObject([
      [
        { damage: 0, kind: "Initial Roar" },
        { damage: 0, kind: "Roar Tick" },
        { damage: 0, kind: "Roar Tick" },
        { damage: 1075 },
      ],
      [{ damage: 1222 }],
    ]);
    // Hoarfrost Stomp: the ice spikes 154 and the shatter 489, and 180 frost, the ice spikes' 70 and
    // the shatter's 110
    const hoarfrost = skillSteps("Hoarfrost Stomp")[0];
    expect(hoarfrost.map((hit) => hit.damage)).toEqual([154, 489]);
    expect(hoarfrost.reduce((sum, hit) => sum + (hit.status[AttackPowerType.FROST] ?? 0), 0)).toBe(
      180,
    );
    // Kick: 45, its 30 flat physical times 4 for the upgrade level, without stat scaling, and 6 poise
    expect(skillSteps("Kick")).toMatchObject([[{ damage: 45, stance: 6 }]]);
    // Lightning Ram: one hit of 551 (it can be chained indefinitely, so one counts)
    expect(skillSteps("Lightning Ram")).toMatchObject([[{ damage: 551 }]]);
    // Lightning Slash: the stomp 96, the slash 921 with its own 85 lightning weapon buff, and the
    // bullet 554 (1571 in total; its water AoE only hits in water)
    expect(skillSteps("Lightning Slash")[0].map((hit) => hit.damage)).toEqual([96, 921, 554]);
    // Lion's Claw: one hit of 1273 with 30 poise
    expect(skillSteps("Lion's Claw")).toMatchObject([[{ damage: 1273, stance: 30 }]]);
    {
      // Poison Moth Flight on a Poison Longsword +25 (tested in game): 706 with a flat 250 poison,
      // and on a poisoned target 4666, the extra 5% of the training dummy's 74212 HP plus 250
      const weapon = getWeapon("Poison Longsword");
      const moth = (target: string) => {
        const result = getAshAttack(
          ashes,
          movesets,
          weapon,
          withFollowUp("Poison Moth Flight", target),
          false,
        );
        if (!("attack" in result)) throw new Error(result.unavailableReason);
        return optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: result.attack,
          enemyHp: 74212,
        });
      };
      const plain = moth("Unpoisoned target");
      expect(plain.finalValue).toBe(706);
      expect(plain.attackSteps![0][0].status[AttackPowerType.POISON]).toBe(250);
      expect(moth("Poisoned target").finalValue).toBe(4666);
    }
    // Poisonous Mist: the weapon hit 902 with 60 poison (its own buff's), the mist burst 60, and the
    // cloud 120 a tick, 5 times (720 in all, tested in game)
    expect(
      skillSteps("Poisonous Mist")[0].map((hit) => [
        hit.damage,
        hit.status[AttackPowerType.POISON],
      ]),
    ).toEqual([
      [902, 60],
      [0, 60],
      [0, 120],
    ]);
    // Impaling Thrust: one hit of 992 with 30 poise
    expect(skillSteps("Impaling Thrust")).toMatchObject([[{ damage: 992, stance: 30 }]]);
    // Double Slash is a chain too: 962 in 2 hits, then 3 more for 2342 in total, then 1 more for 3105
    const doubleSlash = skillSteps(withFollowUp("Double Slash", " chain"));
    expect(doubleSlash.map((step) => step.length)).toEqual([2, 3, 1]);
    expect(doubleSlash.map((step) => step.reduce((sum, hit) => sum + hit.damage, 0))).toEqual([
      962,
      2342 - 962,
      3105 - 2342,
    ]);
    const charged = chainSteps("Charged");
    expect(charged[0].reduce((sum, damage) => sum + damage, 0)).toBe(2282);
    expect(charged[0]).toContain(821);
    expect(charged[1]).toEqual([2058]);
    // Carian Greatsword's charged version is the same: only its own hits, not the uncharged ones too
    const greatswordCharged = ashes.skills["Carian Greatsword"].generic!.followUps.find(
      (followUp) => followUp.label === "Charged",
    )!;
    expect(skillSteps(withFollowUp("Carian Greatsword", "Charged")).flat()).toHaveLength(
      greatswordCharged.hits.length,
    );
    expect(level(2).map(({ damage, stance }) => [damage, stance])).toEqual([[1620, 30]]);
    expect(level(3).map(({ damage, stance }) => [damage, stance])).toEqual([[2058, 45]]);
  });

  it("matches Charge Forth in game", () => {
    // Tested in game on a Spear +25 with 99 in every stat on the training dummy: four hits of 122 and
    // a final thrust of 748, and with the Godfrey Icon (×1.15 for charged skills) only the thrust
    // gets it, 860. Releasing it early just does fewer hits.
    const weapon = getWeapon("Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Charge Forth", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const icon = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Godfrey Icon");
    const hits = (buffs: BuffEffect[]) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      })
        .attackSteps!.flat()
        .map((hit) => hit.damage);
    expect(hits([])).toEqual([122, 122, 122, 122, 748]);
    expect(hits(getBuffEffects(icon, 3))).toEqual([122, 122, 122, 122, 860]);
  });

  it("matches Earthshaker and Eruption in game", () => {
    // Tested in game: a Great Mace +25 with 99 in every stat on the training dummy does 1484 (609 +
    // 321 + 554), then
    // 887 with the follow-up R2, a chain
    const weapon = getWeapon("Great Mace");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Earthshaker", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.reduce((sum, hit) => sum + hit.damage, 0))).toEqual([
      1484, 887,
    ]);
    // Eruption: its weapon hits (552 and 674), then its lava: one hit of 136 with 5 poise, and ticks of
    // 136 with 3 poise each
    const eruption = getAshAttack(ashes, movesets, weapon, "Eruption", false);
    if (!("attack" in eruption)) throw new Error(eruption.unavailableReason);
    const eruptionHits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: eruption.attack,
    }).attackSteps!.flat();
    expect(eruptionHits.map((hit) => [hit.damage, hit.stance, !!hit.tick])).toEqual([
      [552, 17.5, false],
      [674, 8.4, false],
      [136, 5, false],
      [136, 3, true],
    ]);
    // A skill that's one chain is listed by its name alone
    expect(
      getAshChoices(ashes).find(({ value }) => value === withFollowUp("Earthshaker", " chain"))!
        .label,
    ).toBe("Earthshaker");
  });

  it("matches Giant Hunt in game", () => {
    // Tested in game: a Greatsword +25 with 99 in every stat on the training dummy does 1695 in one
    // hit
    const weapon = getWeapon("Greatsword");
    const result = getAshAttack(ashes, movesets, weapon, "Giant Hunt", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.finalValue).toBe(1695);
  });

  it("hits 4 times with Golden Land's wave", () => {
    const weapon = getWeapon("Greatsword");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Golden Land", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    // Tested in game on a Greatsword +25 with 99 in every stat: 764, 412, and 905 (the explosion),
    // then the wave hits up to 4 times, 367 each (1468 at most)
    expect(attackSteps![0].map((hit) => hit.damage)).toEqual([764, 412, 905, 367, 367, 367, 367]);
    // It's a chain with its R2
    expect(attackSteps).toHaveLength(2);
    // The Great Club's fixed Golden Land, also right in game at +25 with 99 in every stat
    const club = getWeapon("Great Club");
    const clubAttacks = getAshAttacks(ashes, movesets, club, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon: club,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(clubAttacks).toEqual([
      [
        undefined,
        [
          [
            [796, 7.5],
            [409, 4.5],
            [905, 30],
            [367, 1],
            [367, 1],
            [367, 1],
            [367, 1],
          ],
          [[1157, 7.5]],
        ],
      ],
    ]);
  });

  it("matches Golden Slam and Ground Slam in game", () => {
    // Tested in game on a Greatsword +25 with 99 in every stat: one hit, 1584 close (the tush) or
    // 1132 further away (the shockwave); the close one counts
    const weapon = getWeapon("Greatsword");
    const result = getAshAttack(ashes, movesets, weapon, "Golden Slam", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps).toMatchObject([[{ damage: 1584, kind: "Tush" }]]);
    // Ground Slam is the same: only its tush counts
    const groundSlam = getAshAttack(ashes, movesets, weapon, "Ground Slam", false);
    if (!("attack" in groundSlam)) throw new Error(groundSlam.unavailableReason);
    expect(groundSlam.attack.steps).toMatchObject([[{ kind: "Tush" }]]);
    // So is the Rotten Staff's Erdtree Slam: tested in game at +10 with 99 in every stat, 1441 with 36
    // poise close (the tush), or 1169 further away (the shockwave)
    const staff = getWeapon("Rotten Staff");
    const erdtreeSlam = getAshAttack(ashes, movesets, staff, "Lion's Claw", false);
    if (!("attack" in erdtreeSlam)) throw new Error(erdtreeSlam.unavailableReason);
    expect(
      optimizeBuild({
        weapon: staff,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: erdtreeSlam.attack,
      }).attackSteps,
    ).toMatchObject([[{ damage: 1441, stance: 36, kind: "Tush" }]]);
    // The Staff of the Avatar's is right in game too at +10 with 99 in every stat: 2175 with 36 poise
    const avatar = getWeapon("Staff of the Avatar");
    const avatarSlam = getAshAttack(ashes, movesets, avatar, "Lion's Claw", false);
    if (!("attack" in avatarSlam)) throw new Error(avatarSlam.unavailableReason);
    expect(
      optimizeBuild({
        weapon: avatar,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: avatarSlam.attack,
      }).attackSteps,
    ).toMatchObject([[{ damage: 2175, stance: 36, kind: "Tush" }]]);
  });

  it("matches Gravitas in game", () => {
    // Tested in game on a Greatsword +25 with 99 in every stat: 1505 in total, the weapon hit and
    // its three rings, which stack
    const weapon = getWeapon("Greatsword");
    const result = getAshAttack(ashes, movesets, weapon, "Gravitas", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, finalValue } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => hit.damage)).toEqual([764, 247, 247, 247]);
    expect(finalValue).toBe(1505);
  });

  it("matches Dryleaf Whirlwind and Palm Blast in game", () => {
    // Tested in game: Dryleaf Arts +25 with 99 in every stat on the training dummy, 1731 damage and 28
    // poise
    const weapon = getWeapon("Dryleaf Arts");
    const result = getAshAttack(ashes, movesets, weapon, "Dryleaf Whirlwind", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [hit.damage, hit.stance])).toEqual([
      [478, 8],
      [337, 2],
      [337, 2],
      [579, 16],
    ]);
    expect(build.finalValue).toBe(1731);
    expect(build.attackStance).toBe(28);
    // An enemy's poise damage multiplier (SpEffectParam saReceiveDamageRate, e.g. 0.2 for ancient
    // dragons) scales its poise damage, not its damage
    const dragon = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
      poiseDamageRate: 0.2,
    });
    expect(dragon.finalValue).toBe(1731);
    expect(dragon.attackStance).toBeCloseTo(28 * 0.2);
    expect(dragon.attackSteps![0][3].stance).toBeCloseTo(16 * 0.2);
    // Palm Blast: uncharged 954 (20 poise), charged 1996 (36 poise)
    const palmBlast = (level: string) => {
      const palm = getAshAttack(ashes, movesets, weapon, withFollowUp("Palm Blast", level), false);
      if (!("attack" in palm)) throw new Error(palm.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: palm.attack,
      }).attackSteps!;
    };
    expect(palmBlast("Uncharged")).toMatchObject([[{ damage: 954, stance: 20 }]]);
    expect(palmBlast("Charged")).toMatchObject([[{ damage: 1996, stance: 36 }]]);
  });

  it("matches Cragblade in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy: 490 (7.5 poise)
    // and 370 (5 poise)
    const weapon = getWeapon("Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Cragblade", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => [hit.damage, hit.stance])).toEqual([
      [490, 7.5],
      [370, 5],
    ]);
  });

  it("matches Divine Beast Frost Stomp in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy, uncharged: the
    // ice spikes 672 and the shatter 96 (768 in total), and 140 frost (70 each)
    const weapon = getWeapon("Longsword");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Divine Beast Frost Stomp", "Uncharged"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, attackStatus } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.flat().map((hit) => hit.damage)).toEqual([672, 96]);
    expect(attackStatus![AttackPowerType.FROST]).toBe(140);
    const charged = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Divine Beast Frost Stomp", "Charged"),
      false,
    );
    if (!("attack" in charged)) throw new Error(charged.unavailableReason);
    const chargedSteps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: charged.attack,
    }).attackSteps!;
    // Charged: 954 and 181
    expect(chargedSteps.flat().map((hit) => hit.damage)).toEqual([954, 181]);
  });

  it("matches Ghostflame Call in game", () => {
    // Tested in game point blank on a Longsword +25 with 99 in every stat on the training dummy: 794
    // in total, the weapon hit (205), 4 ticks (96 each, every 0.4s for 1.46s), and the explosion
    // (205); about 95 frost (20 a tick and 20 for the explosion, less what wears off meanwhile)
    const weapon = getWeapon("Longsword");
    const build = (ash: string) => {
      const result = getAshAttack(ashes, movesets, weapon, ash, false, 0.5, true);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      });
    };
    const { attackSteps, finalValue, attackStatus } = build("Ghostflame Call");
    expect(attackSteps![0].map((hit) => hit.damage)).toEqual([205, 96, 205]);
    expect(finalValue).toBe(794);
    expect(attackStatus![AttackPowerType.FROST]).toBe(100);
    // With the R1 follow-up, not quite point blank: 1770, the R1's weapon hit (341), its wave (205),
    // and its ground flame's 10 ticks (43 each, every 0.5s for 5s). From a distance only the wave
    // and the flame hit: 635.
    const r1 = build(withFollowUp("Ghostflame Call", "R1"));
    expect(r1.attackSteps![1].map((hit) => hit.damage)).toEqual([341, 205, 43]);
    expect(r1.finalValue).toBe(1770);
    // With the R2 follow-up: 1533 (its weapon hit 370 and its bullet 369)
    const r2 = build(withFollowUp("Ghostflame Call", "R2"));
    expect(r2.attackSteps![1].map((hit) => hit.damage)).toEqual([370, 369]);
    expect(r2.finalValue).toBe(1533);
  });

  it("builds up Chilling Mist's frost from the hit, the mist, and its cloud", () => {
    // The weapon hit gets the skill's frost weapon buff (60, like a grease), the mist burst applies
    // 60, and the lingering cloud 120 each tick (every 0.7s for 4s)
    const weapon = getWeapon("Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Chilling Mist", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, attackStatus } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => hit.status[AttackPowerType.FROST])).toEqual([60, 60, 120]);
    // The attack's total counts every tick of the cloud: 60 + 60 + 5 × 120
    expect(attackStatus![AttackPowerType.FROST]).toBe(720);
  });

  it("scales Bloody Slash's and Blood Blade's blood loss with the weapon", () => {
    // Tested in game: about 85 blood loss on a Blood Great Katana +25 with 99 in every stat, its 60
    // with the weapon's Arcane correction for blood loss (×1.435)
    const weapon = getWeapon("Blood Great Katana");
    const result = getAshAttack(ashes, movesets, weapon, "Bloody Slash", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0][0].status[AttackPowerType.BLEED]).toBeCloseTo(86.1, 0);
    // Blood Blade on a Bloody Longsword +25 (tested in game): the slash's own 55 and the weapon's
    // blood loss, and the projectile's 60, both with the weapon's Arcane correction
    const bloodyLongsword = getWeapon("Bloody Longsword");
    const bloodBlade = getAshAttack(ashes, movesets, bloodyLongsword, "Blood Blade", false);
    if (!("attack" in bloodBlade)) throw new Error(bloodBlade.unavailableReason);
    const bloodBladeSteps = optimizeBuild({
      weapon: bloodyLongsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: bloodBlade.attack,
    }).attackSteps!;
    expect(bloodBladeSteps[0].map((hit) => hit.status[AttackPowerType.BLEED])).toEqual([
      expect.closeTo(196.6, 1),
      expect.closeTo(86.1, 1),
    ]);
  });

  it("matches Rolling Sparks in game", () => {
    // Tested in game on a Firespark Perfume Bottle +25 with 99 in every stat: 461 to 886, a spark 9
    // and the explosion 407, so 6 sparks and 1 explosion at least (2 explosions and 8 sparks at most)
    const weapon = getWeapon("Firespark Perfume Bottle");
    const result = getAshAttack(ashes, movesets, weapon, "Rolling Sparks", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, attackNote } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    const damage = attackSteps![0].map((hit) => hit.damage);
    expect(damage).toEqual([9, 9, 9, 9, 9, 9, 407]);
    expect(damage.reduce((sum, hit) => sum + hit, 0)).toBe(461);
    // The result notes that only one explosion is counted
    expect(attackNote).toMatch(/single explosion/);
  });

  it("matches Repeating Thrust in game", () => {
    // Tested in game on a Bloody Longsword +25 with 99 in every stat on the training dummy: 534, 266,
    // 266, and 640, with 10, 2, 2, and 5 poise and 118, 59, 59, and 118 blood loss
    const weapon = getWeapon("Bloody Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Repeating Thrust", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps![0].map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
    ).toEqual([
      [534, 10, expect.closeTo(117.7, 1)],
      [266, 2, expect.closeTo(58.8, 1)],
      [266, 2, expect.closeTo(58.8, 1)],
      [640, 5, expect.closeTo(117.7, 1)],
    ]);
  });

  it("matches Overhead Stance and Piercing Fang in game", () => {
    // Tested in game on a Great Katana +25 with 99 in every stat on the training dummy: the R1 1008,
    // and the R2 566, 645, and 692
    const weapon = getWeapon("Great Katana");
    const steps = (followUp: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Overhead Stance", followUp),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!;
    };
    expect(steps("R1")[0].map((hit) => hit.damage)).toEqual([1008]);
    expect(steps("R2")[0].map((hit) => hit.damage)).toEqual([566, 645, 692]);
    // Piercing Fang: one hit of 1454 (33 poise)
    const fang = getAshAttack(ashes, movesets, weapon, "Piercing Fang", false);
    if (!("attack" in fang)) throw new Error(fang.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: fang.attack,
      }).attackSteps,
    ).toMatchObject([[{ damage: 1454, stance: 33 }]]);
  });

  it("matches Ice Spear, Loretta's Slash, and Phantom Slash in game", () => {
    // Tested in game on a Spear +25 with 99 in every stat on the training dummy: the startup spin 361
    // (10 poise), and the bullet 1219 (25 poise) with 160 frost
    const weapon = getWeapon("Spear");
    const steps = (ash: string) => {
      const result = getAshAttack(ashes, movesets, weapon, ash, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!;
    };
    expect(
      steps("Ice Spear")[0].map((hit) => [
        hit.damage,
        hit.stance,
        hit.status[AttackPowerType.FROST],
      ]),
    ).toEqual([
      [361, 10, undefined],
      [1219, 25, 160],
    ]);
    // Phantom Slash is a chain: 905 (the phantom) and 671, then 931 and 701
    expect(
      steps(withFollowUp("Phantom Slash", " chain")).map((step) => step.map((hit) => hit.damage)),
    ).toEqual([
      [905, 671],
      [931, 701],
    ]);
    // Loretta's Slash: 196 (12.5 poise) and 637 (10 poise)
    expect(steps("Loretta's Slash")[0].map((hit) => [hit.damage, hit.stance])).toEqual([
      [196, 12.5],
      [637, 10],
    ]);
    // Loretta's War Sickle's own, also right in game at +25 with 99 in every stat: 572 and 1411
    const sickle = getWeapon("Loretta's War Sickle");
    const sickleResult = getAshAttack(ashes, movesets, sickle, "Lion's Claw", false);
    if (!("attack" in sickleResult)) throw new Error(sickleResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: sickle,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: sickleResult.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [572, 12.5],
        [1411, 10],
      ],
    ]);
  });

  it("matches Piercing Throw in game", () => {
    // Tested in game on a Blood Smithscript Dagger +25 with 99 in every stat on the training dummy:
    // one hit of 571, 3 poise, and 50 blood loss
    const weapon = getWeapon("Blood Smithscript Dagger");
    const result = getAshAttack(ashes, movesets, weapon, "Piercing Throw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps).toMatchObject([[{ damage: 571, stance: 3 }]]);
    expect(attackSteps![0][0].status[AttackPowerType.BLEED]).toBeCloseTo(50.2, 1);
  });

  it("matches Prayerful Strike in game", () => {
    // Tested in game on Great Stars (fully upgraded) with 99 in every stat on the training dummy: one
    // hit of 1600, 42 poise, and 55 blood loss
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(ashes, movesets, weapon, "Prayerful Strike", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps).toMatchObject([
      [{ damage: 1600, stance: 42, status: { [AttackPowerType.BLEED]: 55 } }],
    ]);
  });

  it("matches Raging Beast in game", () => {
    // Raging Beast is a chain: the leap, then its R2 (two hits). Tested in game on the Beast Claw
    // (fully upgraded) with 99 in every stat on the training dummy: 679, then 299 and 759
    const weapon = getWeapon("Beast Claw");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Raging Beast", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([[679], [299, 759]]);
  });

  it("matches Prelate's Charge in game", () => {
    // Tested in game on Great Stars (fully upgraded) with 99 in every stat on the training dummy, one
    // press: 937 before the final attack, 1507 after it, and 2299 once the fire runs out (5 ticks
    // of 198)
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(ashes, movesets, weapon, "Prelate's Charge", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, finalValue } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => hit.damage)).toEqual([727, 4, 4, 4, 198, 570]);
    expect(finalValue).toBe(2299);
  });

  it("matches Carian Retaliation in game", () => {
    // Tested in game: a Beast Crest Heater Shield +25 with 99 in every stat on the training dummy
    // fires 3 swords of 185 each, 555 in total (the swords' 270 magic doesn't scale), and 9 poise
    const weapon = getWeapon("Beast Crest Heater Shield");
    const result = getAshAttack(ashes, movesets, weapon, "Carian Retaliation", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => [hit.damage, hit.stance])).toEqual([
      [185, 3],
      [185, 3],
      [185, 3],
    ]);
  });

  it("matches Savage Lion's Claw in game", () => {
    // Savage Lion's Claw is a chain: the spin, then its follow-up (two hits). Tested in game on Great
    // Stars +25 with 99 in every stat on the training dummy: 1328, then 413 and 1055
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Savage Lion's Claw", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([
      [1328],
      [413, 1055],
    ]);
  });

  it("matches Scattershot Throw in game", () => {
    // 4 daggers a throw, 960; it can be chain thrown, but one throw is counted. Tested in game on a
    // Blood Smithscript Dagger +25 with 99 in every stat on the training dummy: 240 each, with 2.4
    // poise and 35 blood loss
    const weapon = getWeapon("Blood Smithscript Dagger");
    expect(
      getAshChoices(ashes)
        .filter(({ value }) => value.startsWith("Scattershot Throw"))
        .map(({ value }) => value),
    ).toEqual(["Scattershot Throw"]);
    const result = getAshAttack(ashes, movesets, weapon, "Scattershot Throw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([[0, 0, 0, 0].map(() => [240, 2.4, expect.closeTo(35.2, 1)])]);
  });

  it("matches Shield Bash in game", () => {
    // Tested in game on a Blood Brass Shield +25 with 99 in every stat on the training dummy: one hit
    // of 456, with 6.9 poise and 118 blood loss
    const weapon = getWeapon("Blood Brass Shield");
    const result = getAshAttack(ashes, movesets, weapon, "Shield Bash", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([[[456, 6.875, expect.closeTo(117.7, 1)]]]);
  });

  it("matches Shield Crash in game", () => {
    expect(getAshChoices(ashes).map(({ label }) => label)).toContain(
      "Shield Crash (Fully charged)",
    );
    // Tested in game on a Blood Brass Shield +25 with 99 in every stat on the training dummy, fully
    // charged: 192 three times, 192, and 362, with 4.1 poise (6.9 for the last) and 11.8 blood loss
    // (117.7 for the last two)
    const weapon = getWeapon("Blood Brass Shield");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Shield Crash", "Fully charged"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps![0].map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
    ).toEqual([
      [192, 4.125, expect.closeTo(11.8, 1)],
      [192, 4.125, expect.closeTo(11.8, 1)],
      [192, 4.125, expect.closeTo(11.8, 1)],
      [192, 4.125, expect.closeTo(117.7, 1)],
      [362, 6.875, expect.closeTo(117.7, 1)],
    ]);
  });

  it("matches Spectral Lance in game", () => {
    // Tested in game on a Bloody Spear +25 with 99 in every stat on the training dummy: one hit of
    // 616 with 25 poise, and 677 with the Smithing Talisman (×1.1 for thrown weapon skills)
    const weapon = getWeapon("Bloody Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Spectral Lance", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      });
    const { attackSteps, attackNote } = build();
    expect(attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance]))).toEqual([
      [[616, 25]],
    ]);
    expect(attackNote).toMatch(/head/);
    const talisman = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Smithing Talisman");
    expect(build(getBuffEffects(talisman, 3)).attackSteps![0][0].damage).toBe(677);
  });

  it("matches Spinning Gravity Thrust in game", () => {
    // Spinning Gravity Thrust is a chain: 5 hits, then 4. Tested in game on a Blood Sword Lance +25
    // with 99 in every stat on the training dummy: 144 four times and 693, then 144 three times and
    // 761, with 3.85 poise (5.5 and 13.2 for the big hits) and 112 blood loss a hit
    const weapon = getWeapon("Blood Sword Lance");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Spinning Gravity Thrust", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    const small = [144, 3.85, expect.closeTo(111.9, 1)];
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [small, small, small, small, [693, 5.5, expect.closeTo(111.9, 1)]],
      [small, small, small, [761, 13.2, expect.closeTo(111.9, 1)]],
    ]);
  });

  it("matches Spinning Slash in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy: on a Spear 509, then 251 and
    // 539; on a Bloody Longsword 607, then 314 and 640, with blood loss; and the Dragon Halberd's own
    // version, with its 160 lightning weapon buff, 849, then 471, 889, and the projectile 317 (2526 in
    // all, the same with 10 Intelligence and Faith)
    const build = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Spinning Slash", " chain"),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance, hit.status]));
    };
    expect(build("Spear")).toEqual([
      [[509, 11.5, {}]],
      [
        [251, 3.75, {}],
        [539, 11.5, {}],
      ],
    ]);
    expect(build("Bloody Longsword")).toEqual([
      [[607, 14.5, { [AttackPowerType.BLEED]: expect.closeTo(76.5, 1) }]],
      [
        [314, 4.5, { [AttackPowerType.BLEED]: expect.closeTo(58.8, 1) }],
        [640, 14.5, { [AttackPowerType.BLEED]: expect.closeTo(82.4, 1) }],
      ],
    ]);
    const dragonHalberd = build("Dragon Halberd");
    expect(dragonHalberd.map((step) => step.map(([damage]) => damage))).toEqual([
      [849],
      [471, 889, 317],
    ]);
  });

  it("lists each version of a weapon's fixed skill", () => {
    const variants = (name: string) =>
      getAshAttacks(ashes, movesets, getWeapon(name), "Lion's Claw", false).map(
        ({ variant }) => variant?.short,
      );
    // A stance's follow-ups
    expect(variants("Moonveil")).toEqual(["R1", "R2"]);
    // A fixed skill with one version (the Dragon Halberd's one chain, and the Bloodhound's Fang's:
    // its skill then its R2, numbers right in game), or a weapon that takes the chosen Ash of War, is
    // one result
    expect(variants("Dragon Halberd")).toEqual([undefined]);
    // Red Bear Hunt is one chain
    expect(variants("Red Bear's Claw")).toEqual([undefined]);
    expect(variants("Bloodhound's Fang")).toEqual([undefined]);
    expect(variants("Longsword")).toEqual([undefined]);
  });

  it("makes Moon-and-Fire Stance's R1 a chain", () => {
    // Rellana's Twin Blades' fixed skill: its R1 (three steps) as a chain, and its R2 on its own
    const variants = getAshAttacks(
      ashes,
      movesets,
      getWeapon("Rellana's Twin Blades"),
      "Lion's Claw",
      false,
    ).map(({ ash, variant }) => {
      if (!("attack" in ash)) throw new Error(ash.unavailableReason);
      return [variant?.short, ash.attack.steps.map((step) => step.length), !!ash.attack.chain];
    });
    expect(variants).toEqual([
      ["R1 chain", [4, 4, 2], true],
      ["R2", [7], false],
    ]);
  });

  it("adds up a chain's steps if asked", () => {
    const weapon = getWeapon("Longsword");
    const chain = withFollowUp("Glintstone Pebble", " chain");
    const weights = (sumChains: boolean) => {
      const result = getAshAttack(ashes, movesets, weapon, chain, false, 0.5, sumChains);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack.weights;
    };
    expect(weights(false)).toEqual([2 / 3, 1 / 3]);
    expect(weights(true)).toEqual([1, 1]);
    // A skill with a follow-up counts as a chain too
    const followUp = (sumChains: boolean) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Ghostflame Call", "R2"),
        false,
        0.5,
        sumChains,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return [result.attack.weights, result.attack.chain];
    };
    expect(followUp(false)).toEqual([[2 / 3, 1 / 3], true]);
    expect(followUp(true)).toEqual([[1, 1], true]);
    const r1 = getAttackData(movesets, weapon, "R1", false, 0.5, true)!;
    expect(r1.weights.every((weight) => weight === 1)).toBe(true);
  });

  it("matches the Dragon Halberd's Spinning Slash at other stats in game", () => {
    // Tested in game on the training dummy: at +0 with 99 Strength and Dexterity (256, then 151, 267,
    // and 140), and two handed at +10 with 15 Strength and 10 Dexterity (1416 in all, two handing
    // meeting its 22 Strength requirement; the projectile's physical attack doesn't scale with stats)
    const weapon = getWeapon("Dragon Halberd");
    const damage = (upgradeLevel: number, str: number, dex: number, twoHanding: boolean) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Spinning Slash", " chain"),
        twoHanding,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: upgradeLevel,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str, dex, int: 10, fai: 10, arc: 10 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => hit.damage));
    };
    expect(damage(0, 99, 99, false)).toEqual([[256], [151, 267, 140]]);
    // Poise: 31.75 for the whole chain, the projectile's poise motion value alone (5, not its flat 10)
    const steps = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Spinning Slash", " chain"),
      false,
      0.5,
      true,
    );
    if (!("attack" in steps)) throw new Error(steps.unavailableReason);
    const { attackStance } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: steps.attack,
    });
    expect(attackStance).toBe(31.75);
    // Frost: only the weapon hits apply it (70 times their status motion values, 45 for the first in
    // game), not the projectile, whose 80 is times its status motion value of 0 (3 frost hits in game)
    const { attackSteps: frostSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: steps.attack,
    });
    expect(frostSteps!.flat().map((hit) => hit.status[AttackPowerType.FROST] ?? 0)).toEqual([
      45.5, 35, 49, 0,
    ]);
    expect(damage(25, 15, 10, true)).toEqual([[416], [247, 436, 317]]);
  });

  it("uses each weapon's Spinning Slash", () => {
    const steps = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Spinning Slash", " chain"),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack.steps.map((step) => step.length);
    };
    // A straight sword's, a greatsword's (the sheet's [Var1]), and the Dragon Halberd's, whose second
    // spin also fires a projectile
    expect(steps("Longsword")).toEqual([1, 2]);
    expect(steps("Claymore")).toEqual([1, 2]);
    expect(steps("Dragon Halberd")).toEqual([1, 3]);
  });

  it("matches Spinning Strikes in game", () => {
    // A loop, offered on its own and each follow-up on its own (Ghostflame Call only with its
    // follow-ups)
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => /^(Spinning Strikes|Ghostflame Call)\b/.test(label)),
    ).toEqual([
      "Ghostflame Call with R1 follow-up",
      "Ghostflame Call with R2 follow-up",
      "Spinning Strikes",
      "Spinning Strikes (R1 follow-up)",
      "Spinning Strikes (R2 follow-up)",
    ]);
    // Tested in game on a Scythe +25 with 99 in every stat on the training dummy: the spin 717, with
    // 5.6 poise and 55 blood loss, then its R1 481 and 703, or its R2 589 and 1177
    const weapon = getWeapon("Scythe");
    const build = (choice: string) => {
      const result = getAshAttack(ashes, movesets, weapon, choice, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    };
    expect(build("Spinning Strikes")).toEqual([[[717, 5.6, 55]]]);
    expect(build(withFollowUp("Spinning Strikes", "R1"))).toEqual([
      [
        [481, 4, 55],
        [703, 5.5, 55],
      ],
    ]);
    expect(build(withFollowUp("Spinning Strikes", "R2"))).toEqual([
      [
        [589, 4.75, 55],
        [1177, 9, 55],
      ],
    ]);
  });

  it("matches Spinning Weapon in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy: on a Longsword 312, 246 five
    // times, and 312, with 2 poise each; on the Staff of the Guilty 74, 51 five times, and 74, with
    // 1.2 poise and 22.5 blood loss each
    const build = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Spinning Weapon", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance, hit.status]));
    };
    expect(build("Longsword")).toEqual([
      [312, 246, 246, 246, 246, 246, 312].map((damage) => [damage, 2, {}]),
    ]);
    expect(build("Staff of the Guilty")).toEqual([
      [74, 51, 51, 51, 51, 51, 74].map((damage) => [
        damage,
        1.2,
        { [AttackPowerType.BLEED]: 22.5 },
      ]),
    ]);
  });

  it("matches Square Off in game", () => {
    // Tested in game on a Bloody Longsword +25 with 99 in every stat on the training dummy: the R1 1149
    // with 30 poise, the R2 1379 with 40, 2000 with Rellana's Cameo (×1.45), and 118 blood loss each
    const weapon = getWeapon("Bloody Longsword");
    const cameo = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Rellana's Cameo"),
      3,
    );
    const build = (followUp: string, buffs: BuffEffect[] = []) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Square Off", followUp),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    };
    const bleed = expect.closeTo(117.7, 1);
    expect(build("R1")).toEqual([[[1149, 30, bleed]]]);
    expect(build("R2")).toEqual([[[1379, 40, bleed]]]);
    expect(build("R2", cameo)).toEqual([[[2000, 40, bleed]]]);
  });

  it("matches Stamp (Upward Cut) in game", () => {
    // Tested in game on Great Stars +25 with 99 in every stat on the training dummy: one hit of 1464,
    // with 42 poise and 55 blood loss
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(ashes, movesets, weapon, "Stamp (Upward Cut)", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([[[1464, 42, 55]]]);
  });

  it("matches Stamp (Sweep) in game", () => {
    // Tested in game on Great Stars +25 with 99 in every stat on the training dummy: 601 and 755, with
    // 10.5 and 17.5 poise and 55 blood loss each
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(ashes, movesets, weapon, "Stamp (Sweep)", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [601, 10.5, 55],
        [755, 17.5, 55],
      ],
    ]);
  });

  it("matches Storm Assault in game", () => {
    // Tested in game on a Bloody Spear +25 with 99 in every stat on the training dummy: a whirlwind
    // (on the jump or the landing, not both) 231 with 5 poise, and the thrust 1139 with 20 poise and
    // 118 blood loss; with the Enraged Divine Beast talisman (×1.1 for its storm skills) 254, and 1507
    // in all. Two handed, the whirlwind gets two handing's bonus (238) but the thrust doesn't
    // (isDisableBothHandsAtkBonus), 1139.
    const weapon = getWeapon("Bloody Spear");
    const build = (buffs: BuffEffect[] = [], twoHanding = false) => {
      const result = getAshAttack(ashes, movesets, weapon, "Storm Assault", twoHanding);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      });
    };
    const { attackSteps } = build();
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [231, 5, undefined],
        [1139, 20, expect.closeTo(117.7, 1)],
      ],
    ]);
    const talisman = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Enraged Divine Beast");
    const buffed = build(getBuffEffects(talisman, 3));
    expect(buffed.attackSteps![0][0].damage).toBe(254);
    expect(buffed.finalValue).toBe(1507);
    expect(build([], true).attackSteps![0].map((hit) => hit.damage)).toEqual([238, 1139]);
  });

  it("matches Storm Blade in game", () => {
    // Tested in game on a Bloody Longsword +25 with 99 in every stat on the training dummy: the slash
    // 314 with 3.25 poise and 118 blood loss, and the projectile 832 with 7.5; with the Enraged Divine
    // Beast talisman 346 and 915, then 353 and 915, and 359 and 915. It's a chain, each slash firing the projectile: then 320 with 3.3
    // poise and 832, and 327 with 3.35 poise and 832, looping over those two in game.
    const weapon = getWeapon("Bloody Longsword");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Storm Blade", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const talisman = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Enraged Divine Beast");
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    const bleed = expect.closeTo(117.7, 1);
    expect(build()).toEqual([
      [
        [314, 3.25, bleed],
        [832, 7.5, undefined],
      ],
      [
        [320, 3.3, bleed],
        [832, 7.5, undefined],
      ],
      [
        [327, 3.35, bleed],
        [832, 7.5, undefined],
      ],
    ]);
    expect(
      build(getBuffEffects(talisman, 3)).map((step) => step.map(([damage]) => damage)),
    ).toEqual([
      [346, 915],
      [353, 915],
      [359, 915],
    ]);
  });

  it("matches Prelate's Charge on other affinities in game", () => {
    // Tested in game with 99 in every stat on the training dummy, one press: 2263 on a Heavy Great
    // Stars +25 and 2834 on a Flame Art one. The fire's flat attack (added to the weapon's base
    // attack, with its own 25% Faith scaling) does 198 a tick on Standard and Heavy, 221 on Flame
    // Art, whose upgrades and scaling curve differ.
    const total = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Prelate's Charge", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).finalValue;
    };
    expect(total("Heavy Great Stars")).toBe(2263);
    expect(total("Flame Art Great Stars")).toBe(2834);
  });

  it("matches Storm Stomp in game", () => {
    // Tested in game on a Bloody Longsword +25 with 99 in every stat on the training dummy: one hit of
    // 216 with 10 poise, 237 with the Enraged Divine Beast talisman
    const weapon = getWeapon("Bloody Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Storm Stomp", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const talisman = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).filter((buff) => buff.name === "Enraged Divine Beast");
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance]));
    expect(build()).toEqual([[[216, 10]]]);
    expect(build(getBuffEffects(talisman, 3))).toEqual([[[237, 10]]]);
  });

  it("splits Stormcaller into weapon and AoE chains", () => {
    // Each swing hits with the weapon or its whirlwind, not both (seen in game)
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => label.startsWith("Stormcaller")),
    ).toEqual(["Stormcaller", "Stormcaller (AoE only chain)"]);
    const steps = (chain: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        getWeapon("Longsword"),
        withFollowUp("Stormcaller", `${chain} chain`),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack.steps.map((step) => step.map((hit) => hit.kind ?? "Weapon"));
    };
    expect(steps("")).toEqual([
      ["Weapon", "Weapon", "Weapon"],
      ["Weapon", "Weapon"],
      ["Weapon", "Weapon"],
    ]);
    expect(steps("AoE only")).toEqual([
      ["Bullet", "Bullet", "Bullet"],
      ["Bullet", "Bullet"],
      ["Bullet", "Bullet"],
    ]);
  });

  it("matches Stormcaller in game", () => {
    const build = (name: string, chain: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Stormcaller", `${chain} chain`),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance, hit.status]));
    };
    // Tested in game at +25 with 99 in every stat on the training dummy: on a Longsword 441, 453, and
    // 472, then 478 and 490, then 508 and 582, with 12 poise for the first hit and 5 for the rest
    expect(
      build("Longsword", "").map((step) => step.map(([damage, stance]) => [damage, stance])),
    ).toEqual([
      [
        [441, 12],
        [453, 5],
        [472, 5],
      ],
      [
        [478, 5],
        [490, 5],
      ],
      [
        [508, 5],
        [582, 5],
      ],
    ]);
    // On a Bloody Longsword, the first hit's 88 blood loss (75% status motion value)
    expect(build("Bloody Longsword", "")[0][0][2]).toEqual({
      [AttackPowerType.BLEED]: expect.closeTo(88.3, 1),
    });
    // The whirlwinds alone on a Forked Hatchet: 266, 273, and 284, then 288 and 296, then 191 twice,
    // 5 poise each
    expect(build("Forked Hatchet", "AoE only")).toEqual(
      [
        [266, 273, 284],
        [288, 296],
        [191, 191],
      ].map((step) => step.map((damage) => [damage, 5, {}])),
    );
  });

  it("matches Swift Slash in game", () => {
    const weapon = getWeapon("Blood Backhand Blade");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const build = (followUp: string, buffs: BuffEffect[] = []) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Swift Slash", followUp),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    };
    // Tested in game on a Blood Backhand Blade +25 with 99 in every stat on the training dummy:
    // uncharged 518 and 712 with 5 poise each, charged 602 with 15 poise and 965 with 5, 118 blood
    // loss each; with the Godfrey Icon, charged 692 and 965, and with it and the Shard of Alexander
    // 1760 in all, uncharged 1308 with the Shard (skill buffs don't boost the second slash)
    const shard = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Shard of Alexander"),
      3,
    );
    const total = (steps: ReturnType<typeof build>) =>
      steps.flat().reduce((sum, [damage]) => sum + (damage as number), 0);
    const bleed = expect.closeTo(117.7, 1);
    expect(build("Uncharged")).toEqual([
      [
        [518, 5, bleed],
        [712, 5, bleed],
      ],
    ]);
    expect(build("Charged")).toEqual([
      [
        [602, 15, bleed],
        [965, 5, bleed],
      ],
    ]);
    expect(build("Charged", icon)[0].map(([damage]) => damage)).toEqual([692, 965]);
    // 1761 here: the game seems to round down after each ×1.15 (602 → 692 → 795), where this
    // multiplies by both and rounds once (796)
    expect(Math.abs(total(build("Charged", [...icon, ...shard])) - 1760)).toBeLessThanOrEqual(1);
    expect(total(build("Uncharged", shard))).toBe(1308);
  });

  it("matches Sword Dance in game", () => {
    expect(getAshChoices(ashes).filter(({ label }) => label.startsWith("Sword Dance"))).toEqual([
      { value: withFollowUp("Sword Dance", " chain"), label: "Sword Dance" },
    ]);
    // A single chain entry. Tested in game on a Bloody Longsword +25 with 99 in every stat on the
    // training dummy: 673 twice with 6 poise, then 861 with 7.5, with 88, 118, and 118 blood loss;
    // with the Shard of Alexander 774 twice, then 991
    const weapon = getWeapon("Bloody Longsword");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Sword Dance", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      });
    const { attackSteps } = build();
    const shard = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Shard of Alexander"),
      3,
    );
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [673, 6, expect.closeTo(88.3, 1)],
        [673, 6, expect.closeTo(117.7, 1)],
      ],
      [[861, 7.5, expect.closeTo(117.7, 1)]],
    ]);
    expect(build(shard).attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([
      [774, 774],
      [991],
    ]);
  });

  it("matches The Poison Flower Blooms Twice in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy: the kick 765 with
    // 11 poise and 160 scarlet rot, and the projectile 300 with 9. On a poisoned or rotted target the
    // kick does 5% of its max HP plus 250 instead of the rot (3960 on the dummy's 74212 HP), about
    // 5025 in all in game.
    const weapon = getWeapon("Longsword");
    const flower = (target: string, buffs: BuffEffect[] = []) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("The Poison Flower Blooms Twice", target),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        enemyHp: 74212,
        buffs,
      });
    };
    const talisman = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Shattered Stone Talisman"),
      3,
    );
    // With the Shattered Stone Talisman (×1.1 for kicks and stomps): 842 and 330 (tested in game)
    expect(
      flower("Unafflicted target", talisman).attackSteps!.map((step) =>
        step.map((hit) => hit.damage),
      ),
    ).toEqual([[842, 330]]);
    const plain = flower("Unafflicted target");
    const bonus = flower("Poisoned or rotted target");
    expect(plain.attackSteps).toMatchObject([
      [
        { damage: 765, stance: 11, status: { [AttackPowerType.SCARLET_ROT]: 160 } },
        { damage: 300, stance: 9, status: {} },
      ],
    ]);
    expect(bonus.finalValue).toBe(5025);
    expect(bonus.attackStatus?.[AttackPowerType.SCARLET_ROT]).toBeFalsy();
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => label.startsWith("The Poison Flower")),
    ).toEqual([
      "The Poison Flower Blooms Twice (Unafflicted target)",
      "The Poison Flower Blooms Twice (Poisoned or rotted target)",
    ]);
  });

  it("matches Thunderbolt in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy: the bolt 554 with
    // 5 poise, 621 with the Lightning Scorpion Charm (×1.12 lightning)
    const weapon = getWeapon("Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Thunderbolt", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const charm = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Lightning Scorpion Charm"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance]));
    expect(build()).toEqual([[[554, 5]]]);
    expect(build(charm)).toEqual([[[621, 5]]]);
  });

  it("matches Troll's Roar in game", () => {
    // One chain entry: the roar, then the R2. The inner and outer roars hit one or the other, so only
    // the inner one counts, and so do the R2's direct hit and shockwave, so only the direct hit
    // counts. Tested in game on Great Stars +25 with 99 in every stat on the training dummy: the roar
    // 953, then the R2's direct hit 1226 (or its shockwave 506).
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => label.startsWith("Troll's Roar")),
    ).toEqual(["Troll's Roar"]);
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Troll's Roar", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([[953], [1226]]);
  });

  it("matches Unsheathe in game", () => {
    // Tested in game on an Uchigatana +25 with 99 in every stat on the training dummy: the R1 1109 with
    // 15 poise, the R2 1430 with 30, and 45 blood loss each
    const weapon = getWeapon("Uchigatana");
    const build = (followUp: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Unsheathe", followUp),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    };
    expect(build("R1")).toEqual([[[1109, 15, 45]]]);
    expect(build("R2")).toEqual([[[1430, 30, 45]]]);
  });

  it("matches Vacuum Slice in game", () => {
    // Tested in game on an Uchigatana +25 with 99 in every stat on the training dummy: the slash 385
    // with 7.5 poise and 45 blood loss, and the projectile 1029 with 20 poise
    const weapon = getWeapon("Uchigatana");
    const result = getAshAttack(ashes, movesets, weapon, "Vacuum Slice", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [385, 7.5, 45],
        [1029, 20, undefined],
      ],
    ]);
  });

  it("matches Wall of Sparks in game", () => {
    // Tested in game on a Firespark Perfume Bottle +25 with 99 in every stat on the training dummy:
    // 245, 490, 735, or 989 in all, explosions of 245 (1 to 4) and the odd spark of 9, so 1 explosion
    // counts, with a note
    const weapon = getWeapon("Firespark Perfume Bottle");
    const result = getAshAttack(ashes, movesets, weapon, "Wall of Sparks", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps, finalValue, attackNote } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([[245]]);
    expect(finalValue).toBe(245);
    expect(attackNote).toMatch(/up to four/);
  });

  it("matches Waves of Darkness in game", () => {
    // One chain entry. Tested in game on Great Stars +25 with 99 in every stat on the training dummy:
    // 822, 352, then the waves' three rings 590 each (2944), then the R2 953
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => label.startsWith("Waves of Darkness")),
    ).toEqual(["Waves of Darkness"]);
    const weapon = getWeapon("Great Stars");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Waves of Darkness", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([
      [822, 352, 590, 590, 590],
      [953],
    ]);
  });

  it("names shields', staves', and seals' default skill", () => {
    // Skill 10 is "No Skill"; the DLC's text has a "DLC dummy" placeholder for it, which isn't used
    for (const name of ["Glintstone Staff", "Finger Seal", "Kite Shield"]) {
      expect(ashes.weapons[name]?.skill).toBe("No Skill");
    }
    const seal = getAshAttack(ashes, movesets, getWeapon("Finger Seal"), "No Skill", false);
    expect(seal).toEqual({ unavailableReason: "No skill" });
  });

  it("does nothing with a skill whose weapon's requirements aren't met", () => {
    // A Longsword needs 10 Strength: a skill can't be used below that (its damage is 0), so the
    // optimizer levels Strength to meet it first
    const longsword = getWeapon("Longsword");
    const claw = getAshAttack(ashes, movesets, longsword, "Lion's Claw", false);
    if (!("attack" in claw)) throw new Error(claw.unavailableReason);
    const build = (maxLevels: number) =>
      optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: 0,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 8, dex: 13, int: 9, fai: 9, arc: 7 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels },
        attack: claw.attack,
      });
    const unmet = build(0);
    expect(unmet.skillRequirementsUnmet).toBe(true);
    expect(unmet.finalValue).toBe(0);
    const met = build(2);
    expect(met.skillRequirementsUnmet).toBeUndefined();
    expect(met.attributes.str).toBeGreaterThanOrEqual(10);
    expect(met.finalValue).toBeGreaterThan(0);
  });

  it("matches shields' own skills in game", () => {
    // Tested in game with 99 in every stat on the training dummy
    const skillHits = (weaponName: string, skill: string) => {
      const weapon = getWeapon(weaponName);
      const result = getAshAttack(ashes, movesets, weapon, skill, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      })
        .attackSteps!.flat()
        .map((hit) => [Math.floor(hit.damage), hit.stance, hit.status]);
    };
    // The Smithscript Shield's Discus Hurl (+25): 263 and 627, 5 poise each
    expect(skillHits("Smithscript Shield", "Discus Hurl")).toEqual([
      [263, 5, {}],
      [627, 5, {}],
    ]);
    // The Coil Shield's Viper Bite (+10): 638, 11 poise, and 322 poison
    expect(skillHits("Coil Shield", "Viper Bite")).toEqual([
      [638, 11, { [AttackPowerType.POISON]: 322 }],
    ]);
    // The Visage Shield's Tongues of Fire (+10): 501 and 13 poise each breath
    expect(skillHits("Visage Shield", "Tongues of Fire")).toEqual([[501, 13, {}]]);
    // The Visage Shield's Tongues of Fire, held: a breath every 60.75 frames (measured; its first 87
    // after L2), each pass of its loop starting with one
    const tongues = getAshAttack(
      ashes,
      movesets,
      getWeapon("Visage Shield"),
      "Tongues of Fire",
      false,
    );
    if (!("attack" in tongues)) throw new Error(tongues.unavailableReason);
    expect(tongues.attack.stepTimes![0].hits).toEqual([0]);
    expect(tongues.attack.cycleTimes![0] * 60).toBeCloseTo(60.75, 0);
    // The Shield of Night's Revenge of the Night, and its guard counter on its own, which only does
    // its bigger hit (tested in game: damage and poise right)
    const night = getAshAttacks(ashes, movesets, getWeapon("Shield of Night"), "", false);
    expect(
      night.map(({ ash, variant }) => [
        variant?.label,
        "attack" in ash ? ash.attack.steps.flat().map((hit) => hit.flatPoise) : [],
      ]),
    ).toEqual([
      ["Revenge of the Night", [3]],
      ["Revenge of the Night Guard Counter", [15]],
    ]);
    // The Erdtree Greatshield's Golden Retaliation (+10) on Rennala's second phase (109.3 defense,
    // 40% holy negation): its projectile's 831; its explosion is shown, not counted
    const retaliationWeapon = getWeapon("Erdtree Greatshield");
    const retaliation = getAshAttack(
      ashes,
      movesets,
      retaliationWeapon,
      "Golden Retaliation",
      false,
    );
    if (!("attack" in retaliation)) throw new Error(retaliation.unavailableReason);
    const retaliationHits = optimizeBuild({
      weapon: retaliationWeapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [
          damageType,
          { defense: 109.3, negation: damageType === AttackPowerType.HOLY ? 40 : 0 },
        ]),
      ),
      physicalNegation: { standard: -10, slash: 0, strike: -10, pierce: -10 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: retaliation.attack,
    }).attackSteps!.flat();
    expect(
      retaliationHits.map((hit) => [Math.floor(hit.damage), hit.kind, !!hit.notCounted]),
    ).toEqual([
      [831, "Projectile", false],
      [498, "Explosion", true],
    ]);
    // The Verdigris Greatshield's Moore's Charge only does poise damage: 30 charged
    const moore = getAshAttack(ashes, movesets, getWeapon("Verdigris Greatshield"), "", false);
    if (!("attack" in moore)) throw new Error(moore.unavailableReason);
    expect(
      moore.attack.steps
        .flat()
        .reduce((total, hit) => total + (moore.attack.poiseBase * hit.poiseMotionValue) / 100, 0),
    ).toBeCloseTo(30);
    expect(skillHits("Verdigris Greatshield", "Moore's Charge").map(([damage]) => damage)).toEqual(
      Array(6).fill(0),
    );
    // Its hits from its animation, matched by their poise: 72 to 152 frames after L2 (71 to 151 in
    // game), used again every 198 (as in game)
    expect(moore.attack.stepTimes![0].hits.map((time) => Math.round(time * 60))).toEqual([
      72, 86, 100, 114, 150, 152,
    ]);
    expect(Math.round(moore.attack.cycleTimes![0] * 60)).toBe(198);
    // The Madding Hand's Madding Spear-Hand Strike (+10): 730 and 15 poise (its 305 madness untested)
    expect(
      skillHits("Madding Hand", "Madding Spear-Hand Strike").map(([damage, poise]) => [
        damage,
        poise,
      ]),
    ).toEqual([[730, 15]]);
    // The Golden Lion Shield's Roaring Bash (+10): 467, its first strike alone
    expect(skillHits("Golden Lion Shield", "Roaring Bash").map(([damage]) => damage)).toEqual([
      467,
    ]);
  });

  it("has bows' skills, firing their ammunition", () => {
    const steps = (weaponName: string, choice: string) => {
      const result = getAshAttack(ashes, movesets, getWeapon(weaponName), choice, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack.steps;
    };
    // Mighty Shot fires an arrow at 153% of its attack (its own judge 811 for arrows), 300% poise
    const mighty = steps("Longbow", "Mighty Shot");
    expect(mighty.flat().map((hit) => [hit.motionValue, hit.poiseMotionValue])).toEqual([
      [153, 300],
    ]);
    // A greatbow's version fires a greatarrow: Rain of Arrows' 50% (70% for arrows), all 12 of its
    // arrows counted (it's best against big enemies)
    expect(steps("Greatbow", "Rain of Arrows").flat()[0].motionValue).toBe(50);
    expect(
      steps("Longbow", "Rain of Arrows")
        .flat()
        .map((hit) => hit.motionValue),
    ).toEqual(Array(12).fill(70));
    // Radahn's Rain can hit 16 times, at 36% of the arrow's attack each
    expect(
      steps("Lion Greatbow", "Radahn's Rain")
        .flat()
        .map((hit) => hit.motionValue),
    ).toEqual(Array(16).fill(36));
    // Its arrows land 168 to 249 frames after the press (measured in game at 60 fps)
    const radahn = getAshAttack(
      ashes,
      movesets,
      getWeapon("Lion Greatbow"),
      "Radahn's Rain",
      false,
    );
    if (!("attack" in radahn)) throw new Error(radahn.unavailableReason);
    const landed = radahn.attack.stepTimes![0].hitTimes!.map((time) => Math.round(time! * 60));
    expect([landed[0], landed[15]]).toEqual([168, 249]);
    // Rain of Arrows' land 133 to 176 frames after the press on a Longbow
    const rain = getAshAttack(ashes, movesets, getWeapon("Longbow"), "Rain of Arrows", false);
    if (!("attack" in rain)) throw new Error(rain.unavailableReason);
    const rainHits = rain.attack.stepTimes![0].hitTimes!.map((time) => Math.round(time! * 60));
    expect([rainHits[0], rainHits[11]]).toEqual([133, 176]);
    // The Igon's Greatbow's Igon's Drake Hunt with Igon's Harpoons does 1213 to the dummy (tested in
    // game at +25 with 99 in every stat): its 155%, and the bow's ×1.2 physical for the harpoon's
    // category 135
    const ammo: AmmoGroup[] = JSON.parse(
      readFileSync(new URL("../../public/ammo.json", import.meta.url), "utf8"),
    );
    const igonBow = withAmmo(
      getWeapon("Igon's Greatbow"),
      ammo.find((group) => group.names.includes("Igon's Harpoon"))!,
    );
    const igon = getAshAttack(ashes, movesets, igonBow, "Igon's Drake Hunt", false);
    if (!("attack" in igon)) throw new Error(igon.unavailableReason);
    const igonDamage = optimizeBuild({
      weapon: igonBow,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: igon.attack,
    }).attackSteps![0][0].damage;
    expect(Math.floor(igonDamage)).toBe(1213);
    // Some ammunition fires a skill differently: Rancor Shot with Bloodbone Arrows builds up 45% of
    // their blood loss, 75% with others (tested in game on the Bone Bow +25: 24 of a shot's 55)
    const rancor = (arrowName: string) => {
      const bow = withAmmo(
        getWeapon("Bone Bow"),
        ammo.find((group) => group.names.includes(arrowName))!,
      );
      const result = getAshAttack(ashes, movesets, bow, "Rancor Shot", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack.steps[0][0].statusMotionValue;
    };
    expect([rancor("Bloodbone Arrow"), rancor("Arrow")]).toEqual([45, 75]);
    // Through and Through on the Golem Greatbow +10 with Great Arrows: 1091 (tested in game)
    const golemBow = withAmmo(
      getWeapon("Golem Greatbow"),
      ammo.find((group) => group.names.includes("Great Arrow"))!,
    );
    const through = getAshAttack(ashes, movesets, golemBow, "Through and Through", false);
    if (!("attack" in through)) throw new Error(through.unavailableReason);
    expect(
      Math.floor(
        optimizeBuild({
          weapon: golemBow,
          regularUpgradeLevel: 25,
          twoHanding: true,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: through.attack,
        }).attackSteps![0][0].damage,
      ),
    ).toBe(1091);
    // Enchanted Shot on the Albinauric Bow +25 with Bloodbone Arrows does 418 and 82 blood loss
    // (tested in game, 99 in every stat)
    const albinauric = withAmmo(
      getWeapon("Albinauric Bow"),
      ammo.find((group) => group.names.includes("Bloodbone Arrow"))!,
    );
    const enchanted = getAshAttack(ashes, movesets, albinauric, "Enchanted Shot", false);
    if (!("attack" in enchanted)) throw new Error(enchanted.unavailableReason);
    const enchantedHit = optimizeBuild({
      weapon: albinauric,
      regularUpgradeLevel: 25,
      twoHanding: true,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: enchanted.attack,
    }).attackSteps![0][0];
    expect([
      Math.floor(enchantedHit.damage),
      Math.floor(enchantedHit.status![AttackPowerType.BLEED]!),
    ]).toEqual([418, 82]);
    // The Repeating Crossbow's Repeating Fire fires 12 bolts at 59% of their attack
    expect(
      steps("Repeating Crossbow", "Repeating Fire")
        .flat()
        .map((hit) => hit.motionValue),
    ).toEqual(Array(12).fill(59));
    // Readied each time: its first bolt 104 frames after L2, its last 186 (measured in game: 104, and
    // 28 to 110 frames after its R1)
    const repeating = getAshAttack(
      ashes,
      movesets,
      getWeapon("Repeating Crossbow"),
      "Repeating Fire",
      false,
    );
    if (!("attack" in repeating)) throw new Error(repeating.unavailableReason);
    const bolts = repeating.attack.stepTimes![0].hitTimes ?? repeating.attack.stepTimes![0].hits;
    expect([bolts[0], bolts[11]].map((time) => Math.round(time! * 60))).toEqual([104, 186]);
    // And used again 261 frames after the last (measured in game: first bolts at 361 and 622)
    expect(Math.round(repeating.attack.cycleTimes![0] * 60)).toBe(261);
    // The Black Bow (a bow) has Barrage, a light bow's Ash of War
    expect(
      steps("Black Bow", "Barrage")
        .flat()
        .map((hit) => hit.motionValue),
    ).toEqual([80]);
    // The One-Eyed Shield's Flame Spit: raising the shield, then spitting, its hit 122 frames after
    // the press and the next 278 after it (measured in game)
    const spit = getAshAttack(ashes, movesets, getWeapon("One-Eyed Shield"), "Flame Spit", false);
    if (!("attack" in spit)) throw new Error(spit.unavailableReason);
    expect(spit.attack.steps[0]).toHaveLength(1);
    expect(Math.round(spit.attack.stepTimes![0].hits[0] * 60)).toBe(122);
    expect(Math.round(spit.attack.cycleTimes![0] * 60)).toBe(278);
    // The Golden Lion Shield's Roaring Bash hits once, 150% (tested in game at +10 with 99 in every
    // stat: 467)
    expect(
      steps("Golden Lion Shield", "Roaring Bash")
        .flat()
        .map((hit) => hit.motionValue),
    ).toEqual([150]);
    // Golden Crux: #1's spikes 84 frames after L2 (87 in game), then its end, whose L2 cancel goes on
    // to #2 (its hit 184, as in game), then #1 again (372; 368)
    const crux = getAshAttack(
      ashes,
      movesets,
      getWeapon("Greatsword of Damnation"),
      withFollowUp("Golden Crux", " chain"),
      false,
    );
    if (!("attack" in crux)) throw new Error(crux.unavailableReason);
    const [cruxFirst, cruxSecond] = crux.attack.stepTimes!;
    const cruxCycle = crux.attack.cycleTimes!;
    expect([
      Math.round(cruxFirst.hits[0] * 60),
      Math.round((cruxCycle[0] + cruxSecond.hits[0]) * 60),
      Math.round((cruxCycle[0] + cruxCycle[1] + cruxFirst.hits[0]) * 60),
    ]).toEqual([84, 184, 372]);
    // Phantom Slash's phantom slashes 68 frames after L2 (66 and 70 in game), then its swing at 106
    // (110 in game)
    const phantom = getAshAttack(
      ashes,
      movesets,
      getWeapon("Halberd"),
      withFollowUp("Phantom Slash", " chain"),
      false,
    );
    if (!("attack" in phantom)) throw new Error(phantom.unavailableReason);
    expect(phantom.attack.stepTimes![0].hitTimes!.map((time) => Math.round(time! * 60))).toEqual([
      68, 106,
    ]);
    // Fan Shot fires 8 arrows, 2 of which can hit one target
    expect(steps("Ansbach's Longbow", "Fan Shot").flat()).toHaveLength(2);
  });

  it("times skills from their animations", () => {
    // Tested in game on 60 fps recordings, frames from the skill press
    const times = (weaponName: string, choice: string) => {
      const result = getAshAttack(ashes, movesets, getWeapon(weaponName), choice, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack;
    };
    const frames = (seconds: number) => Math.round(seconds * 60);
    // Storm Blade on a Longsword: the first hit 45 frames after the press, then 60 and 61 frames
    // apart (each step goes on to the next with another skill press)
    const storm = times("Longsword", withFollowUp("Storm Blade", " chain"));
    const stormHits = storm.stepTimes!.map((step, i) =>
      frames(storm.cycleTimes!.slice(0, i).reduce((sum, time) => sum + time, 0) + step.hits[0]),
    );
    expect(stormHits).toEqual([45, 105, 166]);
    // After its last step it goes back to its second (tested in game), so the first is only done
    // once: per second is steps 2 and 3's
    expect(storm.repeatFrom).toBe(1);
    const stormResult = optimizeBuild({
      weapon: getWeapon("Longsword"),
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: storm,
    });
    const repeatedDamage = stormResult
      .attackSteps!.slice(1)
      .flat()
      .reduce((sum, hit) => sum + hit.damage, 0);
    expect(stormResult.attackDps).toBeCloseTo(
      repeatedDamage / (storm.cycleTimes![1] + storm.cycleTimes![2]),
    );
    // Skills' stamina costs are their animations' behaviors': Lion's Claw 45, and each of Wild
    // Strikes' loop passes 18 (9 a hit) on a Claymore
    expect(times("Longsword", "Lion's Claw").stamina).toEqual([45]);
    expect(times("Claymore", "Wild Strikes").stamina).toEqual([18]);
    // So does Surge of Faith (its explosion again)
    expect(times("Cranial Vessel Candlestand", "Lion's Claw").repeatFrom).toBe(1);
    // Sword Dance on a Claymore (greatswords' version): 62 frames to its first hit, 24 to its
    // second, and 76 to its follow-up's
    const dance = times("Claymore", withFollowUp("Sword Dance", " chain"));
    const [first, second] = dance.stepTimes!;
    expect(first.hits.map(frames)).toEqual([62, 86]);
    expect(frames(dance.cycleTimes![0] + second.hits[0]) - frames(first.hits[1])).toBe(76);
    // Used again as soon as possible, a skill of artsSpeedType 1 goes at its quick L2 cancel (flag
    // 103), others at the normal one (104): Barbaric Roar's roars 72 and 74 frames apart, Gravitas's
    // first hits 159 (its quick cancel would be 139)
    // (the roar itself isn't an attack to pick, so from its data)
    expect(frames((ashes.skills["Barbaric Roar"].generic!.timing as any)["0"][""].L2)).toBe(72);
    expect(frames(times("Claymore", "Gravitas").cycleTimes![0])).toBe(159);
    // Spot checks: Braggart's Roar (type 2) roars 163 and 162 frames apart, the Zamor Curved Sword's
    // Zamor Ice Storm (type 2) 177 and 176, and Spinning Weapon (type 1) on a Halberd 160 and 160
    expect(frames((ashes.skills["Braggart's Roar"].generic!.timing as any)["0"][""].L2)).toBe(162);
    expect(frames(times("Zamor Curved Sword", "Zamor Ice Storm").cycleTimes![0])).toBe(176);
    expect(frames(times("Halberd", "Spinning Weapon").cycleTimes![0])).toBe(160);
    // Wild Strikes' loop, on a Claymore: a hit every 38 frames
    const loop = times("Claymore", "Wild Strikes");
    expect(frames(loop.cycleTimes![0])).toBe(76);
    // Ice Spear on a Short Spear (no spears' version of its own): its thrust 32 frames after the
    // press, and its projectile 44 later (45 and 46, as it flies)
    expect(times("Short Spear", "Ice Spear").stepTimes![0].hits.map(frames)).toEqual([32, 76]);
    // Flame Spear on a Longsword: its charged version plays from the press, and tapped, it switches to
    // its uncharged one once the charged one's charging window opens (with tapped R2s' lag): its
    // hits at 60 and 67 tapped (58 and 66 here), 107 and 112 charged (102 and 110)
    const flameSpear = (version: string) =>
      times("Longsword", withFollowUp("Flame Spear", version)).stepTimes![0].hits.map(frames);
    expect(flameSpear("Uncharged")).toEqual([58, 66]);
    expect(flameSpear("Charged")).toEqual([102, 110]);
    // Each hit's own time, where projectiles hit again: Ordovis's Vortex's charged vortex hits 3 times
    // (measured in game: 148, 164, and 179), approximate
    const ordovis = times("Ordovis's Greatsword", withFollowUp("Ordovis's Vortex", "Charged"))
      .stepTimes![0];
    expect(ordovis.hitTimes!.map((time) => frames(time!))).toEqual([132, 146, 164, 179]);
    expect(ordovis.approximate).toEqual([false, true, true, true]);
    // Leaps' hits are on landing, measured: Golden Slam's 128 frames after the press, and Gold
    // Breaker's 135 (its shockwave 8 after: 143 in game)
    expect(
      times("Claymore", "Golden Slam").stepTimes![0].hitTimes!.map((time) => frames(time!)),
    ).toEqual([128]);
    expect(
      times("Marika's Hammer", "Gold Breaker").stepTimes![0].hitTimes!.map((time) => frames(time!)),
    ).toEqual([135, 141]);
    expect(
      times("Club", "Ground Slam").stepTimes![0].hitTimes!.map((time) => frames(time!)),
    ).toEqual([108]);
    // Prelate's Charge pressed once: its start, then its finish (measured in game on a Great Mace: the
    // initial attack 75 frames after the press, the final attack 147), its ground fire's first burn
    // measured (122), and its stamina each window's (72, times the Great Mace's 1.06)
    const prelate = times("Great Mace", "Prelate's Charge");
    expect(prelate.stepTimes![0].hitTimes!.map((time) => frames(time!))).toEqual([
      74, 96, 111, 123, 122, 147,
    ]);
    expect(prelate.stamina).toEqual([76.32]);
  });

  it("matches Wild Strikes in game", () => {
    // A loop, offered on its own and each follow-up on its own
    expect(
      getAshChoices(ashes)
        .map(({ label }) => label)
        .filter((label) => label.startsWith("Wild Strikes")),
    ).toEqual(["Wild Strikes", "Wild Strikes (R1 follow-up)", "Wild Strikes (R2 follow-up)"]);
    // Tested in game on a Brick Hammer +25 with 99 in every stat on the training dummy: the loop's
    // swings 666 and 717, the R1 225 and 983, and the R2 219 and 1296
    const build = (followUp: string, weapon = getWeapon("Brick Hammer")) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        followUp ? withFollowUp("Wild Strikes", followUp) : "Wild Strikes",
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => hit.damage));
    };
    expect(build("")).toEqual([[666, 717]]);
    expect(build("R1")).toEqual([[225, 983]]);
    expect(build("R2")).toEqual([[219, 1296]]);
    // Also right in game on a Quality Scimitar +25: the swings 688 and 644, the R1 228 and 1021,
    // and the R2 228 and 1355
    const scimitar = getWeapon("Quality Scimitar");
    expect(build("", scimitar)).toEqual([[688, 644]]);
    expect(build("R1", scimitar)).toEqual([[228, 1021]]);
    expect(build("R2", scimitar)).toEqual([[228, 1355]]);
  });

  it("matches Aspects of the Crucible: Wings on each weapon class in game", () => {
    // Its versions differ by weapon class. Tested in game on Sacred weapons +25 with 99 in every stat
    // on the training dummy: a Dagger 1320 with 12 poise, a Broadsword (Straight Sword) 1583 with 20,
    // a Flamberge (Greatsword) 1816 with 22, a Fire Knight's Greatsword (Colossal Sword) 2089 with 24,
    // and a Twinblade's 8 hits 2014 with 20 in all
    const build = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Aspects of the Crucible: Wings", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      const steps = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!;
      const hits = steps.flat();
      return [
        hits.reduce((total, hit) => total + Math.floor(hit.damage), 0),
        hits.reduce((total, hit) => total + hit.stance, 0),
      ];
    };
    expect(build("Sacred Dagger")).toEqual([1320, 12]);
    expect(build("Sacred Broadsword")).toEqual([1583, 20]);
    expect(build("Sacred Flamberge")).toEqual([1816, 22]);
    expect(build("Fire Knight's Sacred Greatsword")).toEqual([2089, 24]);
    expect(build("Sacred Twinblade")).toEqual([2014, 20]);
  });

  it("matches Storm Blade with the Divine Beast buffs in game", () => {
    // Tested in game on a Longsword +25 with 99 in every stat on the training dummy: Storm Blade's
    // first hit 1091 with the Divine Beast Head (×1.04 in game, fitted: the data says ×1.05), and
    // with the Enraged Divine Beast too, 1201, then 3622 for all three (the same in vanilla)
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const weapon = getWeapon("Longsword");
    const result = getAshAttack(
      ashes,
      movesets,
      weapon,
      withFollowUp("Storm Blade", " chain"),
      false,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const steps = (names: string[]) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: getBuffEffects(
          allBuffs.filter((buff) => names.includes(buff.name)),
          1,
        ),
      }).attackSteps!.map((step) => step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0));
    expect(steps(["Divine Beast Head"])[0]).toBe(1091);
    const both = steps(["Divine Beast Head", "Enraged Divine Beast"]);
    expect(both[0]).toBe(1201);
    expect(both.reduce((sum, step) => sum + step, 0)).toBe(3622);
  });

  describe("buffs confirmed in game", () => {
    // Confirmed right in game at +25 (+10 somber) with 99 in every stat on the training dummy; the
    // values are the calculator's
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    // Buffs by name, or by prefix for armor sets ("Dancer's *")
    const buffsNamed = (names: string[]) =>
      allBuffs.filter((buff) =>
        names.some((name) =>
          name.endsWith("*") ? buff.name.startsWith(name.slice(0, -1)) : buff.name === name,
        ),
      );
    const steps = (
      weaponName: string,
      attack: AttackData,
      names: string[],
      {
        twoHanding = false,
        stackTier = 3,
        catalyst,
      }: { twoHanding?: boolean; stackTier?: 1 | 2 | 3; catalyst?: string } = {},
    ) =>
      optimizeBuild({
        weapon: getWeapon(weaponName),
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
        buffs: getBuffEffects(buffsNamed(names), stackTier),
        ...(catalyst && { catalyst: getWeapon(catalyst), catalystUpgradeLevel: 25 }),
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)));
    const moveset = (weaponName: string, attack: AttackChoice, twoHanding = false) =>
      getAttackData(movesets, getWeapon(weaponName), attack, twoHanding, 0.5)!;
    const skill = (weaponName: string, ash: string, twoHanding = false) => {
      const result = getAshAttack(ashes, movesets, getWeapon(weaponName), ash, twoHanding);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack;
    };

    it("stacks body buffs and aura buffs on the Longsword's R1", () => {
      const firstHit = (names: string[]) =>
        steps("Longsword", moveset("Longsword", "R1"), names)[0][0];
      expect(firstHit([])).toBe(490);
      // Exalted Flesh and Bloodboil Aromatic replace each other
      expect(firstHit(["Exalted Flesh"])).toBe(588);
      expect(firstHit(["Bloodboil Aromatic"])).toBe(637);
      // Rallying Standard stacks with Exalted Flesh
      expect(firstHit(["Exalted Flesh", "Rallying Standard"])).toBe(706);
      // Millicent's Prosthesis and the Rotten Winged Sword Insignia at each successive attack tier
      expect(
        ([1, 2, 3] as const).map(
          (stackTier) =>
            steps(
              "Longsword",
              moveset("Longsword", "R1"),
              ["Millicent's Prosthesis", "Rotten Winged Sword Insignia"],
              { stackTier },
            )[0][0],
        ),
      ).toEqual([540, 561, 615]);
      // Scholar's Armament cast with an Astrologer's Staff +25
      expect(
        steps("Longsword", moveset("Longsword", "R1"), ["Scholar's Armament"], {
          catalyst: "Astrologer's Staff",
        })[0][0],
      ).toBe(680);
    });

    it("boosts only the attacks talismans and armor are for", () => {
      // The Claw Talisman, jump attacks
      expect(steps("Longsword", moveset("Longsword", "Jumping R1"), [])).toEqual([[533]]);
      expect(steps("Longsword", moveset("Longsword", "Jumping R1"), ["Claw Talisman"])).toEqual([
        [613],
      ]);
      // The Twinblade Talisman, a chain's last hit
      expect(steps("Longsword", moveset("Longsword", "R1"), ["Twinblade Talisman"]).flat()).toEqual(
        [490, 496, 502, 508, 799],
      );
      // Leda's Armor and the Crossed-Trees: Lacerating for running attacks, Retaliatory for rolling
      // and backstep ones, and Leda's Armor for both
      const firstHits = (attack: AttackChoice) =>
        [[], ["Leda's Armor"], ["Retaliatory Crossed-Tree"], ["Lacerating Crossed-Tree"]].map(
          (names) => steps("Longsword", moveset("Longsword", attack), names)[0][0],
        );
      expect(firstHits("Running R1")).toEqual([521, 573, 521, 599]);
      expect(firstHits("Rolling R1")).toEqual([429, 472, 502, 429]);
      expect(firstHits("Backstep R1")).toEqual([429, 472, 502, 429]);
      // Hoarfrost Stomp with the Shattered Stone Talisman and Divine Bird Warrior Greaves
      expect(
        steps("Longsword", skill("Longsword", "Hoarfrost Stomp"), [
          "Shattered Stone Talisman",
          "Divine Bird Warrior Greaves",
        ]),
      ).toEqual([[177, 565]]);
      // Eochaid's Dancing Blade with the Dancer's set
      expect(
        steps("Regalia of Eochaid", skill("Regalia of Eochaid", "Eochaid's Dancing Blade"), [
          "Dancer's *",
        ]),
      ).toEqual([[142, 142, 142, 142, 142, 142, 142, 507, 619]]);
      // Glintstone Pebble with the Spellblade set
      expect(
        steps("Magic Longsword", skill("Magic Longsword", "Glintstone Pebble"), ["Spellblade's *"]),
      ).toEqual([[840], [1291]]);
    });

    it("boosts fixed skills and Ashes of War with armor and off-hand buffs", () => {
      // A fixed skill's version, by its label
      const version = (weaponName: string, label: string) => {
        const found = getAshAttacks(
          ashes,
          movesets,
          getWeapon(weaponName),
          "Lion's Claw",
          false,
        ).find(({ variant }) => variant?.label === label)!.ash;
        if (!("attack" in found)) throw new Error(found.unavailableReason);
        return found.attack;
      };
      // The Crucible set, uncharged Devonia's Vortex
      expect(
        steps("Devonia's Hammer", version("Devonia's Hammer", "Devonia's Vortex (Uncharged)"), [
          "Crucible *",
        ]),
      ).toEqual([[437, 437, 1753]]);
      // The Broken Gold Mask, Causality's Wrath at Tier 1
      expect(
        steps("Golden Order Flail", version("Golden Order Flail", "Causality's Wrath (Tier 1)"), [
          "Broken Gold Mask",
        ]),
      ).toEqual([[1027]]);
      // Freyja's Greatsword in the off hand, Savage Lion's Claw on a Longsword
      expect(
        steps("Longsword", skill("Longsword", "Savage Lion's Claw"), ["Freyja's Greatsword"]),
      ).toEqual([[1138], [331, 902]]);
    });

    it("matches attack power buffs and debuffs on the Longsword", () => {
      // The Blue Dancer Charm alone on a Longsword +0 (4.4 equip weight with the charm): its R1 143
      const longsword = getWeapon("Longsword");
      const r1 = optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: 0,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: moveset("Longsword", "R1"),
        buffs: getBuffEffects(buffsNamed(["Blue Dancer Charm"]), 3),
        equipWeight: 0.9,
      }).attackSteps![0][0];
      expect(Math.floor(r1.damage)).toBe(143);
      // The Silver Tear Mask's ×0.95 physical attack: the R2 605
      expect(steps("Longsword", moveset("Longsword", "R2"), ["Silver Tear Mask"])[0]).toEqual([
        605,
      ]);
      // Flame of the Redmanes with Soul Stifler and a Hefty Oil Pot on the enemy, 1669, and with the
      // Flame-Shrouding Cracked Tear alone, 1055
      const redmanes = skill("Longsword", "Flame of the Redmanes");
      expect(steps("Longsword", redmanes, ["Soul Stifler", "Hefty Oil Pot"])).toEqual([[1669]]);
      expect(steps("Longsword", redmanes, ["Flame-Shrouding Cracked Tear"])).toEqual([[1055]]);
    });

    it("matches the Dagger Talisman's critical hits", () => {
      // Tested in game: a Longsword's backstab 1414 (a point under the calculator's, within the
      // game's own variation: 407-408 at +0) and a Dagger's 1758 on the training dummy, and a
      // Longsword's riposte 1911 on the Weeping Peninsula's Leonine Misbegotten (×1.16, fitted)
      expect(steps("Longsword", moveset("Longsword", "Backstab"), ["Dagger Talisman"])).toEqual([
        [1415],
      ]);
      expect(steps("Dagger", moveset("Dagger", "Backstab"), ["Dagger Talisman"])).toEqual([[1758]]);
      const riposte = optimizeBuild({
        weapon: getWeapon("Longsword"),
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        // The Leonine Misbegotten's defenses and negation, as the enemy picker sets them
        defenses: {
          [AttackPowerType.PHYSICAL]: { defense: 104, negation: 0 },
          [AttackPowerType.MAGIC]: { defense: 104, negation: 0 },
          [AttackPowerType.FIRE]: { defense: 104, negation: 10 },
          [AttackPowerType.LIGHTNING]: { defense: 104, negation: 10 },
          [AttackPowerType.HOLY]: { defense: 104, negation: 20 },
        },
        physicalNegation: { standard: 10, slash: 0, strike: 10, pierce: 10 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: moveset("Longsword", "Riposte"),
        buffs: getBuffEffects(buffsNamed(["Dagger Talisman"]), 3),
      }).attackSteps![0][0];
      expect(Math.floor(riposte.damage)).toBe(1911);
    });

    it("matches roars' R2s with the Roar Medallion on each weapon class", () => {
      // R2 #1's total, one and two handed (Braggart's Roar's one handed R2s are the weapon's own)
      const firstStep = (weaponName: string, roar: string, twoHanding: boolean, chain: string) =>
        steps(
          weaponName,
          skill(weaponName, withFollowUp(roar, chain), twoHanding),
          ["Roar Medallion"],
          { twoHanding },
        )[0].reduce((sum, damage) => sum + damage, 0);
      const tested: [string, string, boolean, string, number][] = [
        ["Claymore", "War Cry", false, "R2 chain", 1135],
        ["Claymore", "War Cry", false, "Charged R2 chain", 1598],
        ["Claymore", "War Cry", true, "R2 chain", 1323],
        ["Claymore", "War Cry", true, "Charged R2 chain", 1808],
        ["Claymore", "Barbaric Roar", false, "R2 chain", 1665],
        ["Claymore", "Barbaric Roar", false, "Charged R2 chain", 2004],
        ["Claymore", "Barbaric Roar", true, "R2 chain", 1920],
        ["Claymore", "Barbaric Roar", true, "Charged R2 chain", 2275],
        ["Claymore", "Braggart's Roar", true, "R2 chain", 1322],
        ["Claymore", "Braggart's Roar", true, "Charged R2 chain", 1807],
        ["Greatsword", "War Cry", false, "R2 chain", 1314],
        ["Greatsword", "War Cry", false, "Charged R2 chain", 1899],
        ["Greatsword", "War Cry", true, "R2 chain", 1448],
        ["Greatsword", "War Cry", true, "Charged R2 chain", 2120],
        ["Greatsword", "Barbaric Roar", false, "R2 chain", 1994],
        ["Greatsword", "Barbaric Roar", false, "Charged R2 chain", 2384],
        ["Greatsword", "Barbaric Roar", true, "R2 chain", 2321],
        ["Greatsword", "Barbaric Roar", true, "Charged R2 chain", 2724],
        ["Greatsword", "Braggart's Roar", true, "R2 chain", 1446],
        ["Greatsword", "Braggart's Roar", true, "Charged R2 chain", 2118],
        ["Warped Axe", "War Cry", false, "R2 chain", 1071],
        ["Warped Axe", "War Cry", false, "Charged R2 chain", 1377],
        ["Warped Axe", "War Cry", true, "R2 chain", 1242],
        ["Warped Axe", "War Cry", true, "Charged R2 chain", 1573],
        ["Warped Axe", "Barbaric Roar", false, "R2 chain", 1480],
        ["Warped Axe", "Barbaric Roar", false, "Charged R2 chain", 1785],
        ["Warped Axe", "Barbaric Roar", true, "R2 chain", 1776],
        ["Warped Axe", "Barbaric Roar", true, "Charged R2 chain", 2111],
        ["Warped Axe", "Braggart's Roar", true, "R2 chain", 1242],
        ["Warped Axe", "Braggart's Roar", true, "Charged R2 chain", 1574],
        ["Greataxe", "War Cry", false, "R2 chain", 1313],
        ["Greataxe", "War Cry", false, "Charged R2 chain", 1829],
        ["Greataxe", "War Cry", true, "R2 chain", 1532],
        ["Greataxe", "War Cry", true, "Charged R2 chain", 2075],
        ["Greataxe", "Barbaric Roar", false, "R2 chain", 1905],
        ["Greataxe", "Barbaric Roar", false, "Charged R2 chain", 2284],
        ["Greataxe", "Barbaric Roar", true, "R2 chain", 2201],
        ["Greataxe", "Barbaric Roar", true, "Charged R2 chain", 2591],
        ["Greataxe", "Braggart's Roar", true, "R2 chain", 1531],
        ["Greataxe", "Braggart's Roar", true, "Charged R2 chain", 2075],
        ["Golem Fist", "War Cry", false, "R2 chain", 861],
        ["Golem Fist", "War Cry", false, "Charged R2 chain", 1128],
        ["Golem Fist", "War Cry", true, "R2 chain", 1298],
        ["Golem Fist", "War Cry", true, "Charged R2 chain", 1690],
        ["Golem Fist", "Barbaric Roar", false, "R2 chain", 1254],
        ["Golem Fist", "Barbaric Roar", false, "Charged R2 chain", 1529],
        ["Golem Fist", "Barbaric Roar", true, "R2 chain", 1806],
        ["Golem Fist", "Barbaric Roar", true, "Charged R2 chain", 1875],
        ["Golem Fist", "Braggart's Roar", true, "R2 chain", 1296],
        ["Golem Fist", "Braggart's Roar", true, "Charged R2 chain", 1688],
        ["Clayman's Harpoon", "War Cry", false, "R2 chain", 957],
        ["Clayman's Harpoon", "War Cry", false, "Charged R2 chain", 1301],
        ["Clayman's Harpoon", "War Cry", true, "R2 chain", 1094],
        ["Clayman's Harpoon", "War Cry", true, "Charged R2 chain", 1440],
        ["Clayman's Harpoon", "Barbaric Roar", false, "R2 chain", 1259],
        ["Clayman's Harpoon", "Barbaric Roar", false, "Charged R2 chain", 1549],
        ["Clayman's Harpoon", "Barbaric Roar", true, "R2 chain", 1457],
        ["Clayman's Harpoon", "Barbaric Roar", true, "Charged R2 chain", 1767],
        ["Clayman's Harpoon", "Braggart's Roar", true, "R2 chain", 1091],
        ["Clayman's Harpoon", "Braggart's Roar", true, "Charged R2 chain", 1437],
      ];
      for (const [weaponName, roar, twoHanding, chain, total] of tested) {
        expect([
          weaponName,
          roar,
          twoHanding,
          chain,
          firstStep(weaponName, roar, twoHanding, chain),
        ]).toEqual([weaponName, roar, twoHanding, chain, total]);
      }
      // The Beast Claw's Barbaric Roar two handed charged R2 #1, its third hit higher (unlike Fists')
      expect(
        steps(
          "Beast Claw",
          skill("Beast Claw", withFollowUp("Barbaric Roar", "Charged R2 chain"), true),
          ["Roar Medallion"],
          { twoHanding: true },
        )[0],
      ).toEqual([573, 573, 676]);
    });
  });

  it("boosts only Lightning Slash's stomp and slash with skill buffs", () => {
    // Tested in game on a Lightning Longsword +25 with 99 in every stat on the training dummy, with
    // the Death Knight set (×1.08 for Dragon Cult skills): 1836 in all, and with the Shard of
    // Alexander (×1.15 for skills): 1913, its projectile unboosted both times
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const weapon = getWeapon("Lightning Longsword");
    const result = getAshAttack(ashes, movesets, weapon, "Lightning Slash", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = (names: string[]) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: getBuffEffects(
          allBuffs.filter((buff) => names.some((name) => buff.name.startsWith(name))),
          1,
        ),
      }).attackSteps![0].map((hit) => Math.floor(hit.damage));
    expect(hits(["Death Knight"])).toEqual([137, 1061, 638]);
    expect(hits(["Shard of Alexander"])).toEqual([146, 1129, 638]);
  });

  it("matches weapon class versions of skills in game", () => {
    // Skills whose motion values differ by weapon class, each tested in game on a weapon of a class
    // with its own version, at +25 with 99 in every stat on the training dummy: the totals of the
    // steps given
    const total = (name: string, ash: string, steps?: number) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, ash, false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      })
        .attackSteps!.slice(0, steps)
        .flat()
        .reduce((sum, hit) => sum + Math.floor(hit.damage), 0);
    };
    const swordDance = withFollowUp("Sword Dance", " chain");
    const flameSkewer = withFollowUp("Flame Skewer", " chain");
    // Sword Dance's Great Katana version, its first move
    expect(total("Cold Reed Great Katana", swordDance, 1)).toBe(2054);
    // Its Spear version, both moves
    expect(total("Clayman's Harpoon", swordDance)).toBe(2233);
    // Flame Skewer's general version (a Thrusting Shield) and its Heavy Thrusting Sword one
    expect(total("Flame Art Dueling Shield", flameSkewer)).toBe(1708);
    expect(total("Flame Art Great Épée", flameSkewer)).toBe(1757);
    // Bloody Slash's Curved Greatsword version
    expect(total("Dismounter", "Bloody Slash")).toBe(1775);
    // Blood Tax's Dagger version
    expect(total("Occult Wakizashi", "Blood Tax")).toBe(906);
    // Shield Bash's Thrusting Shield version
    expect(total("Magic Carian Thrusting Shield", "Shield Bash")).toBe(640);
  });

  it("matches Wing Stance in game", () => {
    // Tested in game on a Blood Milady +25 with 99 in every stat on the training dummy: the R1 472, 480,
    // and 501 with 5.5, 2.75, and 8.25 poise and 94 blood loss each; the R2 1558 with 30.25 poise and
    // 118 blood loss
    const weapon = getWeapon("Blood Milady");
    // Timed from the Ash of War's animations (not the Milady's own skill's): its R1 goes on to another
    // R1 (or R2) at its R1 cancel, so the stance comes only before the first, 34 frames from L2 to the
    // R1. Tested in game at 60 fps: R1 pressed at 482, its hits at 518, 534, and 556, then 622, 638,
    // and 661, and 726, 742, and 764 (every 104 frames; the third hit 2 or 3 frames into its window)
    const r1 = getAshAttack(ashes, movesets, weapon, withFollowUp("Wing Stance", "R1"), false);
    if (!("attack" in r1)) throw new Error(r1.unavailableReason);
    const frames = (seconds: number) => Math.round(seconds * 60);
    expect(frames(r1.attack.stepTimes![0].opening!)).toBe(34);
    expect(r1.attack.stepTimes![0].hits.map(frames)).toEqual([36, 52, 72]);
    expect(r1.attack.cycleTimes!.map(frames)).toEqual([104]);
    const build = (followUp: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Wing Stance", followUp),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
      );
    };
    const bleed = expect.closeTo(94.1, 1);
    expect(build("R1")).toEqual([
      [
        [472, 5.5, bleed],
        [480, 2.75, bleed],
        [501, 8.25, bleed],
      ],
    ]);
    expect(build("R2")).toEqual([[[1558, 30.25, expect.closeTo(117.7, 1)]]]);
  });

  it("matches Glintstone Dart in game", () => {
    // The Glintstone Kris has a chain for its uncharged and charged dart, each then its R2.
    // Tested in game on a Glintstone Kris +10 with 99 in every stat on the training dummy: the dart
    // 959 with 3 poise or charged 1176 with 5.5, then the R2 746 with 30. With the Godfrey Icon, the
    // charged dart 1352 (×1.15), the rest the same.
    const weapon = getWeapon("Glintstone Kris");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
            buffs,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      });
    expect(build()).toEqual([
      ["Uncharged chain", [[[959, 3]], [[746, 30]]]],
      ["Charged chain", [[[1176, 5.5]], [[746, 30]]]],
    ]);
    expect(build(icon)).toEqual([
      ["Uncharged chain", [[[959, 3]], [[746, 30]]]],
      ["Charged chain", [[[1352, 5.5]], [[746, 30]]]],
    ]);
  });

  it("matches Blade of Gold in game", () => {
    // The Blade of Calling's skill. Tested in game on a Blade of Calling +10 with 99 in every stat on
    // the training dummy: one hit of 1226 with 10 poise.
    const weapon = getWeapon("Blade of Calling");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps).toMatchObject([[{ damage: 1226, stance: 10 }]]);
  });

  it("matches Repeating Thrust on the Scorpion's Stinger in game", () => {
    // Its fixed skill. Tested in game on a Scorpion's Stinger +10 with 99 in every stat on the training
    // dummy: 320, 209, 209, and 320, with 6, 1.2, 1.2, and 2.4 poise and 50, 25, 25, and 50 scarlet rot
    const weapon = getWeapon("Scorpion's Stinger");
    const result = getAshAttack(ashes, movesets, weapon, "Repeating Thrust", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps!.map((step) =>
        step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.SCARLET_ROT]]),
      ),
    ).toEqual([
      [
        [320, 6, 50],
        [209, 1.2, 25],
        [209, 1.2, 25],
        [320, 2.4, 50],
      ],
    ]);
  });

  it("matches Blade of Death in game", () => {
    // The Black Knife's skill: its projectile applies Destined Death, 0.045% of the enemy's max HP
    // (lowered to 90% by it) plus 4 every 0.1s for 5s, 51 ticks. Tested in game on the training dummy
    // (74212 HP) with 99 in every stat: 1090 for the projectile and the first tick (1056 and 34), and
    // 2916 in all with the Sacred Scorpion Charm (the projectile 1182, then 51 ticks of 34)
    const weapon = getWeapon("Black Knife");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const charm = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Sacred Scorpion Charm"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        enemyHp: 74212,
        buffs,
      });
    const plain = build();
    expect(plain.attackSteps![0][0].damage).toBe(1056);
    expect(plain.hpDamage).toEqual({ label: "Destined Death", damage: 51 * 34 });
    expect(build(charm).finalValue).toBe(2916);
  });

  it("matches Corpse Wax Cutter in game", () => {
    // The Gargoyle's Blackblade's skill: its projectile applies Destined Death (860), 0.1% of the
    // enemy's max HP plus 1 every 0.1s for 2s, 21 ticks of 75 on the training dummy (74212 HP).
    // Tested in game with 99 in every stat: 3062 in all
    const weapon = getWeapon("Gargoyle's Blackblade");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
      enemyHp: 74212,
    });
    expect(build.hpDamage).toEqual({ label: "Destined Death", damage: 21 * 75 });
    expect(build.finalValue).toBe(3062);
  });

  it("matches Ruinous Ghostflame in game", () => {
    // Helphen's Steeple's skill puts 110 magic and 80 frost a hit on the weapon (1806, 1809), then
    // swings. Tested in game on the training dummy with 99 in every stat: 1003, about 78 frost
    const weapon = getWeapon("Helphen's Steeple");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.finalValue).toBe(1003);
    expect(build.attackStatus![AttackPowerType.FROST]).toBeCloseTo(80, 0);
  });

  it("matches Shriek of Milos in game", () => {
    // The Sword of Milos's skill: its shriek gives the R2s War Cry's buff (1681) and the enemy takes
    // 5% more damage (the Shriek of Milos enemy debuff). Tested in game at +10 with 99 in every stat
    // on the training dummy, with the debuff: R2 #1 1738 (three hits), R2 #2 1155; charged R2 #1
    // 2082, charged R2 #2 1669. One handed: its two handed R2s have higher motion values
    const weapon = getWeapon("Sword of Milos");
    const debuff = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.kind === "debuff" && buff.name === "Shriek of Milos"),
      3,
    );
    const hits = (chain: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Shriek of Milos", chain),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: debuff,
      }).attackSteps!;
    };
    const damage = (chain: string) =>
      hits(chain).map((step) => step.map((hit) => Math.floor(hit.damage)));
    expect(damage("R2 chain")).toEqual([[563, 563, 612], [1155]]);
    expect(damage("Charged R2 chain")).toEqual([[681, 681, 720], [1669]]);
    // Its poise damage and blood loss are right too
    expect(hits("R2 chain").map((step) => step.map((hit) => hit.stance))).toEqual([
      [5.5, 5.5, 8.25],
      [11],
    ]);
    expect(
      hits("R2 chain").map((step) => step.map((hit) => hit.status[AttackPowerType.BLEED])),
    ).toEqual([[41.25, 41.25, 41.25], [82.5]]);
  });

  it("matches White Light Charge in game", () => {
    // The Ancient Meteoric Ore Greatsword's skill, one chain: the swing, then the projectile. Tested
    // in game at +10 with 99 in every stat on the training dummy (damage and poise)
    const weapon = getWeapon("Ancient Meteoric Ore Greatsword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["White Light Charge #1", "#2"]);
    expect(build.attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [736],
      [1713],
    ]);
    expect(build.attackSteps!.map((step) => step.map((hit) => hit.stance))).toEqual([[12], [24]]);
  });

  it("matches The Queen's Black Flame in game", () => {
    // The Godslayer's Greatsword's skill, one chain. Tested in game at +10 with 99 in every stat on
    // the training dummy (74212 HP): the first swing 606, the second 3634 with its black flame (21
    // ticks of 75), then the follow-up 3733 with its black flame
    const weapon = getWeapon("Godslayer's Greatsword");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
      enemyHp: 74212,
    });
    expect(result.attack.stepLabels).toEqual(["The Queen's Black Flame #1", "#2"]);
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => Math.floor(hit.damage) + (hit.hpDamage?.damage ?? 0)),
      ),
    ).toEqual([[606, 3634], [3733]]);
  });

  it("matches Lightspeed Slash in game", () => {
    // The Greatsword of Radahn (Light)'s skill, its swing without its fixed 20 holy (the game doesn't
    // add fixed flat attack to weapon hits). Tested in game at +10 with 99 in every stat on the
    // training dummy: 829 uncharged, 1147 charged. Its light beams strike at random, so it's noted
    const weapon = getWeapon("Greatsword of Radahn (Light)");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash }) => {
      if (!ash || !("attack" in ash)) throw new Error();
      return ash.attack;
    });
    const swings = results.map(
      (attack) =>
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack,
        }).attackSteps![0][0].damage,
    );
    expect(swings.map(Math.floor)).toEqual([829, 1147]);
    // The Godfrey Icon and the Shard of Alexander boost the charged swing but not its light beams:
    // totals of 2012, 2243, 2315, and 2474 with the icon are the swing's 1319 and three to five 231
    // beams (and a 72), and 2690 with the shard is 1319, five 231 beams, and three 72s
    const talisman = (name: string) =>
      getBuffEffects(
        (
          JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
            .buffs as Buff[]
        ).filter((buff) => buff.name === name),
        3,
      );
    const chargedWith = (buffs: BuffEffect[]) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: results[1],
        buffs,
      }).attackSteps![0].map((hit) => Math.floor(hit.damage));
    expect(chargedWith(talisman("Godfrey Icon"))).toEqual([1319, 231, 72]);
    expect(chargedWith(talisman("Shard of Alexander"))).toEqual([1319, 231, 72]);
    // Nor the uncharged ones: 1835 with the shard is the swing's 953, four 206 beams, and a 58 (the
    // calculator's big beam is 205.999, a hair under the game's 206: see the precision note)
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: results[0],
        buffs: talisman("Shard of Alexander"),
      }).attackSteps![0].map((hit) => Math.floor(hit.damage)),
    ).toEqual([953, 205, 58]);
    expect(results[0].note).toMatch(/at random/);
  });

  it("matches Promised Consort in game", () => {
    // The Greatsword of Radahn (Lord)'s skill, one chain: three steps, the first two with the same hits
    const weapon = getWeapon("Greatsword of Radahn (Lord)");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Promised Consort #1", "#2", "#3"]);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    // Tested in game at +10 with 99 in every stat on the training dummy: 4135 and 52 poise for the
    // whole chain, with only #3's last projectile hitting. The small ones are left out, and their
    // damage is in the note.
    const steps = build.attackSteps!;
    expect(steps.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [644, 664],
      [644, 664],
      [400, 440, 679],
    ]);
    expect(steps.flat().reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(4135);
    expect(steps.flat().reduce((sum, hit) => sum + hit.stance, 0)).toBe(52);
    expect(build.attackNote).toBe(
      "Doesn't count its small light projectiles, which may miss: 97 damage each",
    );
  });

  it("matches Maliketh's Black Blade's Destined Death in game", () => {
    // Its swings and projectiles each apply Destined Death (21 ticks), and the projectiles lower the
    // enemy's max HP to 90%, which most of the swings' ticks are of. Tested in game at +10 with 99 in
    // every stat on the training dummy (74212 HP): 9509 to 9726, more when the projectiles hit later
    const weapon = getWeapon("Maliketh's Black Blade");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
      enemyHp: 74212,
    });
    expect(build.attackSteps![0].map((hit) => Math.floor(hit.damage))).toEqual([
      692, 801, 323, 323, 323,
    ]);
    // Each a tick of 67 (0.1% of the lowered max HP, plus 1)
    expect(build.hpDamage).toEqual({ label: "Destined Death", damage: 5 * 21 * 67 });
    expect(build.finalValue).toBe(9497);
    expect(result.attack.note).toMatch(/a little more/);
  });

  it("matches Tremendous Phalanx in game", () => {
    // Moonrithyll's Knight Sword's skill, one chain: its 3 swords, then its R2
    const weapon = getWeapon("Moonrithyll's Knight Sword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Tremendous Phalanx #1", "#2"]);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    // Tested in game at +10 with 99 in every stat on the training dummy (damage and poise)
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([
      [
        [334, 8],
        [334, 8],
        [334, 8],
      ],
      [[1395, 15]],
    ]);
  });

  it("matches Wolf's Assault in game", () => {
    // The Royal Greatsword's skill. Tested in game at +10 with 99 in every stat on the training dummy
    // (damage, poise, and frost)
    const weapon = getWeapon("Royal Greatsword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps![0].map((hit) => [
        Math.floor(hit.damage),
        hit.stance,
        hit.status[AttackPowerType.FROST],
      ]),
    ).toEqual([
      [1340, 10.2, 100],
      [1444, 10.2, 60],
    ]);
  });

  it("matches Wave of Destruction in game", () => {
    // The Ruins Greatsword's skill. Tested in game at +10 with 99 in every stat on the training dummy
    // (damage and poise)
    const weapon = getWeapon("Ruins Greatsword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [662, 5.1],
      [1432, 18],
    ]);
  });

  it("matches Starcaller Cry in game", () => {
    // The Starscourge Greatsword's skill, a chain of two hits. Tested in game at +10 with 99 in every
    // stat on the training dummy: 685 and 15 poise, then 2461 and 10.2
    const weapon = getWeapon("Starscourge Greatsword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Starcaller Cry #1", "#2"]);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([[[685, 15]], [[2461, 10.2]]]);
  });

  it("matches the Troll Knight's Sword's Troll's Roar in game", () => {
    // Its own version of the skill, a chain like the Ash of War's. Tested in game at +10 with 99 in
    // every stat on the training dummy (damage and poise)
    const weapon = getWeapon("Troll Knight's Sword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Troll's Roar #1", "#2"]);
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([[[1003, 40]], [[1695, 36]]]);
    // The Troll's Hammer's, also right in game at +25 with 99 in every stat: 953 with 40 poise, then
    // 1546 with 45
    const hammer = getWeapon("Troll's Hammer");
    const hammerVariants = getAshAttacks(ashes, movesets, hammer, "Lion's Claw", false);
    expect(hammerVariants).toHaveLength(1);
    const hammerResult = hammerVariants[0].ash;
    if (!("attack" in hammerResult)) throw new Error(hammerResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: hammer,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: hammerResult.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([[[953, 40]], [[1546, 45]]]);
  });

  it("matches the Carian Sorcery Sword's Impaling Thrust in game", () => {
    // Its physical damage scales with Intelligence (AttackElementCorrectParam 20010800), at its staff
    // upgrades' 202% at +25: 1035. The Boss Arena mod it was tested with gives it the standard
    // scaling instead (10000: physical with Strength and Dexterity only), so the test does too. To do:
    // test it in vanilla to confirm the 1035.
    // Tested in game at +25 with 99 in every stat on the training dummy: 795 (damage and poise)
    const vanilla = getWeapon("Carian Sorcery Sword");
    expect(vanilla.attackElementCorrect[AttackPowerType.PHYSICAL]).toEqual({
      str: true,
      dex: true,
      int: true,
    });
    const weapon: Weapon = {
      ...vanilla,
      attackElementCorrect: {
        ...vanilla.attackElementCorrect,
        [AttackPowerType.PHYSICAL]: { str: true as const, dex: true as const },
      },
    };
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [795, 24],
    ]);
    // Its R1s too: the first does 345 in game. And unlike a staff's or seal's, its attack power isn't
    // the menu's misleading catalyst scaling
    const r1 = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "R1", false, 0.5),
    });
    expect(Math.floor(r1.attackSteps![0][0].damage)).toBe(345);
    expect(build.menuAttackPower).toBe(false);
    // In vanilla, with Intelligence
    expect(
      Math.floor(
        optimizeBuild({
          weapon: vanilla,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: result.attack,
        }).attackSteps![0][0].damage,
      ),
    ).toBe(1035);
  });

  it("matches the Frozen Needle's Impaling Thrust in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy (damage, poise, and frost)
    const weapon = getWeapon("Frozen Needle");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps![0].map((hit) => [
        Math.floor(hit.damage),
        hit.stance,
        hit.status[AttackPowerType.FROST],
      ]),
    ).toEqual([[899, 24, 60]]);
    // The Crystal Spear's, also right in game at +25 with 99 in every stat: 1139 with 30 poise
    const crystal = getWeapon("Crystal Spear");
    const crystalResult = getAshAttack(ashes, movesets, crystal, "Lion's Claw", false);
    if (!("attack" in crystalResult)) throw new Error(crystalResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: crystal,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: crystalResult.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([[[1139, 30]]]);
  });

  it("times War Cry's R2 chains", () => {
    // Its buffed R2s on a Greataxe, chained as fast as possible in game (60 fps), from the R2 #1
    // press: R2 #1's hit, R2 #2's, and the next R2 #1's. Measured one handed 57, 127, 225 (charged
    // 142, 299, 483), and two handed 59, 129, 232 (charged 144, 301, 486)
    const frames = (seconds: number) => Math.round(seconds * 60);
    const chain = (version: string, twoHanding: boolean) => {
      const ash = getAshAttack(
        ashes,
        movesets,
        getWeapon("Greataxe"),
        withFollowUp("War Cry", version),
        twoHanding,
      );
      if (!("attack" in ash)) throw new Error(ash.unavailableReason);
      const [first, second] = ash.attack.stepTimes!;
      const [firstCycle, secondCycle] = ash.attack.cycleTimes!;
      return [
        first.hits[0],
        firstCycle + second.hits[0],
        firstCycle + secondCycle + first.hits[0],
      ].map(frames);
    };
    expect(chain("R2 chain", false)).toEqual([58, 128, 228]);
    expect(chain("Charged R2 chain", false)).toEqual([142, 298, 484]);
    expect(chain("R2 chain", true)).toEqual([58, 128, 232]);
    expect(chain("Charged R2 chain", true)).toEqual([142, 300, 484]);
  });

  it("times Barbaric Roar's R2 chains", () => {
    // Its buffed R2s on a Greataxe, chained as fast as possible in game (60 fps), from the R2 #1
    // press: R2 #1's three hits, R2 #2's, and the next R2 #1's first. Measured one handed 84, 115,
    // 165, 297, 441 (charged 103, 135, 190, 335, 506), and two handed 83, 116, 166, 293, 432 (charged
    // 106, 138, 192, 338, 508): the cycles within 3 frames, R2 #1's hits up to 8 frames later than
    // their windows (more two handed, though its animations' windows are 2-4 frames sooner)
    const frames = (seconds: number) => Math.round(seconds * 60);
    const chain = (version: string, twoHanding: boolean) => {
      const ash = getAshAttack(
        ashes,
        movesets,
        getWeapon("Greataxe"),
        withFollowUp("Barbaric Roar", version),
        twoHanding,
      );
      if (!("attack" in ash)) throw new Error(ash.unavailableReason);
      const [first, second] = ash.attack.stepTimes!;
      const [firstCycle, secondCycle] = ash.attack.cycleTimes!;
      return [
        ...first.hits,
        firstCycle + second.hits[0],
        firstCycle + secondCycle + first.hits[0],
      ].map(frames);
    };
    expect(chain("R2 chain", false)).toEqual([80, 114, 164, 298, 440]);
    expect(chain("Charged R2 chain", false)).toEqual([100, 132, 188, 336, 504]);
    expect(chain("R2 chain", true)).toEqual([78, 110, 162, 294, 430]);
    expect(chain("Charged R2 chain", true)).toEqual([98, 132, 188, 336, 500]);
  });

  it("times Golden Tempering's R2s", () => {
    // The Ornamental Straight Sword's R2 with its skill's buff, repeated as fast as possible in game
    // (60 fps): R2 pressed at 2161, hits at 2202, 2270, and 2342 (each at the last's R2 cancel). Its
    // charged R2's first hit 74 frames after the press and its last 216 (73 and 213 calculated); re-pressing
    // R2 for the next one (not holding it through the cancel) took 9 frames longer
    const frames = (seconds: number) => Math.round(seconds * 60);
    const ash = getAshAttack(
      ashes,
      movesets,
      getWeapon("Ornamental Straight Sword"),
      withFollowUp("Golden Tempering", "R2"),
      false,
    );
    if (!("attack" in ash)) throw new Error(ash.unavailableReason);
    expect(frames(ash.attack.stepTimes![0].hits[0])).toBe(43);
    expect(ash.attack.cycleTimes!.map(frames)).toEqual([69]);
    // Charged, holding R2 down through its R2 cancel: first hits 239 frames apart (3347, 3586)
    const charged = getAshAttack(
      ashes,
      movesets,
      getWeapon("Ornamental Straight Sword"),
      withFollowUp("Golden Tempering", "Charged R2"),
      false,
    );
    if (!("attack" in charged)) throw new Error(charged.unavailableReason);
    expect(charged.attack.cycleTimes!.map(frames)).toEqual([239]);
  });

  it("matches Dynast's Finesse in game", () => {
    // The Bloody Helice's skill, one chain labeled "Follow-up R2": its thrust, then the follow-up R2.
    // Tested in game at +25 with 99 in every stat on the training dummy (damage, poise, and blood loss)
    const weapon = getWeapon("Bloody Helice");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants.map(({ variant }) => variant)).toEqual([
      { label: "Dynast's Finesse (Follow-up R2)", short: "Follow-up R2" },
    ]);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    // Chained as fast as possible (60 fps): the thrust's hit at 1674, the follow-up R2's at 1726 and
    // 1751 (pressed at the thrust's R2 cancel), and the next thrust's at 1890 (L2 at the follow-up's
    // L2 cancel, its backstep, then R2 at the backstep's cancel)
    const frames = (seconds: number) => Math.round(seconds * 60);
    const [thrust, followUp] = result.attack.stepTimes!;
    const thrustCycle = result.attack.cycleTimes![0];
    const chainCycle = thrustCycle + result.attack.cycleTimes![1];
    expect(followUp.hits.map((time) => frames(thrustCycle + time - thrust.hits[0]))).toEqual([
      52, 78,
    ]);
    expect(frames(chainCycle)).toBe(1890 - 1674);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [[1299, 33, 104.5]],
      [
        [607, 11, 104.5],
        [647, 11, 104.5],
      ],
    ]);
  });

  it("matches Thundercloud Form in game", () => {
    // The Dragon King's Cragblade's skill. Tested in game at +10 with 99 in every stat on the training
    // dummy: uncharged right as it was (its lightning once), charged 2783 and 45 poise in all (its
    // lightning loops 6 times)
    const weapon = getWeapon("Dragon King's Cragblade");
    const totals = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        const steps = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!.flat();
        return [
          variant?.short,
          steps.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
          steps.reduce((sum, hit) => sum + hit.stance, 0),
        ];
      },
    );
    expect(totals).toEqual([
      ["Uncharged", 1661, 13],
      ["Charged", 2783, 45],
    ]);
  });

  it("matches Unending Dance in game", () => {
    // The Dancing Blade of Ranah's skill: its opening slash, then 12 looping slashes. Tested in game
    // at +25 with 99 in every stat on the training dummy: right, varying with how long it's held
    // (the loop cycles while it's held, and can stop early; noted)
    const weapon = getWeapon("Dancing Blade of Ranah");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => Math.floor(hit.damage))).toEqual([
      526, 319, 409, 319, 319, 319, 319, 526, 585, 409, 297, 585, 319,
    ]);
    expect(build.finalValue).toBe(5251);
    expect(result.attack.note).toMatch(/while the skill is held/);
  });

  it("matches Death Flare in game", () => {
    // The Eclipse Shotel's skill, labeled as a follow-up. Tested in game at +25 with 99 in every stat
    // on the training dummy (damage and poise)
    const weapon = getWeapon("Eclipse Shotel");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants.map(({ variant }) => variant)).toEqual([
      { label: "Death Flare (Follow-up)", short: "Follow-up" },
    ]);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [1153, 30],
    ]);
  });

  it("matches Revenger's Blade in game", () => {
    // The Falx's skill: its slash, or its charged slash, each followed by its R2. Tested in game at
    // +25 with 99 in every stat on the training dummy: the slash and R2 right (damage, poise, and
    // blood loss), the charged slash 1327, 15 poise, and 110 blood loss
    const weapon = getWeapon("Falx");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        const steps = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!;
        const total = (step: typeof steps[number]) => [
          step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
          step.reduce((sum, hit) => sum + hit.stance, 0),
          step.reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
        ];
        return [variant?.label, ...steps.map(total)];
      },
    );
    expect(results).toEqual([
      ["Revenger's Blade", [1370, 10, 110], [2684, 24.5, 385]],
      ["Revenger's Blade (Charged)", [1327, 15, 110], [2684, 24.5, 385]],
    ]);
  });

  it("matches Horn Calling in game", () => {
    // The Horned Warrior's Sword's skill: its slash and its projectile. Tested in game at +10 with 99
    // in every stat on the training dummy (damage and poise)
    const weapon = getWeapon("Horned Warrior's Sword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [610, 5],
      [1106, 12],
    ]);
  });

  it("matches Magma Shower in game", () => {
    // The Magma Blade's skill, one chain: its slash and magma, then its follow-up. Tested in game at
    // +25 with 99 in every stat on the training dummy: poise right, and its magma's pool can hit many
    // times, counted at the most seen: 1119 for #1, its 619 slash and 4 hits of 125, and 3239 with #2's
    // 346 and 774 and 8 more
    const weapon = getWeapon("Magma Blade");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Magma Shower #1", "#2"]);
    const steps = build.attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)));
    expect(steps).toEqual([
      [619, 125, 125, 125, 125],
      [346, 774, 125, 125, 125, 125, 125, 125, 125, 125],
    ]);
    const total = (step: number[]) => step.reduce((sum, damage) => sum + damage, 0);
    expect(total(steps[0])).toBe(1119);
    expect(total(steps[0]) + total(steps[1])).toBe(3239);
    // With the Talisman of the Dread (×1.15 for its hits, category 123), also right in game
    const dread = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Talisman of the Dread"),
      3,
    );
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: dread,
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage))),
    ).toEqual([
      [712, 144, 144, 144, 144],
      [397, 890, 144, 144, 144, 144, 144, 144, 144, 144],
    ]);
  });

  it("matches Flowing Form in game", () => {
    // The Nox Flowing Sword's skill. Tested in game at +25 with 99 in every stat on the training dummy
    // (damage and poise)
    const weapon = getWeapon("Nox Flowing Sword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([[[1196, 22]]]);
  });

  it("matches Rancor Slash in game", () => {
    // The Spirit Sword's and Spirit Glaive's skill, one chain: its 2 slashes and 2 spirit projectiles,
    // then its follow-up and 3 more. Every hit gets the skill's 20 magic buff. Tested in game on the
    // Spirit Sword +10 with 99 in every stat on the training dummy: the 5 spirits 995 by themselves,
    // #1 1142, and 2042 with #2 (one spirit missed: 2241 if all hit), and poise right
    for (const name of ["Spirit Sword", "Spirit Glaive"]) {
      const variants = getAshAttacks(ashes, movesets, getWeapon(name), "Lion's Claw", false);
      expect(variants).toHaveLength(1);
      const result = variants[0].ash;
      if (!result || !("attack" in result)) throw new Error();
      expect(result.attack.stepLabels).toEqual(["Rancor Slash #1", "#2"]);
    }
    const weapon = getWeapon("Spirit Sword");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)));
    expect(steps).toEqual([
      [372, 372, 199, 199],
      [502, 199, 199, 199],
    ]);
    expect(steps[0].reduce((sum, damage) => sum + damage, 0)).toBe(1142);
    // The Spirit Glaive's, also right in game at +10 with 99 in every stat
    const glaive = getWeapon("Spirit Glaive");
    const glaiveResult = getAshAttack(ashes, movesets, glaive, "Lion's Claw", false);
    if (!("attack" in glaiveResult)) throw new Error(glaiveResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: glaive,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: glaiveResult.attack,
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage))),
    ).toEqual([
      [502, 502, 196, 196],
      [673, 196, 196, 196],
    ]);
    // Frost: the buff's 80 on the slashes, times their status motion value and share of the buff (75%
    // each for the first two): about 170 for all three in game, none on the spirits
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => hit.status[AttackPowerType.FROST])),
    ).toEqual([
      [45, 45, undefined, undefined],
      [80, undefined, undefined, undefined],
    ]);
  });

  it("matches the Wing of Astel's and Bastard's Stars' Nebula in game", () => {
    // Its 11 explosions can each hit, 4 on a human-sized enemy: counted, and noted. Tested in game at
    // +25 with 99 in every stat on the training dummy: 703 and 13 poise each
    const weapon = getWeapon("Wing of Astel");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual(
      Array.from({ length: 4 }, () => [703, 13]),
    );
    expect(build.attackNote).toMatch(/4 of its 11 explosions/);
    // The Bastard's Stars' version has its own note: its swing and its projectile, which can hit
    // several times. Tested in game at +10 with 99 in every stat: its numbers right
    const starsWeapon = getWeapon("Bastard's Stars");
    const stars = getAshAttack(ashes, movesets, starsWeapon, "Lion's Claw", false);
    if (!("attack" in stars)) throw new Error(stars.unavailableReason);
    expect(stars.attack.note).toBe("Counts one hit of its projectile, which can hit several times");
    expect(
      optimizeBuild({
        weapon: starsWeapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: stars.attack,
      }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]),
    ).toEqual([
      [1006, 9],
      [1062, 13],
    ]);
  });

  it("matches Bloodhound's Finesse in game", () => {
    // The Bloodhound's Fang's skill, one chain: its slash, then its R2. Tested in game at +10 with 99
    // in every stat on the training dummy
    const weapon = getWeapon("Bloodhound's Fang");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Bloodhound's Finesse #1", "#2"]);
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([[[1658, 22, 55]], [[1785, 22, 55]]]);
  });

  it("matches Horn Calling: Storm in game", () => {
    // The Horned Warrior's Greatsword's skill, one chain of three steps. Each slash fires a wind
    // projectile, but only the first hits, and only point blank, so it's left out. Tested in
    // game at +25 with 99 in every stat on the training dummy: 1919 for #1 (with the 131 wind), 3741
    // with #2, and 5597 with #3
    const weapon = getWeapon("Horned Warrior's Greatsword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Horn Calling: Storm #1", "#2", "#3"]);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    const steps = build.attackSteps!.map((step) =>
      step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
    );
    expect(steps).toEqual([1919 - 131, 3741 - 1919, 5597 - 3741]);
    expect(build.attackNote).toBeUndefined();
  });

  it("matches Magma Guillotine in game", () => {
    // The Magma Wyrm's Scalesword's skill, one chain: its slash and 5 hits of its lava (its explosion
    // doesn't add to the slash), then its follow-up. Tested in game at +25 with 99 in every stat on
    // the training dummy: 1566 for the slash, 2526 with the lava, 4841 with the follow-up
    const weapon = getWeapon("Magma Wyrm's Scalesword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Magma Guillotine #1", "#2"]);
    const steps = build.attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)));
    expect(steps).toEqual([
      [1566, 192, 192, 192, 192, 192],
      [650, 1665],
    ]);
    const total = (step: number[]) => step.reduce((sum, damage) => sum + damage, 0);
    expect(total(steps[0])).toBe(2526);
    expect(total(steps[0]) + total(steps[1])).toBe(4841);
    // Poise right too, and the lava hits are hits, not damage over time
    expect(build.attackSteps!.flat().map((hit) => hit.stance)).toEqual([
      16.5, 0, 0, 0, 0, 0, 33, 5.5,
    ]);
    expect(build.attackSteps!.flat().some((hit) => hit.tick)).toBe(false);
    // With the Talisman of the Dread (×1.15 for its hits, category 123), also right in game
    const dread = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Talisman of the Dread"),
      3,
    );
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: dread,
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage))),
    ).toEqual([
      [1801, 221, 221, 221, 221, 221],
      [747, 1915],
    ]);
  });

  it("matches Cursed-Blood Slice in game", () => {
    // Morgott's Cursed Sword's skill, one chain: its slash, then its follow-up. Tested in game at +10
    // with 99 in every stat on the training dummy (damage, poise, and blood loss)
    const weapon = getWeapon("Morgott's Cursed Sword");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Cursed-Blood Slice #1", "#2"]);
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [851, 10.12, 101.64],
        [226, 8, 64.68],
      ],
      [[851, 13.2, 101.64]],
    ]);
  });

  it("matches Onyx Lords' Repulsion in game", () => {
    // The Onyx Lord's Greatsword's skill: its swing and one of its three rings. Tested in game at +10
    // with 99 in every stat on the training dummy (damage and poise)
    const weapon = getWeapon("Onyx Lord's Greatsword");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([
      [
        [744, 5.5],
        [1368, 20],
      ],
    ]);
  });

  it("matches Zamor Ice Storm in game", () => {
    // The Zamor Curved Sword's skill: its swing and 5 projectile hits (one, and one that hits 4 times),
    // without its lingering frost. Tested in game at +25 with 99 in every stat on the training dummy:
    // 2075 and about 770 frost
    const weapon = getWeapon("Zamor Curved Sword");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => Math.floor(hit.damage))).toEqual([
      385, 338, 338, 338, 338, 338,
    ]);
    expect(build.finalValue).toBe(2075);
    expect(build.attackStatus![AttackPowerType.FROST]).toBe(790);
    // Poise right too: its projectiles' flat poise adds to their motion value's (Revenger's Blade)
    expect(build.attackSteps![0].map((hit) => hit.stance)).toEqual([5.5, 7.5, 7.5, 7.5, 7.5, 7.5]);
  });

  it("matches Deadly Dance in game", () => {
    // Curseblade's Cirque's skill, one chain: its dance, then its follow-up. Tested in game at +25 with
    // 99 in every stat on the training dummy (damage, poise, and blood loss)
    const weapon = getWeapon("Curseblade's Cirque");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Deadly Dance #1", "#2"]);
    const dance = [421, 4, 11.25];
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([[dance, dance, dance, dance], [[927, 20, undefined]]]);
  });

  it("matches Ice Lightning Sword in game", () => {
    // The Dragonscale Blade's skill puts the Dragon Halberd's 160 lightning and 80 frost on it. Tested
    // in game at +10 with 99 in every stat on the training dummy: 1792 damage (the stomp lightning
    // 167, 161 here for its 30 flat lightning, not yet explained; the slash and projectile right),
    // about 148 frost (its slash's own 70 and the buff's), and poise right
    const weapon = getWeapon("Dragonscale Blade");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackStatus![AttackPowerType.FROST]).toBe(150);
    expect(build.attackSteps![0].map((hit) => hit.stance)).toEqual([2, 15, 5]);
    // The game's stomp lightning is 167
    expect(build.attackSteps![0].map((hit) => Math.floor(hit.damage))).toEqual([161, 1359, 266]);
  });

  it("matches Waterfowl Dance and the Meteoric Ore Blade's Gravitas in game", () => {
    // Tested in game at +10 with 99 in every stat on the training dummy (damage, poise, and status)
    const steps = (name: string) => {
      const weapon = getWeapon(name);
      const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
      expect(variants).toHaveLength(1);
      const result = variants[0].ash;
      if (!result || !("attack" in result)) throw new Error();
      return {
        labels: result.attack.stepLabels,
        hits: optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: result.attack,
        }).attackSteps!.map((step) =>
          step.map((hit) => [
            Math.floor(hit.damage),
            hit.stance,
            hit.status[AttackPowerType.BLEED] ?? 0,
          ]),
        ),
      };
    };
    // The Hand of Malenia's Waterfowl Dance, one chain of its three flurries
    expect(steps("Hand of Malenia")).toEqual({
      labels: ["Waterfowl Dance #1", "#2", "#3"],
      hits: [
        [
          [374, 3.5, 25],
          [374, 3.5, 25],
          [374, 3.5, 25],
          [478, 4.25, 25],
        ],
        [
          [584, 5, 25],
          [918, 7.5, 25],
        ],
        [
          [443, 4, 25],
          [443, 4, 25],
          [792, 6.5, 25],
          [584, 5, 25],
        ],
      ],
    });
    // The Meteoric Ore Blade's Gravitas: its swing and 3 projectiles
    expect(steps("Meteoric Ore Blade").hits).toEqual([
      [
        [669, 5, 50],
        [251, 0, 0],
        [251, 0, 0],
        [251, 20, 0],
      ],
    ]);
  });

  it("matches Transient Moonlight in game", () => {
    // Moonveil's skill, its R1 and R2 versions: the slash and its projectile. Tested in game at +10
    // with 99 in every stat on the training dummy (damage, poise, and blood loss)
    const weapon = getWeapon("Moonveil");
    const versions = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps![0].map((hit) => [
            Math.floor(hit.damage),
            hit.stance,
            hit.status[AttackPowerType.BLEED],
          ]),
        ];
      },
    );
    expect(versions).toEqual([
      [
        "R1",
        [
          [245, 22.5, 50],
          [1048, 5, undefined],
        ],
      ],
      [
        "R2",
        [
          [284, 22.5, 50],
          [1160, 7.5, undefined],
        ],
      ],
    ]);
  });

  it("matches Corpse Piler in game", () => {
    // The Rivers of Blood's skill: three steps of slashes, each hitting with the blade or its blood
    // extension, not both (seen in game), so the extensions are left out. Tested in game at +10 with
    // 99 in every stat on the training dummy: damage and poise right, the first slash about 77 blood
    // loss (about 600 for the chain)
    const weapon = getWeapon("Rivers of Blood");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Corpse Piler #1", "#2", "#3"]);
    expect(result.attack.steps.flat().some((hit) => hit.kind)).toBe(false);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!;
    expect(steps.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [561, 582],
      [502, 517, 648],
      [1015],
    ]);
    expect(steps[0][0].status[AttackPowerType.BLEED]).toBeCloseTo(77, 0);
    expect(
      steps.flat().reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
    ).toBeCloseTo(595, 0);
  });

  it("matches Onze's Line of Stars in game", () => {
    // The Star-Lined Sword's skill, one chain of its three steps. Tested in game at +25 with 99 in
    // every stat on the training dummy (damage, poise, and blood loss)
    const variants = getAshAttacks(
      ashes,
      movesets,
      getWeapon("Star-Lined Sword"),
      "Lion's Claw",
      false,
    );
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Onze's Line of Stars #1", "#2", "#3"]);
    expect(result.attack.steps.map((step) => step.length)).toEqual([2, 2, 2]);
    const weapon = getWeapon("Star-Lined Sword");
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.BLEED]]),
      ),
    ).toEqual([
      [
        [489, 5, 45],
        [497, 2.5, 45],
      ],
      [
        [604, 3.75, 45],
        [619, 3.75, 45],
      ],
      [
        [435, 2.5, 45],
        [954, 12.5, 45],
      ],
    ]);
  });

  it("matches the Serpentbone Blade's Double Slash in game", () => {
    // Its fixed skill, the Double Slash chain. Tested in game at +25 with 99 in every stat on the
    // training dummy (damage, poise, and poison)
    const weapon = getWeapon("Serpentbone Blade");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Double Slash #1", "#2", "#3"]);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), hit.stance, hit.status[AttackPowerType.POISON]]),
      ),
    ).toEqual([
      [
        [500, 3.75, 49.5],
        [588, 5, 66],
      ],
      [
        [446, 3.75, 49.5],
        [460, 3.75, 49.5],
        [656, 5, 66],
      ],
      [[849, 10, 66]],
    ]);
  });

  it("matches Witching Hour Slash in game", () => {
    // The Sword of Night's skill, uncharged and charged. Tested in game at +10 with 99 in every stat
    // on the training dummy (damage, poise, and blood loss), and with the Godfrey Icon, which only
    // boosts the charged one
    const weapon = getWeapon("Sword of Night");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const versions = (buffs: BuffEffect[]) =>
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
            buffs,
          }).attackSteps![0].map((hit) => [
            Math.floor(hit.damage),
            hit.stance,
            hit.status[AttackPowerType.BLEED],
          ]),
        ];
      });
    const uncharged = [
      [444, 3.5, 45],
      [451, 3.5, 45],
      [480, 6.5, 45],
    ];
    expect(versions([])).toEqual([
      ["Uncharged", uncharged],
      [
        "Charged",
        [
          [531, 7, 45],
          [539, 7, 45],
          [673, 13, 45],
        ],
      ],
    ]);
    expect(versions(icon)).toEqual([
      ["Uncharged", uncharged],
      [
        "Charged",
        [
          [611, 7, 45],
          [620, 7, 45],
          [774, 13, 45],
        ],
      ],
    ]);
  });

  it("matches Dragonwound Slash and Weed Cutter in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy, Dragonwound Slash with the
    // Godfrey Icon too (which only boosts the charged one)
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const versions = (name: string, buffs: BuffEffect[] = []) => {
      const weapon = getWeapon(name);
      return getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
        ({ ash, variant }) => {
          if (!ash || !("attack" in ash)) throw new Error();
          return [
            variant?.short,
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps![0].map((hit) => [
              Math.floor(hit.damage),
              hit.stance,
              hit.status[AttackPowerType.BLEED],
            ]),
          ];
        },
      );
    };
    // The Dragon-Hunter's Great Katana's Dragonwound Slash: its slash, or charged its slash and wave
    expect(versions("Dragon-Hunter's Great Katana")).toEqual([
      ["Uncharged", [[1286, 22, 55]]],
      [
        "Charged",
        [
          [449, 16.5, 55],
          [1453, 16.5, undefined],
        ],
      ],
    ]);
    expect(versions("Dragon-Hunter's Great Katana", icon)).toEqual([
      ["Uncharged", [[1286, 22, 55]]],
      [
        "Charged",
        [
          [516, 16.5, 55],
          [1671, 16.5, undefined],
        ],
      ],
    ]);
    // The Rakshasa's Great Katana's Weed Cutter
    expect(versions("Rakshasa's Great Katana")).toEqual([
      [
        undefined,
        [
          [766, 5.5, 55],
          [833, 5.5, 55],
        ],
      ],
    ]);
  });

  it("matches Euporia Vortex in game", () => {
    // Euporia's skill and its separate Luster Tier 1 and 2 versions, which get flat holy (fitted: 22
    // on Tier 1's projectiles and 20 on its swings, 9 and 10 on Tier 2's). Tested in game at +25 on
    // the training dummy, with 99 in every stat: 2040; Luster Tier 1 2530 (2117 for its projectiles);
    // Tier 2 6921 with 61 poise (5345 for its projectiles). At 89 Strength and Dexterity and 25 Faith:
    // Tier 1 1676, Tier 2 4416. To do: check the tiers in vanilla (tested in the Boss Arena mod).
    const weapon = getWeapon("Euporia");
    const versions = (attributes: Attributes) =>
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        const hits = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes,
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!.flat();
        return [
          variant?.label,
          hits.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
          hits.reduce((sum, hit) => sum + hit.stance, 0),
        ];
      });
    // All within 4 of the game's
    expect(versions({ str: 99, dex: 99, int: 99, fai: 99, arc: 99 })).toEqual([
      ["Euporia Vortex", 2040, 6.25],
      ["Euporia Vortex (Luster Tier 1)", 2530, 21.25],
      ["Euporia Vortex (Luster Tier 2)", 6922, 61],
    ]);
    const low = versions({ str: 89, dex: 89, int: 99, fai: 25, arc: 99 });
    expect([low[1][1], low[2][1]]).toEqual([1680, 4420]);
    // The skill has its own luster, so the luster buffs aren't added to it
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.ownWeaponBuff).toBe(true);
  });

  it("lists weapons' own skills' buffs by the skill's name", () => {
    // Each skill a weapon can't change is its own weapon buff, for the weapons with it, shown only
    // when one of them is picked; one that's also an Ash of War's buff (Sacred Blade) is that buff
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const find = (name: string) => allBuffs.find((buff) => buff.name === name)!;
    expect(allBuffs.some((buff) => buff.name === "Activate unique skills")).toBe(false);
    const goldenTempering = find("Golden Tempering");
    expect(isWeaponOnlyBuff(goldenTempering)).toBe(true);
    expect(Object.keys(goldenTempering.weapons!)).toEqual(["Ornamental Straight Sword"]);
    expect(describeBuff(goldenTempering)).toBe("+100 holy on the weapon");
    const sacredBlade = find("Sacred Blade");
    expect(isWeaponOnlyBuff(sacredBlade)).toBe(false);
    expect(Object.keys(sacredBlade.weapons!).sort()).toEqual([
      "Inseparable Sword",
      "Miquellan Knight's Sword",
    ]);
    // Sacred Order is an Ash of War's (DLC) and the Treespear's, with the Ash of War's effects:
    // ×2 against those who live in death, and ×1.1 to everything from the effect it keeps applying
    const sacredOrder = find("Sacred Order");
    expect(isWeaponOnlyBuff(sacredOrder)).toBe(false);
    expect(sacredOrder.weapons).toEqual({ Treespear: sacredOrder.effects });
    expect(describeBuff(sacredOrder)).toBe(
      "×2 damage against those who live in death; ×1.1 damage",
    );
  });

  it("matches Euporia's luster tiers in game", () => {
    // Its luster tier buffs, 95 and 120 holy for it only. Tested in game at +25 with 99 in every stat on
    // the training dummy: its first one handed R1 637, 733 with Tier 1, and 759 with Tier 2
    const weapon = getWeapon("Euporia");
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const tier = (name: string) => {
      const buff = allBuffs.find((candidate) => candidate.name === name)!;
      expect(buff.exclusive).toEqual(["luster"]);
      return getBuffEffects([{ ...buff, effects: buff.weapons!.Euporia }], 3);
    };
    const firstR1 = (buffs: BuffEffect[]) =>
      Math.floor(
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: getAttackData(movesets, weapon, "R1", false, 0.5),
          buffs,
        }).attackSteps![0][0].damage,
      );
    expect([firstR1([]), firstR1(tier("Luster Tier 1")), firstR1(tier("Luster Tier 2"))]).toEqual([
      637, 733, 759,
    ]);
  });

  it("matches Bloodblade Dance in game", () => {
    // Eleonora's Poleblade's skill, one chain: its dance (its second slash doesn't land), then its
    // follow-up. Its slashes' own blood loss effect also gets their status motion value, like Corpse
    // Piler's. Tested in game at +25 with 99 in every stat on the training dummy: 1949 and about 350
    // blood loss for #1, and the follow-up
    const weapon = getWeapon("Eleonora's Poleblade");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Bloodblade Dance #1", "#2"]);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!;
    expect(steps[0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(1949);
    expect(
      steps[0].reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
    ).toBeCloseTo(350.7, 0);
    // And the follow-up, right in game too
    expect(steps[1].map((hit) => Math.floor(hit.damage))).toEqual([376, 632]);
    expect(
      steps[1].reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
    ).toBeCloseTo(127.05, 1);
  });

  it("matches the Gargoyle's Black Blades' Spinning Slash in game", () => {
    // Its fixed skill, the Spinning Slash chain (its Var1 follow-up). Tested in game at +25 with 99 in
    // every stat on the training dummy
    const weapon = getWeapon("Gargoyle's Black Blades");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Spinning Slash #1", "#2"]);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([
      [[643, 14.5]],
      [
        [315, 4.5],
        [682, 14.5],
      ],
    ]);
    // The Gargoyle's Black Halberd's, also right in game at +25 with 99 in every stat: 797, then 395
    // and 845
    const halberd = getWeapon("Gargoyle's Black Halberd");
    const halberdResult = getAshAttack(ashes, movesets, halberd, "Lion's Claw", false);
    if (!("attack" in halberdResult)) throw new Error(halberdResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: halberd,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: halberdResult.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [[797, 11.5]],
      [
        [395, 3.8],
        [845, 11.5],
      ],
    ]);
  });

  it("matches Blinkbolt: Twinaxe in game", () => {
    // The Death Knight's Twin Axes' skill, one chain: its blink's lightning, then its R2. Tested in
    // game at +10 with 99 in every stat on the training dummy
    const weapon = getWeapon("Death Knight's Twin Axes");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Blinkbolt: Twinaxe #1", "#2"]);
    expect(build.attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [198],
      [158, 172, 283, 290, 312, 371],
    ]);
  });

  it("matches Dragonform Flame in game", () => {
    // The Forked-Tongue Hatchet's skill: its flame, and its ground fire, which only burns where the
    // stream hits the ground, so it's shown but not counted. Tested in game at +25 with 99 in every
    // stat on the training dummy
    const weapon = getWeapon("Forked-Tongue Hatchet");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.notCounted])).toEqual([
      [262, undefined],
      [81, true],
    ]);
    expect(build.finalValue).toBe(262);
  });

  it("matches the Icerind Hatchet's Hoarfrost Stomp in game", () => {
    // Its fixed skill: the ice spikes and the shatter. Tested in game at +25 with 99 in every stat on
    // the training dummy (damage, poise, and frost)
    const weapon = getWeapon("Icerind Hatchet");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps![0].map((hit) => [
        Math.floor(hit.damage),
        hit.stance,
        hit.status[AttackPowerType.FROST],
      ]),
    ).toEqual([
      [160, 0, 70],
      [507, 0, 110],
    ]);
  });

  it("matches the Ripple Crescent Halberd's Spinning Slash in game", () => {
    // Its fixed skill, the Spinning Slash chain. Tested in game at +25 with 99 in every stat on a 123.2
    // defense target with Fire Grease: 659, then 338 and 695
    const weapon = getWeapon("Ripple Crescent Halberd");
    const grease = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Fire Grease"),
      3,
    );
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs: grease,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [[659, 11.5]],
      [
        [338, 3.8],
        [695, 11.5],
      ],
    ]);
  });

  it("matches the Ripple Blade's Wild Strikes in game", () => {
    // Its fixed skill: its loop, and its R1 or R2 follow-up. Tested in game at +25 with 99 in every stat on the
    // training dummy, and with Fire Grease
    const weapon = getWeapon("Ripple Blade");
    const grease = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Fire Grease"),
      3,
    );
    const versions = (buffs: BuffEffect[]) =>
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
            buffs,
          }).attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
        ];
      });
    const strikes = [
      [767, 5],
      [720, 5],
    ];
    // The loop and each follow-up on its own
    expect(versions([])).toEqual([
      ["Wild Strikes", [strikes]],
      [
        "R1 follow-up",
        [
          [
            [257, 5],
            [1123, 20],
          ],
        ],
      ],
      [
        "R2 follow-up",
        [
          [
            [257, 5],
            [1492, 30],
          ],
        ],
      ],
    ]);
    const greasedStrikes = [
      [787, 5],
      [739, 5],
    ];
    expect(versions(grease)).toEqual([
      ["Wild Strikes", [greasedStrikes]],
      [
        "R1 follow-up",
        [
          [
            [277, 5],
            [1143, 20],
          ],
        ],
      ],
      [
        "R2 follow-up",
        [
          [
            [277, 5],
            [1511, 30],
          ],
        ],
      ],
    ]);
  });

  it("matches Rosus's Summons in game", () => {
    // Rosus' Axe's skill: its 3 summoned spirits and its swing. Tested in game at +10 with 99 in every
    // stat on the training dummy
    const weapon = getWeapon("Rosus' Axe");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]),
    ).toEqual([
      [787, 7.5],
      [787, 7.5],
      [787, 7.5],
      [741, 7.5],
    ]);
  });

  it("matches Thunderstorm in game", () => {
    // The Stormhawk Axe's skill, one chain of three steps: its lightning strikes only (not its weapon
    // rows), with its 120 lightning buff at their 150% share. Tested in game at +25 on the training
    // dummy: 1470, 2632, and 3882 for the chain with 99 in every stat (#1's strikes 443, 482, 545;
    // 28.5 poise), and 883 for #1 at 20 Strength and 15 Dexterity
    const weapon = getWeapon("Stormhawk Axe");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["Thunderstorm #1", "#2", "#3"]);
    const steps = (attributes: Attributes) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes,
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!;
    const high = steps({ str: 99, dex: 99, int: 99, fai: 99, arc: 99 });
    expect(high.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [443, 482, 545],
      [561, 601],
      [617, 633],
    ]);
    expect(high[0].reduce((sum, hit) => sum + hit.stance, 0)).toBe(28.5);
    expect(
      steps({ str: 20, dex: 15, int: 99, fai: 99, arc: 99 })[0].reduce(
        (sum, hit) => sum + Math.floor(hit.damage),
        0,
      ),
    ).toBe(883);
  });

  it("matches I Command Thee, Kneel! in game", () => {
    // The Axe of Godrick's skill, one chain: each swing hits with the axe or its shockwave, not both,
    // so its shockwaves are counted (less point blank, noted). Tested in game at +25 with 99 in every
    // stat on the training dummy: #1 1663 at most, 16.5 poise
    const weapon = getWeapon("Axe of Godrick");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    expect(result.attack.stepLabels).toEqual(["I Command Thee, Kneel! #1", "#2"]);
    expect(result.attack.note).toMatch(/point blank/);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!;
    expect(steps.map((step) => step.map((hit) => Math.floor(hit.damage)))).toEqual([
      [823, 840],
      [1572],
    ]);
    expect(steps[0].reduce((sum, hit) => sum + hit.stance, 0)).toBe(16.5);
  });

  it("matches Blinkbolt: Long-hafted Axe in game", () => {
    // The Death Knight's Longhaft Axe's skill, one chain: its blink's lightning, then its R2. Tested
    // in game at +10 with 99 in every stat on the training dummy
    const weapon = getWeapon("Death Knight's Longhaft Axe");
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(variants).toHaveLength(1);
    const result = variants[0].ash;
    if (!result || !("attack" in result)) throw new Error();
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(result.attack.stepLabels).toEqual(["Blinkbolt: Long-hafted Axe #1", "#2"]);
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([
      [[198, 0]],
      [
        [1335, 22],
        [413, 10],
      ],
    ]);
  });

  it("matches the Gargoyle's Black Axe's War Cry in game", () => {
    // Its fixed skill, War Cry's R2 and charged R2 chains with its buff, which are its R2s with the
    // buff picked. Tested in game two handed at +10 with 99 in every stat on the training dummy
    const weapon = getWeapon("Gargoyle's Black Axe");
    expect(getAshAttacks(ashes, movesets, weapon, "Lion's Claw", true)).toEqual([
      { ash: { unavailableReason: "War Cry does no damage itself: pick its buff for its R2s" } },
    ]);
    const versions = ["R2 chain", "Charged R2 chain"].map((chain) => {
      const ash = getAshAttack(ashes, movesets, weapon, withFollowUp("War Cry", chain), true);
      if (!("attack" in ash)) throw new Error(ash.unavailableReason);
      return [
        chain,
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: true,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
      ];
    });
    expect(versions).toEqual([
      ["R2 chain", [[[1393, 13.2]], [[1393, 13.2]]]],
      [
        "Charged R2 chain",
        [
          [
            [0, 3],
            [1926, 36.3],
          ],
          [
            [0, 2],
            [1972, 36.3],
          ],
        ],
      ],
    ]);
  });

  it("matches Spinning Guillotine in game", () => {
    // The Putrescence Cleaver's skill, and its L2 (repeatable) and R2 follow-ups on their own. Tested in
    // game at +25 with 99 in every stat on the training dummy (damage, poise, and status)
    const weapon = getWeapon("Putrescence Cleaver");
    const versions = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.label,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps![0].map((hit) => [
            Math.floor(hit.damage),
            hit.stance,
            hit.status[AttackPowerType.FROST],
          ]),
        ];
      },
    );
    expect(versions).toEqual([
      ["Spinning Guillotine", [[1478, 16.5, 55]]],
      [
        "Spinning Guillotine (chainable L2 follow-up)",
        [
          [646, 5.5, 55],
          [656, 2.75, 55],
          [688, 5.5, 55],
        ],
      ],
      [
        "Spinning Guillotine (R2 follow-up)",
        [
          [677, 8.25, 55],
          [698, 8.25, 55],
          [772, 16.5, 55],
        ],
      ],
    ]);
  });

  it("matches the Envoy's Horn's Oracular Bubble in game", () => {
    // Its fixed skill hits with its bubble or its burst, not both. Tested in game at +10 with 99 in
    // every stat on the training dummy
    const weapon = getWeapon("Envoy's Horn");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([[[639, 5.2]]]);
    // The Envoy's Greathorn's Great Oracular Bubble too (tested in game)
    const great = getAshAttack(
      ashes,
      movesets,
      getWeapon("Envoy's Greathorn"),
      "Lion's Claw",
      false,
    );
    if (!("attack" in great)) throw new Error(great.unavailableReason);
    expect(great.attack.steps.map((step) => step.length)).toEqual([1]);
    // With the Envoy Crown (×1.15 for horns' attacks), also right in game
    const crown = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Envoy Crown"),
      3,
    );
    expect(
      Math.floor(
        optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: result.attack,
          buffs: crown,
        }).attackSteps![0][0].damage,
      ),
    ).toBe(735);
  });

  it("matches Flower Dragonbolt in game", () => {
    // The Flowerstone Gavel's skill, uncharged and charged. Tested in game at +10 with 99 in every
    // stat on the training dummy, and with the Godfrey Icon (which only boosts the charged one)
    const weapon = getWeapon("Flowerstone Gavel");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const versions = (buffs: BuffEffect[]) =>
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
            buffs,
          }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]),
        ];
      });
    expect(versions([])).toEqual([
      ["Uncharged", [[1017, 5]]],
      ["Charged", [[1340, 5]]],
    ]);
    expect(versions(icon)).toEqual([
      ["Uncharged", [[1017, 5]]],
      ["Charged", [[1541, 5]]],
    ]);
  });

  it("matches Gold Breaker, the Nox Flowing Hammer's Flowing Form, and Claw Flick in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy (Marika's Hammer and the
    // Ringed Finger at +10). Claw Flick's first hit only does poise damage (13)
    const hits = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]);
    };
    expect(hits("Marika's Hammer")).toEqual([
      [633, 26.65],
      [1993, 16.25],
    ]);
    expect(hits("Nox Flowing Hammer")).toEqual([
      [662, 9.75],
      [739, 9.75],
    ]);
    expect(hits("Ringed Finger")).toEqual([
      [0, 13],
      [1640, 26],
    ]);
  });

  it("matches Knowledge Above All and Varré's Bouquet's Blood Tax in game", () => {
    // The Scepter of the All-Knowing's skill does no damage (tested in game; the sheet gives it Helphen's
    // Steeple's swing, which still has it)
    expect(
      getAshAttack(ashes, movesets, getWeapon("Scepter of the All-Knowing"), "Lion's Claw", false),
    ).toEqual({ unavailableReason: "Knowledge Above All does no damage" });
    const steeple = getAshAttack(
      ashes,
      movesets,
      getWeapon("Helphen's Steeple"),
      "Lion's Claw",
      false,
    );
    expect("attack" in steeple).toBe(true);
    // Varré's Bouquet's Blood Tax. Tested in game at +25 with 99 in every stat on the training dummy
    const weapon = getWeapon("Varré's Bouquet");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps![0];
    expect(hits.map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [206, 6.5],
      [69, 2.6],
      [69, 2.6],
      [270, 6.5],
    ]);
    expect(hits.map((hit) => hit.status[AttackPowerType.BLEED])).toEqual([
      expect.closeTo(141.05, 1),
      expect.closeTo(70.53, 1),
      expect.closeTo(70.53, 1),
      expect.closeTo(141.05, 1),
    ]);
  });

  it("matches Familial Rancor in game", () => {
    // The Family Heads' skill: 1 large skull, 2 medium, and 4 small. Tested in game at +25 with 99 in
    // every stat on the training dummy: 1417 and 19.8 poise
    const weapon = getWeapon("Family Heads");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps![0];
    expect(hits.map((hit) => [hit.kind, Math.floor(hit.damage)])).toEqual([
      ["Large Skull", 287],
      ["Medium Skull", 177],
      ["Medium Skull", 177],
      ["Small Skull", 194],
      ["Small Skull", 194],
      ["Small Skull", 194],
      ["Small Skull", 194],
    ]);
    expect(hits.reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(1417);
    expect(hits.reduce((sum, hit) => sum + hit.stance, 0)).toBeCloseTo(19.8, 5);
  });

  it("lists Causality's Wrath's levels as versions", () => {
    // The Golden Order Flail's skill has three levels, each its own entry. Tested in game at +10 with
    // 99 in every stat on the training dummy: Tier 1 right (Tiers 2 and 3 not yet tested)
    const weapon = getWeapon("Golden Order Flail");
    const versions = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!ash || !("attack" in ash)) throw new Error();
        return [
          variant?.label,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]),
        ];
      },
    );
    expect(versions).toEqual([
      ["Causality's Wrath (Tier 1)", [[893, 12]]],
      ["Causality's Wrath (Tier 2)", [[1352, 18]]],
      ["Causality's Wrath (Tier 3)", [[1940, 24]]],
    ]);
  });

  it("matches the Serpent Flail and its Flare, O Serpent in game", () => {
    // Flails' weapon hits get a 12.5% sweet spot bonus. Tested in game at +10 one handed on the
    // training dummy: the first R1 644 and R2 811 with 99 in every stat, 493 and 618 at 99 Dexterity
    // and 21 Faith. Flare, O Serpent's R2 is the flail's R2 with its 90 fire buff and its fire
    // explosion: 1465 in 2 hits (the explosion 550) and 19 poise
    const weapon = getWeapon("Serpent Flail");
    const firstHit = (attack: AttackData, attributes: Attributes) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes,
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
      }).attackSteps![0];
    const all99 = { str: 99, dex: 99, int: 99, fai: 99, arc: 99 };
    const low = { str: 10, dex: 99, int: 10, fai: 21, arc: 10 };
    const normal = (attack: "R1" | "R2", attributes: Attributes) =>
      Math.floor(
        firstHit(getAttackData(movesets, weapon, attack, false, 0.5)!, attributes)[0].damage,
      );
    expect([normal("R1", all99), normal("R2", all99)]).toEqual([644, 811]);
    expect([normal("R1", low), normal("R2", low)]).toEqual([493, 618]);
    // Its buff (picked in the Buffs panel) adds an explosion to some of the flail's attacks, so it has
    // no entries of its own: with it, those are the flail's own with the buff and the explosion
    const own = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    expect(own).toEqual({
      unavailableReason:
        "Flare, O Serpent does no damage itself: pick its buff for the attacks it changes",
    });
    const changed = (attack: string) => {
      const result = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Flare, O Serpent", `${attack} chain`),
        false,
      );
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return result.attack;
    };
    const r2 = changed("R2");
    expect(r2.ownWeaponBuff).toBe(true);
    const hits = firstHit(r2, all99);
    expect(hits.map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [915, 12],
      [550, 7],
    ]);
    // Each flail's explosion is spent on its first (the buff can't be cast again mid-chain), so each
    // attack it changes stops after it: the cast, the attack, then the cast again once anything can
    // follow (frames from the L2 press: the cast's 62, then the R2's swing and explosion)
    const frames = (seconds: number | undefined) =>
      seconds == null ? null : Math.round(seconds * 60);
    expect(r2.steps.length).toBe(1);
    expect(r2.stepTimes![0].hitTimes!.map(frames)).toEqual([103, 107]);
    expect(r2.cycleTimes!.map(frames)).toEqual([139]);
    expect(r2.upkeep).toBeUndefined();
    const kinds = (attack: AttackData) =>
      attack.steps.map((step) =>
        step.map((hit) => `${hit.kind ?? "Weapon"}${hit.leftHand ? " (left)" : ""}`),
      );
    for (const attack of ["Running R2", "Charged R2", "Jumping R2", "Rolling R1"]) {
      expect(kinds(changed(attack))).toEqual([["Weapon", "Bullet"]]);
    }
    // Powerstanced, the left flail's too: the L1 chain's #1 (the right's) and #2 (the left's)
    expect(kinds(changed("Powerstance L1"))).toEqual([
      ["Weapon", "Weapon (left)", "Bullet"],
      ["Weapon", "Weapon (left)", "Bullet (left)"],
    ]);
    expect(kinds(changed("Powerstance Rolling L1"))).toEqual([
      ["Weapon", "Weapon (left)", "Bullet (left)", "Bullet"],
    ]);
    expect(
      kinds(changed("Powerstance Running L1"))[0].filter((kind) => kind.startsWith("Bullet")),
    ).toEqual(["Bullet"]);
    expect(
      getAshAttack(ashes, movesets, weapon, withFollowUp("Flare, O Serpent", "R1 chain"), false),
    ).toEqual({ unavailableReason: "Flare, O Serpent doesn't change the R1" });
    // Its other attacks cast it again when it runs out: 62 frames every 30 seconds
    expect(getSkillUpkeep(ashes, "Serpent Flail", "Flare, O Serpent")).toEqual({
      cast: 1.033,
      duration: 30,
    });
    const r1 = {
      ...getAttackData(movesets, weapon, "R1", false, 0.5)!,
      upkeep: { cast: 1.033, duration: 30 },
    };
    const dps = (attack: AttackData) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: all99,
        bonusAttributes: noBonus,
        objective: "totalAttack",
        limits: { ...noLimits, maxLevels: 0 },
        attack,
      }).attackDps!;
    expect(dps(r1) / dps({ ...r1, upkeep: undefined })).toBeCloseTo((30 - 1.033) / 30, 6);
    const buff = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).find((candidate) => candidate.name === "Flare, O Serpent")!;
    expect(buff.weapons).toEqual({ "Serpent Flail": [{ flat: [0, 0, 90, 0, 0], group: 162 }] });
  });

  it("gives flails' sweet spot only where their animations have it", () => {
    // The sweet spot is marked in the animations (check_animations.py's SWEET_SPOT_FLAG): most
    // attacks have it, but not backstabs, ripostes, mounted charged R2s, or Spinning Chain. Tested
    // in game with 99 in every stat on a 123.2 defense target: the Flail +25's Spinning Chain spin
    // does 419 and its backstab matches, both without the bonus, and so do Spinning Chain's
    // follow-ups
    const weapon = getWeapon("Flail");
    const rates = (attack: AttackChoice) =>
      getAttackData(movesets, weapon, attack, false, 0.5)!
        .steps.flat()
        .map((hit) => hit.damageRates);
    const sweetSpot = allDamageTypes.map(() => 1.125);
    expect(rates("R1")).toEqual([sweetSpot, sweetSpot, sweetSpot, sweetSpot]);
    expect(rates("Mounted R2/L2")).toEqual([sweetSpot]);
    expect(rates("Mounted Charged R2/L2")).toEqual([undefined]);
    expect(rates("Backstab")).toEqual([undefined, undefined]);
    const spin = getAshAttack(ashes, movesets, weapon, "Spinning Chain", false);
    if (!("attack" in spin)) throw new Error(spin.unavailableReason);
    const damage = (attack: AttackData) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
      })
        .attackSteps!.flat()
        .map((hit) => Math.floor(hit.damage));
    expect(damage(spin.attack)[0]).toBe(419);
    expect(damage(getAttackData(movesets, weapon, "Backstab", false, 0.5)!)).toEqual([241, 1057]);
    // Its R1 and R2 follow-ups on their own, also tested in game: their two hits after the spin
    for (const [label, hits] of [
      ["R1", [450, 641]],
      ["R2", [577, 765]],
    ] as const) {
      const followUp = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Spinning Chain", label),
        false,
      );
      if (!("attack" in followUp)) throw new Error(followUp.unavailableReason);
      expect(damage(followUp.attack)).toEqual(hits);
    }
  });

  it("matches Shield Strike in game", () => {
    // It's the shield's R1 chain: tested in game two handed with 99 in every stat, with the two handed
    // R1s' poise: the Carian Thrusting Shield +25's total 2768, and the Heater Shield +25's hits with
    // the Two-Handed Sword Talisman (×1.15 for two handed attacks)
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const talisman = getBuffEffects(
      allBuffs.filter((buff) => buff.name === "Two-Handed Sword Talisman"),
      3,
    );
    const hits = (name: string, twoHanding: boolean, buffs: BuffEffect[] = []) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Shield Strike", twoHanding, 0.5, true);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      expect(result.attack.steps).toEqual(
        getAttackData(movesets, weapon, "R1", twoHanding, 0.5, true)!.steps,
      );
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
        buffs,
      })
        .attackSteps!.flat()
        .map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]);
    };
    const total = (steps: number[][]) => steps.reduce((sum, [damage]) => sum + damage, 0);
    expect(total(hits("Carian Thrusting Shield", true))).toBe(2768);
    expect(hits("Heater Shield", true, talisman)).toEqual([
      [288, 7.2],
      [292, 7.2],
      [295, 7.2],
      [313, 14.3],
    ]);
  });

  it("offers built-in skills that aren't Ashes of War for their own weapons", () => {
    // Flails' Spinning Chain comes with weapons that take Ashes of War, so it's in the picker, for
    // those weapons only, in alphabetical order with the Ashes of War. It's a loop, so the spin and
    // each of its R1 and R2 follow-ups (tested in game: their numbers match) are offered on their own.
    const choices = getAshChoices(ashes).map(({ value }) => value);
    const spin = choices.indexOf("Spinning Chain");
    expect(choices[spin + 1]).toBe(withFollowUp("Spinning Chain", "R1"));
    expect(choices[spin + 2]).toBe(withFollowUp("Spinning Chain", "R2"));
    expect(choices[spin - 1] < "Spinning Chain").toBe(true);
    expect(choices[spin + 3] > "Spinning Chain").toBe(true);
    // Shield Strike is an Ash of War whose skill row is named by another's (SwordArtsParam textId),
    // so any shield can take it. Its follow-ups continue it, so it's one chain entry.
    expect(
      getAshChoices(ashes)
        .filter(({ value }) => value.startsWith("Shield Strike"))
        .map(({ label }) => label),
    ).toEqual(["Shield Strike"]);
    expect(ashes.ashes.map(({ name }) => name)).toContain("Shield Strike");
    for (const name of ["Flail", "Nightrider Flail", "Chainlink Flail"]) {
      expect(
        "attack" in getAshAttack(ashes, movesets, getWeapon(name), "Spinning Chain", false),
      ).toBe(true);
    }
    // Other affinities come from an Ash of War, which replaces it
    expect(
      getAshAttack(ashes, movesets, getWeapon("Heavy Flail"), "Spinning Chain", false),
    ).toEqual({ unavailableReason: "Only Standard has Spinning Chain" });
    expect(
      getAshAttack(
        ashes,
        movesets,
        getWeapon("Heavy Flail"),
        withFollowUp("Spinning Chain", "R1"),
        false,
      ),
    ).toEqual({ unavailableReason: "Only Standard has Spinning Chain" });
    expect(getAshAttack(ashes, movesets, getWeapon("Longsword"), "Spinning Chain", false)).toEqual({
      unavailableReason: "Can't take Spinning Chain",
    });
    expect(
      "attack" in getAshAttack(ashes, movesets, getWeapon("Heater Shield"), "Shield Strike", false),
    ).toBe(true);
    // The sheet names the staves' shared Erdtree Slam together; each staff has it
    for (const name of ["Staff of the Avatar", "Rotten Staff"]) {
      expect("attack" in getAshAttack(ashes, movesets, getWeapon(name), "Lion's Claw", false)).toBe(
        true,
      );
    }
  });

  it("matches Regal Beastclaw in game", () => {
    // The Beastclaw Greathammer's fixed skill: its swing and its claw projectile. Tested in game at
    // +10 with 99 in every stat on a 123.2 defense target: 588 with 7 poise, then 1946 with 20
    const weapon = getWeapon("Beastclaw Greathammer");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [588, 7],
            [1946, 20],
          ],
        ],
      ],
    ]);
  });

  it("matches Surge of Faith in game", () => {
    // The Cranial Vessel Candlestand's fixed skill, a chain: a slam and an explosion, then the
    // explosion again. Tested in game at +10 with 99 in every stat: the slam 13 with 9.1 poise, the
    // explosion 1647 with 10.5, and its random small projectiles 336 with 4.9 each (at least 10 hit),
    // left out of the total
    const weapon = getWeapon("Cranial Vessel Candlestand");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [13, 9.1],
        [1647, 10.5],
      ],
      [[1647, 10.5]],
    ]);
    expect(build.attackNote).toBe(
      "Doesn't count its 36 small projectiles an explosion, which fly at random: 336 damage each",
    );
  });

  it("matches Devourer of Worlds in game", () => {
    // The Devourer's Scepter's fixed skill, its fire projectile. Tested in game at +10 with 99 in every
    // stat on a 123.2 defense target: 463 with 12.9 poise
    const weapon = getWeapon("Devourer's Scepter");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([[[463, 12.9]]]);
  });

  it("matches Bubble Shower in game", () => {
    // The Envoy's Long Horn's fixed skill: its bubbles, 6 of which usually hit a human-sized enemy (at
    // most 17 seen on Dragonlord Placidusax). Tested in game at +10 with 99 in every stat on a 123.2
    // defense target: 182 damage and 1.9 poise each, 1092 for the usual 6
    const weapon = getWeapon("Envoy's Long Horn");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([Array(6).fill([182, 1.9])]);
    expect(result.attack.note).toBe(
      "Counts the 6 bubbles that usually hit a human-sized enemy: bigger enemies can take more",
    );
  });

  it("matches Smithing Art Spears in game", () => {
    // The Anvil Hammer's fixed skill: its slam, then its spears and their second hit. Tested in game at
    // +10 with 99 in every stat on a 123.2 defense target: 964 with 15 poise, 1404 with 30, and 455
    const weapon = getWeapon("Anvil Hammer");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [964, 15],
        [1404, 30],
        [455, 0],
      ],
    ]);
  });

  it("matches Regal Roar in game", () => {
    // The Axe of Godfrey's fixed skill: its roar, then its slam's shockwave. Its buff applies to the
    // skill itself, so roaring again with it does more. Its R2s with the buff are its R2 chains.
    // Tested in game at +10 with 99 in every stat on a 123.2 defense target: the roar 3 poise, the
    // shockwave 1774 with 18, and 1946 roaring again
    const weapon = getWeapon("Axe of Godfrey");
    const allBuffs = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const regalRoar = allBuffs.find((buff) => buff.name === "Regal Roar")!;
    const buff = getBuffEffects(
      [{ ...regalRoar, effects: regalRoar.weapons!["Axe of Godfrey"] }],
      3,
    );
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false);
    expect(results.map(({ variant }) => variant)).toEqual([undefined]);
    const { ash } = results[0];
    if (!("attack" in ash)) throw new Error(ash.unavailableReason);
    expect(ash.attack.ownWeaponBuff).toBeUndefined();
    const hits = (buffs: BuffEffect[]) =>
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: ash.attack,
        buffs,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      );
    expect(hits([])).toEqual([
      [
        [0, 3],
        [1774, 18],
      ],
    ]);
    expect(hits(buff)[0][1][0]).toBe(1946);
    // Its R2s with the buff picked are its R2 chains, which the picked buff applies to
    for (const [chain, labels] of [
      ["R2 chain", ["Regal Roar R2 #1", "R2 #2"]],
      ["Charged R2 chain", ["Regal Roar Charged R2 #1", "Charged R2 #2"]],
    ] as const) {
      const r2 = getAshAttack(ashes, movesets, weapon, withFollowUp("Regal Roar", chain), false);
      if (!("attack" in r2)) throw new Error(r2.unavailableReason);
      expect(r2.attack.stepLabels).toEqual(labels);
      expect(r2.attack.ownWeaponBuff).toBeUndefined();
    }
  });

  it("matches Devonia's Vortex in game", () => {
    // Devonia's Hammer's fixed skill, uncharged and charged: a swing, its first projectile (twice
    // charged), and its second. Tested in game at +10 with 99 in every stat on a 123.2 defense target:
    // uncharged 2265 with 37.5 poise, charged 3504 with 52.5. The uncharged hits are 376.95 (physical
    // and holy), which the game shows as 377 (see the stacked buff rounding note: the calculator
    // floors them, 2263)
    const weapon = getWeapon("Devonia's Hammer");
    const results = Object.fromEntries(
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const hits = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!.flat();
        return [
          variant!.short,
          [
            hits.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
            hits.reduce((sum, hit) => sum + hit.stance, 0),
          ],
        ];
      }),
    );
    expect(Object.keys(results)).toEqual(["Uncharged", "Charged"]);
    expect(Math.abs(results.Uncharged[0] - 2265)).toBeLessThanOrEqual(2);
    expect(results.Uncharged[1]).toBeCloseTo(37.5);
    expect(results.Charged).toEqual([3504, 52.5]);
  });

  it("matches Gravity Bolt in game", () => {
    // The Fallingstar Beast Jaw's fixed skill, one bolt a cast: it can be chain cast, but one cast is
    // counted. Tested in game at +10 with 99 in every stat on a 123.2 defense target: 1054 and 7 poise
    const weapon = getWeapon("Fallingstar Beast Jaw");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([[[1054, 7]]]);
  });

  it("matches Kowtower's Resentment in game", () => {
    // The Gazing Finger's fixed skill: a swing, then a second swing and its projectile, released early
    // (uncharged) or not. Tested in game at +10 with 99 in every stat on a 123.2 defense target
    const weapon = getWeapon("Gazing Finger");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const hits = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        }).attackSteps!.flat();
        return [
          variant?.short,
          hits.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
          hits.reduce((sum, hit) => sum + hit.stance, 0),
        ];
      },
    );
    expect(results).toEqual([
      ["Uncharged", 2091, 22.5],
      ["Charged", 2724, 22.5],
    ]);
    // Its charged version isn't a charged skill: the Godfrey Icon doesn't boost it (tested in game)
    const charged = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false)[1].ash;
    if (!("attack" in charged)) throw new Error(charged.unavailableReason);
    expect(charged.attack.steps.flat().some((hit) => hit.categories?.includes(111))).toBe(false);
  });

  it("matches Spinning Wheel in game", () => {
    // Ghiza's Wheel's fixed skill loops while it's held: its downswing, 7 opening spins, and its two
    // loops of 8 and 10 are counted. Tested in game at +10 with 99 in every stat on a 123.2 defense
    // target: 5044 for 26 hits of 194, and its blood loss; the downswing 0.6 poise, then about 2. Its
    // poise isn't pinned: 19.5 in game, 20.4 here (as if one of the opening's 1.8 hits were 0.9)
    const weapon = getWeapon("Ghiza's Wheel");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(hits).toHaveLength(26);
    expect(hits.reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(5044);
    expect(hits.reduce((sum, hit) => sum + hit.stance, 0)).toBeCloseTo(19.5, -0.5);
    expect(result.attack.note).toBe(
      "Counts its downswing, 7 opening spins, and its two loops of 8 and 10: it keeps looping while the skill is held",
    );
  });

  it("hits once a headbutt with Shadow Sunflower Headbutt", () => {
    // The Shadow Sunflower Blossom's fixed skill, a chain of three headbutts (two hits in #2), each
    // hitting with its head or the AoE around it, not both (tested in game: damage and poise right)
    const weapon = getWeapon("Shadow Sunflower Blossom");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.steps.map((step) => step.map((hit) => hit.motionValue))).toEqual([
      [201],
      [90, 92],
      [210],
    ]);
    // Tested in game at +10 with 99 in every stat on a 123.2 defense target
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [[1921, 21]],
      [
        [753, 7.5],
        [774, 7.5],
      ],
      [[2007, 30]],
    ]);
  });

  it("fires 8 bullets with Sorcery of the Crozier", () => {
    // The Watchdog's Staff's fixed skill: 8 bullets (tested in game)
    const weapon = getWeapon("Watchdog's Staff");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.steps).toEqual([Array(8).fill(result.attack.steps[0][0])]);
  });

  it("matches Ancient Lightning Spear in game", () => {
    // The Bolt of Gransax's fixed skill, uncharged and charged. Tested in game at +10 with 99 in every
    // stat on a 123.2 defense target: 1061 and 1459, each with 7.5 poise
    const weapon = getWeapon("Bolt of Gransax");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      ["Uncharged", [[[1061, 7.5]]]],
      ["Charged", [[[1459, 7.5]]]],
    ]);
  });

  it("matches Sacred Phalanx in game", () => {
    // The Cleanrot Spear's fixed skill: its thrust and its holy spears. Tested in game at +25 with 99 in
    // every stat on a 123.2 defense target: 911 and 1055, each with 10 poise
    const weapon = getWeapon("Cleanrot Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [911, 10],
        [1055, 10],
      ],
    ]);
  });

  it("matches Spearcall Ritual in game", () => {
    // The Death Ritual Spear's fixed skill only hits with its spears, which fall at random; one is
    // counted. Tested in game at +25 with 99 in every stat on a 123.2 defense target: 305 each
    const weapon = getWeapon("Death Ritual Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage))),
    ).toEqual([[305]]);
    expect(result.attack.note).toBe(
      "Counts one of its spears: about 14 fall at random, and how many hit depends on the target",
    );
  });

  it("matches the spears' fixed Charge Forth in game", () => {
    // Four hits as it charges, then its final thrust. Tested in game at +25 with 99 in every stat on a
    // 123.2 defense target (damage and poise)
    const hits = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      );
    };
    const charge = (charging: number, thrust: number) => [
      [...Array(4).fill([charging, 2.5]), [thrust, 10]],
    ];
    expect(hits("Inquisitor's Girandole")).toEqual(charge(146, 1050));
    expect(hits("Rotten Crystal Spear")).toEqual(charge(123, 806));
    expect(hits("Torchpole")).toEqual(charge(116, 747));
  });

  it("matches Jori's Inquisition in game", () => {
    // The Barbed Staff-Spear's fixed skill only hits with its bullet, 5 times. Tested in game at +25
    // with 99 in every stat on a 123.2 defense target: 2300, 15 poise, and about 130 blood loss
    const weapon = getWeapon("Barbed Staff-Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(hits.map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual(
      Array(5).fill([460, 3]),
    );
    expect(
      hits.reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
    ).toBeCloseTo(130, -2);
  });

  it("chains Bloodfiends' Bloodboon's bullets", () => {
    // The Bloodfiend's Sacred Spear's fixed skill, a chain whose bullets hit several times, reportedly
    // up to 4, 4, and 8 (tested in game: 2 or 3 for #1 and #2, and at least 5 for #3); at +25 with 99 in
    // every stat on a 123.2 defense target, 176 damage, 3 poise, and about 71 blood loss each
    const weapon = getWeapon("Bloodfiend's Sacred Spear");
    expect(
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash }) =>
        "attack" in ash
          ? [ash.attack.stepLabels, ash.attack.steps.map((step) => step.length)]
          : ash,
      ),
    ).toEqual([
      [
        ["Bloodfiends' Bloodboon #1", "#2", "#3"],
        [4, 4, 8],
      ],
    ]);
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.note).toBe(
      "Counts its bullets' most hits, 4, 4, and 8: in practice they hit less",
    );
    const bullet = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps![0][0];
    expect([
      Math.floor(bullet.damage),
      bullet.stance,
      Math.round(bullet.status[AttackPowerType.BLEED]!),
    ]).toEqual([176, 3, 71]);
  });

  it("matches Bloodboon Ritual in game", () => {
    // Mohgwyn's Sacred Spear's fixed skill, a chain: each step's bullet ticks up to 4, 4, and 8 times
    // (reportedly), its first with 100 fire (592) and the rest 65 (346). Tested in game at +25 with 99
    // in every stat on a 123.2 defense target: 1284 for #1 and #2 (one tick fewer), and 3014 for #3
    const weapon = getWeapon("Mohgwyn's Sacred Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0)),
    ).toEqual([592 + 3 * 346, 592 + 3 * 346, 3014]);
    // Its ticks only build up 40%, 50%, and 60% of the weapon's blood loss (94.6), not their own
    // effect's 60: tested in game, 36 for the first tick and about 115 for #1's 3
    const bleed = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.map((step) => step[0].status[AttackPowerType.BLEED]);
    expect(bleed).toEqual([
      expect.closeTo(37.8, 1),
      expect.closeTo(47.3, 1),
      expect.closeTo(56.8, 1),
    ]);
    // Its weapon buff, 30 fire for 20 seconds, which the game's scripts apply
    const buff = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).find((candidate) => candidate.name === "Bloodboon Ritual")!;
    expect(buff.weapons).toEqual({
      "Mohgwyn's Sacred Spear": [{ flat: [0, 0, 30, 0, 0], group: 162 }],
    });
    expect(result.attack.note).toBe(
      "Counts its bullets' most ticks, 4, 4, and 8: in practice they hit less",
    );
  });

  it("matches Great-Serpent Hunt in game", () => {
    // The Serpent-Hunter's fixed skill, a chain of two thrusts. Tested in game at +25 with 99 in every
    // stat on a 123.2 defense target: 2075, then 2195 (damage and poise)
    const weapon = getWeapon("Serpent-Hunter");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) => step.map((hit) => Math.floor(hit.damage))),
    ).toEqual([[2075], [2195]]);
  });

  it("matches Siluria's Woe in game", () => {
    // Siluria's Tree's fixed skill: its thrust and its bullet, uncharged or charged. Tested in game at
    // +25 with 99 in every stat on a 123.2 defense target: uncharged right, charged one 2225 bullet
    const weapon = getWeapon("Siluria's Tree");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        "Uncharged",
        [
          [
            [285, 5.5],
            [1660, 19.3],
          ],
        ],
      ],
      [
        "Charged",
        [
          [
            [405, 11],
            [2225, 22],
          ],
        ],
      ],
    ]);
  });

  it("matches Messmer's Assault in game", () => {
    // The Spear of the Impaler's fixed skill, a chain of three. Tested in game at +25 with 99 in every
    // stat on a 123.2 defense target
    const weapon = getWeapon("Spear of the Impaler");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [366, 2.8],
        [971, 7],
      ],
      [
        [458, 5.5],
        [466, 2.8],
        [481, 2.8],
      ],
      [
        [450, 5.5],
        [702, 5.5],
        [1009, 5.5],
      ],
    ]);
  });

  it("matches Frenzyflame Thrust in game", () => {
    // Vyke's War Spear's fixed skill hits with its explosion or, point blank, its thrust, then its fire
    // ticks either way. Tested in game at +25 with 99 in every stat on a 123.2 defense target: 1909
    // from a slight distance (959 and 5 ticks of 190), 1469 point blank (the thrust's 519 instead)
    const weapon = getWeapon("Vyke's War Spear");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(Math.round(build.finalValue)).toBe(1909);
    expect(build.attackNote).toBe(
      "Counts its explosion from a slight distance: point blank, its thrust hits instead (519)",
    );
  });

  it("matches Romina's Purification in game", () => {
    // The Poleblade of the Bud's fixed skill: two slashes, then its bullet, which hits several times.
    // Tested in game at +25 with 99 in every stat on a 123.2 defense target: 1799 (3 bullet hits) and
    // about 160 scarlet rot
    const weapon = getWeapon("Poleblade of the Bud");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(hits.map((hit) => Math.floor(hit.damage))).toEqual([761, 708, 110, 110, 110]);
    expect(
      hits.reduce((sum, hit) => sum + (hit.status[AttackPowerType.SCARLET_ROT] ?? 0), 0),
    ).toBeCloseTo(160, -2);
    expect(result.attack.note).toBe(
      "Counts 3 hits of its bullet, which can hit more or fewer times",
    );
  });

  it("matches Miquella's Ring of Light in game", () => {
    // The Halo Scythe's fixed skill: its swing and its ring of light. Tested in game at +25 with 99 in
    // every stat on a 123.2 defense target: 316 and 830
    const weapon = getWeapon("Halo Scythe");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [316, 2.8],
            [830, 3],
          ],
        ],
      ],
    ]);
  });

  it("matches Dynastic Sickleplay in game", () => {
    // The Obsidian Lamina's fixed skill, one chain labeled "R2 follow-up" (the sheet's "R2 #1" and "#2")
    const variants = getAshAttacks(
      ashes,
      movesets,
      getWeapon("Obsidian Lamina"),
      "Lion's Claw",
      false,
    );
    expect(variants.map(({ variant }) => variant)).toEqual([
      { label: "Dynastic Sickleplay (R2 follow-up)", short: "R2 follow-up" },
    ]);
    const { ash } = variants[0];
    if (!("attack" in ash)) throw new Error(ash.unavailableReason);
    expect(ash.attack.stepLabels).toEqual(["Dynastic Sickleplay #1", "#2"]);
    // Chained as fast as possible in game (60 fps), from a neutral backstep: #1 hit every 291 frames
    expect(Math.round((ash.attack.cycleTimes![0] + ash.attack.cycleTimes![1]) * 60)).toBe(290);
    // Tested in game at +25 with 99 in every stat on a 123.2 defense target
    const weapon = getWeapon("Obsidian Lamina");
    expect(
      optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: ash.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [[1253, 33]],
      [
        [601, 10],
        [617, 2.5],
        [657, 10],
      ],
    ]);
  });

  it("matches Angel's Wings in game", () => {
    // The Winged Scythe's fixed skill. Tested in game at +25 with 99 in every stat on a 123.2 defense
    // target: 548 with 10 poise, and 1211 with 19.5
    const weapon = getWeapon("Winged Scythe");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [548, 10],
            [1211, 19.5],
          ],
        ],
      ],
    ]);
  });

  it("matches Flame Dance in game", () => {
    // The Giant's Red Braid's fixed skill: 4 spins, then its last. Tested in game at +25 with 99 in every
    // stat on a 123.2 defense target: 447 each, then 627, each with 4 poise
    const weapon = getWeapon("Giant's Red Braid");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([[undefined, [[...Array(4).fill([447, 4]), [627, 4]]]]]);
  });

  it("matches Sea of Magma in game", () => {
    // The Magma Whip Candlestick's fixed skill, counted without looping: one lash of its start, its
    // final lash, and 3 magma ticks; a loop's lash and tick are shown but not counted. Tested in game at
    // +25 with 99 in every stat on a 123.2 defense target: 2195 and 8 poise (sometimes 2538, a 4th tick),
    // 2989 with a loop, and 3783 with two
    const weapon = getWeapon("Magma Whip Candlestick");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    const counted = hits.filter((hit) => !hit.notCounted);
    expect(counted.map((hit) => Math.floor(hit.damage)).sort((a, b) => a - b)).toEqual([
      343, 343, 343, 451, 715,
    ]);
    expect(counted.reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(2195);
    expect(counted.reduce((sum, hit) => sum + hit.stance, 0)).toBe(8);
    // A loop: 794
    const loop = hits.filter((hit) => hit.notCounted);
    expect(loop.reduce((sum, hit) => sum + Math.floor(hit.damage), 0)).toBe(794);
  });

  it("matches Painful Strike in game", () => {
    // The Tooth Whip's fixed skill. Tested in game at +25 with 99 in every stat on a 123.2 defense
    // target: 320, 320, then 690
    const weapon = getWeapon("Tooth Whip");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [320, 2.8],
            [320, 2.8],
            [690, 8],
          ],
        ],
      ],
    ]);
  });

  it("matches Bear Witness! in game", () => {
    // The Grafted Dragon's fixed skill: its fire and explosion, and 18 projectiles that land at random,
    // noted. Tested in game at +25 with 99 in every stat on a 123.2 defense target: 1282 and 10 poise;
    // up close its windup's weapon hit (238) and the fire twice, 442
    const weapon = getWeapon("Grafted Dragon");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([
      [
        [102, 2.5],
        [1180, 7.5],
      ],
    ]);
    expect(build.attackNote).toBe(
      "Counts its fire and explosion: up close its windup's weapon hit and more fire can hit too, and its 18 projectiles land at random (193 each), leaving patches of fire",
    );
  });

  it("matches Madding and Poison Spear-Hand Strike in game", () => {
    // The Madding Hand's and Poisoned Hand's fixed skills. Tested in game at +25 (+10 for the somber
    // Poisoned Hand) with 99 in every stat on a 123.2 defense target, each with 15 poise: the Madding
    // Hand's 730, and the Poisoned Hand's 733, with its instant deadly poison proc's first tick (0.14%
    // of the training dummy's 74212 HP plus 14, 117) on top of the hit's 616
    const hit = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      );
    };
    expect(hit("Madding Hand")).toEqual([[[730, 15]]]);
    expect(hit("Poisoned Hand")).toEqual([[[616, 15]]]);
    expect(616 + Math.floor(74212 * 0.0014 + 14)).toBe(733);
  });

  it("matches Sleep Evermore in game", () => {
    // Thiollier's Hidden Needle's fixed skill, on an awake or sleeping target: on a sleeping one it also
    // does 6.5% of the target's max HP plus 300. Tested in game at +25 with 99 in every stat on a 123.2
    // defense target: 714 and 15 poise, and its sleep; 5837 on the sleeping training dummy
    const weapon = getWeapon("Thiollier's Hidden Needle");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const build = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
          enemyHp: 74212,
        });
        return [variant?.short, build.finalValue, build.attackSteps![0][0].stance];
      },
    );
    expect(results).toEqual([
      ["Awake target", 714, 15],
      // 6.5% of the training dummy's 74212 HP plus 300, 5123, more
      ["Sleeping target", 714 + 5123, 15],
    ]);
  });

  it("matches Storm Kick in game", () => {
    // The Veteran's Prosthesis's fixed skill, a chain of its kick and its R2 follow-up. Tested in game
    // at +10 with 99 in every stat on a 123.2 defense target: 1006 and 10 poise, then 1506 and 25 (its
    // wind and the R2's lightning not hitting)
    const weapon = getWeapon("Veteran's Prosthesis");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.stepLabels).toEqual(["Storm Kick #1", "#2"]);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.map((step) => [
      step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0),
      step.reduce((sum, hit) => sum + hit.stance, 0),
    ]);
    expect(steps).toEqual([
      [1006, 10],
      [1506, 25],
    ]);
  });

  it("matches the Claws of Night's Scattershot in game", () => {
    // Its fixed Scattershot (Claws), which the sheet lists as Scattershot Throw: 4 claws. Tested in
    // game at +25 with 99 in every stat on a 123.2 defense target: 1296, 11.2 poise, and about 124
    // blood loss
    const weapon = getWeapon("Claws of Night");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(hits.map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual(
      Array(4).fill([324, 2.8]),
    );
    expect(
      hits.reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
    ).toBeCloseTo(124, -1);
  });

  it("matches Red Bear Hunt in game", () => {
    // The Red Bear's Claw's fixed skill, a chain of three swipes, each bullet hitting twice. Tested in
    // game at +25 with 99 in every stat on a 123.2 defense target: 1229 for #1, and 3655 in all
    const weapon = getWeapon("Red Bear's Claw");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!;
    const damage = steps.map((step) => step.reduce((sum, hit) => sum + Math.floor(hit.damage), 0));
    expect(damage[0]).toBe(1229);
    expect(damage.reduce((sum, value) => sum + value, 0)).toBe(3655);
    // Blood loss, fitted (the cause unknown): #1's and #2's swipes build up twice the weapon's 45, its
    // bullets none (tested in game: about 90 for #1 and 265 for the chain). To do: test it in vanilla
    expect(
      steps.map((step) =>
        step.reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0),
      ),
    ).toEqual([90, 90, 90]);
  });

  it("matches Deadly Poison Spray in game", () => {
    // The Deadly Poison Perfume Bottle's fixed skill, which the sheet leaves out: no damage, only deadly
    // poison, 6 hits of 65% of the bottle's. Tested in game at +10 with 99 in every stat: no damage,
    // and a proc at 273 resistance within a second (4 of these hits), and at 752 in about a second
    // (more than these hits' 442, probably from a cloud the data doesn't show)
    const weapon = getWeapon("Deadly Poison Perfume Bottle");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(hits).toHaveLength(6);
    expect(hits.every((hit) => hit.damage === 0)).toBe(true);
    const poison = hits.map((hit) => hit.status[AttackPowerType.POISON]!);
    expect(poison[0]).toBeCloseTo(73.8, 1);
    expect(poison.slice(0, 4).reduce((sum, buildup) => sum + buildup, 0)).toBeGreaterThan(273);
  });

  it("matches Feeble Lord's Frenzied Flame in game", () => {
    // Nanaya's Torch's fixed skill. Tested in game at +25 with 99 in every stat on a 123.2 defense
    // target: 80 with 1 poise
    const weapon = getWeapon("Nanaya's Torch");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
          ),
        ];
      },
    );
    expect(results).toEqual([[undefined, [[[80, 1]]]]]);
  });

  it("matches Firebreather in game", () => {
    // The Steel-Wire Torch's fixed skill: its fire, and its ground fire, which only burns where the fire
    // hits the ground, so it's shown but not counted. Tested in game at +25 with 99 in every stat on a
    // 123.2 defense target: 561, and 307 for the ground fire
    const weapon = getWeapon("Steel-Wire Torch");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      build.attackSteps!.flat().map((hit) => [Math.floor(hit.damage), hit.notCounted ?? false]),
    ).toEqual([
      [561, false],
      [307, true],
    ]);
    expect(build.finalValue).toBe(561);
  });

  it("builds up sleep with Fires of Slumber", () => {
    // St. Trina's Torch's fixed skill only builds up sleep: its fire, counted twice (it can hit again
    // every 0.4s, 2.5 times as often as Firebreather's), and its ground fire, which only burns where the
    // fire hits the ground, so it's shown but not counted (seen in game: the numbers right)
    const weapon = getWeapon("St. Trina's Torch");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const hits = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    }).attackSteps!.flat();
    expect(
      hits.map((hit) => [
        hit.damage,
        Math.round(hit.status[AttackPowerType.SLEEP] ?? 0),
        hit.notCounted ?? false,
      ]),
    ).toEqual([
      [0, 40, false],
      [0, 40, false],
      [0, 20, true],
    ]);
  });

  it("uses torches' R2s for Torch Attack", () => {
    // Torches' built-in skill (the Sentry's Torch's fixed one) is their R2 (seen in game)
    expect(getAshChoices(ashes).map(({ value }) => value)).toContain("Torch Attack");
    for (const name of ["Torch", "Sentry's Torch"]) {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Torch Attack", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      expect(result.attack.steps).toEqual(getAttackData(movesets, weapon, "R2", false, 0.5)!.steps);
    }
    expect(getAshAttack(ashes, movesets, getWeapon("Longsword"), "Torch Attack", false)).toEqual({
      unavailableReason: "Can't take Torch Attack",
    });
  });

  it("matches Reduvia Blood Blade in game", () => {
    // Its fixed skill. Tested in game on a Reduvia +25 with 99 in every stat on the training dummy: the
    // slash 208 with 1.65 poise and 209 blood loss, and the projectile 683 with 3 poise and 179
    const weapon = getWeapon("Reduvia");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [208, 1.65, expect.closeTo(209, 0)],
            [683, 3, expect.closeTo(179.1, 1)],
          ],
        ],
      ],
    ]);
  });

  it("matches Night-and-Flame Stance in game", () => {
    // Tested in game on the Sword of Night and Flame +10 with 99 in every stat on the training dummy:
    // the R2 2595, its swing 719 and one fire burst 1876 (its two fire rows hit one or the other); the
    // R1 3175, its swing 650, the point blank burst 195, the beam's loops 321 six times, and its final
    // hit 404, and 49.5 poise in all (with 3 poise-only hits of 5)
    const weapon = getWeapon("Sword of Night and Flame");
    const build = (followUp: string) => {
      const { ash } = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).find(
        ({ variant }) => variant?.short === followUp,
      )!;
      if (!("attack" in ash)) throw new Error(ash.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: ash.attack,
      });
    };
    const r2 = build("R2");
    expect(r2.attackSteps!.map((step) => step.map((hit) => hit.damage))).toEqual([[719, 1876]]);
    expect(r2.finalValue).toBe(2595);
    const r1 = build("R1");
    expect(
      r1.attackSteps!.map((step) => step.filter((hit) => hit.damage).map((hit) => hit.damage)),
    ).toEqual([[650, 195, 321, 321, 321, 321, 321, 321, 404]]);
    expect(r1.attackStance).toBe(49.5);
    expect(r1.finalValue).toBe(3175);
  });

  it("matches Golden Tempering in game", () => {
    // The Ornamental Straight Sword's skill puts 100 holy on it for its R2s. Tested in game on a +25
    // with 99 in every stat on the training dummy: the R2 1048 with 10 poise (1046 here: each hit is
    // 523.97, 495.49 physical and 28.48 holy, rounded down, where the game shows 524), and the fully charged R2 3282 with 50 poise (5 thrusts with each hand, 200 each, then the
    // final hits, 641 each)
    const weapon = getWeapon("Ornamental Straight Sword");
    const results = Object.fromEntries(
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const build = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        });
        return [variant!.short, [build.finalValue, build.attackStance]];
      }),
    );
    expect(results["Charged R2"]).toEqual([3282, 50]);
    expect(results["R2"][1]).toBe(10);
    expect(Math.abs(results["R2"][0]! - 1048)).toBeLessThanOrEqual(2);
  });

  it("matches Eochaid's Dancing Blade in game", () => {
    // The Regalia of Eochaid's skill. Tested in game on a +10 with 99 in every stat on the training
    // dummy: charged 2834 with 35.5 poise; uncharged 1933 with 23.5 (1926 here: its seven small hits
    // are each 129.976, rounded down, where the game shows 130)
    const weapon = getWeapon("Regalia of Eochaid");
    const results = Object.fromEntries(
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const build = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        });
        return [variant!.short, [build.finalValue, build.attackStance]];
      }),
    );
    expect(results["Charged"]).toEqual([2834, 35.5]);
    expect(results["Uncharged"][1]).toBe(23.5);
    expect(Math.abs(results["Uncharged"][0]! - 1933)).toBeLessThanOrEqual(7);
  });

  it("matches the Carian Knight's Sword's skill in game", () => {
    // Its fixed Carian Grandeur. Tested in game on a Carian Knight's Sword +25 with 99 in every stat on
    // the training dummy: level 1 1148 with 20 poise, level 2 1644 with 30, level 3 2088 with 45, and
    // with the Godfrey Icon only level 3 changes, 2401
    const weapon = getWeapon("Carian Knight's Sword");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
          if (!("attack" in ash)) throw new Error(ash.unavailableReason);
          return [
            variant!.short,
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
          ];
        }),
      );
    expect(build()).toEqual({
      "Level 1": [[[1148, 20]]],
      "Level 2": [[[1644, 30]]],
      "Level 3": [[[2088, 45]]],
    });
    expect(build(icon)).toEqual({
      "Level 1": [[[1148, 20]]],
      "Level 2": [[[1644, 30]]],
      "Level 3": [[[2401, 45]]],
    });
  });

  it("matches Moonlight Greatsword in game", () => {
    // The Dark Moon Greatsword's skill puts 65 magic on it for its R2s, a swing and its projectile.
    // Tested in game on a +10 with 99 in every stat on the training dummy: the R2 1282 (347 and 935);
    // the charged R2 with the Godfrey Icon 1834 (478, and 1356 for the projectile, which only it
    // boosts; 1179 without)
    const weapon = getWeapon("Dark Moon Greatsword");
    // Its R2s with its buff picked
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        ["R2 chain", "Charged R2 chain"].map((chain) => {
          const ash = getAshAttack(
            ashes,
            movesets,
            weapon,
            withFollowUp("Moonlight Greatsword", chain),
            false,
          );
          if (!("attack" in ash)) throw new Error(ash.unavailableReason);
          return [
            chain,
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
          ];
        }),
      );
    const versions = build();
    // Each is a chain of two of them
    const r2 = [
      [347, 7.7],
      [935, 15],
    ];
    expect(versions["R2 chain"]).toEqual([r2, r2]);
    expect(Object.keys(versions)).toEqual(["R2 chain", "Charged R2 chain"]);
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const charged = [
      [478, 8.8],
      [1179, 24],
    ];
    expect(versions["Charged R2 chain"]).toEqual([charged, charged]);
    const chargedWithIcon = [
      [478, 8.8],
      [1356, 24],
    ];
    expect(build(icon)["Charged R2 chain"]).toEqual([chargedWithIcon, chargedWithIcon]);
  });

  it("matches Muleta in game", () => {
    // Leontiel's Greatsword's fixed skill: the R1, and R2 and charged R2 chains, each followed by the
    // same second R2. Tested in game on a +10 with 99 in every stat on the training dummy.
    const weapon = getWeapon("Leontiel's Greatsword");
    // Its R2 #2 chains back to R2 #1 with R2 (tested in game), so the stance comes only before the
    // first: the R2 chain's R2 pressed 22 frames after L2, then each step at its R2 cancel
    const r2Chain = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).find(
      ({ variant }) => variant?.short === "R2 chain",
    )!.ash;
    if (!("attack" in r2Chain)) throw new Error(r2Chain.unavailableReason);
    const frames = (seconds: number) => Math.round(seconds * 60);
    expect(frames(r2Chain.attack.stepTimes![0].opening!)).toBe(22);
    expect(r2Chain.attack.cycleTimes!.map(frames)).toEqual([108, 112]);
    // Measured at 60 fps: R2 pressed at 1410, R2 #1's hit at 1485, R2 #2's at 1572, then 1704 and 1791
    const [first, second] = r2Chain.attack.stepTimes!;
    const [firstCycle, secondCycle] = r2Chain.attack.cycleTimes!;
    expect(frames(first.hits[0])).toBe(74);
    expect(frames(firstCycle + second.hits[0] - first.hits[0])).toBe(88);
    expect(frames(firstCycle + secondCycle)).toBe(220);
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true).map(
          ({ ash, variant }) => {
            if (!("attack" in ash)) throw new Error(ash.unavailableReason);
            return [
              variant!.short,
              optimizeBuild({
                weapon,
                regularUpgradeLevel: 25,
                twoHanding: false,
                startLevel: 9,
                currentLevel: 9,
                attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
                bonusAttributes: noBonus,
                objective: "totalAttack",
                defenses: Object.fromEntries(
                  allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
                ),
                physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
                limits: { ...noLimits, maxLevels: 0 },
                attack: ash.attack,
                buffs,
              }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
            ];
          },
        ),
      );
    expect(build()).toEqual({
      "R2 chain": [[[1353, 12.1]], [[1511, 12.1]]],
      "Charged R2 chain": [[[1979, 44]], [[1511, 12.1]]],
      R1: [[[1007, 8.25]]],
    });
  });

  it("matches Taker's Flames in game", () => {
    // The Blasphemous Blade's fixed skill. Tested in game on a +10 with 99 in every stat on the training
    // dummy: the swing 478 with 8.25 poise and the flames 1666 with 15.95; with the Talisman of the
    // Dread (×1.15 for its category 123 hits) the flames 1916
    const weapon = getWeapon("Blasphemous Blade");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Talisman of the Dread"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
          if (!("attack" in ash)) throw new Error(ash.unavailableReason);
          return [
            variant?.short ?? "main",
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
          ];
        }),
      );
    expect(build()).toEqual({
      main: [
        [
          [478, 8.25],
          [1666, 15.95],
        ],
      ],
    });
    expect(build(icon)).toEqual({
      main: [
        [
          [478, 8.25],
          [1916, 15.95],
        ],
      ],
    });
  });

  it("matches Ordovis's Vortex in game", () => {
    // Ordovis's Greatsword's fixed skill. Tested in game on a +10 with 99 in every stat on the training
    // dummy: uncharged 1242 and 540 with 11 and 8.25 poise; charged 1294 with 33, 438 twice, and 540,
    // with 11 each
    const weapon = getWeapon("Ordovis's Greatsword");
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
          if (!("attack" in ash)) throw new Error(ash.unavailableReason);
          return [
            variant!.short,
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
          ];
        }),
      );
    expect(build()).toEqual({
      Uncharged: [
        [
          [1242, 11],
          [540, 8.25],
        ],
      ],
      Charged: [
        [
          [1294, 33],
          [438, 11],
          [438, 11],
          [540, 11],
        ],
      ],
    });
  });

  it("matches the Marais Executioner's Sword's skill in game", () => {
    // Its fixed Eochaid's Dancing Blade. Tested in game on a +10 with 99 in every stat on the training
    // dummy, damage and poise uncharged and charged, and with the Godfrey Icon (only the charged one
    // changes)
    const weapon = getWeapon("Marais Executioner's Sword");
    const icon = getBuffEffects(
      (
        JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
          .buffs as Buff[]
      ).filter((buff) => buff.name === "Godfrey Icon"),
      3,
    );
    const build = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
          if (!("attack" in ash)) throw new Error(ash.unavailableReason);
          return [
            variant!.short,
            optimizeBuild({
              weapon,
              regularUpgradeLevel: 25,
              twoHanding: false,
              startLevel: 9,
              currentLevel: 9,
              attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
              bonusAttributes: noBonus,
              objective: "totalAttack",
              defenses: Object.fromEntries(
                allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
              ),
              physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
              limits: { ...noLimits, maxLevels: 0 },
              attack: ash.attack,
              buffs,
            }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
          ];
        }),
      );
    const totals = (buffs: BuffEffect[] = []) =>
      Object.fromEntries(
        Object.entries(build(buffs)).map(([version, steps]) => [
          version,
          [
            steps.flat().reduce((sum, [damage]) => sum + damage, 0),
            Math.round(steps.flat().reduce((sum, [, stance]) => sum + stance, 0) * 100) / 100,
          ],
        ]),
      );
    expect(totals()).toEqual({ Uncharged: [2238, 25.85], Charged: [3262, 39.05] });
    expect(totals(icon)).toEqual({ Uncharged: [2238, 25.85], Charged: [3746, 39.05] });
  });

  it("matches the Crystal Sword's skill in game", () => {
    // Its fixed Spinning Slash chain. Tested in game on a Crystal Sword +10 with 99 in every stat on
    // the training dummy: 681 with 14.5 poise, then 337 with 4.5 and 719 with 14.5
    const weapon = getWeapon("Crystal Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [[681, 14.5]],
          [
            [337, 4.5],
            [719, 14.5],
          ],
        ],
      ],
    ]);
  });

  it("matches Solitary Moon Slash in game", () => {
    // The Greatsword of Solitude's fixed skill, a chain. Tested in game on a +10 with 99 in every stat
    // on the training dummy: 324 and 993, then 1299 (its startup stagger adds poise, 5.5 here)
    const weapon = getWeapon("Greatsword of Solitude");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [324, 5.5],
            [993, 11],
          ],
          [
            [0, 5.5],
            [1299, 27.5],
          ],
        ],
      ],
    ]);
  });

  it("matches Alabaster Lords' Pull in game", () => {
    // Its fixed skill hits with the thrust and one of its rings (the outer one). Tested in game on a
    // +10 with 99 in every stat on the training dummy: 1726 with 25.5 poise.
    const weapon = getWeapon("Alabaster Lord's Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [706, 5.5],
            [1020, 20],
          ],
        ],
      ],
    ]);
  });

  it("matches Ghostflame Ignition in game", () => {
    // The Death's Poker's fixed skill, without a follow-up. Tested in game on a +10 with 99 in every
    // stat on the training dummy: 1504 (4 ticks of 209 and the explosion 668), 15.5 poise (the thrust
    // 5.5), and about 660 frost (665 here: the thrust's 65, 120 a tick, and 120)
    const weapon = getWeapon("Death's Poker");
    const result = getAshAttack(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.finalValue).toBe(1504);
    expect(build.attackStance).toBe(15.5);
    expect(build.attackStatus![AttackPowerType.FROST]).toBe(665);
    const variants = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true);
    // Offered only with its follow-ups
    expect(variants.map(({ variant }) => variant?.short)).toEqual([
      "with R1 follow-up",
      "with R2 follow-up",
    ]);
    const r1 = variants.find(({ variant }) => variant?.short === "with R1 follow-up")!.ash;
    if (!("attack" in r1)) throw new Error(r1.unavailableReason);
    const r1Build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: r1.attack,
    });
    // With the R1 follow-up: 5318 with 26 poise, and about 2000 frost as it decays (2095 here)
    expect([r1Build.finalValue, r1Build.attackStance]).toEqual([5318, 26]);
    expect(r1Build.attackStatus![AttackPowerType.FROST]).toBe(2095);
    const r2 = variants.find(({ variant }) => variant?.short === "with R2 follow-up")!.ash;
    if (!("attack" in r2)) throw new Error(r2.unavailableReason);
    const r2Build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: r2.attack,
    });
    // With the R2 follow-up: 2483 with 32 poise (the R2's swing 5.5), and about 860 frost (875 here)
    expect([r2Build.finalValue, r2Build.attackStance]).toEqual([2483, 32]);
    expect(r2Build.attackStatus![AttackPowerType.FROST]).toBe(875);
  });

  it("matches Wave of Gold in game", () => {
    // The Sacred Relic Sword's fixed skill hits once. Tested in game on a +10 with 99 in every stat on
    // the training dummy: 1483 with 6 poise.
    const weapon = getWeapon("Sacred Relic Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([[undefined, [[[1483, 6]]]]]);
  });

  it("matches Establish Order in game", () => {
    // The Golden Order Greatsword's fixed skill, a chain. Tested in game on a +10 with 99 in every stat
    // on the training dummy: 977, then 531 and one holy bullet of 1466 (of three alternatives), 2974 in
    // all
    const weapon = getWeapon("Golden Order Greatsword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [[977, 19.25]],
          [
            [531, 8.25],
            [1466, 9.9],
          ],
        ],
      ],
    ]);
  });

  it("matches Needle Piercer in game", () => {
    // Leda's Sword's fixed skill. Tested in game on a +10 with 99 in every stat on the training dummy:
    // the thrust 448, then 10 needles, all of which can hit, 157 each (1570 with 11 poise)
    const weapon = getWeapon("Leda's Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    const [[, [hits]]] = results as [unknown, number[][][]][];
    expect(hits).toEqual([[448, 8.25], ...Array(10).fill([157, 1.1])]);
  });

  it("matches the Sword of Light's skill in game", () => {
    // Its fixed Light: 16 bolts, at most 5 of which hit, with the ×1.2 holy its effect puts on the
    // player. Tested in game on a Sword of Light +10 with 99 in every stat on the training dummy: 298 a
    // bolt.
    const weapon = getWeapon("Sword of Light");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [undefined, [[298, 298, 298, 298, 298].map((damage) => [damage, 5])]],
    ]);
  });

  it("matches Mists of Slumber in game", () => {
    // The Sword of St. Trina's skill puts a sleep buff on it (1881: 20 a hit). Tested in game on a +10
    // with 99 in every stat on the training dummy: 907 with 6.5 poise, and about 241 sleep at once: the
    // swing's 86 (its own 66 and the buff's 20) and its cloud's 156 (90 and the sword's 66), 242 here
    const weapon = getWeapon("Sword of St. Trina");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.SLEEP]]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [907, 6.5, 86],
            [0, 0, 156],
          ],
        ],
      ],
    ]);
  });

  it("matches Mists of Eternal Sleep in game", () => {
    // The Velvet Sword of St. Trina's skill puts a sleep buff on it (20001031: 15 a hit) and releases a
    // cloud. Tested in game on a +10 with 99 in every stat on the training dummy: the swing 863 with 6.5
    // poise, and the cloud 112 sleep (70 and the sword's own 42)
    const weapon = getWeapon("Velvet Sword of St. Trina");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.SLEEP]]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [863, 6.5, 57],
            [0, 0, 112],
          ],
        ],
      ],
    ]);
  });

  it("matches the Stone-Sheathed Sword's skill in game", () => {
    // Its fixed Square Off. Tested in game on a Stone-Sheathed Sword +25 with 99 in every stat on the
    // training dummy: the R1 1032 with 30 poise, the R2 1239 with 40
    const weapon = getWeapon("Stone-Sheathed Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      ["R1", [[[1032, 30]]]],
      ["R2", [[[1239, 40]]]],
    ]);
  });

  it("matches Unblockable Blade in game", () => {
    // The Coded Sword's fixed skill. Tested in game on a Coded Sword (fully upgraded) with 99 in every
    // stat on the training dummy: one hit of 1269 with 30 poise
    const weapon = getWeapon("Coded Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([[undefined, [[[1269, 30]]]]]);
    // The Cipher Pata's, also right in game fully upgraded with 99 in every stat: 1358 with 30 poise
    const pata = getWeapon("Cipher Pata");
    const pataResult = getAshAttack(ashes, movesets, pata, "Lion's Claw", false);
    if (!("attack" in pataResult)) throw new Error(pataResult.unavailableReason);
    expect(
      optimizeBuild({
        weapon: pata,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: pataResult.attack,
      }).attackSteps!.map((step) =>
        step.map((hit) => [Math.floor(hit.damage), +hit.stance.toFixed(1)]),
      ),
    ).toEqual([[[1358, 30]]]);
  });

  it("matches the Miquellan Knight's Sword's skill in game", () => {
    // Its fixed Sacred Blade. Tested in game on a Miquellan Knight's Sword +10 with 99 in every stat on
    // the training dummy: the slash 394 with 5 poise (with the skill's 90 holy buff), the projectile
    // 939 with 13
    const weapon = getWeapon("Miquellan Knight's Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [
            [394, 5],
            [939, 13],
          ],
        ],
      ],
    ]);
  });

  it("matches the Sword of Darkness's skill in game", () => {
    // Its fixed Darkness. Tested in game on a Sword of Darkness +10 with 99 in every stat on the
    // training dummy: one hit of 1578 with 20 poise
    const weapon = getWeapon("Sword of Darkness");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance])),
        ];
      },
    );
    expect(results).toEqual([[undefined, [[[1578, 20]]]]]);
  });

  it("matches the Rotten Crystal Sword's skill in game", () => {
    // Its fixed Spinning Slash chain. Tested in game on a Rotten Crystal Sword +10 with 99 in every
    // stat on the training dummy: 647, then 319 and 683, with 14.5, 4.5, and 14.5 poise and 32.5, 25,
    // and 35 scarlet rot
    const weapon = getWeapon("Rotten Crystal Sword");
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [
          variant?.short,
          optimizeBuild({
            weapon,
            regularUpgradeLevel: 25,
            twoHanding: false,
            startLevel: 9,
            currentLevel: 9,
            attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
            bonusAttributes: noBonus,
            objective: "totalAttack",
            defenses: Object.fromEntries(
              allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
            ),
            physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
            limits: { ...noLimits, maxLevels: 0 },
            attack: ash.attack,
          }).attackSteps!.map((step) =>
            step.map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.SCARLET_ROT]]),
          ),
        ];
      },
    );
    expect(results).toEqual([
      [
        undefined,
        [
          [[647, 14.5, 32.5]],
          [
            [319, 4.5, 25],
            [683, 14.5, 35],
          ],
        ],
      ],
    ]);
  });

  it("matches Moon-and-Fire Stance in game", () => {
    // Rellana's Twin Blades' fixed skill. Tested in game on a +10 with 99 in every stat on the training
    // dummy: the R1 chain 254, 261, and two moons of 420, then 267, 274, and two of 420, then 288 and
    // 689; the R2 76 three times, its fireballs 473, 489, and 554, and a flame pillar 219, which can
    // hit several times (one counted, with a note)
    const weapon = getWeapon("Rellana's Twin Blades");
    // Its R1 chain chained as fast as possible (60 fps): first hits at 1526, 1585, 1672, then 1801
    // (each step at its R1 cancel, then L2 and the stance's R1 again; the repeat 3 frames sooner)
    const r1Chain = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).find(
      ({ variant }) => variant?.short === "R1 chain",
    )!.ash;
    if (!("attack" in r1Chain)) throw new Error(r1Chain.unavailableReason);
    const frames = (seconds: number) => Math.round(seconds * 60);
    const r1Steps = r1Chain.attack.stepTimes!;
    const r1Cycles = r1Chain.attack.cycleTimes!;
    const firstHit = (i: number) =>
      r1Cycles.slice(0, i).reduce((sum, time) => sum + time, 0) + r1Steps[i].hits[0];
    expect([1, 2].map((i) => frames(firstHit(i) - firstHit(0)))).toEqual([58, 146]);
    expect(frames(r1Cycles.reduce((sum, time) => sum + time, 0))).toBe(278);
    const results = getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false, 0.5, true).map(
      ({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        const build = optimizeBuild({
          weapon,
          regularUpgradeLevel: 25,
          twoHanding: false,
          startLevel: 9,
          currentLevel: 9,
          attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
          bonusAttributes: noBonus,
          objective: "totalAttack",
          defenses: Object.fromEntries(
            allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
          ),
          physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
          limits: { ...noLimits, maxLevels: 0 },
          attack: ash.attack,
        });
        return [
          variant?.short,
          build.attackSteps!.map((step) => step.map((hit) => hit.damage)),
          build.attackNote,
        ];
      },
    );
    const note = "Counts one hit of its flame pillars, which can hit several times";
    expect(results).toEqual([
      [
        "R1 chain",
        [
          [254, 261, 420, 420],
          [267, 274, 420, 420],
          [288, 689],
        ],
        undefined,
      ],
      ["R2", [[76, 76, 76, 473, 489, 554, 219]], note],
    ]);
  });

  it("matches Golden Crux in game", () => {
    // The Greatsword of Damnation's fixed skill: a chain of its thrust and bullet, and a version of
    // its grab, which only NPCs take. Tested in game on a +10 with 99 in every stat: on the training
    // dummy 1137 then 1386 (16.5 poise each); on Sir Gideon Ofnir (the Ashen Capital's) the grab 1810.
    const weapon = getWeapon("Greatsword of Damnation");
    const build = (attack: AttackData, gideon: boolean) => {
      const defense = [105.5, 139.1, 129.5, 103.1, 110.3];
      const negation = [25.5, 24.6, 19.2, 20.5, 17.8];
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [
            damageType,
            gideon
              ? { defense: defense[damageType], negation: negation[damageType] }
              : { defense: 123.2, negation: 0 },
          ]),
        ),
        physicalNegation: gideon
          ? { standard: 25.5, strike: 26.5, slash: 23.6, pierce: 23.6 }
          : { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
      }).attackSteps!.map((step) => step.map((hit) => [hit.damage, hit.stance]));
    };
    const versions = Object.fromEntries(
      getAshAttacks(ashes, movesets, weapon, "Lion's Claw", false).map(({ ash, variant }) => {
        if (!("attack" in ash)) throw new Error(ash.unavailableReason);
        return [variant!.short, ash.attack];
      }),
    );
    expect(Object.keys(versions)).toEqual(["Golden Crux", "NPC"]);
    expect(build(versions["Golden Crux"], false)).toEqual([[[1137, 16.5]], [[1386, 16.5]]]);
    expect(build(versions["NPC"], true)[0][0][0]).toBe(1810);
  });

  it("matches Savage Claws in game", () => {
    // Tested in game on the Beast Claw (fully upgraded) with 99 in every stat on the training dummy:
    // 325, 330, 289, 294, 299, and 442, with 4, 4, 2, 2, 2, and 8 poise and 27 blood loss each
    const weapon = getWeapon("Beast Claw");
    const result = getAshAttack(ashes, movesets, weapon, "Savage Claws", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(
      attackSteps![0].map((hit) => [hit.damage, hit.stance, hit.status[AttackPowerType.BLEED]]),
    ).toEqual([
      [325, 4, 27],
      [330, 4, 27],
      [289, 2, 27],
      [294, 2, 27],
      [299, 2, 27],
      [442, 8, 27],
    ]);
  });

  it("matches Sacred Ring of Light in game", () => {
    // Tested in game on a Scythe +25 with 99 in every stat on the training dummy: the swing 348 and
    // the ring 620, with 5 and 3 poise
    const weapon = getWeapon("Scythe");
    const result = getAshAttack(ashes, movesets, weapon, "Sacred Ring of Light", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const { attackSteps } = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(attackSteps![0].map((hit) => [hit.damage, hit.stance])).toEqual([
      [348, 5],
      [620, 3],
    ]);
  });

  it("matches Sacred Blade in game", () => {
    // Tested in game at +25 with 99 in every stat on the training dummy (123.2 defense, no
    // negation): on a Longsword the slash does 306 and the whole skill 1232; on a Sacred Longsword
    // the projectile does 1020 and the whole skill 1375. The slash gets Sacred Blade's 90 holy
    // weapon buff, added to the hit's holy attack before defenses.
    const sacredBladeBuild = (name: string) => {
      const weapon = getWeapon(name);
      const result = getAshAttack(ashes, movesets, weapon, "Sacred Blade", false);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      });
    };
    const sacredBlade = (name: string) =>
      sacredBladeBuild(name).attackSteps![0].map((hit) => Math.floor(hit.damage));
    const [slash, projectile] = sacredBlade("Longsword");
    expect(slash).toBe(306);
    expect(slash + projectile).toBe(1232);
    const [sacredSlash, sacredProjectile] = sacredBlade("Sacred Longsword");
    expect(sacredProjectile).toBe(1020);
    expect(sacredSlash + sacredProjectile).toBe(1375);
    // The breakdown shows the skill's own buff's attack power: a holy row of its 90 on a Longsword
    const holy = sacredBladeBuild("Longsword").breakdown.find(
      (row) => row.damageType === AttackPowerType.HOLY,
    )!;
    expect([holy.buff, holy.total]).toEqual([90, 90]);
    // The Inseparable Sword +10 (tested in game, damage and poise): 524 and 939, 18.5 poise
    const inseparable = sacredBladeBuild("Inseparable Sword");
    expect(inseparable.attackSteps![0].map((hit) => Math.floor(hit.damage))).toEqual([524, 939]);
    expect(inseparable.finalValue).toBe(1463);
    expect(inseparable.attackStance).toBe(18.5);

    // The optimizer agrees with brute force when hits' attack is added up before defenses
    const weapon = getWeapon("Sacred Longsword");
    const attack = getAshAttack(ashes, movesets, weapon, "Sacred Blade", false);
    if (!("attack" in attack)) throw new Error(attack.unavailableReason);
    const options: OptimizeOptions = {
      weapon,
      upgradeLevel: 25,
      twoHanding: false,
      attributes: { str: 12, dex: 11, int: 9, fai: 12, arc: 9 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 120, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      hits: attack.attack.steps[0].map((hit) => ({
        ...hit,
        flatAttack: hit.flatAttack?.map((flat) => flat * 4),
        weight: 1,
      })),
    };
    const curve = optimizeAttributes(options)!;
    const expected = bruteForce(options, 8);
    for (let n = 0; n <= 8; n++) {
      expect(curve.values[n]).toBeCloseTo(expected[n], 6);
    }
  });

  it("counts a follow-up chosen with an Ash of War", () => {
    // Tested in game: a Standard Longsword +25's Ghostflame Call does 794 and with its R2 follow-up
    // 1533 with 99 in every stat on the training dummy. With the R2 chosen, both count.
    const longsword = getWeapon("Longsword");
    expect(getAshChoices(ashes).map(({ label }) => label)).toContain(
      "Ghostflame Call with R2 follow-up",
    );
    const build = (choice: string, attributes: Attributes) => {
      const result = getAshAttack(ashes, movesets, longsword, choice, false, 0.5, true);
      if (!("attack" in result)) throw new Error(result.unavailableReason);
      return optimizeBuild({
        weapon: longsword,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes,
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: result.attack,
      });
    };
    const all99 = { str: 99, dex: 99, int: 99, fai: 99, arc: 99 };
    // Without the follow-up, only the main attack is shown
    const alone = build("Ghostflame Call", all99);
    expect(alone.attackSteps).toHaveLength(1);
    expect(alone.finalValue).toBe(794);
    const withR2 = build(withFollowUp("Ghostflame Call", "R2"), all99);
    expect(withR2.attackSteps).toHaveLength(2);
    expect(withR2.finalValue).toBe(1533);

    // A weapon's version of a skill without the follow-up says so
    expect(
      getAshAttack(ashes, movesets, longsword, withFollowUp("Lion's Claw", "R2"), false, 0.5, true),
    ).toEqual({ unavailableReason: "No R2 follow-up to Lion's Claw" });
  });

  it("splits stances into their attacks", () => {
    const labels = getAshChoices(ashes).map(({ label }) => label);
    expect(labels).toContain("Unsheathe (R1)");
    expect(labels).toContain("Unsheathe (R2)");
    expect(labels).not.toContain("Unsheathe");
    // Also for a stance only one weapon has (Overhead Stance, the Great Katana's)
    expect(labels).toContain("Overhead Stance (R1)");
    expect(labels).toContain("Overhead Stance (R2)");
    const overhead = getAshAttack(
      ashes,
      movesets,
      getWeapon("Great Katana"),
      withFollowUp("Overhead Stance", "R2"),
      false,
    );
    if (!("attack" in overhead)) throw new Error(overhead.unavailableReason);
    expect(overhead.attack.steps[0]).toHaveLength(3);
    const katana = getWeapon("Uchigatana");
    const r2 = getAshAttack(ashes, movesets, katana, withFollowUp("Unsheathe", "R2"), false);
    if (!("attack" in r2)) throw new Error(r2.unavailableReason);
    expect(r2.attack.stepLabels).toEqual(["Unsheathe R2"]);
    // Stances without a chosen attack (e.g. a fixed skill) use their first
    const squareOff = getAshAttack(ashes, movesets, getWeapon("Longsword"), "Square Off", false);
    if (!("attack" in squareOff)) throw new Error(squareOff.unavailableReason);
    expect(squareOff.attack.stepLabels).toEqual(["Square Off R1"]);
  });

  it("only offers Ashes of War that do damage", () => {
    const labels = getAshChoices(ashes).map(({ label }) => label);
    expect(labels).not.toContain("Assassin's Gambit");
    expect(labels).not.toContain("Parry");
    expect(labels).toContain("Lion's Claw");
    // War Cry's R2s are the weapon's R2s with its buff picked, and it does no damage itself
    expect(labels.filter((label) => label.startsWith("War Cry"))).toEqual([]);
    // Spinning Slash is one chain, whichever weapon's version
    expect(labels.filter((label) => label.startsWith("Spinning Slash"))).toEqual([
      "Spinning Slash",
    ]);
  });

  it("counts Black Flame Tornado's black flame with the enemy's HP", () => {
    const labels = getAshChoices(ashes).map(({ label }) => label);
    expect(labels).toContain("Black Flame Tornado (Tap)");
    expect(labels).toContain("Black Flame Tornado (Fully charged)");
    // Tested in game: a Standard Twinblade +25 with 99 in every stat does 2449 tapped and 11689
    // fully charged (5 loops) on the training dummy (74212 HP). Each hit does 273 (loop) or 874
    // (finisher), and its black flame 21 × 75.
    const weapon = getWeapon("Twinblade");
    const build = (followUp: string, enemyHp?: number) => {
      const attack = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Black Flame Tornado", followUp),
        false,
      );
      if (!("attack" in attack)) throw new Error(attack.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: attack.attack,
        enemyHp,
      });
    };
    const total = (result: ReturnType<typeof build>) =>
      result.attackSteps![0].reduce(
        (sum, hit) => sum + Math.floor(hit.damage) + (hit.hpDamage?.damage ?? 0),
        0,
      );
    expect(total(build("Tap", 74212))).toBe(2449);
    expect(total(build("Fully charged", 74212))).toBe(11689);
    expect(build("Fully charged", 74212).hpDamage).toEqual({ label: "Black flame", damage: 9450 });
    // Without an enemy, black flame isn't counted, and the result says so
    const unknown = build("Tap");
    expect(Math.floor(unknown.finalValue)).toBe(874);
    expect(unknown.uncountedHpDamage).toEqual({
      label: "Black flame",
      rate: 0.001,
      ticks: 21,
      flat: 1,
    });
  });

  it("counts only Beast's Roar's bullet", () => {
    // Tested in game: a Quality Longsword +25 with 99 in every stat does 542 with the bullet on the
    // training dummy (or 363 with the AoE, never both)
    const weapon = getWeapon("Quality Longsword");
    const attack = getAshAttack(ashes, movesets, weapon, "Beast's Roar", false);
    if (!("attack" in attack)) throw new Error(attack.unavailableReason);
    const build = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: attack.attack,
    });
    expect(build.attackSteps!.map((step) => step.map((hit) => hit.kind))).toEqual([["Bullet"]]);
    // Its physical damage is all flat attack
    expect(build.attackSteps![0][0].physicalType).toBe("strike");
    expect(Math.floor(build.finalValue)).toBe(542);
    expect(build.attackStance).toBe(6);
  });

  it("treats War Cry's and Barbaric Roar's R2s as chains", () => {
    const labels = getAshChoices(ashes).map(({ label }) => label);
    // They're the weapon's R2s with the buff picked, not offered on their own
    for (const skill of ["War Cry", "Barbaric Roar"]) {
      expect(labels.filter((label) => label.startsWith(skill))).toEqual([]);
    }
    const result = getAshAttack(
      ashes,
      movesets,
      getWeapon("Longsword"),
      withFollowUp("War Cry", "Charged R2 chain"),
      false,
      0.5,
    );
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.attack.stepLabels).toEqual(["War Cry Charged R2 #1", "Charged R2 #2"]);
    // The running charge's poise is one hit in game: 3 in #1, 2 in #2
    expect(result.attack.steps.map((step) => step.map((hit) => hit.flatPoise))).toEqual([
      [3, undefined],
      [2, undefined],
    ]);
    expect(result.attack.weights).toEqual([expect.closeTo(2 / 3), expect.closeTo(1 / 3)]);

    // War Cry's buff gives them ×1.075 physical attack power and +0.05 Strength scaling. Tested in
    // game: a Heavy Longsword +25 with 99 in every stat does 742 (R2 #1) and 973 (charged R2 #1) on
    // the training dummy.
    const heavy = getWeapon("Heavy Longsword");
    const firstHit = (chain: string, skill = "War Cry", twoHanding = false, weapon = heavy) => {
      const attack = getAshAttack(ashes, movesets, weapon, withFollowUp(skill, chain), twoHanding);
      if (!("attack" in attack)) throw new Error(attack.unavailableReason);
      const steps = optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack: attack.attack,
      }).attackSteps!;
      return steps[0].reduce((sum, hit) => sum + Math.floor(hit.damage), 0);
    };
    expect(firstHit("R2 chain")).toBe(742);
    expect(firstHit("Charged R2 chain")).toBe(973);
    // Barbaric Roar's R2 #1 (three hits) does 1024 in game, with the same buff
    expect(firstHit("R2 chain", "Barbaric Roar")).toBe(1024);
    // On a Longsword +25 one handed, R2 #1 1088 and charged R2 #1 1316 (tested in game)
    const longsword = getWeapon("Longsword");
    expect([
      firstHit("R2 chain", "Barbaric Roar", false, longsword),
      firstHit("Charged R2 chain", "Barbaric Roar", false, longsword),
    ]).toEqual([1088, 1316]);
    // Braggart's Roar uses War Cry's two handed R2s with ×1.1 physical attack power and no Strength
    // bonus: 875 and 1116 (charged) in game
    expect(firstHit("R2 chain", "Braggart's Roar", true)).toBe(875);
    expect(firstHit("Charged R2 chain", "Braggart's Roar", true)).toBe(1116);
    expect(
      getAshAttack(ashes, movesets, heavy, withFollowUp("Braggart's Roar", "R2 chain"), false),
    ).toEqual({ unavailableReason: "Two handed only" });

    // Barbaric Roar's Fist and Hand-to-Hand versions, two handed with the Roar Medallion (×1.15 for
    // roar attacks): its charged R2 #1 does 1875 with 27 poise on a Golem Fist, 1668 on an Iron Ball,
    // and 1497 with 21.6 poise with Dryleaf Arts in game, each of its three hits the same (fitted: the
    // data's third hit is higher). The Claw version's third hit is higher, as the data says (tested
    // on the Hookclaws, 505, 505, and 598)
    const buffList = JSON.parse(
      readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
    ).buffs as Buff[];
    const roarMedallion = getBuffEffects(
      [buffList.find((buff) => buff.name === "Roar Medallion")!],
      1,
    );
    const fistFirstHit = (name: string) => {
      const weapon = getWeapon(name);
      const attack = getAshAttack(
        ashes,
        movesets,
        weapon,
        withFollowUp("Barbaric Roar", "Charged R2 chain"),
        true,
      );
      if (!("attack" in attack)) throw new Error(attack.unavailableReason);
      return optimizeBuild({
        weapon,
        regularUpgradeLevel: 25,
        twoHanding: true,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        buffs: roarMedallion,
        attack: attack.attack,
      }).attackSteps![0].map((hit) => [Math.floor(hit.damage), hit.stance]);
    };
    expect(fistFirstHit("Golem Fist")).toEqual([
      [625, 9],
      [625, 9],
      [625, 9],
    ]);
    expect(fistFirstHit("Iron Ball").map(([damage]) => damage)).toEqual([556, 556, 556]);
    expect(fistFirstHit("Dryleaf Arts")).toEqual([
      [499, 7.2],
      [499, 7.2],
      [499, 7.2],
    ]);
    expect(fistFirstHit("Hookclaws").map(([damage]) => damage)).toEqual([505, 505, 598]);

    // Chosen as a weapon buff, War Cry gives the weapon's own attacks the same Strength scaling
    const warCry = (
      JSON.parse(readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"))
        .buffs as Buff[]
    ).find((buff) => buff.kind === "skill" && buff.name === "War Cry")!;
    expect(describeBuff(warCry)).toBe("×1.075 physical attack, +5 STR scaling");
    const r2 = getAttackData(movesets, heavy, "R2", false, 0.5)!;
    const r2Damage = (attack: AttackData, buffs: BuffEffect[]) =>
      optimizeBuild({
        weapon: heavy,
        regularUpgradeLevel: 25,
        twoHanding: false,
        startLevel: 9,
        currentLevel: 9,
        attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
        bonusAttributes: noBonus,
        objective: "totalAttack",
        defenses: Object.fromEntries(
          allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
        ),
        physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
        limits: { ...noLimits, maxLevels: 0 },
        attack,
        buffs,
      }).finalValue;
    const rateOnly = [{ attackPowerRates: [1.075, 1, 1, 1, 1] }];
    expect(r2Damage(r2, getBuffEffects([warCry], 3))).toBe(
      r2Damage({ ...r2, scalingBonus: { str: 0.05 } }, rateOnly),
    );
    expect(r2Damage(r2, getBuffEffects([warCry], 3))).toBeGreaterThan(r2Damage(r2, rateOnly));
  });

  it("adds skills' flat poise damage", () => {
    // Tested in game: Sacred Blade's projectile does 13 poise damage from a Longsword +25
    const longsword = getWeapon("Longsword");
    const result = getAshAttack(ashes, movesets, longsword, "Sacred Blade", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    const build = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    expect(build.attackSteps![0][1].stance).toBe(13);
  });

  it("counts only the main attack, and shows ticks per second", () => {
    const club = getWeapon("Large Club");
    const result = getAshAttack(ashes, movesets, club, "Eruption", false);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    expect(result.skill).toBe("Eruption");
    expect(result.attack.weights[0]).toBe(1);
    expect(result.attack.weights.slice(1).every((weight) => weight === 0)).toBe(true);
    const build = optimizeBuild({
      weapon: club,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 40, dex: 20, int: 9, fai: 9, arc: 9 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: result.attack,
    });
    const ticks = build.attackSteps![0].filter((hit) => hit.tick);
    expect(ticks.length).toBeGreaterThan(0);
    // Lava ticks hit every second
    for (const tick of ticks) expect(tick.perSecond).toBeCloseTo(tick.damage);
    expect(result.attack.stepLabels![0]).toBe("Eruption");
  });
});

describe("enemy types", () => {
  const allBuffs = JSON.parse(
    readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
  ).buffs as Buff[];
  const ammo: AmmoGroup[] = JSON.parse(
    readFileSync(new URL("../../public/ammo.json", import.meta.url), "utf8"),
  );
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const damage = (
    weapon: Weapon,
    enemyTypes: BuildRequest["enemyTypes"],
    buffs: BuffEffect[] = [],
  ) =>
    optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses,
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      // Buffs' damage multipliers only apply to an attack's hits
      attack:
        getAttackData(movesets, weapon, "Standard Shot", true, 0.5) ?? plainHit(movesets, weapon),
      enemyTypes,
      buffs,
    }).curve.values[0];

  it("multiplies weapons' damage against their enemy types after defenses", () => {
    const epitaph = getWeapon("Golden Epitaph");
    expect(epitaph.enemyTypeRates).toEqual({ death: 1.3 });
    expect(damage(epitaph, ["death"])).toBeCloseTo(damage(epitaph, []) * 1.3, 1);
    expect(damage(epitaph, ["dragon"])).toBeCloseTo(damage(epitaph, []), 1);
    const greatclaw = getWeapon("Dragon Greatclaw");
    expect(damage(greatclaw, ["ancientDragon"])).toBeCloseTo(damage(greatclaw, []) * 1.15, 1);
    expect(damage(greatclaw, ["dragon"])).toBeCloseTo(damage(greatclaw, []) * 1.3, 1);
  });

  it("multiplies ammunition's damage against its enemy types", () => {
    const harpoon = withAmmo(
      getWeapon("Greatbow"),
      ammo.find((group) => group.names.includes("Igon's Harpoon"))!,
    );
    expect(harpoon.enemyTypeRates).toMatchObject({ ancientDragon: 1.15, dragon: 1.3 });
    expect(damage(harpoon, ["dragon"])).toBeCloseTo(damage(harpoon, []) * 1.3, 1);
  });

  it("multiplies buffs' damage against their enemy types", () => {
    const longsword = getWeapon("Longsword");
    const effects = (name: string) =>
      getBuffEffects(
        allBuffs.filter((buff) => buff.name === name),
        3,
      );
    // Dragon Communion Grease: ×1.38 against dragons, nothing otherwise
    const grease = effects("Dragon Communion Grease");
    expect(damage(longsword, ["dragon"], grease)).toBeCloseTo(damage(longsword, []) * 1.38, 1);
    expect(damage(longsword, ["death"], grease)).toBeCloseTo(damage(longsword, []), 1);
    // Shared Order: ×1.1 to everything, and ×1.5 more against those who live in death
    const sharedOrder = effects("Shared Order");
    expect(damage(longsword, ["death"], sharedOrder)).toBeCloseTo(
      damage(longsword, [], sharedOrder) * 1.5,
      1,
    );
  });
});

describe("powerstance off hand weapons", () => {
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const allBuffs = JSON.parse(
    readFileSync(new URL("../../public/buffs.json", import.meta.url), "utf8"),
  ).buffs as Buff[];
  const grease = (name: string, hand: "main" | "off") =>
    getBuffEffects(
      allBuffs.filter((buff) => buff.name === name),
      3,
    ).map((effect) => ({ ...effect, hand }));
  const hits = (
    main: string,
    offhand?: { name: string; regularUpgradeLevel?: number },
    buffs: BuffEffect[] = [],
  ) => {
    const weapon = getWeapon(main);
    return optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Powerstance L1", false, 0.5),
      buffs,
      ...(offhand && {
        offhand: {
          weapon: getWeapon(offhand.name),
          regularUpgradeLevel: offhand.regularUpgradeLevel ?? 25,
          poiseBase: movesets[getWeapon(offhand.name).weaponName].poise,
        },
      }),
    }).attackSteps![0].map((hit) => [+hit.damage.toFixed(1), hit.stance]);
  };

  it("marks the left hand's hits", () => {
    // From the animations (AttackBehavior Source): the Longsword's first powerstance L1's second hit
    const attack = getAttackData(movesets, getWeapon("Longsword"), "Powerstance L1", false, 0.5)!;
    expect(attack.steps[0].map((hit) => !!hit.leftHand)).toEqual([false, true]);
  });

  it("uses the off hand weapon for the left hand's hits", () => {
    // The same weapon in the off hand is the same as without one
    expect(hits("Longsword", { name: "Longsword" })).toEqual(hits("Longsword"));
    // Another one changes only the left hand's hit, which is what it does with both hands
    const mixed = hits("Longsword", { name: "Lordsworn's Straight Sword" });
    expect(mixed[0]).toEqual(hits("Longsword")[0]);
    expect(mixed[1]).toEqual(hits("Lordsworn's Straight Sword")[1]);
    // Its upgrade level is its own
    expect(hits("Longsword", { name: "Longsword", regularUpgradeLevel: 0 })[1][0]).toBeLessThan(
      hits("Longsword")[1][0],
    );
  });

  it("uses the left hand weapon's own attack rows", () => {
    // The right hand weapon's animations decide the hits, but each hand's weapon has its own rows:
    // a Wakizashi's L1 #1 with a katana is 115 (poise 80), not the katana's 90 (40). Tested in game:
    // an Uchigatana +25 with a Wakizashi +25 in the left hand, 99 in every stat, does 464 + 551 on
    // the training dummy, with 6.4 poise
    const weapon = getWeapon("Uchigatana");
    const wakizashi = getWeapon("Wakizashi");
    const attack = withOffhandRows(
      getAttackData(movesets, weapon, "Powerstance L1", false, 0.5)!,
      movesets,
      "Uchigatana",
      "Wakizashi",
    );
    expect(attack.steps[0].map((hit) => [hit.motionValue, hit.leftHand ?? false])).toEqual([
      [115, true],
      [100, false],
    ]);
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      offhand: {
        weapon: wakizashi,
        regularUpgradeLevel: 25,
        poiseBase: movesets["Wakizashi"]!.poise,
      },
      attack,
    }).attackSteps!;
    expect(steps[0].map((hit) => [Math.floor(hit.damage), hit.stance])).toEqual([
      [464, 2.4],
      [551, 4],
    ]);
    // A Main-gauche's in the left hand with a thrusting sword are the same as the Rapier's. Tested
    // in game: a Rapier +25 with a Main-gauche +25, 99 in every stat, on the training dummy
    const mainGauche = optimizeBuild({
      weapon: getWeapon("Rapier"),
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      offhand: {
        weapon: getWeapon("Main-gauche"),
        regularUpgradeLevel: 25,
        poiseBase: movesets["Main-gauche"]!.poise,
      },
      attack: withOffhandRows(
        getAttackData(movesets, getWeapon("Rapier"), "Powerstance L1", false, 0.5)!,
        movesets,
        "Rapier",
        "Main-gauche",
      ),
    }).attackSteps!;
    expect(
      mainGauche.map((step) => step.map((hit) => [Math.floor(hit.damage), hit.stance])),
    ).toEqual([
      [
        [377, 2.4],
        [320, 1.8],
      ],
      [
        [352, 2.4],
        [362, 2.4],
        [393, 2.4],
      ],
      [
        [315, 1.8],
        [398, 2.4],
      ],
      [
        [341, 3.6],
        [428, 2.4],
        [363, 3.6],
      ],
    ]);
    // Each hit shows its own stamina (its attack windows'): the Rapier's 5 a swing, and the
    // Main-gauche's own 3.3
    expect(mainGauche.map((step) => step.map((hit) => hit.stamina))).toEqual([
      [5, 3.3],
      [5, 5, 5],
      [3.3, 5],
      [3.3, 5, 3.3],
    ]);
    // Weapons of the same class share rows, so only the stamina changes: a Broadsword's swings cost
    // its own 12.36 (its staminaConsumptionRate)
    const longsword = getAttackData(
      movesets,
      getWeapon("Longsword"),
      "Powerstance L1",
      false,
      0.5,
    )!;
    const withBroadsword = withOffhandRows(longsword, movesets, "Longsword", "Broadsword");
    expect(withBroadsword.steps).toEqual(longsword.steps);
    expect(withBroadsword.hitStamina![0]).toEqual([12, 12.36]);
  });

  it("repeats R2s at their own cancel, even when an R1's is as early", () => {
    // The Broadsword's R2 2 can be cancelled into an R1 or an R2 at 0.933s (2 frames early, see
    // check_animations.py's EARLY_JUMP_TABLE_EVENT; the earliest next attack is the R1), and has no
    // "R1/R2" cancel: 0.933s after it starts, 0.433s after the press
    const r2 = getAttackData(movesets, getWeapon("Broadsword"), "R2", false, 0.5)!;
    expect(r2.cycleTimes).toHaveLength(2);
    expect(r2.cycleTimes![1]).toBeCloseTo(1.366);
    const charged = getAttackData(movesets, getWeapon("Broadsword"), "Charged R2", false, 0.5)!;
    expect(charged.cycleTimes).toHaveLength(2);
    // The Backhand Blade's one handed R2 2 has no R2 or right hand attack cancel, so it's repeated when the
    // animation ends (57 frames, 1.9s, read in DS Anim Studio), 0.333s after the press
    const backhand = getAttackData(movesets, getWeapon("Backhand Blade"), "R2", false, 0.5)!;
    expect(backhand.cycleTimes![1]).toBeCloseTo(2.233);
  });

  it("starts cancels early where the animations let them", () => {
    // Tested in game, 10 chains of R1s: a Rapier's two handed, whose repeat cancels each have an
    // early window, about 43s, and a Longsword's one handed, whose don't, 41.5s; each step starts a
    // frame after its cancel (recordings)
    const chain = (weapon: string, twoHanding: boolean) =>
      getAttackData(movesets, getWeapon(weapon), "R1", twoHanding, 0.5)!.cycleTimes!.reduce(
        (sum, time) => sum + time,
        0,
      );
    expect(chain("Rapier", true)).toBeCloseTo(4.1 + 6 / 30, 2);
    expect(chain("Longsword", false)).toBeCloseTo(3.8 + 5 / 30, 2);
  });

  it("times attacks in real time where their animations play faster", () => {
    // Tested in game on 60 fps recordings, frames from each chain's first hit to the next chain's:
    // the Giant-Crusher's two handed R1 chain 257 (its R1 1 plays at x1.23 and x1.3 in parts), and
    // a Dagger's powerstance L1 chain 192 and 194 (it continues on flag 16, with no L1 flag)
    const chainFrames = (weapon: string, attack: AttackChoice, twoHanding: boolean) =>
      getAttackData(movesets, getWeapon(weapon), attack, twoHanding, 0.5)!.cycleTimes!.reduce(
        (sum, time) => sum + time,
        0,
      ) * 60;
    expect(chainFrames("Giant-Crusher", "R1", true)).toBeCloseTo(258.7, 0);
    expect(chainFrames("Dagger", "Powerstance L1", false)).toBeCloseTo(194.1, 0);
    // And a Short Spear's powerstance L1 chain 168 twice (on flag 16, though it has an L1 flag later:
    // 406 on that), a Longsword's 210 twice (on its L1 flag), and a Longsword's two handed charged
    // R2s 241 and 239
    expect(chainFrames("Short Spear", "Powerstance L1", false)).toBeCloseTo(168, 0);
    expect(chainFrames("Longsword", "Powerstance L1", false)).toBeCloseTo(210, 0);
    expect(chainFrames("Longsword", "Charged R2", true)).toBeCloseTo(240, 0);
  });

  it("goes on at the right hand attack cancel when it's before the attack's own", () => {
    // Tested in game on 60 fps recordings, frames after the first press: the Miséricorde's two
    // handed R2 chain 25, 86, 138, 199 (#2's R2 cancel 142 frames in, right hand attack cancel 46), the Pike's 55,
    // 143, 238, 321 (#1's R2 cancel 156 frames in, right hand attack cancel 54), and the Death Knight's Twin Axes'
    // two handed R1 chain (no R1 cancels) 35, 56, 102, 125, 172, 175, 222, 258, 260, then 329
    const hitFrames = (weapon: string, attack: AttackChoice, loops = 1) => {
      const data = getAttackData(movesets, getWeapon(weapon), attack, true, 0.5)!;
      const frames: number[] = [];
      let start = 0;
      for (let loop = 0; loop < loops; loop++) {
        data.stepTimes!.forEach((step, i) => {
          frames.push(...step.hits.map((time) => Math.round((start + time) * 60)));
          start += data.cycleTimes![i];
        });
      }
      return frames;
    };
    expect(hitFrames("Miséricorde", "R2", 2)).toEqual([26, 88, 142, 204]);
    expect(hitFrames("Pike", "R2", 2)).toEqual([52, 136, 232, 316]);
    expect(hitFrames("Death Knight's Twin Axes", "R1", 2).slice(0, 10)).toEqual([
      36, 57, 104, 127, 175, 177, 223, 259, 260, 332,
    ]);
  });

  it("repeats mounted R2s with R2, like charged R2s on foot", () => {
    // The Uchigatana's mounted R2: its R2 cancel at 1s, its right hand attack cancel at 1.1s
    const r2 = getAttackData(movesets, getWeapon("Uchigatana"), "Mounted R2/L2", false, 0.5)!;
    expect(r2.cycleTimes![0]).toBeCloseTo(1 / 30 + 1);
    expect(r2.stepTimes![0].earliest).toEqual({
      attack: "R2/L2",
      time: expect.closeTo(1 / 30 + 1),
    });
  });

  it("leaves rolling, blocking, and moving out of mounted attacks' timing", () => {
    for (const attack of ["Mounted R1/L1", "Mounted R2/L2", "Mounted Charged R2/L2"] as const) {
      for (const weapon of ["Uchigatana", "Greatsword", "Short Spear"]) {
        const data = getAttackData(movesets, getWeapon(weapon), attack, false, 0.5)!;
        for (const step of data.stepTimes!) {
          expect(step.roll).toBeUndefined();
          expect(step.block).toBeUndefined();
          expect(step.move).toBeUndefined();
        }
      }
    }
  });

  it("times each step's hits and cancels, and cuts chains short", () => {
    const longsword = getWeapon("Longsword");
    const r1 = getAttackData(movesets, longsword, "R1", false, 0.5)!;
    // From the R1 1's press (the step start delay, then its animation): its hit at 0.433s, its R1
    // cancel at 0.567s, a roll at 0.8s, blocking at 0.9s, and moving at 0.967s
    const first = r1.stepTimes![0];
    expect(first.hits[0]).toBeCloseTo(1 / 30 + 0.433);
    expect(first.earliest).toEqual({ attack: "R1", time: expect.closeTo(1 / 30 + 0.567) });
    expect(first.roll).toBeCloseTo(1 / 30 + 0.8);
    expect(first.block).toBeCloseTo(1 / 30 + 0.9);
    expect(first.move).toBeCloseTo(1 / 30 + 0.967);
    // The last step's earliest attack is an L1 (1.333s), before an R2 (1.4s) or either right hand
    // attack (1.467s)
    expect(r1.stepTimes![4].earliest).toEqual({
      attack: "L1",
      time: expect.closeTo(1 / 30 + 1.333),
    });

    // Cut to two steps
    const two = getAttackData(movesets, longsword, "R1", false, 0.5, false, { steps: 2 })!;
    expect(two.steps).toHaveLength(2);
    expect(two.weights[0] + two.weights[1]).toBeCloseTo(1);
    expect(two.cycleTimes![1]).toBeCloseTo(1 / 30 + 0.767);
    // Or the steps that fit a time budget, from the press until a roll can start after them: the
    // second step's roll is at 1.37s, the third's at 2.03s
    expect(
      getAttackData(movesets, longsword, "R1", false, 0.5, false, { seconds: 1.6 })!.steps,
    ).toHaveLength(2);
    expect(
      getAttackData(movesets, longsword, "R1", false, 0.5, false, { seconds: 2.1 })!.steps,
    ).toHaveLength(3);
    // At least one step
    expect(
      getAttackData(movesets, longsword, "R1", false, 0.5, false, { seconds: 0.1 })!.steps,
    ).toHaveLength(1);

    // Stamina per second: the chain's 60 over its 3.967s
    const result = optimizeBuild({
      weapon: longsword,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      limits: { ...noLimits, maxLevels: 0 },
      attack: r1,
    });
    expect(result.attackStaminaPerSecond).toBeCloseTo(60 / (3.8 + 5 / 30));
  });

  it("times jumping attacks from the jump press to after landing", () => {
    // Tested in game on 60 fps recordings: a Rapier's one handed jumping R1 hits 36-37 frames after
    // the jump (however early it's pressed) and lands at 53; its light landing can be rolled out of 8 frames (30 fps)
    // later, and jumped out of (flag 32) 12
    const jump = getAttackData(movesets, getWeapon("Rapier"), "Jumping R1", false, 0.5)!;
    const [times] = jump.stepTimes!;
    expect(times.hits[0] * 60).toBeCloseTo(36, 0);
    expect(times.roll! * 60).toBeCloseTo(53 + 16, 0);
    expect(jump.cycleTimes![0] * 60).toBeCloseTo(53 + 24, 0);
  });

  it("gives status buildup per second like DPS", () => {
    // The whole chain's buildup (each step's, not weighted) over the time it takes
    const weapon = getWeapon("Bloody Longsword");
    const attack = getAttackData(movesets, weapon, "R1", false, 0.5)!;
    const result = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack,
    });
    const time = attack.cycleTimes!.reduce((sum, stepTime) => sum + stepTime, 0);
    const blood = result
      .attackSteps!.flat()
      .reduce((sum, hit) => sum + (hit.status[AttackPowerType.BLEED] ?? 0), 0);
    expect(blood).toBeGreaterThan(0);
    expect(result.attackStatusPerSecond![AttackPowerType.BLEED]).toBeCloseTo(blood / time);
  });

  it("shows each hand's stamina on its own hits", () => {
    // From the animations: each swing of the Longsword's first powerstance L1 costs 12 of its 24
    const weapon = getWeapon("Longsword");
    const steps = optimizeBuild({
      weapon,
      regularUpgradeLevel: 25,
      twoHanding: false,
      startLevel: 9,
      currentLevel: 9,
      attributes: { str: 99, dex: 99, int: 99, fai: 99, arc: 99 },
      bonusAttributes: noBonus,
      objective: "totalAttack",
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense: 123.2, negation: 0 }]),
      ),
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
      limits: { ...noLimits, maxLevels: 0 },
      attack: getAttackData(movesets, weapon, "Powerstance L1", false, 0.5),
    }).attackSteps!;
    expect(steps[0].map((hit) => hit.stamina)).toEqual([12, 12]);
  });

  it("puts each hand's weapon buff only on its own hits", () => {
    const plain = hits("Longsword", { name: "Longsword" });
    const offFire = hits("Longsword", { name: "Longsword" }, grease("Fire Grease", "off"));
    expect(offFire[0]).toEqual(plain[0]);
    expect(offFire[1][0]).toBeGreaterThan(plain[1][0]);
    const mainFire = hits("Longsword", { name: "Longsword" }, grease("Fire Grease", "main"));
    expect(mainFire[0][0]).toBeGreaterThan(plain[0][0]);
    expect(mainFire[1]).toEqual(plain[1]);
  });
});

describe("timing coverage", () => {
  const movesets: Movesets = JSON.parse(
    readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
  );
  const ashes: Ashes = JSON.parse(
    readFileSync(new URL("../../public/ashes.json", import.meta.url), "utf8"),
  );
  const ashAttack = (weapon: string, choice: string, twoHanding = false) => {
    const result = getAshAttack(ashes, movesets, getWeapon(weapon), choice, twoHanding);
    if (!("attack" in result)) throw new Error(result.unavailableReason);
    return result.attack;
  };

  it("times roars' buffed R2 chains from the weapon's moveset, by hands", () => {
    // War Cry's R2s are each moveset's 030620s (Barbaric Roar's the 030600s, with three hits on R2
    // #1), going on with R2 (from the animations, untested)
    const warCry = ashAttack("Greataxe", withFollowUp("War Cry", "R2 chain"));
    expect(warCry.stepTimes).toHaveLength(2);
    expect(warCry.stepTimes![0].earliest).toEqual({ attack: "R2", time: expect.any(Number) });
    expect(warCry.cycleTimes).toHaveLength(2);
    expect(warCry.stamina!.every((cost) => cost != null && cost > 0)).toBe(true);
    const barbaric = ashAttack("Greataxe", withFollowUp("Barbaric Roar", "R2 chain"));
    expect(barbaric.stepTimes![0].hits).toHaveLength(3);
    const twoHanded = ashAttack("Greataxe", withFollowUp("War Cry", "R2 chain"), true);
    expect(twoHanded.stamina![0]).toBeGreaterThan(warCry.stamina![0]!);
  });

  it("times weapon attacks without a right hand attack cancel at their R1 or R2 cancel", () => {
    // The Greatsword's rolling R1 can only go on to an R1 or R2 (its R1 at 1.0s)
    const rolling = getAttackData(movesets, getWeapon("Greatsword"), "Rolling R1", false, 0.5)!;
    expect(rolling.cycleTimes![0]).toBeCloseTo(1.0 + 1 / 30);
  });

  it("leaves out catalysts' jumping R1s (a jumping cast)", () => {
    expect(
      getAttackData(movesets, getWeapon("Glintstone Staff"), "Jumping R1", false, 0.5),
    ).toBeUndefined();
  });

  it("costs a jumping attack's landing stamina when its hit costs none", () => {
    const jumping = getAttackData(movesets, getWeapon("Backhand Blade"), "Jumping R2", false, 0.5)!;
    expect(jumping.stamina![0]).toBeGreaterThan(0);
  });
});
