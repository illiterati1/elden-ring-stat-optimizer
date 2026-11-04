import type { PhysicalType } from "../optimizer/defense.ts";
import { AttackPowerType, WeaponType } from "../calculator/calculator.ts";
import type { Objective } from "../optimizer/optimizer.ts";
import type { LimitReason } from "../optimizer/limits.ts";
import standardAffinityIcon from "./img/standardAffinity.webp";
import heavyAffinityIcon from "./img/heavyAffinity.webp";
import keenAffinityIcon from "./img/keenAffinity.webp";
import qualityAffinityIcon from "./img/qualityAffinity.webp";
import magicAffinityIcon from "./img/magicAffinity.webp";
import coldAffinityIcon from "./img/coldAffinity.webp";
import fireAffinityIcon from "./img/fireAffinity.webp";
import lightningAffinityIcon from "./img/lightningAffinity.webp";
import sacredAffinityIcon from "./img/sacredAffinity.webp";
import poisonAffinityIcon from "./img/poisonAffinity.webp";
import bloodAffinityIcon from "./img/bloodAffinity.webp";
import occultAffinityIcon from "./img/occultAffinity.webp";
import specialWeaponIcon from "./img/specialWeapon.webp";
import bleedStatusIcon from "./img/bleedStatus.webp";
import poisonStatusIcon from "./img/poisonStatus.webp";
import scarletRotStatusIcon from "./img/scarletRotStatus.webp";
import frostStatusIcon from "./img/frostStatus.webp";
import sleepStatusIcon from "./img/sleepStatus.webp";
import madnessStatusIcon from "./img/madnessStatus.webp";
import deathBlightStatusIcon from "./img/deathBlightStatus.webp";

export interface AffinityOption {
  text: string;
  icon: string;
}

export const uniqueAffinityId = -1;

/** Debug details are shown with ?debug in the URL, e.g. enemies' NpcParam IDs */
export const debug = new URLSearchParams(window.location.search).has("debug");

/**
 * Affinities that can be applied to infusable weapons, plus "Unique" for weapons that can't be
 * infused. Unique weapons picked by name are always included; the Unique option only affects
 * weapons included by weapon type.
 */
export const affinityOptions = new Map<number, AffinityOption>([
  [0, { text: "Standard", icon: standardAffinityIcon }],
  [1, { text: "Heavy", icon: heavyAffinityIcon }],
  [2, { text: "Keen", icon: keenAffinityIcon }],
  [3, { text: "Quality", icon: qualityAffinityIcon }],
  [8, { text: "Magic", icon: magicAffinityIcon }],
  [4, { text: "Fire", icon: fireAffinityIcon }],
  [5, { text: "Flame Art", icon: fireAffinityIcon }],
  [6, { text: "Lightning", icon: lightningAffinityIcon }],
  [7, { text: "Sacred", icon: sacredAffinityIcon }],
  [9, { text: "Cold", icon: coldAffinityIcon }],
  [10, { text: "Poison", icon: poisonAffinityIcon }],
  [11, { text: "Blood", icon: bloodAffinityIcon }],
  [12, { text: "Occult", icon: occultAffinityIcon }],
  [uniqueAffinityId, { text: "Unique", icon: specialWeaponIcon }],
]);

/** Weapon type groups for the weapon type picker */
export const rangedWeaponTypes: WeaponType[] = [
  WeaponType.LIGHT_BOW,
  WeaponType.BOW,
  WeaponType.GREATBOW,
  WeaponType.CROSSBOW,
  WeaponType.BALLISTA,
];

export const catalystTypes: WeaponType[] = [WeaponType.GLINTSTONE_STAFF, WeaponType.SACRED_SEAL];

export const shieldTypes: WeaponType[] = [
  WeaponType.SMALL_SHIELD,
  WeaponType.MEDIUM_SHIELD,
  WeaponType.GREATSHIELD,
  WeaponType.THRUSTING_SHIELD,
];

