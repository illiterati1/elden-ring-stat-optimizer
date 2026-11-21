import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WeaponType } from "../calculator/weaponTypes.ts";
import type { BuildRequest } from "../optimizer/build.ts";
import { decodeRegulationData } from "../regulationData.ts";
import {
  getFreezeBlocked,
  getFrozenKeys,
  getRestoredSettings,
  restoreChangesSettings,
  mergeChartKeys,
  toggleFreeze,
  unpin,
  unpinAll,
} from "./pinActions.ts";
import {
  describePinSettings,
  getFrozenKey,
  getKeyOfPin,
  getPinChartKey,
  getPinKey,
  getPinSettings,
  isPin,
  parseRowKey,
  restoreRequest,
  storeRequest,
  type Pin,
  type PinSettings,
} from "./pins.ts";
import { ashAttack } from "./useAshes.ts";
import { defaultAppState, type AppState } from "./useAppState.ts";

const weapons = decodeRegulationData(
  JSON.parse(
    readFileSync(new URL("../../public/regulation-vanilla-v1.17.js", import.meta.url), "utf8"),
  ),
);
const findWeapon = (name: string) => weapons.find((weapon) => weapon.name === name);

function request(name: string, extra: Partial<BuildRequest> = {}): BuildRequest {
  const weapon = findWeapon(name);
  if (!weapon) throw new Error(`No weapon named ${name}`);
  return { weapon, regularUpgradeLevel: 25, twoHanding: false, ...extra } as BuildRequest;
}

function pin(id: string, extra: Partial<Pin> = {}): Pin {
  return {
    id,
    weaponName: "Uchigatana",
    attack: "R1",
    ashOfWar: "",
    upgradeLevel: 25,
    twoHanding: false,
    label: "R1",
    ...extra,
  };
}

const settings = getPinSettings(defaultAppState);
const frozen = (id: string, extra: Partial<Pin> = {}, req = request("Uchigatana")) =>
  pin(id, { ...extra, frozen: { request: storeRequest(req), settings } });

const rowKey = (p: Pin) => getKeyOfPin(p);

describe("row keys", () => {
  it("reads a row's choices back from its key", () => {
    const choice = {
      attack: ashAttack,
      ashOfWar: "Bloody Slash",
      upgradeLevel: 10,
      twoHanding: true,
    } as const;
    expect(parseRowKey(getPinKey("Uchigatana", undefined, choice))).toEqual(choice);
  });

  it("ignores the Ash of War for attacks that aren't the skill", () => {
    expect(
      getPinKey("Uchigatana", undefined, {
        attack: "R1",
        ashOfWar: "Bloody Slash",
        upgradeLevel: 25,
        twoHanding: false,
      }),
    ).toBe(
      getPinKey("Uchigatana", undefined, {
        attack: "R1",
        ashOfWar: "",
        upgradeLevel: 25,
        twoHanding: false,
      }),
    );
  });

  it("tells fixed skill versions, upgrade levels, and grips apart", () => {
    const choice = { attack: "R1", ashOfWar: "", upgradeLevel: 25, twoHanding: false } as const;
    const key = getPinKey("Uchigatana", undefined, choice);
    expect(getPinKey("Uchigatana", "Lv2", choice)).not.toBe(key);
    expect(getPinKey("Uchigatana", undefined, { ...choice, upgradeLevel: 24 })).not.toBe(key);
    expect(getPinKey("Uchigatana", undefined, { ...choice, twoHanding: true })).not.toBe(key);
  });
});

