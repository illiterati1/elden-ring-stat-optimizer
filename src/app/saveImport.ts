import type { Weapon } from "../calculator/weapon.ts";
import { maxSpecialUpgradeLevel } from "../optimizer/build.ts";
import type { StartingClassName, Stats } from "../optimizer/startingClasses.ts";
import { weaponSlots, type SaveCharacter, type WeaponSlot } from "./saveFile.ts";
import { getAmmoKey, type AmmoGroup } from "./useAmmo.ts";
import type { AppState, Grip } from "./useAppState.ts";
import { fixedSkillsChoice, parseAshChoice, type Ashes } from "./useAshes.ts";
import { getBuffKey, type Buff } from "./useBuffs.ts";
import { maxNgPlus } from "./useEnemies.ts";

/** public/saveItems.json (scripts/build_save_data.py): names by the save's item IDs */
export interface SaveItems {
  /** By base weapon ID (no affinity or upgrade level) */
  weapons: Record<string, string>;
  armor: Record<string, string>;
  talismans: Record<string, string>;
  /** Ash of War names, as in ashes.json */
  ashes: Record<string, string>;
}

/** Starting classes by CharaInitParam row (3000 + index), as the save has them */
export const saveClasses: readonly StartingClassName[] = [
  "Vagabond",
  "Warrior",
  "Hero",
  "Bandit",
  "Astrologer",
  "Prophet",
  "Confessor",
  "Samurai",
  "Prisoner",
  "Wretch",
  "Idus Knight",
  "Heavy Knight",
];

/** @returns the save's grip: two handed if either hand's weapon is held with both hands */
export function getSaveGrip(character: SaveCharacter): Grip {
  return character.grip === "1h" ? "1h" : "2h";
}

/** A weapon from the save, as the app names it */
export interface ImportedWeapon {
  weaponName: string;
  affinityId: number;
  /** On the regular scale (+25), like AppState's upgrade levels */
  upgradeLevel: number;
}

/** What a save character's stats and gear set in the app */
export interface ImportedGear {
  startingClass: StartingClassName;
  stats: Stats;
  /** Every equipped weapon (not Unarmed), in slot order */
  weapons: ImportedWeapon[];
  /** Their skills, as Ash of War picker choices */
  ashesOfWar: string[];
  /** The left hand's weapon in use, if it can powerstance with the right hand's */
  offhand: ImportedWeapon | null;
  /** Talismans and armor in the buff list (ones that don't do anything to damage aren't) */
  buffs: string[];
  catalyst: { name: string; upgradeLevel: number } | null;
  /** The equipped arrows and bolts, as ammunition keys (getAmmoKey) */
  ammo: string[];
  scadutreeBlessingLevel: number;
  /** The journey's NG+ level (0 for NG), if the save has it */
  ngPlus: number | null;
}

export interface SaveImportData {
  items: SaveItems;
  weapons: readonly Weapon[];
  buffs: readonly Buff[];
  ashes: Ashes;
  /** The Ash of War picker's choices' values */
  ashChoices: readonly string[];
  /** Weapons that can be the off hand weapon, by base name */
  offhandChoices: ReadonlySet<string>;
  /** Staves and seals, by base name */
  catalystNames: ReadonlySet<string>;
  ammo: readonly AmmoGroup[];
}

/** The kinds of buffs the save decides: other selected buffs (e.g. consumables) are kept */
const gearBuffKinds: ReadonlySet<string> = new Set(["talisman", "armor"]);

/** @returns the weapon in the app's weapon data, if it has it */
function getAppWeapon(id: number, data: SaveImportData) {
  const affinityId = Math.floor((id % 10000) / 100);
  const level = id % 100;
  const name = data.items.weapons[id - (id % 10000)];
  if (!name) return undefined;
  // Weapons that can't take affinities are -1 in the app's data, rather than standard
  const weapon =
    data.weapons.find((w) => w.weaponName === name && w.affinityId === affinityId) ??
    (affinityId === 0
      ? data.weapons.find((w) => w.weaponName === name && w.affinityId === -1)
      : undefined);
  return weapon && { weapon, level };
}

