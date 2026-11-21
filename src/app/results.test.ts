import { describe, expect, it } from "vitest";
import { packAllocations } from "../optimizer/allocations.ts";
import type { BuildResult } from "../optimizer/build.ts";
import {
  getAllocationAtLevel,
  getDamagePerStamina,
  getResultStatus,
  getStancePerStamina,
  getValueAtLevel,
  sortResults,
} from "./results.ts";

const stats = (str: number) => ({ str, dex: 10, int: 9, fai: 9, arc: 7 });

describe("getValueAtLevel", () => {
  const curve = { startLevel: 10, values: [100, 110, 120] };

  it("is the curve's value at the level, and its last past the end", () => {
    expect(getValueAtLevel(curve, 10)).toBe(100);
    expect(getValueAtLevel(curve, 12)).toBe(120);
    expect(getValueAtLevel(curve, 50)).toBe(120);
  });

  it("is null before the requirements can be met, or with no values", () => {
    expect(getValueAtLevel(curve, 9)).toBeNull();
    expect(getValueAtLevel({ startLevel: 10, values: [] }, 10)).toBeNull();
  });
});

describe("getAllocationAtLevel", () => {
  const curve = {
    startLevel: 10,
    values: [100, 110],
    allocations: packAllocations([stats(10), stats(11)]),
  };

  it("is the allocation at the level, and its last past the end", () => {
    expect(getAllocationAtLevel(curve, 10)).toEqual(stats(10));
    expect(getAllocationAtLevel(curve, 11)).toEqual(stats(11));
    expect(getAllocationAtLevel(curve, 99)).toEqual(stats(11));
  });

  it("is null before the start or without allocations", () => {
    expect(getAllocationAtLevel(curve, 9)).toBeNull();
    expect(getAllocationAtLevel({ startLevel: 10, values: [100] }, 10)).toBeNull();
    expect(getAllocationAtLevel({ ...curve, allocations: packAllocations([]) }, 10)).toBeNull();
  });
});

function result(name: string, extra: Partial<BuildResult> = {}): BuildResult {
  return {
    weaponName: name,
    applicable: true,
    finalValue: 100,
    finalLevel: 50,
    scaling: {},
    requirements: {},
    statusBuildup: {},
    ...extra,
  } as BuildResult;
}

const names = (results: BuildResult[]) => results.map((r) => r.row?.name ?? r.weaponName);

describe("per stamina and status", () => {
  it("divides damage or DPS by stamina, if the stamina is known", () => {
    const r = result("a", { finalValue: 300, attackDps: 150, attackStamina: 30 });
    expect(getDamagePerStamina(r)).toBe(10);
    expect(getDamagePerStamina(r, true)).toBe(5);
    expect(getDamagePerStamina(result("b"))).toBeUndefined();
    expect(getDamagePerStamina(result("c", { attackStamina: 0 }))).toBeUndefined();
  });

  it("divides stance or stance per second by stamina, if both are known", () => {
    const r = result("a", { attackStance: 60, attackStancePerSecond: 30, attackStamina: 20 });
    expect(getStancePerStamina(r)).toBe(3);
    expect(getStancePerStamina(r, true)).toBe(1.5);
    expect(getStancePerStamina(result("b", { attackStamina: 20 }))).toBeUndefined();
  });

  it("uses the attack's status, else the weapon's, or per second", () => {
    const weapon = { 6: 50 };
    expect(getResultStatus(result("a", { statusBuildup: weapon }))).toBe(weapon);
    expect(
      getResultStatus(result("a", { statusBuildup: weapon, attackStatus: { 6: 70 } })),
    ).toEqual({ 6: 70 });
    expect(getResultStatus(result("a", { statusBuildup: weapon }), true)).toEqual({});
    expect(getResultStatus(result("a", { attackStatusPerSecond: { 6: 20 } }), true)).toEqual({
      6: 20,
    });
  });
});

describe("sortResults", () => {
  it("puts the highest total first, not applicable results last, and reverses", () => {
    const results = [
      result("low", { finalValue: 50 }),
      result("none", { applicable: false, finalValue: 999 }),
      result("high", { finalValue: 200 }),
    ];
    expect(names(sortResults(results, "total", false))).toEqual(["high", "low", "none"]);
    // (not applicable results stay last)
    expect(names(sortResults(results, "total", true))).toEqual(["low", "high", "none"]);
  });

  it("doesn't change the list it's given", () => {
    const results = [result("a", { finalValue: 1 }), result("b", { finalValue: 2 })];
    sortResults(results, "total", false);
    expect(names(results)).toEqual(["a", "b"]);
  });

  it("sorts by DPS per second, with unknown DPS last", () => {
    const results = [
      result("slow", { finalValue: 300, attackDps: 100 }),
      result("unknown", { finalValue: 999 }),
      result("fast", { finalValue: 200, attackDps: 150 }),
    ];
    expect(names(sortResults(results, "total", false, true))).toEqual(["fast", "slow", "unknown"]);
  });

  it("sorts names A to Z, by number within them, by row name, then by total", () => {
    const results = [
      result("Uchigatana", { row: { id: "1", name: "Uchigatana +10" } }),
      result("Dagger", { finalValue: 50 }),
      result("Uchigatana", { row: { id: "2", name: "Uchigatana +9" } }),
      result("Dagger", { finalValue: 80, row: { id: "3", name: "Dagger" } }),
    ];
    expect(names(sortResults(results, "name", false)).slice(0, 2)).toEqual(["Dagger", "Dagger"]);
    expect(sortResults(results, "name", false)[0].finalValue).toBe(80);
    expect(names(sortResults(results, "name", false)).slice(2)).toEqual([
      "Uchigatana +9",
      "Uchigatana +10",
    ]);
    expect(names(sortResults(results, "name", true))[0]).toBe("Uchigatana +10");
  });

  it("puts the lowest level, stamina, and requirement first, unknown stamina last", () => {
    const results = [
      result("a", { finalLevel: 80, attackStamina: 20, requirements: { str: 30 } }),
      result("b", { finalLevel: 60, requirements: {} }),
      result("c", { finalLevel: 70, attackStamina: 10, requirements: { str: 10 } }),
    ];
    expect(names(sortResults(results, "level", false))).toEqual(["b", "c", "a"]);
    expect(names(sortResults(results, "stamina", false))).toEqual(["c", "a", "b"]);
    expect(names(sortResults(results, "requirement:str", false))).toEqual(["b", "c", "a"]);
  });

  it("puts the highest scaling, status, stance, and potential first", () => {
    const results = [
      result("a", { scaling: { dex: 0.5 }, statusBuildup: { 6: 40 }, attackStance: 20 }),
      result("b", { scaling: { dex: 0.9 }, potential: 0.5 }),
      result("c", { statusBuildup: { 6: 80 }, attackStance: 30, potential: 0.8 }),
    ];
    expect(names(sortResults(results, "scaling:dex", false))).toEqual(["b", "a", "c"]);
    expect(names(sortResults(results, "status:6", false))).toEqual(["c", "a", "b"]);
    expect(names(sortResults(results, "stance", false))).toEqual(["c", "a", "b"]);
    expect(names(sortResults(results, "potential", false))).toEqual(["c", "b", "a"]);
  });

  it("breaks ties by total", () => {
    const results = [
      result("a", { finalValue: 100, attackStance: 20 }),
      result("b", { finalValue: 300, attackStance: 20 }),
    ];
    expect(names(sortResults(results, "stance", false))).toEqual(["b", "a"]);
    expect(names(sortResults(results, "stance", true))).toEqual(["b", "a"]);
  });
});
