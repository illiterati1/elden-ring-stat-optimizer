import { useEffect, useState } from "react";
import { allDamageTypes, AttackPowerType, type Weapon } from "../calculator/calculator.ts";
import { allPhysicalTypes, type PhysicalType } from "../optimizer/defense.ts";
import type { AttackData, AttackDataHit, HpDamage, StepTimes } from "../optimizer/build.ts";
import {
  allAttacks,
  getAttackData,
  stepStartDelay,
  type AttackName,
  type Movesets,
} from "./useMovesets.ts";

/** The attack picker's choice for a weapon's skill */
export const ashAttack = "ash";

/**
 * [motion value, status motion value, poise motion value, physical type, details?], like a moveset
 * hit, except physical type 4 and 5 are the weapon's own first and second types
 */
type AshHit = [
  number | number[],
  number,
  number,
  number,
  {
    flat?: number[];
    /** True for flat attack not added to the weapon's base attack, assumed not to scale */
    fixed?: boolean;
    correct?: Weapon["attackElementCorrect"];
    noTwoHandBonus?: boolean;
    kind?: string;
    tick?: boolean;
    /** Seconds between a projectile tick's hits */
    tickInterval?: number;
    /** How long ticks last, in seconds, if known (e.g. a lingering cloud's) */
    tickDuration?: number;
    /** Seconds before the first tick, if not right away */
    tickDelay?: number;
    /** Flat poise damage */
    poise?: number;
    /** The skill's own weapon buff's flat attack by damage type */
    buff?: number[];
    /** How much of a weapon buff's flat attack the hit gets, in percent, if not 100 */
    buffMotionValue?: number;
    /** The hit's own damage multipliers by damage type, from an effect its skill applies */
    damageRates?: number[];
    /** Damage over time of a percentage of the enemy's max HP, e.g. black flame */
    hpDamage?: HpDamage;
    /** True for a hit left out of the total, whose damage the skill's note shows instead */
    uncounted?: boolean;
    /** True for a hit shown with the others but not counted in the total */
    notCounted?: boolean;
    /** Attack subcategories, which some buffs only apply to (e.g. 112 Skill Attack) */
    categories?: number[];
    /**
     * Status buildup the hit applies through its own effects, by AttackPowerType: as is, or with
     * the weapon's status correction (e.g. Blood Blade's projectile 60 and slash 55 blood loss)
     */
    status?: Partial<Record<AttackPowerType, number>>;
    scaledStatus?: Partial<Record<AttackPowerType, number>>;
  }?,
];

interface SkillHits {
  /** Empty for skills that only do damage with follow-ups, e.g. stances like Unsheathe */
  main: AshHit[];
  /** A bow's skill's main attack with ammunition that fires it differently, by its name */
  ammo?: Record<string, AshHit[]>;
  /** A follow-up's note is shown with its results, e.g. that it can hit more than counted */
  followUps: { label: string; hands?: "1h" | "2h"; hits: AshHit[]; note?: string }[];
  /** True if this version puts its own weapon buff on the weapon, e.g. the Dragon Halberd's */
  weaponBuff?: boolean;
  /** A note shown with this version's results, e.g. the Wing of Astel's Nebula's */
  note?: string;
  /**
   * Each part's timing (the main attack's is ""), by the weapon animation range it's for
   * (Ashes["weapons"] skillRange; "0" is the default), from the skill's animations
   */
  timing?: Record<string, Record<string, SkillPartTiming>>;
}

/** A skill part's timing, in seconds from when its animation starts (see build_ash_data.py) */
interface SkillPartTiming {
  /**
   * For an uncharged version, how long after the press its animation starts: once the charged
   * one's charging window opens (like tapped R2s)
   */
  start?: number;
  hits: number[];
  /**
   * Each of the part's hits' own time, in order (null if unknown), where they aren't just its
   * animation's hits
   */
  hitTimes?: (number | null)[];
  /** Which of the part's hits' times are approximate (projectiles': when they're created) */
  approximate?: number[];
  /** When it can be cancelled into another skill (or its chain's next step) */
  L2?: number;
  R1?: number;
  R2?: number;
  anyAttack?: number;
  roll?: number;
  block?: number;
  /** Its stamina cost (for a loop, each pass's), before the weapon's staminaRate */
  stamina?: number;
  /** For a loop, how long each pass takes */
  loop?: number;
  /** For a loop, how long until it starts */
  opening?: number;
}

/**
 * A skill's steps, for their timing: each step's part (its label, "" for the main attack), the
 * button that goes on to the next step, and whether the attack can't be repeated on its own (a
 * loop's follow-up)
 */
interface SkillStepPart {
  label: string;
  next?: "R1" | "R2" | "L2";
  /** The button the last step repeats with (an L2 for most skills) */
  repeat?: "R1" | "R2" | "L2";
  noRepeat?: boolean;
}

/**
 * @returns a part's timing: its own for the hands (a follow-up for one or two handing only, keyed
 * "label|hands", e.g. War Cry's "R2 #1|2h"), or else its label's, for the weapon's animation range
 * or else the default one
 */
function getPartTiming(hits: SkillHits, skillRange: number, label: string, hands?: "1h" | "2h") {
  const own = hits.timing?.[String(skillRange)] ?? {};
  const fallback = hits.timing?.["0"] ?? {};
  const handsKey = hands && `${label}|${hands}`;
  return (
    (handsKey && (own[handsKey] ?? fallback[handsKey])) ||
    own[label] ||
    fallback[label] ||
    undefined
  );
}

