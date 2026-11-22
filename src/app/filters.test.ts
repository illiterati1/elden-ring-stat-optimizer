import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AttackPowerType } from "../calculator/attackPowerTypes.ts";
import type { AttackDataHit, BuildRequest } from "../optimizer/build.ts";
import { decodeRegulationData } from "../regulationData.ts";
import {
  defaultWeaponFilters,
  getRequestTypes,
  passesFilters as passesFiltersWith,
  type WeaponFilters,
} from "./filters.ts";
import type { Movesets } from "./useMovesets.ts";

const weapons = decodeRegulationData(
  JSON.parse(
    readFileSync(new URL("../../public/regulation-vanilla-v1.17.js", import.meta.url), "utf8"),
  ),
);

const movesets: Movesets = JSON.parse(
  readFileSync(new URL("../../public/movesets.json", import.meta.url), "utf8"),
);

const passesFilters = (request: BuildRequest, filters: WeaponFilters) =>
  passesFiltersWith(request, filters, movesets);

function request(name: string, extra: Partial<BuildRequest> = {}): BuildRequest {
  const weapon = weapons.find((weapon) => weapon.name === name);
  if (!weapon) throw new Error(`No weapon named ${name}`);
  return { weapon, regularUpgradeLevel: 25, ...extra } as BuildRequest;
}

const hit = (extra: Partial<AttackDataHit> = {}): AttackDataHit => ({
  motionValue: 100,
  statusMotionValue: 100,
  stanceMotionValue: 100,
  physicalType: "standard",
  ...extra,
});

describe("weapon filters", () => {
  it("finds the weapon's own damage types and statuses", () => {
    const types = getRequestTypes(request("Fire Uchigatana"));
    expect(types.has(AttackPowerType.PHYSICAL)).toBe(true);
    expect(types.has(AttackPowerType.FIRE)).toBe(true);
    expect(types.has(AttackPowerType.BLEED)).toBe(true);
    expect(types.has(AttackPowerType.MAGIC)).toBe(false);
  });

  it("counts a weapon buff's damage and status", () => {
    const flat = [0, 0, 0, 0, 0];
    flat[AttackPowerType.LIGHTNING] = 110;
    const types = getRequestTypes(
      request("Uchigatana", {
        buffs: [{ flat }, { status: { [AttackPowerType.POISON]: 100 } }],
      }),
    );
    expect(types.has(AttackPowerType.LIGHTNING)).toBe(true);
    expect(types.has(AttackPowerType.POISON)).toBe(true);
  });

  it("counts an attack's own flat attack, but not damage types its hits don't use", () => {
    const flatAttack = [0, 0, 0, 0, 0];
    flatAttack[AttackPowerType.HOLY] = 50;
    const types = getRequestTypes(
      request("Fire Uchigatana", {
        attack: {
          steps: [[hit({ motionValues: [100, 100, 0, 100, 100], flatAttack })]],
          weights: [1],
          stanceBase: 10,
        },
      }),
    );
    expect(types.has(AttackPowerType.HOLY)).toBe(true);
    expect(types.has(AttackPowerType.FIRE)).toBe(false);
  });

  it("filters by any of the checked types and by weight", () => {
    const fire = { ...defaultWeaponFilters, damageTypes: [AttackPowerType.FIRE] };
    expect(passesFilters(request("Fire Uchigatana"), fire)).toBe(true);
    expect(passesFilters(request("Uchigatana"), fire)).toBe(false);
    expect(
      passesFilters(request("Uchigatana"), {
        ...fire,
        damageTypes: [AttackPowerType.FIRE, AttackPowerType.PHYSICAL],
      }),
    ).toBe(true);

    const uchigatana = request("Uchigatana");
    const light = { ...defaultWeaponFilters, maxWeight: { enabled: true, value: 5 } };
    expect(uchigatana.weapon.weight).toBe(5.5);
    expect(passesFilters(uchigatana, light)).toBe(false);
    expect(passesFilters(uchigatana, { ...light, maxWeight: { enabled: true, value: 5.5 } })).toBe(
      true,
    );
  });

  it("leaves out DLC weapons for base game only", () => {
    const baseGame = { ...defaultWeaponFilters, baseGameOnly: true };
    expect(passesFilters(request("Uchigatana"), baseGame)).toBe(true);
    expect(passesFilters(request("Star-Lined Sword"), baseGame)).toBe(false);
  });

  it("filters by max requirements, including the off hand weapon's", () => {
    const max = (value: Partial<WeaponFilters["maxRequirements"]["value"]>) => ({
      ...defaultWeaponFilters,
      maxRequirements: {
        enabled: true,
        value: { ...defaultWeaponFilters.maxRequirements.value, ...value },
      },
    });
    const uchigatana = request("Uchigatana");
    expect(uchigatana.weapon.requirements).toMatchObject({ str: 11, dex: 15 });
    expect(passesFilters(uchigatana, max({ str: 11, dex: 15 }))).toBe(true);
    expect(passesFilters(uchigatana, max({ dex: 14 }))).toBe(false);
    expect(
      passesFilters(uchigatana, {
        ...max({ dex: 14 }),
        maxRequirements: {
          ...max({ dex: 14 }).maxRequirements,
          enabled: false,
        },
      }),
    ).toBe(true);

    const greatsword = request("Greatsword");
    const powerstanced = request("Uchigatana", {
      offhand: { weapon: greatsword.weapon, regularUpgradeLevel: 25, stanceBase: 0 },
    });
    expect(passesFilters(powerstanced, max({ str: 11, dex: 15 }))).toBe(false);
  });

  it("filters by the stats a weapon scales with, all of them", () => {
    const filters = (scalesWith: WeaponFilters["scalesWith"]) => ({
      ...defaultWeaponFilters,
      scalesWith,
    });
    expect(passesFilters(request("Uchigatana"), filters(["str", "dex"]))).toBe(true);
    expect(passesFilters(request("Uchigatana"), filters(["int"]))).toBe(false);
    expect(passesFilters(request("Magic Uchigatana"), filters(["dex", "int"]))).toBe(true);
    expect(passesFilters(request("Heavy Uchigatana"), filters(["dex"]))).toBe(false);
  });

  it("filters by the weapon's own physical damage type, including standard", () => {
    const filters = (physicalTypes: WeaponFilters["physicalTypes"]) => ({
      ...defaultWeaponFilters,
      physicalTypes,
    });
    expect(passesFilters(request("Uchigatana"), filters(["slash"]))).toBe(true);
    expect(passesFilters(request("Uchigatana"), filters(["strike", "pierce"]))).toBe(false);
    expect(passesFilters(request("Club"), filters(["strike"]))).toBe(true);
    expect(passesFilters(request("Rapier"), filters(["pierce"]))).toBe(true);
    expect(passesFilters(request("Longsword"), filters(["standard"]))).toBe(true);
    expect(passesFilters(request("Longsword"), filters(["slash"]))).toBe(false);
  });
});