function importWeapon(id: number, data: SaveImportData): ImportedWeapon | null {
  const found = getAppWeapon(id, data);
  if (!found || found.weapon.weaponName === "Unarmed") return null;
  const { weapon, level } = found;
  // A somber weapon's level, e.g. +10, as the lowest regular level the app turns into it, e.g. +25
  const special = weapon.attack.length - 1 === maxSpecialUpgradeLevel;
  return {
    weaponName: weapon.weaponName,
    affinityId: weapon.affinityId,
    upgradeLevel: special ? Math.max(0, Math.ceil(level * 2.5 - 0.5)) : level,
  };
}

/** @returns the Ash of War picker's choices for the weapon's skill: attached, or its own */
function getSkillChoices(weaponName: string, ashId: number | null, data: SaveImportData) {
  const info = data.ashes.weapons[weaponName];
  if (ashId == null && info && !info.canChange) return [fixedSkillsChoice];
  const skill = ashId != null ? data.items.ashes[ashId] : info?.skill;
  return data.ashChoices.filter((choice) => parseAshChoice(choice)[0] === skill);
}

/**
 * @returns buff keys by armor name: merged armor (e.g. "Crucible Axe Helm / Tree Helm" or altered
 * versions under the normal name) under each of its pieces' names
 */
function getArmorBuffKeys(buffs: readonly Buff[]) {
  const keys = new Map<string, string>();
  for (const buff of buffs) {
    if (buff.kind !== "armor") continue;
    const [first, ...rest] = buff.name.split(" / ");
    const family = first.startsWith("Crucible ") ? "Crucible " : "";
    for (const name of [first, ...rest.map((piece) => family + piece)]) {
      keys.set(name, getBuffKey(buff));
    }
  }
  return keys;
}

export function getImportedGear(character: SaveCharacter, data: SaveImportData): ImportedGear {
  const { items } = data;
  const slotWeapons = weaponSlots.flatMap((slot) => {
    const { id, ashId } = character.weapons[slot];
    const weapon = importWeapon(id, data);
    return weapon ? [{ slot, weapon, ashId }] : [];
  });
  const weaponIn = (slot: WeaponSlot) => slotWeapons.find((w) => w.slot === slot)?.weapon;

  // Powerstancing takes two weapons of the same type, held with one hand
  const left = weaponIn(`L${character.activeLeft + 1}` as WeaponSlot);
  const right = weaponIn(`R${character.activeRight + 1}` as WeaponSlot);
  const typeOf = (weapon: ImportedWeapon) =>
    data.weapons.find((w) => w.weaponName === weapon.weaponName)?.weaponType;
  const offhand =
    character.grip !== "2hLeft" &&
    left &&
    right &&
    data.offhandChoices.has(left.weaponName) &&
    data.offhandChoices.has(right.weaponName) &&
    typeOf(left) === typeOf(right)
      ? left
      : null;

  const buffKeys = new Set(data.buffs.map(getBuffKey));
  const armorKeys = getArmorBuffKeys(data.buffs);
  const buffs = [
    ...character.talismans.flatMap((id) => {
      const key =
        items.talismans[id] && getBuffKey({ kind: "talisman", name: items.talismans[id] });
      return key && buffKeys.has(key) ? [key] : [];
    }),
    ...character.armor.flatMap((id) => {
      const key = items.armor[id] && armorKeys.get(items.armor[id].replace(/ \(Altered\)$/, ""));
      return key ? [key] : [];
    }),
  ];

  // A staff or seal for weapon buff spells: one in hand if there is one
  const slotOrder: WeaponSlot[] = [
    `L${character.activeLeft + 1}` as WeaponSlot,
    `R${character.activeRight + 1}` as WeaponSlot,
    ...weaponSlots,
  ];
  const catalyst = slotOrder
    .map((slot) => getAppWeapon(character.weapons[slot].id, data))
    .find((found) => found && data.catalystNames.has(found.weapon.weaponName));

  // Arrows and bolts are weapons in the save, with no affinity or upgrade level
  const ammo = character.ammo.flatMap((id) => {
    const name = items.weapons[id - (id % 10000)];
    const group = name && data.ammo.find((g) => g.names.includes(name));
    return group ? [getAmmoKey(group)] : [];
  });

  return {
    startingClass: saveClasses[character.classIndex] ?? "Wretch",
    stats: character.stats,
    weapons: slotWeapons.map(({ weapon }) => weapon),
    ashesOfWar: [
      ...new Set(
        slotWeapons.flatMap(({ weapon, ashId }) => getSkillChoices(weapon.weaponName, ashId, data)),
      ),
    ],
    offhand,
    buffs,
    catalyst: catalyst ? { name: catalyst.weapon.weaponName, upgradeLevel: catalyst.level } : null,
    ammo: [...new Set(ammo)],
    scadutreeBlessingLevel: character.scadutreeBlessing,
    ngPlus: character.clearCount != null ? Math.min(character.clearCount, maxNgPlus) : null,
  };
}