/**
 * @returns each step's times (see getAttackData's), from a version's timing for the weapon's
 * animation range, or undefined if any step's aren't known. A step goes on to the next with its
 * button (or an R1/R2), and the last step repeats with another skill (L2, or an R1/R2). A
 * loop's step is one pass, repeated.
 */
function getSkillStepTimes(
  hits: SkillHits,
  skillRange: number,
  parts: SkillStepPart[],
  hands?: "1h" | "2h",
): StepTimes[] | undefined {
  const timings = parts.map(({ label }) => getPartTiming(hits, skillRange, label, hands));
  if (!timings.length || timings.some((timing) => !timing)) return undefined;
  return parts.map(({ label, next: button, repeat, noRepeat }, i) => {
    const timing = timings[i]!;
    // Each counted hit's own time (see SkillPartTiming hitTimes), if the part's hits are known
    const partHits = label
      ? hits.followUps.find((followUp) => followUp.label === label)?.hits
      : hits.main;
    const ownTimes =
      partHits &&
      (timing.hitTimes ?? (timing.hits.length === partHits.length ? timing.hits : undefined));
    const counted = partHits?.flatMap((hit, j) => (hit[4]?.uncounted ? [] : [j])) ?? [];
    if (timing.loop != null) {
      return {
        lead: 0,
        hits: timing.hits,
        cycle: timing.loop,
        ...(timing.opening != null && { opening: timing.opening }),
      };
    }
    // An uncharged version starts once it's released, or else a step starts a frame after its press
    const lead = timing.start ?? stepStartDelay;
    const last = i === parts.length - 1;
    const nextButton = last ? repeat ?? "L2" : button;
    const buttonTime = nextButton ? timing[nextButton] : undefined;
    // A skill again (L2) waits for its own cancel, even if any attack can start sooner (tested in
    // game: the One-Eyed Shield's Flame Spit, used again 278 frames after its last, at its L2 cancel
    // rather than its any attack cancel 10 frames earlier); an R1 or R2 follow-up can start at
    // either
    const next =
      buttonTime != null &&
      (nextButton === "L2" || timing.anyAttack == null || buttonTime <= timing.anyAttack)
        ? { attack: nextButton!, time: lead + buttonTime }
        : timing.anyAttack != null
        ? { attack: "R1/R2" as const, time: lead + timing.anyAttack }
        : undefined;
    return {
      lead,
      hits: timing.hits.map((time) => lead + time),
      ...(ownTimes && {
        hitTimes: counted.map((j) => (ownTimes[j] != null ? lead + ownTimes[j]! : undefined)),
        approximate: counted.map((j) => !!timing.approximate?.includes(j)),
      }),
      ...(next && { next }),
      ...(timing.anyAttack != null && { anyAttack: lead + timing.anyAttack }),
      ...(timing.roll != null && { roll: lead + timing.roll }),
      ...(timing.block != null && { block: lead + timing.block }),
      ...(!(last && noRepeat) && next && { cycle: next.time }),
    };
  });
}

/**
 * @returns the timing parts of an attack: its step times, cycle times if all known, and each step's
 * stamina cost (times the weapon's staminaRate)
 */
function withSkillTiming(
  hits: SkillHits,
  skillRange: number,
  parts: SkillStepPart[],
  staminaRate = 1,
  hands?: "1h" | "2h",
): Pick<AttackData, "stepTimes" | "cycleTimes" | "stamina"> {
  const stepTimes = getSkillStepTimes(hits, skillRange, parts, hands);
  if (!stepTimes) return {};
  const cycleTimes = stepTimes.every((step) => step.cycle != null)
    ? stepTimes.map((step) => step.cycle!)
    : undefined;
  const stamina = parts.map(({ label }) => {
    const cost = getPartTiming(hits, skillRange, label, hands)?.stamina;
    return cost != null ? Math.round(cost * staminaRate * 100) / 100 : undefined;
  });
  return {
    stepTimes,
    ...(cycleTimes && { cycleTimes }),
    ...(stamina.some((cost) => cost != null) && { stamina: stamina.map((cost) => cost ?? 0) }),
  };
}

/**
 * Chains that go back to a later step after their last (its number), tested in game; others start
 * over at their first (or stop, which takes the same time: their last steps can all be cancelled
 * into the skill again)
 */
const chainRepeatSteps: Partial<Record<string, number>> = {
  "Storm Blade": 2,
  "Surge of Faith": 2,
};

/** The button a follow-up is done with, going on to it from the main attack */
function getFollowUpButton(label: string): SkillStepPart["next"] {
  return label.startsWith("R1") ? "R1" : label.startsWith("R2") ? "R2" : "L2";
}

/**
 * @returns true for a skill whose main attack is a loop (e.g. Wild Strikes'), which is its own
 * choice, and each of its follow-ups another on its own, since how many passes come first is up to
 * the player
 */
function isLoopSkill(ashes: Ashes, skill: string) {
  const skillData = ashes.skills[skill];
  return [
    skillData?.generic,
    ...Object.values(skillData?.classes ?? {}),
    ...Object.values(skillData?.unique ?? {}),
  ].some((hits) => hits?.main.some((hit) => hit[4]?.kind === "Loop"));
}

/**
 * A weapon's version of a skill: its own (unique weapon), its weapon class's, or the generic one.
 * A version without a main attack of its own uses the generic one's (e.g. War Cry's roar).
 */
