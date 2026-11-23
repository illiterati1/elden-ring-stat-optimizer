/**
 * The calculator's numbers for one weapon's attacks, to compare with in-game tests (e.g. er-logger's
 * summaries) without editing a test: each step's stamina, timing and cancels, and each hit's damage,
 * stance, buildup and frame.
 *
 *   npx vite-node scripts/predict.ts -- <weapon> [options]
 *
 * <weapon> is a logged weapon ID (base + affinity × 100 + upgrade level, e.g. 3180825 = Claymore,
 * Magic, +25) or a name ("Rellana's Twin Blades", with --affinity and --upgrade).
 *
 *   --2h               two handed (default one handed)
 *   --affinity <name>  with a name: the affinity (default Standard, or the unique one)
 *   --upgrade <n>      with a name: the upgrade level, +25 scale or +10 for somber (default the max)
 *   --ash <id|name>    the Ash of War (a logged ID, or its name; default the weapon's own skill)
 *   --attack <text>    only attacks whose label has this in it (any case), e.g. "jumping r2", "moon"
 *   --anim <ids>       only the attacks these logged animations could be (comma separated): a skill's
 *                      (040000 on) are all its versions, the moveset's are their attack and step
 *   --enemy <id>       the NpcParam ID hit: its defenses from enemies.json (the dummy's otherwise)
 *   --ng <n>           NG+ level: 0 or 1 (default 1, the dummy's defense 144.4; 123.2 in NG)
 *   --stat <n>         every stat (default 99)
 *   --str/--dex/--int/--fai/--arc <n>  one stat (overrides --stat for it)
 *   --json             print JSON instead
 *
 * Frames are at 60 fps. Each step's hits are from its press ("@56") and from its animation's start
 * ("anim 36"): a step's lead is the frames before its animation starts (the press's 2-frame delay,
 * plus a stance's opening or a jump's start before a chain's first step). Cancels are from the press.
 * Hits marked ~ have approximate times (projectiles); "(not counted)" ones are shown but not counted.
 * No buffs.
 */
import { readFileSync } from "node:fs";
import { allDamageTypes, AttackPowerType, type Attributes } from "../src/calculator/calculator.ts";
import type { Weapon } from "../src/calculator/weapon.ts";
import { decodeRegulationData } from "../src/regulationData.ts";
import { optimizeBuild, maxSpecialUpgradeLevel } from "../src/optimizer/build.ts";
import type { AttackData, StepTimes } from "../src/optimizer/build.ts";
import {
  allAttacks,
  getAttackData,
  type AttackName,
  type Movesets,
} from "../src/app/useMovesets.ts";
import { getEnemyStats, type Enemy, type EnemyArea } from "../src/app/useEnemies.ts";
import { getAshAttacks, getAshChoices, parseAshChoice, type Ashes } from "../src/app/useAshes.ts";
import type { SaveItems } from "../src/app/saveImport.ts";