/** Settings to change, built up a field at a time */
export type GearUpdate = { -readonly [K in keyof AppState]?: AppState[K] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param previous the gear last imported, to only change what changed since (e.g. weapons added to
 * compare stay until the save's weapons change), or null to set everything
 * @returns the settings to change for the gear
 */
export function getGearUpdate(
  gear: ImportedGear,
  previous: ImportedGear | null,
  selectedBuffs: readonly string[],
): GearUpdate {
  const update: GearUpdate = {};
  if (
    !previous ||
    previous.startingClass !== gear.startingClass ||
    !same(previous.stats, gear.stats)
  ) {
    update.startingClass = gear.startingClass;
    update.stats = gear.stats;
  }
  if (
    gear.weapons.length &&
    (!previous ||
      !same(previous.weapons, gear.weapons) ||
      !same(previous.ashesOfWar, gear.ashesOfWar))
  ) {
    const unique = <T>(values: T[]) => [...new Set(values)];
    update.selectedWeapons = unique(gear.weapons.map((weapon) => weapon.weaponName));
    update.affinityIds = unique(gear.weapons.map((weapon) => weapon.affinityId));
    update.upgradeLevels = unique(gear.weapons.map((weapon) => weapon.upgradeLevel));
    update.ashesOfWar = gear.ashesOfWar;
  }
  if (!previous || !same(previous.offhand, gear.offhand)) {
    update.offhandWeapon = gear.offhand?.weaponName ?? null;
    update.offhandAffinityId = gear.offhand?.affinityId ?? null;
    update.offhandBuff = null;
    if (gear.offhand) update.offhandUpgradeLevel = gear.offhand.upgradeLevel;
  }
  if (!previous || !same(previous.buffs, gear.buffs)) {
    update.buffs = [
      ...selectedBuffs.filter((key) => !gearBuffKinds.has(key.slice(0, key.indexOf(":")))),
      ...gear.buffs,
    ];
  }
  if (!previous || !same(previous.catalyst, gear.catalyst)) {
    update.catalyst = gear.catalyst?.name ?? "";
    if (gear.catalyst) update.catalystUpgradeLevel = gear.catalyst.upgradeLevel;
  }
  if (gear.ammo.length && (!previous || !same(previous.ammo, gear.ammo))) {
    update.selectedAmmo = gear.ammo;
  }
  if (!previous || previous.scadutreeBlessingLevel !== gear.scadutreeBlessingLevel) {
    update.scadutreeBlessingLevel = gear.scadutreeBlessingLevel;
  }
  if (gear.ngPlus != null && (!previous || previous.ngPlus !== gear.ngPlus)) {
    update.ngPlus = gear.ngPlus;
  }
  return update;
}