function getSkillHits(
  ashes: Ashes,
  skill: string,
  weapon: Pick<Weapon, "weaponName" | "weaponType" | "ammoNames">,
): SkillHits | undefined {
  const skillData = ashes.skills[skill];
  const version =
    skillData?.unique?.[weapon.weaponName] ??
    skillData?.classes?.[weapon.weaponType] ??
    skillData?.generic;
  // A bow's skill fired with ammunition that has its own hits for it
  const ammoHits = weapon.ammoNames
    ?.map((name) => version?.ammo?.[name])
    .find((ammoMain) => ammoMain);
  const hits = version && ammoHits ? { ...version, main: ammoHits } : version;
  if (hits && !hits.main.length && skillData?.generic?.main.length) {
    return { ...hits, main: skillData.generic.main };
  }
  return hits;
}

/**
 * Skills chosen as chains ("R2 chain", "Charged R2 chain") from their follow-ups "R2 #1", "R2 #2",
 * etc.: ones that buff the following R2s, and ones cast again as a follow-up (Carian Sovereignty's
 * "Uncharged" and "Charged" chains)
 */
const chainSkills: ReadonlySet<string> = new Set([
  "War Cry",
  "Barbaric Roar",
  "Bloodhound's Finesse",
  "Braggart's Roar",
  "Blinkbolt: Long-hafted Axe",
  "Blinkbolt: Twinaxe",
  "Bloodblade Dance",
  "Carian Sovereignty",
  "Corpse Piler",
  "Cursed-Blood Slice",
  "Deadly Dance",
  "Double Slash",
  "Dynast's Finesse",
  "Dynastic Sickleplay",
  "Earthshaker",
  "Establish Order",
  "Flame Skewer",
  "Flaming Strike",
  "Glintblade Phalanx",
  "Glintstone Dart",
  "Glintstone Pebble",
  "Horn Calling: Storm",
  "Magma Guillotine",
  "Magma Shower",
  "Golden Crux",
  "I Command Thee, Kneel!",
  "Golden Land",
  "Hoarah Loux's Earthshaker",
  "Moon-and-Fire Stance",
  "Moonlight Greatsword",
  "Muleta",
  "Onze's Line of Stars",
  "Phantom Slash",
  "Promised Consort",
  "Raging Beast",
  "Rancor Slash",
  "Red Bear Hunt",
  "Regal Roar",
  "Revenger's Blade",
  "Savage Lion's Claw",
  "Shadow Sunflower Headbutt",
  "Shield Strike",
  "Shriek of Milos",
  "Solitary Moon Slash",
  "Spinning Gravity Thrust",
  "Storm Kick",
  "Surge of Faith",
  "Spinning Slash",
  "Starcaller Cry",
  "Storm Blade",
  "Stormcaller",
  "Sword Dance",
  "The Queen's Black Flame",
  "Tremendous Phalanx",
  "Thunderstorm",
  "Troll's Roar",
  "Waterfowl Dance",
  "Waves of Darkness",
  "White Light Charge",
  "Bloodboon Ritual",
  "Bloodfiends' Bloodboon",
  "Great-Serpent Hunt",
  "Messmer's Assault",
]);

/**
 * The buff a skill gives its chains (SpEffectParam 1681 for War Cry, 1811 for Barbaric Roar):
 * ×1.075 physical attack power (physicsAttackPowerRate) and +5 Strength scaling
 * (changeStrengthPoint, not growing with upgrades). Tested in game on a Heavy Longsword +25 with 99
 * in every stat on the training dummy: War Cry's R2 #1 742 and charged R2 #1 973, Barbaric Roar's
 * R2 #1 (three hits) 1024, all exact. Shriek of Milos applies War Cry's (tested in game on the Sword of
 * Milos +10 with its enemy debuff: R2 #1 1738, R2 #2 1155). Braggart's Roar's (SpEffectParam 1861, with War Cry's R2s) is
 * ×1.1 physical attack power without a Strength bonus: two handed R2 #1 875 and charged R2 #1 1116.
 */
const chainBuffs: Partial<
  Record<string, { physicalRate: number; scaling: AttackData["scalingBonus"] }>
> = {
  "War Cry": { physicalRate: 1.075, scaling: { str: 0.05 } },
  "Barbaric Roar": { physicalRate: 1.075, scaling: { str: 0.05 } },
  "Braggart's Roar": { physicalRate: 1.1, scaling: undefined },
  "Shriek of Milos": { physicalRate: 1.075, scaling: { str: 0.05 } },
};

const chainSuffix = " chain";

/**
 * Skills whose versions are the weapon's own attacks with something added, e.g. the Serpent Flail's
 * Flare, O Serpent's R2s fire a flame: each version is that attack's first step (with the skill's
 * weapon buff) and the skill's hits for it
 */
const weaponAttackSkills: ReadonlySet<string> = new Set(["Flare, O Serpent"]);

/**
 * Skills whose follow-ups are the weapon's R2s with the skill's buff (in the skill's own animations),
 * repeated with R2 rather than the skill
 */
const buffedAttackSkills: ReadonlySet<string> = new Set(["Golden Tempering"]);

/**
 * Skills that put a weapon buff on the weapon and change its R2s while it lasts: their R2 and charged
 * R2 chains are the weapon's R2s with the buff picked (App.tsx's r2Skill), so the picker only offers
 * the skill's own attack, if it does damage (e.g. Regal Roar's shockwave). Their R2s are timed from
 * the weapon's moveset (build_ash_data.py's get_moveset_timings), going on and repeated with R2.
 */