export const meleeWeaponTypes: WeaponType[] = [
  WeaponType.AXE,
  WeaponType.BACKHAND_BLADE,
  WeaponType.BEAST_CLAW,
  WeaponType.CLAW,
  WeaponType.COLOSSAL_SWORD,
  WeaponType.COLOSSAL_WEAPON,
  WeaponType.CURVED_GREATSWORD,
  WeaponType.CURVED_SWORD,
  WeaponType.DAGGER,
  WeaponType.FIST,
  WeaponType.FLAIL,
  WeaponType.GREAT_HAMMER,
  WeaponType.GREAT_KATANA,
  WeaponType.GREAT_SPEAR,
  WeaponType.GREATAXE,
  WeaponType.GREATSWORD,
  WeaponType.HALBERD,
  WeaponType.HAMMER,
  WeaponType.HAND_TO_HAND,
  WeaponType.HEAVY_THRUSTING_SWORD,
  WeaponType.KATANA,
  WeaponType.LIGHT_GREATSWORD,
  WeaponType.PERFUME_BOTTLE,
  WeaponType.REAPER,
  WeaponType.SPEAR,
  WeaponType.STRAIGHT_SWORD,
  WeaponType.THROWING_BLADE,
  WeaponType.THRUSTING_SWORD,
  WeaponType.TORCH,
  WeaponType.TWINBLADE,
  WeaponType.WHIP,
];

export const physicalTypeLabels: Record<PhysicalType, string> = {
  standard: "Standard",
  slash: "Slash",
  strike: "Strike",
  pierce: "Pierce",
};

/**
 * Weapon types in the order the game lists them (also the motion value sheet's order). Dual
 * catalysts aren't in the sheet, so they're placed with the other catalysts.
 */
export const weaponTypeOrder: WeaponType[] = [
  WeaponType.DAGGER,
  WeaponType.THROWING_BLADE,
  WeaponType.STRAIGHT_SWORD,
  WeaponType.LIGHT_GREATSWORD,
  WeaponType.GREATSWORD,
  WeaponType.COLOSSAL_SWORD,
  WeaponType.THRUSTING_SWORD,
  WeaponType.HEAVY_THRUSTING_SWORD,
  WeaponType.CURVED_SWORD,
  WeaponType.CURVED_GREATSWORD,
  WeaponType.BACKHAND_BLADE,
  WeaponType.KATANA,
  WeaponType.GREAT_KATANA,
  WeaponType.TWINBLADE,
  WeaponType.AXE,
  WeaponType.GREATAXE,
  WeaponType.HAMMER,
  WeaponType.FLAIL,
  WeaponType.GREAT_HAMMER,
  WeaponType.COLOSSAL_WEAPON,
  WeaponType.SPEAR,
  WeaponType.GREAT_SPEAR,
  WeaponType.HALBERD,
  WeaponType.REAPER,
  WeaponType.WHIP,
  WeaponType.FIST,
  WeaponType.HAND_TO_HAND,
  WeaponType.CLAW,
  WeaponType.BEAST_CLAW,
  WeaponType.PERFUME_BOTTLE,
  WeaponType.LIGHT_BOW,
  WeaponType.BOW,
  WeaponType.GREATBOW,
  WeaponType.CROSSBOW,
  WeaponType.BALLISTA,
  WeaponType.GLINTSTONE_STAFF,
  WeaponType.SACRED_SEAL,
  WeaponType.DUAL_CATALYST,
  WeaponType.TORCH,
  WeaponType.SMALL_SHIELD,
  WeaponType.MEDIUM_SHIELD,
  WeaponType.GREATSHIELD,
  WeaponType.THRUSTING_SHIELD,
];

/** Sorts weapon types in the game's order */
export function compareWeaponTypes(a: WeaponType, b: WeaponType) {
  const index = (weaponType: WeaponType) => {
    const i = weaponTypeOrder.indexOf(weaponType);
    return i === -1 ? weaponTypeOrder.length : i;
  };
  return index(a) - index(b) || a - b;
}