const root = new URL("../public/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const weapons = decodeRegulationData(read("regulation-vanilla-v1.17.js"));
const movesets: Movesets = read("movesets.json");
const ashes: Ashes = read("ashes.json");
const items: SaveItems = read("saveItems.json");

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueOptions = [
  "--affinity",
  "--upgrade",
  "--ash",
  "--attack",
  "--anim",
  "--enemy",
  "--ng",
  "--stat",
  "--str",
  "--dex",
  "--int",
  "--fai",
  "--arc",
];
const positional = args.filter(
  (arg, i) => !arg.startsWith("--") && !valueOptions.includes(args[i - 1]),
);
if (positional.length !== 1) {
  console.error("Usage: npx vite-node scripts/predict.ts -- <weapon ID or name> [options]");
  process.exit(1);
}

const ngPlus = Number(option("--ng") ?? 1);
const stat = Number(option("--stat") ?? 99);
const twoHanding = flag("--2h");
const json = flag("--json");
// The training dummy's defense in NG and NG+1 (useEnemies.ts's trainingDummyArea)
const defense = ngPlus > 0 ? 144.4 : 123.2;

const AFFINITIES: Record<string, number> = {
  standard: 0,
  heavy: 1,
  keen: 2,
  quality: 3,
  fire: 4,
  "flame art": 5,
  lightning: 6,
  sacred: 7,
  magic: 8,
  cold: 9,
  poison: 10,
  blood: 11,
  occult: 12,
};
const STATUS_NAMES: Partial<Record<AttackPowerType, string>> = {
  [AttackPowerType.POISON]: "poison",
  [AttackPowerType.SCARLET_ROT]: "rot",
  [AttackPowerType.BLEED]: "bleed",
  [AttackPowerType.FROST]: "frost",
  [AttackPowerType.SLEEP]: "sleep",
  [AttackPowerType.MADNESS]: "madness",
  [AttackPowerType.DEATH_BLIGHT]: "blight",
};

interface Target {
  name: string;
  defenses: Record<AttackPowerType, { defense: number; negation: number }>;
  physicalNegation: { standard: number; slash: number; strike: number; pierce: number };
}

/** @returns an enemy's defenses as the enemy picker sets them, or the dummy's if it isn't known */
function getTarget(npcParamId: number | undefined): Target {
  const enemy =
    npcParamId == null
      ? undefined
      : (read("enemies.json").areas as EnemyArea[])
          .flatMap((area) => area.enemies)
          .find((enemy: Enemy) => enemy.npcParamIds.includes(npcParamId));
  if (!enemy) {
    return {
      name: `${ngPlus > 0 ? "NG+1" : "NG"} dummy (${defense})`,
      defenses: Object.fromEntries(
        allDamageTypes.map((damageType) => [damageType, { defense, negation: 0 }]),
      ) as Target["defenses"],
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
    };
  }
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

/** @returns the app's weapon and regular-scale upgrade level */
function getWeapon(input: string): { weapon: Weapon; level: number } | undefined {
  let name: string;
  let affinityId: number;
  let level: number | undefined;
  if (/^\d+$/.test(input)) {
    const id = Number(input);
    name = items.weapons[Math.floor(id / 10000) * 10000];
    affinityId = Math.floor((id % 10000) / 100);
    level = id % 100;
  } else {
    name = input;
    const affinity = option("--affinity")?.toLowerCase() ?? "standard";
    affinityId = AFFINITIES[affinity] ?? Number(affinity);
    const upgrade = option("--upgrade");
    level = upgrade == null ? undefined : Number(upgrade);
  }
  const matches = (w: Weapon) => w.weaponName.toLowerCase() === name?.toLowerCase();
  const weapon =
    weapons.find((w) => matches(w) && w.affinityId === affinityId) ??
    (affinityId === 0 ? weapons.find((w) => matches(w) && w.affinityId === -1) : undefined);
  if (!weapon) return undefined;
  const special = weapon.attack.length - 1 === maxSpecialUpgradeLevel;
  if (level == null) return { weapon, level: 25 };
  return { weapon, level: special ? Math.max(0, Math.ceil(level * 2.5 - 0.5)) : level };
}

interface Hit {
  damage: number;
  stance: number;
  status: Record<string, number>;
  /** Frames from the step's press, and from its animation's start */
  frame: number | null;
  animFrame: number | null;
  approximate?: true;
  kind?: string;
  notCounted?: true;
}
interface Step {
  label?: string;
  stamina?: number;
  leftStamina?: number;
  hitStamina?: number[];
  /** Frames from the press until its animation starts */
  lead?: number;
  /** Frames until the next step (or the attack again) */
  cycle?: number;
  cancels: Record<string, number | number[] | string>;
  hits: Hit[];
}
interface Prediction {
  label: string;
  chain?: boolean;
  repeatFrom?: number;
  note?: string;
  steps: Step[];
}

const frames = (seconds: number | undefined) =>
  seconds == null ? undefined : Math.round(seconds * 60);

/** @returns the attack's steps and hits, as the calculator has them */
function predict(
  label: string,
  weapon: Weapon,
  level: number,
  attack: AttackData,
  target: Target,
  onlyStep?: number,
): Prediction {
  const attributes = Object.fromEntries(
    (["str", "dex", "int", "fai", "arc"] as const).map((name) => [
      name,
      Number(option(`--${name}`) ?? stat),
    ]),
  ) as Attributes;
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
  const steps = (result.attackSteps ?? []).map((hits, i): Step => {
    const times: StepTimes | undefined = attack.stepTimes?.[i];
    const lead = frames(times?.lead);
    const cancels: Step["cancels"] = {};
    if (times) {
      if (times.earliest) {
        cancels.earliest = `${times.earliest.attack} ${frames(times.earliest.time)}`;
      }
      for (const key of [
        "rightHandAttack",
        "quickL2",
        "L2",
        "roll",
        "block",
        "move",
        "jump",
        "recast",
        "opening",
      ] as const) {
        const value = frames(times[key]);
        if (value != null) cancels[key] = value;
      }
      if (times.earlyRolls?.length) cancels.earlyRolls = times.earlyRolls.map((t) => frames(t)!);
    }
    return {
      label: attack.stepLabels?.[i],
      stamina: attack.stamina?.[i],
      leftStamina: attack.leftStamina?.[i],
      hitStamina: attack.hitStamina?.[i],
      lead,
      cycle: frames(attack.cycleTimes?.[i] ?? times?.cycle),
      cancels,
      hits: hits.map((hit, j): Hit => {
        const frame = frames(times?.hitTimes?.[j] ?? times?.hits[j]) ?? null;
        const status = Object.fromEntries(
          Object.entries(hit.status)
            .filter(([, value]) => value)
            .map(([type, value]) => [
              STATUS_NAMES[Number(type) as AttackPowerType] ?? type,
              Math.round(value!),
            ]),
        );
        return {
          damage: hit.damage,
          stance: Math.round(hit.stance * 100) / 100,
          status,
          frame,
          animFrame: frame == null || lead == null ? null : frame - lead,
          ...(times?.approximate?.[j] && { approximate: true as const }),
          ...(hit.kind && { kind: hit.kind }),
          ...(hit.notCounted && { notCounted: true as const }),
        };
      }),
    };
  });
  return {
    label: onlyStep != null && steps.length > 1 ? `${label} ${onlyStep + 1}` : label,
    ...(attack.chain && { chain: true }),
    ...(attack.repeatFrom != null && { repeatFrom: attack.repeatFrom }),
    ...(attack.note && { note: attack.note }),
    steps: onlyStep != null ? steps.slice(onlyStep, onlyStep + 1) : steps,
  };
}

function getPredictions(weapon: Weapon, level: number, target: Target): Prediction[] {
  const predictions: Prediction[] = [];
  const anims = option("--anim")
    ?.split(",")
    .map((anim) => Number(anim) % 1_000_000);
  // The skill: every version and follow-up of it
  if (!anims || anims.some((local) => local >= 40000 && local < 50000)) {
    const ashOption = option("--ash");
    const skill = ashOption
      ? /^\d+$/.test(ashOption)
        ? items.ashes[Number(ashOption)]
        : ashOption
      : ashes.weapons[weapon.weaponName]?.skill;
    const choices = getAshChoices(ashes).filter(
      ({ value }) => parseAshChoice(value)[0].toLowerCase() === skill?.toLowerCase(),
    );
    if (!choices.length && skill) choices.push({ value: skill, label: skill });
    for (const { value, label } of choices) {
      for (const { ash, variant } of getAshAttacks(
        ashes,
        movesets,
        weapon,
        value,
        twoHanding,
        0.5,
        true,
      )) {
        const name = variant ? `${label}: ${variant.short}` : label;
        if (!("attack" in ash)) {
          predictions.push({ label: name, note: ash.unavailableReason, steps: [] });
          continue;
        }
        predictions.push(predict(name, weapon, level, ash.attack, target));
      }
    }
  }
  // Moveset attacks: all of them, or the logged animations'
  const movesetAttacks: [AttackName, number | undefined][] = anims
    ? anims.flatMap((local) => {
        const entry =
          MOUNTED_ANIMATIONS[local] ??
          MOVESET_ANIMATIONS[twoHanding ? local - TWO_HANDED_OFFSET : local];
        return entry ? [entry] : [];
      })
    : allAttacks.map((name) => [name, undefined]);
  for (const [attackName, step] of movesetAttacks) {
    const attack = getAttackData(movesets, weapon, attackName, twoHanding, 0.5, true);
    if (!attack) continue;
    predictions.push(predict(attackName, weapon, level, attack, target, step));
  }
  const text = option("--attack")?.toLowerCase();
  return text ? predictions.filter(({ label }) => label.toLowerCase().includes(text)) : predictions;
}

function format(prediction: Prediction): string {
  const lines = [
    `${prediction.label}${prediction.chain ? " (chain" : ""}${
      prediction.repeatFrom != null ? `, repeats from step ${prediction.repeatFrom + 1}` : ""
    }${prediction.chain ? ")" : ""}${prediction.note ? ` — ${prediction.note}` : ""}`,
  ];
  prediction.steps.forEach((step, i) => {
    const head = [
      prediction.steps.length > 1 ? `step ${i + 1}` : "",
      step.label ? `"${step.label}"` : "",
      step.stamina != null ? `stamina ${step.stamina}` : "",
      step.leftStamina ? `(left ${step.leftStamina})` : "",
      step.hitStamina ? `per hit [${step.hitStamina.join(", ")}]` : "",
      step.lead != null ? `lead ${step.lead}` : "",
      step.cycle != null ? `cycle ${step.cycle}` : "",
    ].filter(Boolean);
    lines.push(`  ${head.join("  ")}`);
    const cancels = Object.entries(step.cancels).map(
      ([key, value]) => `${key} ${Array.isArray(value) ? value.join("/") : value}`,
    );
    if (cancels.length) lines.push(`    from press: ${cancels.join(", ")}`);
    const byFrame = [...step.hits].sort((a, b) => (a.frame ?? Infinity) - (b.frame ?? Infinity));
    for (const hit of byFrame) {
      const status = Object.entries(hit.status).map(([type, value]) => `${type} ${value}`);
      lines.push(
        `    ${String(Math.floor(hit.damage)).padStart(5)}  stance ${hit.stance}${
          hit.frame != null
            ? `  @${hit.frame}${hit.approximate ? "~" : ""} (anim ${hit.animFrame})`
            : "  (no time)"
        }${status.length ? `  ${status.join(", ")}` : ""}${hit.kind ? `  ${hit.kind}` : ""}${
          hit.notCounted ? "  (not counted)" : ""
        }`,
      );
    }
  });
  return lines.join("\n");
}

const found = getWeapon(positional[0]);
if (!found) {
  console.error(`No weapon ${positional[0]}`);
  process.exit(1);
}
const { weapon, level } = found;
const enemyOption = option("--enemy");
const target = getTarget(enemyOption == null ? undefined : Number(enemyOption));
const predictions = getPredictions(weapon, level, target);
if (json) {
  console.log(
    JSON.stringify({
      weapon: weapon.name,
      level,
      twoHanding,
      ngPlus,
      stat,
      target: target.name,
      predictions,
    }),
  );
} else {
  console.log(
    `${weapon.name} (+${level} on the regular scale), ${
      twoHanding ? "two" : "one"
    } handed; ${stat} in every stat, NG+${ngPlus}, vs ${target.name}; no buffs`,
  );
  console.log(predictions.map(format).join("\n\n") || "No attacks match");
}