export const buffedR2Skills: ReadonlySet<string> = new Set([
  "War Cry",
  "Barbaric Roar",
  "Braggart's Roar",
  "Regal Roar",
  "Shriek of Milos",
  "Moonlight Greatsword",
]);

/**
 * Skills that are one of the weapon's own attacks, by attack: Shield Strike is the shield's R1
 * chain, one or two handed (tested in game: the Carian Thrusting Shield +25's two handed total
 * 2768 with 99 in every stat, and the Heater Shield's, with the R1s' poise). One handed, its own
 * rows have the one handed R1s' motion values. Torches' Torch Attack is their R2 (seen in game).
 */
const movesetSkills: ReadonlyMap<string, AttackName> = new Map([
  ["Shield Strike", "R1"],
  ["Torch Attack", "R2"],
]);

/**
 * Chain skills whose chains are versions of the skill rather than attacks, labeled without "chain":
 * Revenger's Blade and Revenger's Blade (Charged), each followed by its R2
 */
const versionChainSkills: ReadonlySet<string> = new Set(["Revenger's Blade"]);

/**
 * @returns a follow-up's chain and step, e.g. ["Charged R2", 2] for "Charged R2 #2", or ["", 2] for
 * "#2" (a skill that's one chain, e.g. Double Slash)
 */