export const weaponTypeLabels = new Map<WeaponType, string>([
  [WeaponType.DAGGER, "Dagger"],
  [WeaponType.STRAIGHT_SWORD, "Straight Sword"],
  [WeaponType.GREATSWORD, "Greatsword"],
  [WeaponType.COLOSSAL_SWORD, "Colossal Sword"],
  [WeaponType.CURVED_SWORD, "Curved Sword"],
  [WeaponType.CURVED_GREATSWORD, "Curved Greatsword"],
  [WeaponType.KATANA, "Katana"],
  [WeaponType.TWINBLADE, "Twinblade"],
  [WeaponType.THRUSTING_SWORD, "Thrusting Sword"],
  [WeaponType.HEAVY_THRUSTING_SWORD, "Heavy Thrusting Sword"],
  [WeaponType.AXE, "Axe"],
  [WeaponType.GREATAXE, "Greataxe"],
  [WeaponType.HAMMER, "Hammer"],
  [WeaponType.GREAT_HAMMER, "Great Hammer"],
  [WeaponType.FLAIL, "Flail"],
  [WeaponType.SPEAR, "Spear"],
  [WeaponType.GREAT_SPEAR, "Great Spear"],
  [WeaponType.HALBERD, "Halberd"],
  [WeaponType.REAPER, "Reaper"],
  [WeaponType.FIST, "Fist"],
  [WeaponType.CLAW, "Claw"],
  [WeaponType.WHIP, "Whip"],
  [WeaponType.COLOSSAL_WEAPON, "Colossal Weapon"],
  [WeaponType.LIGHT_BOW, "Light Bow"],
  [WeaponType.BOW, "Bow"],
  [WeaponType.GREATBOW, "Greatbow"],
  [WeaponType.CROSSBOW, "Crossbow"],
  [WeaponType.BALLISTA, "Ballista"],
  [WeaponType.GLINTSTONE_STAFF, "Glintstone Staff"],
  [WeaponType.DUAL_CATALYST, "Dual Catalyst"],
  [WeaponType.SACRED_SEAL, "Sacred Seal"],
  [WeaponType.SMALL_SHIELD, "Small Shield"],
  [WeaponType.MEDIUM_SHIELD, "Medium Shield"],
  [WeaponType.GREATSHIELD, "Greatshield"],
  [WeaponType.TORCH, "Torch"],
  [WeaponType.HAND_TO_HAND, "Hand-to-Hand"],
  [WeaponType.PERFUME_BOTTLE, "Perfume Bottle"],
  [WeaponType.THRUSTING_SHIELD, "Thrusting Shield"],
  [WeaponType.THROWING_BLADE, "Throwing Blade"],
  [WeaponType.BACKHAND_BLADE, "Backhand Blade"],
  [WeaponType.LIGHT_GREATSWORD, "Light Greatsword"],
  [WeaponType.GREAT_KATANA, "Great Katana"],
  [WeaponType.BEAST_CLAW, "Beast Claw"],
]);

export const damageTypeLabels = new Map<AttackPowerType, string>([
  [AttackPowerType.PHYSICAL, "Physical"],
  [AttackPowerType.MAGIC, "Magic"],
  [AttackPowerType.FIRE, "Fire"],
  [AttackPowerType.LIGHTNING, "Lightning"],
  [AttackPowerType.HOLY, "Holy"],
]);

export const damageTypeIcons = new Map<AttackPowerType, string>([
  [AttackPowerType.PHYSICAL, standardAffinityIcon],
  [AttackPowerType.MAGIC, magicAffinityIcon],
  [AttackPowerType.FIRE, fireAffinityIcon],
  [AttackPowerType.LIGHTNING, lightningAffinityIcon],
  [AttackPowerType.HOLY, sacredAffinityIcon],
]);

export const objectiveOptions: [Objective, string][] = [
  ["totalAttack", "Total damage"],
  ["spellScaling", "Spell scaling"],
  [AttackPowerType.PHYSICAL, "Physical damage"],
  [AttackPowerType.MAGIC, "Magic damage"],
  [AttackPowerType.FIRE, "Fire damage"],
  [AttackPowerType.LIGHTNING, "Lightning damage"],
  [AttackPowerType.HOLY, "Holy damage"],
];

export const limitReasonLabels: Record<LimitReason, string> = {
  maxLevels: "Level limit",
  minGainPerLevel: "Min gain / level",
  minRelativeGainPerLevel: "Min % / level",
  runeBudget: "Rune budget",
  targetValue: "Target reached",
  maxedOut: "No further gain",
};

export const statusTypes = new Map<AttackPowerType, { label: string; icon: string }>([
  [AttackPowerType.BLEED, { label: "Bleed", icon: bleedStatusIcon }],
  [AttackPowerType.FROST, { label: "Frost", icon: frostStatusIcon }],
  [AttackPowerType.POISON, { label: "Poison", icon: poisonStatusIcon }],
  [AttackPowerType.SCARLET_ROT, { label: "Scarlet Rot", icon: scarletRotStatusIcon }],
  [AttackPowerType.SLEEP, { label: "Sleep", icon: sleepStatusIcon }],
  [AttackPowerType.MADNESS, { label: "Madness", icon: madnessStatusIcon }],
  [AttackPowerType.DEATH_BLIGHT, { label: "Death Blight", icon: deathBlightStatusIcon }],
]);