describe("stored requests", () => {
  const catalyst = weapons.find((weapon) => weapon.weaponType === WeaponType.GLINTSTONE_STAFF)!;
  const full = request("Uchigatana", {
    offhand: { weapon: findWeapon("Fire Uchigatana")! } as BuildRequest["offhand"],
    catalyst,
  });

  it("keeps weapons by name and gets them back", () => {
    const stored = storeRequest(full);
    expect(stored.weapon).toBe("Uchigatana");
    expect(stored.offhand?.weapon).toBe("Fire Uchigatana");
    expect(stored.catalyst).toBe(catalyst.name);
    expect(restoreRequest(stored, findWeapon)).toEqual(full);
  });

  it("can't be restored when one of its weapons is gone", () => {
    const stored = storeRequest(full);
    for (const gone of ["Uchigatana", "Fire Uchigatana", catalyst.name]) {
      expect(
        restoreRequest(stored, (name) => (name === gone ? undefined : findWeapon(name))),
      ).toBeUndefined();
    }
  });

  it("has the same frozen key whatever order its settings are in", () => {
    const req = request("Uchigatana", { twoHanding: true, startLevel: 50 });
    const a = storeRequest(req);
    const b = storeRequest(Object.fromEntries(Object.entries(req).reverse()) as BuildRequest);
    expect(Object.keys(a)).not.toEqual(Object.keys(b));
    expect(getFrozenKey(a)).toBe(getFrozenKey(b));
  });

  it("only counts equip weight with a buff that depends on it", () => {
    const light = request("Uchigatana", { equipWeight: 10 } as Partial<BuildRequest>);
    const heavy = request("Uchigatana", { equipWeight: 60 } as Partial<BuildRequest>);
    expect(getFrozenKey(storeRequest(light))).toBe(getFrozenKey(storeRequest(heavy)));
    const buffs = [{ byEquipWeight: true }] as unknown as BuildRequest["buffs"];
    expect(getFrozenKey(storeRequest({ ...light, buffs }))).not.toBe(
      getFrozenKey(storeRequest({ ...heavy, buffs })),
    );
  });
});

describe("isPin", () => {
  it("accepts live and frozen pins", () => {
    expect(isPin(pin("a"))).toBe(true);
    expect(isPin(frozen("a"))).toBe(true);
  });

  it("rejects what isn't a pin", () => {
    expect(isPin(null)).toBe(false);
    expect(isPin("pin")).toBe(false);
    const { upgradeLevel: _, ...noLevel } = pin("a");
    expect(isPin(noLevel)).toBe(false);
    expect(isPin({ ...pin("a"), frozen: { request: storeRequest(request("Uchigatana")) } })).toBe(
      false,
    );
  });
});

describe("chart keys", () => {
  it("charts a row pinned live by its pin's key", () => {
    const live = pin("a");
    expect(mergeChartKeys([rowKey(live), "Dagger"], [live])).toEqual([
      getPinChartKey(live),
      "Dagger",
    ]);
  });

  it("charts a row and its live pin once", () => {
    const live = pin("a");
    expect(mergeChartKeys([getPinChartKey(live), rowKey(live)], [live])).toEqual([
      getPinChartKey(live),
    ]);
  });

  it("keeps a row charted apart from its frozen pin", () => {
    const pinned = frozen("a");
    expect(mergeChartKeys([rowKey(pinned), getPinChartKey(pinned)], [pinned])).toEqual([
      rowKey(pinned),
      getPinChartKey(pinned),
    ]);
  });

  it("drops the keys of pins that are gone", () => {
    expect(mergeChartKeys(["pin:gone", "Dagger"], [pin("a")])).toEqual(["Dagger"]);
  });
});