function getChainStep(label: string): [chain: string, step: number] | undefined {
  const match = label.match(/^(?:(.*) )?#(\d+)$/);
  return match ? [match[1] ?? "", +match[2]] : undefined;
}

/** True for skills with a hit that does damage in any version, unlike e.g. Assassin's Gambit */
function doesDamage(ashes: Ashes, skill: string) {
  const skillData = ashes.skills[skill];
  const versions = [
    skillData?.generic,
    ...Object.values(skillData?.classes ?? {}),
    ...Object.values(skillData?.unique ?? {}),
  ];
  // (or poise damage: e.g. the Verdigris Greatshield's Moore's Charge only does poise damage)
  return versions.some((hits) =>
    [...(hits?.main ?? []), ...(hits?.followUps.flatMap((followUp) => followUp.hits) ?? [])].some(
      ([motionValue, , poiseMotionValue, , details]) =>
        [motionValue, details?.flat, details?.buff, poiseMotionValue, details?.poise]
          .flat()
          .some((value) => value != null && value > 0),
    ),
  );
}

/** True for skills that only do damage with follow-ups in every version, e.g. Unsheathe */
function isStance(ashes: Ashes, skill: string, includeUnique = false) {
  const skillData = ashes.skills[skill];
  const versions = [
    skillData?.generic,
    ...Object.values(skillData?.classes ?? {}),
    ...(includeUnique ? Object.values(skillData?.unique ?? {}) : []),
  ].filter((hits) => hits != null);
  return (
    versions.length > 0 &&
    versions.every((hits) => !hits.main.length) &&
    !skillData?.generic?.main.length
  );
}

/** Ashes of War and skills, generated by scripts/build_ash_data.py */
export interface Ashes {
  ashes: { name: string; mounts: number[]; affinities: number[] }[];
  weapons: Record<
    string,
    {
      skill: string;
      canChange: boolean;
      types: number[];
      /** Which of a skill's animations it uses (see SkillHits timing) */
      skillRange?: number;
      /**
       * Its skills' stamina costs are multiplied by this (its staminaConsumptionRate), if not 1, like
       * its attacks' (tested in game: Lion's Claw on a Greatsword and a Short Sword)
       */
      staminaRate?: number;
    }
  >;
  skills: Record<
    string,
    {
      generic?: SkillHits;
      classes?: Record<string, SkillHits>;
      unique?: Record<string, SkillHits>;
      /** True if the skill puts its own weapon buff on the weapon, replacing any other */
      weaponBuff?: boolean;
      /** A note shown with the skill's results, e.g. that it can hit more than counted */
      note?: string;
      /** A label shown with a fixed skill with one version, e.g. Dynast's Finesse's "Follow-up R2" */
      label?: string;
    }
  >;
}

const emptyAshes: Ashes = { ashes: [], weapons: {}, skills: {} };

export type AshAttack = { skill: string; attack: AttackData } | { unavailableReason: string };

/** Separates an Ash of War from a follow-up that counts with it in the picker's values */
const followUpSeparator = " + ";

/** @returns the picker value for an Ash of War with a follow-up that counts towards the total */
export function withFollowUp(ash: string, followUp: string) {
  return `${ash}${followUpSeparator}${followUp}`;
}

/** @returns an Ash of War picker value's Ash of War and counted follow-up, if any */
export function parseAshChoice(choice: string): [ash: string, followUp: string | undefined] {
  const [ash, followUp] = choice.split(followUpSeparator);
  return [ash, followUp];
}

/**
 * The Ash of War picker's choices: each Ash of War that does damage, and each with each of its
 * follow-ups (in any weapon class's version) counting towards the total. Stances (skills that only do damage with
 * follow-ups) have a choice for each follow-up instead, e.g. "Unsheathe (R1)". Weapons' built-in
 * skills aren't offered: those weapons always use them, a result for each version (getAshAttacks).
 */
export function getAshChoices(ashes: Ashes): { value: string; label: string }[] {
  return [...ashes.ashes.map(({ name }) => name), ...getBuiltInSkills(ashes)]
    .sort()
    .flatMap((name) => getSkillChoices(ashes, name, false));
}

/**
 * @returns skills that weapons taking Ashes of War come with but that aren't Ashes of War
 * themselves, e.g. flails' Spinning Chain, which only those weapons can use
 */
function getBuiltInSkills(ashes: Ashes) {
  const ashNames = new Set(ashes.ashes.map(({ name }) => name));
  return [
    ...new Set(
      Object.values(ashes.weapons)
        .filter((info) => info.canChange && !ashNames.has(info.skill))
        .map((info) => info.skill),
    ),
  ].sort();
}

/**
 * Skills always followed up, so the picker only offers them with each follow-up (e.g. Spinning
 * Strikes with its R1 or R2), not on their own
 */
/**
 * Skills whose follow-up is its own way of using it, not something done after it: each is offered
 * alone (e.g. the Shield of Night's Revenge of the Night, or its guard counter's bigger hit alone:
 * tested in game, the counter doesn't also do the skill's own hit)
 */
const separateFollowUpSkills: ReadonlySet<string> = new Set(["Revenge of the Night"]);

const followUpOnlySkills: ReadonlySet<string> = new Set([
  "Ghostflame Call",
  "Ghostflame Ignition",
  "Shriek of Milos",
]);

/**
 * A skill's choices for the Ash of War picker (see getAshChoices). @param builtIn true for a weapon's
 * built-in skill, which only needs choices for its follow-ups (its main attack is what it uses
 * anyway), from its weapons' own versions too
 */
function getSkillChoices(
  ashes: Ashes,
  name: string,
  builtIn: boolean,
): { value: string; label: string }[] {
  // A skill that's one of the weapon's own attacks, which it has no data of its own for
  if (movesetSkills.has(name) && !ashes.skills[name]) return [{ value: name, label: name }];
  if (!doesDamage(ashes, name)) return [];
  const skill = ashes.skills[name];
  if (buffedR2Skills.has(name)) {
    const mains = [
      skill?.generic,
      ...Object.values(skill?.classes ?? {}),
      ...Object.values(skill?.unique ?? {}),
    ].flatMap((hits) => hits?.main ?? []);
    return mains.some(([motionValue, , , , details]) =>
      [motionValue, details?.flat].flat().some((value) => value != null && value > 0),
    )
      ? [{ value: name, label: name }]
      : [];
  }
  // Weapons' own versions count for built-in skills, and for Ashes of War that only have those
  // (e.g. Overhead Stance, only the Great Katana's)
  const shared = [skill?.generic, ...Object.values(skill?.classes ?? {})].filter(Boolean);
  const unique = builtIn || !shared.length;
  const versions = [...shared, ...(unique ? Object.values(skill?.unique ?? {}) : [])];
  const followUps = [
    ...new Set(versions.flatMap((hits) => hits?.followUps.map(({ label }) => label) ?? [])),
  ];
  if (chainSkills.has(name)) {
    const chains = [...new Set(followUps.map((label) => getChainStep(label)?.[0]))].filter(
      (chain) => chain != null,
    );
    return [
      ...chains.map((chain) => ({
        value: withFollowUp(name, `${chain}${chainSuffix}`),
        // A skill that's one chain (e.g. Double Slash) is just its name
        label: !chain
          ? name
          : versionChainSkills.has(name)
          ? `${name} (${chain})`
          : `${name} (${chain} chain)`,
      })),
      // A stance's follow-ups that aren't chain steps, e.g. Moon-and-Fire Stance's R2
      ...(isStance(ashes, name, unique)
        ? followUps
            .filter((followUp) => !getChainStep(followUp))
            .map((followUp) => ({
              value: withFollowUp(name, followUp),
              label: `${name} (${followUp})`,
            }))
        : []),
    ];
  }
  // A loop, and each of its follow-ups on its own
  if (isLoopSkill(ashes, name)) {
    return [
      ...(builtIn ? [] : [{ value: name, label: name }]),
      ...followUps.map((followUp) => ({
        value: withFollowUp(name, followUp),
        label: `${name} (${followUp} follow-up)`,
      })),
    ];
  }
  if (separateFollowUpSkills.has(name)) {
    return [
      ...(builtIn ? [] : [{ value: name, label: name }]),
      ...followUps.map((followUp) => ({
        value: withFollowUp(name, followUp),
        label: `${name} ${followUp}`,
      })),
    ];
  }
  if (isStance(ashes, name, unique)) {
    return followUps.map((followUp) => ({
      value: withFollowUp(name, followUp),
      // An unlabeled version is the skill itself, e.g. Euporia Vortex beside its Luster Tiers
      label: followUp ? `${name} (${followUp})` : name,
    }));
  }
  return [
    ...(builtIn || followUpOnlySkills.has(name) ? [] : [{ value: name, label: name }]),
    ...followUps.map((followUp) => ({
      value: withFollowUp(name, followUp),
      label: `${name} with ${followUp} follow-up`,
    })),
  ];
}

/** A version of a weapon's fixed skill, e.g. Moonveil's Transient Moonlight R2 */
export interface SkillVariant {
  /** The picker's label for it, e.g. "Transient Moonlight (R2)" */
  label: string;
  /** What sets it apart, e.g. "R2" */
  short: string;
}

/**
 * The attacks a weapon makes with the chosen Ash of War: one, or for a weapon with a fixed skill
 * that has several versions (e.g. Moonveil's R1 and R2), one for each, so they can be compared
 */
export function getAshAttacks(
  ashes: Ashes,
  movesets: Movesets,
  weapon: Weapon,
  choice: string,
  twoHanding: boolean,
  chainWeight = 0.5,
  sumChains = false,
): { ash: AshAttack; variant?: SkillVariant }[] {
  const build = (value: string) =>
    getAshAttack(ashes, movesets, weapon, value, twoHanding, chainWeight, sumChains);
  const chosen = build(choice);
  const info = ashes.weapons[weapon.weaponName];
  if (!info || info.canChange || !("attack" in chosen)) return [{ ash: chosen }];

  const skill = info.skill;
  const attackKey = (ash: AshAttack) =>
    "attack" in ash ? JSON.stringify([ash.attack.steps, ash.attack.weights]) : undefined;
  // Its follow-ups' and chains' versions it has, then its main attack if that isn't one of them
  const variants: { ash: AshAttack; variant: SkillVariant }[] = [];
  const seen = new Set<string>();
  for (const { value, label } of getSkillChoices(ashes, skill, true)) {
    const ash = build(value);
    const key = attackKey(ash);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    // A skill that's one chain is just its name
    const short =
      label
        .slice(skill.length)
        .trim()
        .replace(/^\((.*)\)$/, "$1") || skill;
    variants.push({ ash, variant: { label, short } });
  }
  if (!seen.has(attackKey(chosen)!) && !followUpOnlySkills.has(skill)) {
    variants.unshift({ ash: chosen, variant: { label: skill, short: skill } });
  }
  if (variants.length > 1) return variants;
  // One version is just the skill's name, or with its label if it has one
  const label = ashes.skills[skill]?.label;
  return [
    { ash: chosen, ...(label && { variant: { label: `${skill} (${label})`, short: label } }) },
  ];
}

/**
 * The skill a weapon uses with the chosen Ash of War, and its hits: the main attack counts, and
 * follow-ups are shown but not counted (weight 0)
 */
export function getAshAttack(
  ashes: Ashes,
  movesets: Movesets,
  weapon: Weapon,
  choice: string,
  twoHanding: boolean,
  /** For chains, how much each step counts relative to the one before it */
  chainWeight = 0.5,
  /** For chains, add up the steps rather than taking their weighted average */
  sumChains = false,
): AshAttack {
  const result = getSkillAttack(
    ashes,
    movesets,
    weapon,
    choice,
    twoHanding,
    chainWeight,
    sumChains,
  );
  // A skill can't be used at all without the weapon's requirements
  return "attack" in result
    ? { ...result, attack: { ...result.attack, needsRequirements: true } }
    : result;
}

/** getAshAttack, without needsRequirements */
function getSkillAttack(
  ashes: Ashes,
  movesets: Movesets,
  weapon: Weapon,
  choice: string,
  twoHanding: boolean,
  chainWeight: number,
  sumChains: boolean,
): AshAttack {
  const [ash, countedFollowUp] = parseAshChoice(choice);
  const info = ashes.weapons[weapon.weaponName];
  if (!info) return { unavailableReason: "No skill data" };

  // Weapons with a fixed skill always use it
  let skill: string;
  if (!info.canChange) {
    skill = info.skill;
  } else {
    const ashInfo = ashes.ashes.find((candidate) => candidate.name === ash);
    // A built-in skill that isn't an Ash of War (e.g. flails' Spinning Chain), on its own weapons:
    // only Standard (or ones that can't be infused, e.g. torches), since other affinities come from an
    // Ash of War that replaces it
    const ownBuiltIn = !ashInfo && info.skill === ash;
    if (ownBuiltIn && weapon.affinityId > 0) {
      return { unavailableReason: `Only Standard has ${ash}` };
    }
    if (
      !ownBuiltIn &&
      (!ashInfo ||
        !ashInfo.mounts.includes(weapon.weaponType) ||
        !ashInfo.affinities.includes(Math.max(weapon.affinityId, 0)))
    ) {
      return { unavailableReason: `Can't take ${ash}` };
    }
    skill = ash;
  }

  const movesetAttack = movesetSkills.get(skill);
  const weaponChain =
    movesetAttack &&
    getAttackData(movesets, weapon, movesetAttack, twoHanding, chainWeight, sumChains);
  if (weaponChain) {
    return {
      skill,
      attack: {
        ...weaponChain,
        stepLabels: weaponChain.steps.map((_, i) => (i ? `#${i + 1}` : `${skill} #1`)),
      },
    };
  }

  const hits = getSkillHits(ashes, skill, weapon);
  const hands = twoHanding ? "2h" : "1h";
  if (!hits || (!hits.main.length && !hits.followUps.length)) {
    // Shields', staves', and seals' default skill (SwordArtsParam 10)
    if (skill === "No Skill") return { unavailableReason: "No skill" };
    return { unavailableReason: `${skill} does no damage` };
  }

  const physicalType = (type: number): PhysicalType =>
    allPhysicalTypes[type >= 4 ? info.types[type - 4] : type] ?? "standard";
  const toHit = ([motionValue, statusMotionValue, poiseMotionValue, type, details]: AshHit) => {
    const hit: AttackDataHit = {
      ...(Array.isArray(motionValue)
        ? { motionValue: Math.max(...motionValue), motionValues: motionValue }
        : { motionValue }),
      statusMotionValue,
      poiseMotionValue,
      physicalType: physicalType(type),
    };
    if (details?.flat) hit.flatAttack = details.flat;
    if (details?.fixed) hit.fixedFlatAttack = true;
    if (details?.correct) hit.attackElementCorrect = details.correct;
    if (details?.noTwoHandBonus) hit.noTwoHandBonus = true;
    if (details?.kind) hit.kind = details.kind;
    if (details?.tick) hit.tickInterval = details.tickInterval ?? 0;
    if (details?.tickDuration) hit.tickDuration = details.tickDuration;
    if (details?.tickDelay) hit.tickDelay = details.tickDelay;
    if (details?.notCounted) hit.notCounted = true;
    if (details?.poise) hit.flatPoise = details.poise;
    if (details?.hpDamage) hit.hpDamage = details.hpDamage;
    if (details?.categories) hit.categories = details.categories;
    if (details?.status) hit.status = details.status;
    if (details?.scaledStatus) hit.scaledStatus = details.scaledStatus;
    if (details?.buffMotionValue != null) hit.buffMotionValue = details.buffMotionValue;
    if (details?.damageRates) hit.damageRates = details.damageRates;
    if (details?.buff) {
      const buffMotionValue = details.buffMotionValue ?? 100;
      hit.buffAttack = details.buff.map((value) => (value * buffMotionValue) / 100);
    }
    return hit;
  };

  // Hits that aren't counted (e.g. Promised Consort's small projectiles, which may miss) are left
  // out, and the first one's damage is shown in the note
  const countedHits = (stepHits: AshHit[]) => stepHits.filter((hit) => !hit[4]?.uncounted);
  const uncountedHit = [...hits.main, ...hits.followUps.flatMap((followUp) => followUp.hits)].find(
    (hit) => hit[4]?.uncounted,
  );
  const notedHit = uncountedHit && { notedHit: toHit(uncountedHit) };
  const followUps = hits.followUps.filter(
    (followUp) => !followUp.hands || followUp.hands === hands,
  );
  // A follow-up chosen with an Ash of War counts towards the total with the main attack. Fixed and
  // built-in skills don't use the chosen Ash of War, so they only count their main attack, or for a
  // stance (no main attack), its first follow-up.
  const counted = skill === ash ? countedFollowUp : undefined;
  // A skill whose R2s are the weapon's R2s with its buff is just its own attack unless one of those
  // chains is asked for (getBuffedR2Chain), which the buff picked applies to like any other attack
  const ownAttackOnly = buffedR2Skills.has(skill) && !counted?.endsWith(chainSuffix);
  if (
    ownAttackOnly &&
    !hits.main.some(([motionValue, , , , details]) =>
      [motionValue, details?.flat].flat().some((value) => value != null && value > 0),
    )
  ) {
    return {
      unavailableReason: `${skill} does no damage itself: pick its buff for its R2s`,
    };
  }
  const poiseBase = weapon.ammoPoise ?? movesets[weapon.weaponName]?.poise ?? 0;
  const skillRange = info.skillRange ?? 0;
  // Each call's timing, with its weapon's stamina rate
  const timingOf = (parts: SkillStepPart[]) =>
    withSkillTiming(hits, skillRange, parts, info.staminaRate, hands);
  // The skill's own weapon buff's flat attack (e.g. Sacred Blade's 90 holy), for the breakdown
  const skillBuff = [...hits.main, ...hits.followUps.flatMap((followUp) => followUp.hits)].find(
    ([, , , , details]) => details?.buff,
  )?.[4]?.buff;
  // The skill's own weapon buff replaces any other, e.g. a grease
  const ownBuff = {
    ...(skillBuff && { skillBuff }),
    ...((ashes.skills[skill]?.weaponBuff || hits.weaponBuff) &&
      !ownAttackOnly && { ownWeaponBuff: true }),
    ...((hits.note ?? ashes.skills[skill]?.note) && {
      note: hits.note ?? ashes.skills[skill]?.note,
    }),
    ...(!info.canChange && { fixedSkill: skill }),
  };

  // A chain skill's follow-up that isn't a chain step is chosen on its own, e.g. Moon-and-Fire
  // Stance's R2
  const ownFollowUp =
    !!counted && !counted.endsWith(chainSuffix) && followUps.some(({ label }) => label === counted);
  if (chainSkills.has(skill) && !ownFollowUp && !ownAttackOnly) {
    // A chain of follow-ups, e.g. War Cry's buffed R2s, weighted towards the first like other chains
    // Built-in skills (and choices from earlier versions) use the first chain
    const chain = counted?.endsWith(chainSuffix)
      ? counted.slice(0, -chainSuffix.length)
      : getChainStep(hits.followUps[0]?.label ?? "")?.[0] ?? "R2";
    const steps = followUps
      .map((followUp) => ({ followUp, step: getChainStep(followUp.label) }))
      .filter(({ step }) => step?.[0] === chain)
      .sort((a, b) => a.step![1] - b.step![1])
      .map(({ followUp }) => followUp);
    if (!steps.length) {
      // e.g. Braggart's Roar only changes two handed R2s
      const otherHands = hits.followUps.find(
        (followUp) => followUp.hands && getChainStep(followUp.label)?.[0] === chain,
      )?.hands;
      return {
        unavailableReason: otherHands
          ? `${otherHands === "2h" ? "Two" : "One"} handed only`
          : `No ${chain} chain for ${skill}`,
      };
    }
    // The buff's physical attack power multiplier is the same as multiplying physical motion values
    const buff = chainBuffs[skill];
    const toBuffedHit = (hit: AshHit) => {
      const result = toHit(hit);
      if (!buff) return result;
      const motionValues = [
        ...(result.motionValues ?? allDamageTypes.map(() => result.motionValue)),
      ];
      motionValues[AttackPowerType.PHYSICAL] *= buff.physicalRate;
      return { ...result, motionValue: Math.max(...motionValues), motionValues };
    };
    const rawWeights = steps.map((_, i) => chainWeight ** i);
    const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
    return {
      skill,
      attack: {
        steps: steps.map((followUp) => countedHits(followUp.hits).map(toBuffedHit)),
        weights: sumChains ? steps.map(() => 1) : rawWeights.map((weight) => weight / totalWeight),
        chain: true,
        stepLabels: steps.map((followUp, i) =>
          i === 0 ? `${skill} ${followUp.label}` : followUp.label,
        ),
        poiseBase,
        ...ownBuff,
        ...notedHit,
        // The chain has its skill's buff, which replaces other weapon buffs (War Cry's on the weapon)
        ...(buff && { ownWeaponBuff: true }),
        ...(buff?.scaling && { scalingBonus: buff.scaling }),
        // Some chains go back to a later step, not the first
        ...(chainRepeatSteps[skill] != null && { repeatFrom: chainRepeatSteps[skill]! - 1 }),
        // Each step goes on to the next with another skill
        // (a buffed R2 chain's with R2s, like the weapon's own R2s)
        ...timingOf(
          steps.map(({ label }) =>
            buffedR2Skills.has(skill)
              ? { label, next: "R2" as const, repeat: "R2" as const }
              : { label, next: "L2" as const },
          ),
        ),
      },
    };
  }

  const followUp = counted
    ? followUps.find(({ label }) => label === counted)
    : !hits.main.length
    ? followUps[0]
    : undefined;
  if (counted && !followUp) {
    return { unavailableReason: `No ${counted} follow-up to ${skill}` };
  }
  // The chosen follow-up's note, e.g. that it can hit more than counted
  const followUpNote = followUp?.note && { note: followUp.note };
  if (!hits.main.length) {
    // A stance's attack is its follow-up, after the weapon's own attack it's named after for some (the
    // first, e.g. "R2 / Running R2")
    const attackName = followUp!.label.split(" / ")[0];
    const weaponAttack =
      weaponAttackSkills.has(skill) && (allAttacks as readonly string[]).includes(attackName)
        ? getAttackData(movesets, weapon, attackName as AttackName, twoHanding, chainWeight)
        : undefined;
    const weaponHits = (weaponAttack?.steps[0] ?? []).map((hit) => ({
      ...hit,
      ...(skillBuff && {
        buffAttack: skillBuff.map((value) => (value * (hit.buffMotionValue ?? 100)) / 100),
      }),
    }));
    return {
      skill,
      attack: {
        steps: [[...weaponHits, ...countedHits(followUp!.hits).map(toHit)]],
        weights: [1],
        stepLabels: [`${skill} ${followUp!.label}`],
        poiseBase,
        ...ownBuff,
        ...notedHit,
        ...followUpNote,
        // A weapon attack it's added to has that attack's first step's timing (repeated as the
        // weapon's attack is, e.g. the Serpent Flail's R2 at its R2 cancel); or else the skill's own
        // animation's (repeated with its button where it's the weapon's attack with the skill's
        // buff, e.g. Golden Tempering's R2s)
        ...(weaponAttack?.stepTimes?.[0] && {
          stepTimes: [weaponAttack.stepTimes[0]],
          ...(weaponAttack.cycleTimes && { cycleTimes: [weaponAttack.cycleTimes[0]!] }),
          ...(weaponAttack.stamina && { stamina: [weaponAttack.stamina[0] ?? 0] }),
        }),
        ...(!weaponAttack &&
          timingOf([
            {
              label: followUp!.label,
              ...(buffedAttackSkills.has(skill) && { repeat: "R2" as const }),
            },
          ])),
      },
    };
  }
  // A loop's follow-up is on its own: how many passes come before it is up to the player
  if (followUp && (isLoopSkill(ashes, skill) || separateFollowUpSkills.has(skill))) {
    return {
      skill,
      attack: {
        steps: [countedHits(followUp.hits).map(toHit)],
        weights: [1],
        stepLabels: [`${skill} ${followUp.label}`],
        poiseBase,
        ...ownBuff,
        ...notedHit,
        ...followUpNote,
        ...timingOf([{ label: followUp.label, noRepeat: true }]),
      },
    };
  }
  // Only what counts is shown: the main attack, and the chosen follow-up, as a chain (weighted the
  // same way, or added up)
  return {
    skill,
    attack: {
      steps: [
        countedHits(hits.main).map(toHit),
        ...(followUp ? [countedHits(followUp.hits).map(toHit)] : []),
      ],
      weights: !followUp
        ? [1]
        : sumChains
        ? [1, 1]
        : [1 / (1 + chainWeight), chainWeight / (1 + chainWeight)],
      ...(followUp && { chain: true }),
      stepLabels: [skill, ...(followUp ? [followUp.label] : [])],
      poiseBase,
      ...ownBuff,
      ...notedHit,
      ...followUpNote,
      // The main attack goes on to the follow-up with its button
      ...timingOf(
        followUp
          ? [{ label: "", next: getFollowUpButton(followUp.label) }, { label: followUp.label }]
          : [{ label: "" }],
      ),
    },
  };
}

let ashesPromise: Promise<Ashes> | undefined;

/**
 * Loads the Ash of War data
 */
export default function useAshes() {
  const [ashes, setAshes] = useState<Ashes>(emptyAshes);
  useEffect(() => {
    ashesPromise ??= fetch("/ashes.json").then((res) => res.json());
    ashesPromise.then(setAshes).catch(() => setAshes(emptyAshes));
  }, []);
  return ashes;
}
