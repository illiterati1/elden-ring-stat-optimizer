import { describe, expect, test } from "vitest";
import type { SaveCharacter } from "./saveFile.ts";
import type { Weapon } from "../calculator/weapon.ts";
import {
  getGearUpdate,
  getImportedGear,
  getSaveGrip,
  type ImportedGear,
  type SaveImportData,
} from "./saveImport.ts";
import type { Ashes } from "./useAshes.ts";

test("the grip is two handed if either hand's weapon is held with both hands", () => {
  const character = (grip: SaveCharacter["grip"]) => ({ grip } as SaveCharacter);
  expect(getSaveGrip(character("1h"))).toBe("1h");
  expect(getSaveGrip(character("2hLeft"))).toBe("2h");
  expect(getSaveGrip(character("2hRight"))).toBe("2h");
});

describe("getGearUpdate", () => {
  const gear: ImportedGear = {
    startingClass: "Hero",
    stats: { vig: 60, min: 31, end: 30, str: 54, dex: 16, int: 7, fai: 33, arc: 9 },
    weapons: [
      { weaponName: "Longsword", affinityId: 1, upgradeLevel: 25 },
      { weaponName: "Dagger", affinityId: 1, upgradeLevel: 24 },
      { weaponName: "Longsword", affinityId: 0, upgradeLevel: 25 },
    ],
    ashesOfWar: ["Square Off"],
    offhand: null,
    buffs: ["talisman:Shard of Alexander"],
    catalyst: null,
    ammo: ["arrow:Arrow"],
    scadutreeBlessingLevel: 12,
    ngPlus: 1,
  };

  test("sets everything without earlier gear, keeping buffs the save doesn't decide", () => {
    expect(getGearUpdate(gear, null, ["talisman:Old", "armor:Old", "consumable:Grease"])).toEqual({
      startingClass: "Hero",
      stats: gear.stats,
      selectedWeapons: ["Longsword", "Dagger"],
      affinityIds: [1, 0],
      upgradeLevels: [25, 24],
      ashesOfWar: ["Square Off"],
      offhandWeapon: null,
      offhandAffinityId: null,
      offhandBuff: null,
      buffs: ["consumable:Grease", "talisman:Shard of Alexander"],
      catalyst: "",
      selectedAmmo: ["arrow:Arrow"],
      scadutreeBlessingLevel: 12,
      ngPlus: 1,
    });
  });

  test("only changes what changed since the earlier gear", () => {
    expect(getGearUpdate(gear, gear, [])).toEqual({});
    const levelled = { ...gear, stats: { ...gear.stats, vig: 61 } };
    expect(getGearUpdate(levelled, gear, [])).toEqual({
      startingClass: "Hero",
      stats: levelled.stats,
    });
    const upgraded = {
      ...gear,
      weapons: [{ weaponName: "Longsword", affinityId: 1, upgradeLevel: 24 }],
    };
    expect(getGearUpdate(upgraded, gear, [])).toMatchObject({
      selectedWeapons: ["Longsword"],
      upgradeLevels: [24],
    });
    expect(getGearUpdate(upgraded, gear, [])).not.toHaveProperty("buffs");
    expect(getGearUpdate({ ...gear, ngPlus: 2 }, gear, [])).toEqual({ ngPlus: 2 });
  });

  test("keeps the ammunition and NG+ when the save has none", () => {
    const update = getGearUpdate({ ...gear, ammo: [], ngPlus: null }, null, []);
    expect(update).not.toHaveProperty("selectedAmmo");
    expect(update).not.toHaveProperty("ngPlus");
  });
});

describe("the off hand weapon", () => {
  const weapon = (weaponName: string, weaponType: number) =>
    ({ weaponName, affinityId: 0, weaponType, attack: [[0, 100]] } as unknown as Weapon);
  const data: SaveImportData = {
    items: {
      weapons: { 1000000: "Dagger", 1010000: "Parrying Dagger", 2000000: "Longsword" },
      armor: {},
      talismans: {},
      ashes: {},
    },
    weapons: [weapon("Dagger", 1), weapon("Parrying Dagger", 1), weapon("Longsword", 3)],
    buffs: [],
    ashes: { ashes: [], weapons: {}, skills: {} } as unknown as Ashes,
    ashChoices: [],
    offhandChoices: new Set(["Dagger", "Parrying Dagger", "Longsword"]),
    catalystNames: new Set(),
    ammo: [],
  };
  const character = (left: number, grip: SaveCharacter["grip"] = "1h") =>
    ({
      classIndex: 0,
      stats: {},
      grip,
      activeLeft: 1,
      activeRight: 0,
      weapons: {
        L1: { id: 110000, ashId: null },
        R1: { id: 1000025, ashId: null },
        L2: { id: left, ashId: null },
        R2: { id: 110000, ashId: null },
        L3: { id: 110000, ashId: null },
        R3: { id: 110000, ashId: null },
      },
      armor: [],
      talismans: [],
      ammo: [],
    } as unknown as SaveCharacter);

  test("is the left hand's weapon in use if it's the same type as the right hand's", () => {
    expect(getImportedGear(character(1010010), data).offhand).toEqual({
      weaponName: "Parrying Dagger",
      affinityId: 0,
      upgradeLevel: 10,
    });
  });

  test("is none for a different type, or with the left hand's weapon held with both hands", () => {
    expect(getImportedGear(character(2000025), data).offhand).toBeNull();
    expect(getImportedGear(character(1010010, "2hLeft"), data).offhand).toBeNull();
  });
});

test("equipped arrows and bolts are the ammunition, and NG+ stops at NG+7", () => {
  const data = {
    items: { weapons: { 50000000: "Arrow", 50010000: "Fire Arrow", 52000000: "Bolt" } },
    weapons: [],
    buffs: [],
    ashes: { ashes: [], weapons: {}, skills: {} },
    ashChoices: [],
    offhandChoices: new Set(),
    catalystNames: new Set(),
    ammo: [
      { class: "arrow", names: ["Arrow"], attack: {}, status: {} },
      { class: "arrow", names: ["Fire Arrow", "Flaming Arrow"], attack: {}, status: {} },
      { class: "bolt", names: ["Bolt"], attack: {}, status: {} },
    ],
  } as unknown as SaveImportData;
  const character = {
    classIndex: 0,
    stats: {},
    activeLeft: 0,
    activeRight: 0,
    weapons: Object.fromEntries(
      ["L1", "R1", "L2", "R2", "L3", "R3"].map((slot) => [slot, { id: 110000, ashId: null }]),
    ),
    armor: [],
    talismans: [],
    ammo: [50010000, 52000000, 50010000],
    scadutreeBlessing: 20,
    clearCount: 9,
  } as unknown as SaveCharacter;
  expect(getImportedGear(character, data)).toMatchObject({
    ammo: ["arrow:Fire Arrow/Flaming Arrow", "bolt:Bolt"],
    scadutreeBlessingLevel: 20,
    ngPlus: 7,
  });
});
