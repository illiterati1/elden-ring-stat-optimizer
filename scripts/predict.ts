/**
 * The calculator's predictions for attacks logged in game by er-logger, for its summarize.mjs to
 * compare with: each hit's damage, stance, and buildup on the training dummy, and when it lands.
 *
 *   echo '[{"weapon": 1500725, "ash": 0, "twoHanding": true, "anims": [877040000, 877040001]}]' |
 *     npx vite-node scripts/predict.ts -- [--ng 0|1] [--stat 99]
 *
 * Each query is one press: the logged weapon ID (base + affinity × 100 + upgrade level, as the save
 * has it), the hand's Ash of War ID (0 for the weapon's own skill), the grip, and the animations the
 * press played. Prints, per query, every calculator attack those animations could be (a skill's
 * versions and follow-ups, or the moveset attack and chain step the animation is), each with its
 * hits in order: [damage, stance, {status: buildup}, frames from the press (or null)]. The caller
 * picks the one whose damage matches.
 *
 * A query can name the enemy hit (`"enemy": <NpcParam ID>`): its defenses and negations are used if
 * enemies.json has it, the Boss Arena training dummy's otherwise. Also prints each query's enemy name.
 * Assumes 99 in every stat (--stat) and NG+1 (--ng 0 for NG), no buffs.
 */
import { readFileSync } from "node:fs";
import { allDamageTypes, AttackPowerType, type Attributes } from "../src/calculator/calculator.ts";
import type { Weapon } from "../src/calculator/weapon.ts";
import { decodeRegulationData } from "../src/regulationData.ts";
import { optimizeBuild, maxSpecialUpgradeLevel } from "../src/optimizer/build.ts";
import type { AttackData } from "../src/optimizer/build.ts";
import { getAttackData, type AttackName, type Movesets } from "../src/app/useMovesets.ts";
import { getEnemyStats, type Enemy, type EnemyArea } from "../src/app/useEnemies.ts";
import { getAshAttack, getAshChoices, parseAshChoice, type Ashes } from "../src/app/useAshes.ts";
import type { SaveItems } from "../src/app/saveImport.ts";

const root = new URL("../public/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const weapons = decodeRegulationData(read("regulation-vanilla-v1.17.js"));
const movesets: Movesets = read("movesets.json");
const ashes: Ashes = read("ashes.json");
const items: SaveItems = read("saveItems.json");

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const ngPlus = option("--ng", 1);
const stat = option("--stat", 99);
// The training dummy's defense in NG and NG+1 (useEnemies.ts's trainingDummyArea)
const defense = ngPlus > 0 ? 144.4 : 123.2;
const enemiesById = new Map<number, Enemy>(
  (read("enemies.json").areas as EnemyArea[]).flatMap((area) =>
    area.enemies.flatMap((enemy) => enemy.npcParamIds.map((id) => [id, enemy] as const)),
  ),
);

interface Target {
  name: string;
  defenses: Record<AttackPowerType, { defense: number; negation: number }>;
  physicalNegation: { standard: number; slash: number; strike: number; pierce: number };
}
const dummy: Target = {
  name: `${ngPlus > 0 ? "NG+1" : "NG"} dummy`,
  defenses: Object.fromEntries(
    allDamageTypes.map((damageType) => [damageType, { defense, negation: 0 }]),
  ) as Target["defenses"],
  physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
};

/** @returns an enemy's defenses as the enemy picker sets them, or the dummy's if it isn't known */
function getTarget(npcParamId: number | undefined): Target {
  const enemy = npcParamId == null ? undefined : enemiesById.get(npcParamId);
  if (!enemy) return dummy;
  const [phys, mag, fire, lightning, holy] = getEnemyStats(enemy, ngPlus, false).defense.map(
    Math.round,
  );
  const [standard, slash, strike, pierce, magN, fireN, lightningN, holyN] = enemy.negation.map(
    Math.round,
  );
  return {
    name: enemy.name,
    defenses: {
      [AttackPowerType.PHYSICAL]: { defense: phys, negation: 0 },
      [AttackPowerType.MAGIC]: { defense: mag, negation: magN },
      [AttackPowerType.FIRE]: { defense: fire, negation: fireN },
      [AttackPowerType.LIGHTNING]: { defense: lightning, negation: lightningN },
      [AttackPowerType.HOLY]: { defense: holy, negation: holyN },
    } as Target["defenses"],
    physicalNegation: { standard, slash, strike, pierce },
  };
}

/** Moveset attacks by one handed animation ID (two handed ones are 2000 later), with their step */
const MOVESET_ANIMATIONS: Record<number, [AttackName, number]> = {
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [30000 + i * 10, ["R1", i]])),
  30505: ["R2", 0],
  30515: ["R2", 1],
  30500: ["Charged R2", 0],
  30510: ["Charged R2", 1],
  30200: ["Running R1", 0],
  30210: ["Running R2", 0],
  30300: ["Rolling R1", 0],
  30310: ["Crouching R1", 0],
  30400: ["Backstep R1", 0],
  31030: ["Jumping R1", 0],
  31230: ["Jumping R2", 0],
  30700: ["Guard Counter", 0],
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [34000 + i * 10, ["Powerstance L1", i]])),
  34200: ["Powerstance Running L1", 0],
  34300: ["Powerstance Rolling L1", 0],
  34310: ["Powerstance Crouching L1", 0],
  34400: ["Powerstance Backstep L1", 0],
  34530: ["Powerstance Jumping L1", 0],
};
/** Mounted attacks by animation ID: R1/R2 are 038xxx, L1/L2 039xxx, the same in either grip */
const MOUNTED_ANIMATIONS: Record<number, [AttackName, number]> = Object.fromEntries(
  [38000, 39000].flatMap((base) => [
    ...[0, 1, 2].map((i) => [base + i * 10, ["Mounted R1/L1", i]]),
    [base + 110, ["Mounted R2/L2", 0]],
    [base + 100, ["Mounted Charged R2/L2", 0]],
  ]),
);
const TWO_HANDED_OFFSET = 2000;
const STATUS_NAMES: Partial<Record<AttackPowerType, string>> = {
  [AttackPowerType.POISON]: "poison",
  [AttackPowerType.SCARLET_ROT]: "rot",
  [AttackPowerType.BLEED]: "bleed",
  [AttackPowerType.FROST]: "frost",
  [AttackPowerType.SLEEP]: "sleep",
  [AttackPowerType.MADNESS]: "madness",
  [AttackPowerType.DEATH_BLIGHT]: "blight",
};