describe("freezing", () => {
  it("freezes a live pin with its request and the settings", () => {
    const live = pin("a");
    const req = request("Uchigatana");
    const [after] = toggleFreeze([live], "a", req, settings);
    expect(after).toEqual({ ...live, frozen: { request: storeRequest(req), settings } });
    expect(getPinChartKey(after)).toBe(getPinChartKey(live));
  });

  it("leaves only the frozen pin charted when a charted live pin is frozen", () => {
    const live = pin("a");
    const pins = toggleFreeze([live], "a", request("Uchigatana"), settings);
    expect(mergeChartKeys([getPinChartKey(live)], pins)).toEqual([getPinChartKey(live)]);
  });

  it("only changes the pin frozen", () => {
    const other = pin("b", { attack: "R2", label: "R2" });
    const pins = toggleFreeze([pin("a"), other], "a", request("Uchigatana"), settings);
    expect(pins[1]).toBe(other);
  });

  it("doesn't freeze a pin whose weapon or attack isn't found", () => {
    const live = pin("a");
    expect(getFreezeBlocked(undefined, new Set())).toMatch(/wasn't found/);
    expect(toggleFreeze([live], "a", undefined, settings)).toEqual([live]);
  });

  it("doesn't freeze the same row again with the same settings", () => {
    const pins = [frozen("a"), pin("b")];
    const same = request("Uchigatana");
    expect(getFreezeBlocked(same, getFrozenKeys(pins))).toMatch(/Already frozen/);
    expect(toggleFreeze(pins, "b", same, settings)).toEqual(pins);
  });

  it("freezes the same row again with different settings", () => {
    const pins = [frozen("a"), pin("b")];
    const different = request("Uchigatana", { twoHanding: true });
    expect(getFreezeBlocked(different, getFrozenKeys(pins))).toBeUndefined();
    expect(toggleFreeze(pins, "b", different, settings)[1].frozen?.request.twoHanding).toBe(true);
  });

  it("unfreezes a frozen pin back to live", () => {
    const pins = toggleFreeze([frozen("a")], "a", undefined, settings);
    expect(pins).toEqual([pin("a")]);
  });

  it("drops an unfrozen pin, and its chart key, when its row is already pinned live", () => {
    const pinned = frozen("a");
    const live = pin("b");
    const pins = toggleFreeze([pinned, live], "a", undefined, settings);
    expect(pins).toEqual([live]);
    expect(mergeChartKeys([getPinChartKey(pinned), getPinChartKey(live)], pins)).toEqual([
      getPinChartKey(live),
    ]);
  });
});

describe("unpinning", () => {
  const live = pin("a");
  const pinned = frozen("b", { attack: "R2", label: "R2" });
  const rowKeys = new Map([[getPinChartKey(live), rowKey(live)]]);

  it("keeps a charted live pin's row charted by its own key", () => {
    expect(unpin({ pins: [live], chartWeapons: ["Dagger", "pin:a"] }, "a", rowKeys)).toEqual({
      pins: [],
      chartWeapons: ["Dagger", rowKey(live)],
    });
  });

  it("uncharts a pin whose row isn't in the table", () => {
    expect(unpin({ pins: [live], chartWeapons: ["pin:a"] }, "a", new Map())).toEqual({
      pins: [],
      chartWeapons: [],
    });
  });

  it("uncharts a frozen pin", () => {
    expect(unpin({ pins: [live, pinned], chartWeapons: ["pin:b"] }, "b", rowKeys)).toEqual({
      pins: [live],
      chartWeapons: [],
    });
  });

  it("leaves the chart alone when the pin isn't charted", () => {
    expect(unpin({ pins: [live], chartWeapons: ["Dagger"] }, "a", rowKeys)).toEqual({ pins: [] });
  });

  it("unpins every pin, keeping live pins' rows charted", () => {
    expect(unpinAll({ chartWeapons: ["pin:a", "Dagger", "pin:b"] }, rowKeys)).toEqual({
      pins: [],
      chartWeapons: [rowKey(live), "Dagger"],
    });
  });
});

describe("restoring a frozen pin's settings", () => {
  const changed: PinSettings = { ...settings, meetRequirements: !settings.meetRequirements };
  const current: Pick<AppState, "upgradeLevels" | "grips"> = { upgradeLevels: [25], grips: ["1h"] };

  it("is only offered when it would change the settings", () => {
    const frozenPin = pin("a", {
      frozen: { request: storeRequest(request("Uchigatana")), settings: changed },
    });
    expect(restoreChangesSettings(frozenPin, { ...settings, ...current })).toBe(true);
    expect(restoreChangesSettings(frozenPin, { ...changed, ...current })).toBe(false);
    // (with its keys listed in another order, still the same)
    const reordered = Object.fromEntries(Object.entries(changed).reverse()) as PinSettings;
    expect(restoreChangesSettings(frozenPin, { ...reordered, ...current })).toBe(false);
    expect(restoreChangesSettings(frozenPin, { ...changed, ...current, upgradeLevels: [10] })).toBe(
      true,
    );
    expect(restoreChangesSettings(pin("a"), { ...settings, ...current })).toBe(false);
  });

  it("does nothing for a live pin", () => {
    expect(getRestoredSettings(pin("a"), { ...current })).toBeUndefined();
  });

  it("restores the settings it was frozen with", () => {
    const restored = getRestoredSettings(
      pin("a", { frozen: { request: storeRequest(request("Uchigatana")), settings: changed } }),
      { ...current },
    );
    expect(restored).toEqual(changed);
  });

  it("picks its upgrade level too, in order", () => {
    const restored = getRestoredSettings(frozen("a", { upgradeLevel: 20 }), {
      ...current,
      upgradeLevels: [10, 25],
    });
    expect(restored?.upgradeLevels).toEqual([10, 20, 25]);
  });

  it("picks its grip too", () => {
    const restored = getRestoredSettings(frozen("a", { twoHanding: true }), current);
    expect(restored?.grips).toEqual(["1h", "2h"]);
    expect(getRestoredSettings(frozen("a"), current)).not.toHaveProperty("grips");
  });

  it("restores pins frozen by earlier versions", () => {
    const { targetPotential: _, ...oldLimits } = settings.limits;
    const old = {
      ...settings,
      upgradeLevel: 25,
      twoHanding: true,
      limits: oldLimits,
    } as unknown as PinSettings;
    const restored = getRestoredSettings(
      pin("a", { frozen: { request: storeRequest(request("Uchigatana")), settings: old } }),
      { ...current },
    );
    expect(restored).not.toHaveProperty("upgradeLevel");
    expect(restored).not.toHaveProperty("twoHanding");
    expect(restored?.limits).toEqual(defaultAppState.limits);
  });
});

describe("frozen pin settings", () => {
  const describe_ = (
    frozenSettings: PinSettings,
    current = settings,
    attack: Pin["attack"] = "R1",
    chain = false,
  ) => describePinSettings(frozenSettings, current, settings, attack, chain, []);
  const labels = (lines: ReturnType<typeof describe_>) => lines.map((line) => line.label);

  it("shows the main settings, none changed, when they're the defaults", () => {
    const lines = describe_(settings);
    expect(labels(lines)).toEqual(
      expect.arrayContaining(["Class", "Stats", "Level limit", "Buffs", "Enemy"]),
    );
    expect(lines.every((line) => !line.changed)).toBe(true);
  });

  it("marks settings different now", () => {
    const lines = describe_({ ...settings, meetRequirements: !settings.meetRequirements });
    expect(lines.find((line) => line.label === "Meet requirements first")).toEqual({
      label: "Meet requirements first",
      value: settings.meetRequirements ? "No" : "Yes",
      changed: true,
    });
  });

  it("shows settings that aren't the default even when they're the same now", () => {
    const fast = { ...settings, fastMode: !settings.fastMode };
    expect(describe_(fast, fast).find((line) => line.label === "Fast mode")?.changed).toBe(false);
  });

  it("only shows chain settings for chains, and the off hand for powerstancing", () => {
    const changed = { ...settings, sumChains: !settings.sumChains, offhandWeapon: "Dagger" };
    expect(labels(describe_(changed))).not.toContain("Chains");
    expect(labels(describe_(changed, settings, "R1", true))).toContain("Chains");
    expect(labels(describe_(changed))).not.toContain("Off hand");
    const powerstance = describe_(changed, settings, "Powerstance R1" as Pin["attack"]);
    expect(labels(powerstance)).toContain("Off hand");
  });

  it("only shows defenses without a picked enemy", () => {
    const defenses = {
      ...settings.defenses,
      [0]: { ...settings.defenses[0], defense: settings.defenses[0].defense + 50 },
    };
    expect(labels(describe_({ ...settings, defenses }))).toContain("Defenses");
    expect(labels(describe_({ ...settings, defenses, enemyKey: "Some enemy|1" }))).not.toContain(
      "Defenses",
    );
  });
});