interface Query {
  weapon: number;
  ash: number;
  twoHanding: boolean;
  anims: number[];
  enemy?: number;
}
type Hit = [damage: number, stance: number, status: Record<string, number>, frame: number | null];
interface Candidate {
  label: string;
  hits: Hit[];
}

/** @returns the app's weapon and regular-scale upgrade level for a logged weapon ID */
function getWeapon(id: number): { weapon: Weapon; level: number } | undefined {
  const name = items.weapons[Math.floor(id / 10000) * 10000];
  const affinityId = Math.floor((id % 10000) / 100);
  const level = id % 100;
  const weapon =
    weapons.find((w) => w.weaponName === name && w.affinityId === affinityId) ??
    (affinityId === 0
      ? weapons.find((w) => w.weaponName === name && w.affinityId === -1)
      : undefined);
  if (!weapon) return undefined;
  const special = weapon.attack.length - 1 === maxSpecialUpgradeLevel;
  return { weapon, level: special ? Math.max(0, Math.ceil(level * 2.5 - 0.5)) : level };
}

/** @returns each step's hits, as the calculator has them */
function predict(
  weapon: Weapon,
  level: number,
  twoHanding: boolean,
  attack: AttackData,
  target: Target,
): Hit[][] {
  const attributes: Attributes = { str: stat, dex: stat, int: stat, fai: stat, arc: stat };
  const result = optimizeBuild({
    weapon,
    regularUpgradeLevel: level,
    twoHanding,
    startLevel: 9,
    currentLevel: 9,
    attributes,
    bonusAttributes: { str: 0, dex: 0, int: 0, fai: 0, arc: 0 },
    objective: "totalAttack",
    defenses: target.defenses,
    physicalNegation: target.physicalNegation,
    limits: {
      maxLevels: 0,
      minGainPerLevel: null,
      minRelativeGainPerLevel: null,
      runeBudget: null,
      targetValue: null,
      targetPotential: null,
      minPotentialPerRemainingLevel: null,
    },
    attack,
    buffs: [],
  });
  return (result.attackSteps ?? []).map((step, i) => {
    const times = attack.stepTimes?.[i];
    return step
      .filter((hit) => !hit.notCounted)
      .map((hit, j): Hit => {
        const time = times?.hitTimes?.[j] ?? times?.hits[j];
        const status = Object.fromEntries(
          Object.entries(hit.status)
            .filter(([, value]) => value)
            .map(([type, value]) => [
              STATUS_NAMES[Number(type) as AttackPowerType] ?? type,
              Math.round(value!),
            ]),
        );
        return [
          hit.damage,
          Math.round(hit.stance * 10) / 10,
          status,
          time == null ? null : Math.round(time * 60),
        ];
      });
  });
}

function getCandidates({ weapon: id, ash, twoHanding, anims, enemy }: Query): Candidate[] {
  const target = getTarget(enemy);
  const found = getWeapon(id);
  if (!found) return [];
  const { weapon, level } = found;
  const candidates: Candidate[] = [];
  const locals = anims.map((anim) => anim % 1_000_000);
  // A skill (its animations are 040000 on): every version and follow-up of it
  if (locals.some((local) => local >= 40000 && local < 50000)) {
    const skill = ash ? items.ashes[ash] : ashes.weapons[weapon.weaponName]?.skill;
    const choices = getAshChoices(ashes).filter(({ value }) => parseAshChoice(value)[0] === skill);
    if (!choices.length && skill) choices.push({ value: skill, label: skill });
    for (const { value, label } of choices) {
      const result = getAshAttack(ashes, movesets, weapon, value, twoHanding, 0.5, true);
      if (!("attack" in result)) continue;
      const steps = predict(weapon, level, twoHanding, result.attack, target);
      steps.forEach((hits, i) =>
        candidates.push({ label: steps.length > 1 ? `${label}, step ${i + 1}` : label, hits }),
      );
    }
  }
  // Moveset attacks, by their animation
  for (const local of locals) {
    const entry =
      MOUNTED_ANIMATIONS[local] ??
      MOVESET_ANIMATIONS[twoHanding ? local - TWO_HANDED_OFFSET : local];
    if (!entry) continue;
    const [attackName, step] = entry;
    const attack = getAttackData(movesets, weapon, attackName, twoHanding, 0.5, true);
    if (!attack) continue;
    const steps = predict(weapon, level, twoHanding, attack, target);
    const label = steps.length > 1 ? `${attackName} ${step + 1}` : attackName;
    if (steps[step]) candidates.push({ label, hits: steps[step] });
  }
  return candidates;
}

const queries: Query[] = JSON.parse(readFileSync(0, "utf8"));
console.log(
  JSON.stringify({
    ngPlus,
    stat,
    defense,
    results: queries.map(getCandidates),
    enemies: queries.map((query) => getTarget(query.enemy).name),
  }),
);
