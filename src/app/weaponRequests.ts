import {
  allDamageTypes,
  WeaponType,
  type Attribute,
  type Attributes,
} from "../calculator/calculator.ts";
import type { Weapon } from "../calculator/weapon.ts";
import { getWeaponUpgradeLevel, type BuffEffect, type BuildRequest } from "../optimizer/build.ts";
import type { Limits } from "../optimizer/limits.ts";
import type { AmmoGroup } from "./useAmmo.ts";
import { getAmmoKey, weaponTypeAmmoClasses, withAmmo } from "./useAmmo.ts";
import { minEquipWeight, type AppState, type Grip } from "./useAppState.ts";
import {
  ashAttack,
  buffedR2Skills,
  fixedSkillsChoice,
  getAshAttack,
  getAshAttacks,
  getSkillUpkeep,
  weaponAttackSkills,
  withFollowUp,
  type AshAttack,
  type Ashes,
  type SkillVariant,
} from "./useAshes.ts";
import { isBuffable, type Buffable } from "./useBuffable.ts";
import { getBuffEffects, isWeaponOnlyBuff, type Buff } from "./useBuffs.ts";
import {
  canTwoHand,
  getAttackData,
  tooSlowReason,
  withOffhandRows,
  type ChainLimit,
  type Movesets,
} from "./useMovesets.ts";
import { getPinKey, type RowChoice } from "./pins.ts";
import { catalystTypes, uniqueAffinityId } from "./uiUtils.ts";

/*
 * Building the optimizer's requests from the settings: a weapon's rows (one per attack, skill,
 * skill version, upgrade level, and grip), and the table's for every weapon picked. Plain functions
 * (App memoizes them), so they can be tested without React.
 */
/** Skills that apply an enemy debuff, which is picked separately (in the enemy debuffs), by name */
const skillDebuffs: Partial<Record<string, string>> = { "Shriek of Milos": "Shriek of Milos" };

/** A row's grip, in its name when it has a row with the other grip */
const gripLabel = (twoHanding: boolean) => (twoHanding ? "2H" : "1H");

/** Between a row's weapon and its attack in its name (non-breaking; RowName lets it wrap) */
export const labelSeparator = "\u00a0·\u00a0";

/** An attack's label with its grip before it, e.g. "2H R1" (kept together) */
export const withGrip = (label: string, twoHanding: boolean) =>
  [gripLabel(twoHanding), label].filter(Boolean).join("\u00a0");

/** A request with its grip in its row's name, before its attack */
function withGripLabel(request: BuildRequest): BuildRequest {
  if (!request.row) return request;
  const [name, ...label] = request.row.name.split(labelSeparator);
  const labeled = {
    ...request,
    row: {
      ...request.row,
      name: [name, withGrip(label.join(labelSeparator), request.twoHanding)].join(labelSeparator),
    },
  };
  if (shownReasonRequests.has(request)) shownReasonRequests.add(labeled);
  return labeled;
}

const alwaysTwoHandedTypes: readonly WeaponType[] = [
  WeaponType.LIGHT_BOW,
  WeaponType.BOW,
  WeaponType.GREATBOW,
  WeaponType.BALLISTA,
];

/** @returns true if any of a weapon's damage types scales with Strength */
const scalesWithStrength = (weapon: Weapon) =>
  weapon.attributeScaling.some((scaling) => scaling.str) &&
  allDamageTypes.some((type) => weapon.attackElementCorrect[type]?.str);

/** The attack subcategory of two handed attacks, which some buffs only apply to */
const twoHandedCategory = 120;

/**
 * @returns true if a row works out the same two handed as one handed: it can't be two handed, or
 * it has the same attack (besides being marked a two handed attack, unless a buff only applies to
 * those, or its hits not getting the bonus) and two handing's Strength bonus makes no difference: a paired weapon or bow, which never
 * or always get it, or one whose Strength requirement is already met (the bonus counts towards it
 * even for hits that don't get it) and whose hits don't scale with Strength or don't get the bonus
 */
function sameWithEitherGrip(oneHanded: BuildRequest, twoHanded: BuildRequest) {
  if (!twoHanded.twoHanding) return true;
  if (oneHanded.unavailableReason !== twoHanded.unavailableReason) return false;
  const categoryCounts = twoHanded.buffs?.some((effect) =>
    effect.categories?.includes(twoHandedCategory),
  );
  const attackKey = (attack: BuildRequest["attack"]) =>
    JSON.stringify(attack, (key, value: unknown) => {
      // (only two handed hits are marked as not getting the bonus, e.g. critical hits; checked below)
      if (key === "noTwoHandBonus") return undefined;
      if (key !== "categories" || categoryCounts || !Array.isArray(value)) return value;
      const categories = value.filter((category) => category !== twoHandedCategory);
      return categories.length ? categories : undefined;
    });
  if (attackKey(oneHanded.attack) !== attackKey(twoHanded.attack)) return false;
  const { weapon, attack, attributes, bonusAttributes } = twoHanded;
  if (weapon.paired || alwaysTwoHandedTypes.includes(weapon.weaponType)) return true;
  // (stats only go up from the planned ones)
  const requirementMet = attributes.str + bonusAttributes.str >= (weapon.requirements.str ?? 0);
  // (a hit's own scaling is for its flat attack, besides the weapon's for its motion value)
  const usesBonus = attack
    ? attack.steps.some((step) =>
        step.some(
          (hit) =>
            !hit.noTwoHandBonus &&
            (scalesWithStrength(weapon) ||
              Object.values(hit.attackElementCorrect ?? {}).some((correct) => correct?.str)),
        ),
      )
    : scalesWithStrength(weapon);
  return requirementMet && !usesBonus;
}

/**
 * A weapon's name with its upgrade level, on its own scale (e.g. +10 for a somber weapon), kept
 * together so the level doesn't wrap onto a line alone
 */
export const withUpgradeLevel = (
  weapon: Weapon | undefined,
  name: string,
  regularUpgradeLevel: number,
) =>
  `${name}\u00a0+${
    weapon ? getWeaponUpgradeLevel(weapon, regularUpgradeLevel) : regularUpgradeLevel
  }`;

/**
 * Weapons that also powerstance with another weapon type, in the left hand only or either hand
 * (exceptions in the game; their own attack rows for it are in its data, see withOffhandRows): the
 * Wakizashi with katanas (tested in game with an Uchigatana), the Main-gauche with thrusting swords
 * (tested with a Rapier), and the Pickaxe, a Great Hammer with greataxes' animations
 * (wepmotionCategory 32), with greataxes (tested with the Rusted Anchor)
 */
const powerstanceExceptions: { weapon: string; weaponType: WeaponType; leftHandOnly?: true }[] = [
  { weapon: "Wakizashi", weaponType: WeaponType.KATANA, leftHandOnly: true },
  { weapon: "Main-gauche", weaponType: WeaponType.THRUSTING_SWORD, leftHandOnly: true },
  { weapon: "Pickaxe", weaponType: WeaponType.GREATAXE },
];

/**
 * @returns true if a weapon in the right hand powerstances with one in the left: the same weapon
 * type, unless it's paired, or one of the exceptions (powerstanceExceptions)
 */
function powerstancesWith(main: Weapon, offhand: Weapon) {
  if (main.paired) return false;
  return (
    main.weaponType === offhand.weaponType ||
    powerstanceExceptions.some(
      ({ weapon, weaponType, leftHandOnly }) =>
        (offhand.weaponName === weapon && main.weaponType === weaponType) ||
        (!leftHandOnly && main.weaponName === weapon && offhand.weaponType === weaponType),
    )
  );
}

// Requests for an attack a weapon has but that can't be used here (e.g. too slow to roll in time,
// or a skill that does no damage), shown in its row with the reason rather than left out
const shownReasonRequests = new WeakSet<BuildRequest>();

/** The settings and game data a weapon's requests are built from (App works most of them out) */
export interface WeaponRequestContext
  extends Pick<
    AppState,
    | "chainWeight"
    | "sumChains"
    | "physicalNegation"
    | "criticalDamageRate"
    | "stanceDamageRate"
    | "enemyTypes"
    | "offhandUpgradeLevel"
    | "catalystUpgradeLevel"
    | "equipWeight"
    | "stackTier"
    | "health"
    | "objective"
    | "limits"
    | "fastMode"
    | "meetRequirements"
  > {
  movesets: Movesets;
  buffable: Buffable;
  ashes: Ashes;
  /** Chains cut short, if set */
  limit: ChainLimit | undefined;
  /** The enemy's HP, for damage that's a percentage of it, if known */
  countedEnemyHp: number | undefined;
  scadutreeBlessingRate: number;
  /** The powerstance off hand weapon, if picked */
  offhandWeaponData: Weapon | undefined;
  offhandBuffEffects: BuffEffect[];
  /** Each row's name says which attack or skill it is */
  showRowLabels: boolean;
  /** Each skill choice's label */
  ashLabels: ReadonlyMap<string, string>;
  bonusAttributes: Attributes;
  classAttributes: Attributes;
  selectedBuffs: readonly Buff[];
  catalyst: Weapon | undefined;
  castingRequirements: Partial<Record<Attribute, number>> | undefined;
  /** False for spell scaling, which doesn't use an attack */
  attackActive: boolean;
  enemyDefenses: BuildRequest["defenses"];
  planLevel: number;
  planAttributes: Attributes;
  /** The current character level */
  startLevel: number;
  buffEffects: BuffEffect[];
  offhandBuff: Buff | undefined;
  weaponBuff: Buff | undefined;
  weaponBuffEffects: BuffEffect[];
  uniqueSkills: Buff | undefined;
  oneHandedBuffs: Buff[];
  /** Weapons' passives, by weapon name */
  passives: ReadonlyMap<string, Buff>;
}

/**
 * @returns the damage multipliers a ranged weapon's ammunition gets from the off-hand weapon's
 * passive, e.g. a second Lion Greatbow's ×1.2 physical for Radahn's Spears (the firing weapon's own
 * is in its damageMultipliers)
 */
export function getAmmoOffhandEffects(
  weapon: Weapon,
  offhandName: string | undefined,
): BuffEffect[] {
  const multipliers = offhandName && weapon.ammoOffhandMultipliers?.[offhandName];
  return multipliers
    ? [{ damageRates: allDamageTypes.map((damageType) => multipliers[damageType] ?? 1) }]
    : [];
}

/**
 * The picked buffs, split by what they apply to: all weapons, the weapon buff for other weapons,
 * weapons' own skills', and the off hand weapon's passive
 */
export function getBuffSelection(
  selectedBuffs: readonly Buff[],
  stackTier: AppState["stackTier"],
  health: number,
) {
  // Buffs for particular weapons (their own skills', e.g. Golden Tempering, and Euporia's luster
  // tiers), together
  const weaponBuffs = selectedBuffs.filter((buff) => buff.weapons);
  const uniqueSkills = weaponBuffs.length
    ? {
        ...weaponBuffs[0],
        weapons: weaponBuffs.reduce<NonNullable<Buff["weapons"]>>((all, buff) => {
          for (const [name, effects] of Object.entries(buff.weapons!)) {
            all[name] = [...(all[name] ?? []), ...effects];
          }
          return all;
        }, {}),
      }
    : undefined;
  // The weapon buff for other weapons (an Ash of War's, e.g. Sacred Blade, can also be some
  // weapons' own skill's)
  const weaponBuff = selectedBuffs.find(
    (buff) => buff.type === "weapon" && !isWeaponOnlyBuff(buff),
  );
  return {
    buffEffects: getBuffEffects(
      selectedBuffs.filter((buff) => buff.type !== "weapon" && buff.kind !== "offhand"),
      stackTier,
      health,
    ),
    offhandBuff: selectedBuffs.find((buff) => buff.kind === "offhand"),
    weaponBuff,
    weaponBuffEffects: weaponBuff ? getBuffEffects([weaponBuff], stackTier, health) : [],
    uniqueSkills,
    oneHandedBuffs: selectedBuffs.filter((buff) => buff.oneHanded),
  };
}

/**
 * The requests for one weapon with an attack (each version of a fixed skill that has several is its
 * own), with the other settings: for the table's weapons with the chosen attack, and for each
 * pinned row with its own
 */
export function getWeaponRequestBuilder(context: WeaponRequestContext) {
  const {
    movesets,
    buffable,
    ashes,
    chainWeight,
    sumChains,
    limit,
    physicalNegation,
    countedEnemyHp,
    criticalDamageRate,
    stanceDamageRate,
    enemyTypes,
    scadutreeBlessingRate,
    offhandWeaponData,
    offhandUpgradeLevel,
    offhandBuffEffects,
    showRowLabels,
    ashLabels,
    bonusAttributes,
    classAttributes,
    buffEffects,
    selectedBuffs,
    weaponBuff,
    weaponBuffEffects,
    uniqueSkills,
    oneHandedBuffs,
    passives,
    offhandBuff,
    catalyst,
    catalystUpgradeLevel,
    castingRequirements,
    equipWeight,
    stackTier,
    health,
    objective,
    attackActive,
    enemyDefenses,
    limits,
    fastMode,
    meetRequirements,
    planLevel,
    planAttributes,
    startLevel,
  } = context;
  const { maxLevels, minGain, targetValue, targetPotential, minPotentialPerRemainingLevel } =
    limits;
  const levelLimit = maxLevels.enabled ? maxLevels.values[maxLevels.mode] : null;
  const enabledLimits: Limits = {
    // Additional levels count from the current or planned level, whichever is higher, but the
    // optimizer counts from the plan
    maxLevels:
      levelLimit != null && maxLevels.mode !== "runes"
        ? Math.max(
            0,
            (maxLevels.mode === "absolute"
              ? levelLimit
              : Math.max(startLevel, planLevel) + levelLimit) - planLevel,
          )
        : null,
    // Fast mode only calculates where the level limit stops, so these don't apply
    minGainPerLevel: minGain.enabled && !minGain.relative && !fastMode ? minGain.value : null,
    minRelativeGainPerLevel:
      minGain.enabled && minGain.relative && !fastMode ? minGain.value : null,
    runeBudget: levelLimit != null && maxLevels.mode === "runes" ? levelLimit : null,
    targetValue: targetValue.enabled && !fastMode ? targetValue.value : null,
    targetPotential: targetPotential.enabled && !fastMode ? targetPotential.value : null,
    minPotentialPerRemainingLevel:
      minPotentialPerRemainingLevel.enabled && !fastMode
        ? minPotentialPerRemainingLevel.value
        : null,
  };

  return (
    weapon: Weapon,
    unavailableReason: string | undefined,
    choice: RowChoice,
  ): BuildRequest[] => {
    const { attack, ashOfWar, upgradeLevel, twoHanding } = choice;
    // Two handing doesn't apply to weapons that can't be two handed
    const weaponTwoHanding =
      twoHanding &&
      !oneHandedBuffs.some((buff) => buff.skillOf !== weapon.weaponName) &&
      canTwoHand(movesets, weapon, attack);
    const uniqueSkillEffects = uniqueSkills?.weapons?.[weapon.weaponName];
    const ashInfo =
      weaponBuff?.kind === "skill" && ashes.ashes.find((ash) => ash.name === weaponBuff.name);
    const weaponBuffApplies =
      weaponBuff?.kind === "skill"
        ? !!ashes.weapons[weapon.weaponName]?.canChange &&
          !!ashInfo &&
          ashInfo.mounts.includes(weapon.weaponType) &&
          ashInfo.affinities.includes(weapon.affinityId)
        : !!weaponBuff && isBuffable(buffable, weapon);
    // The weapon's own motion values for the chosen attack, or its skill: each version of a
    // fixed skill that has several (e.g. Moonveil's R1 and R2) is its own result
    const skillAttacks: { ash?: AshAttack; variant?: SkillVariant }[] = !attackActive
      ? [{ ash: undefined }]
      : attack === ashAttack && !unavailableReason
      ? getAshAttacks(
          ashes,
          movesets,
          weapon,
          ashOfWar,
          weaponTwoHanding,
          chainWeight,
          sumChains,
          limit,
        )
      : attack === ashAttack
      ? [
          {
            ash: getAshAttack(
              ashes,
              movesets,
              weapon,
              ashOfWar,
              weaponTwoHanding,
              chainWeight,
              sumChains,
              limit,
            ),
          },
        ]
      : [{ ash: undefined }];
    // With a skill's buff picked that changes the weapon's R2s while it lasts (e.g. War Cry, or the
    // Dark Moon Greatsword's own Moonlight Greatsword), its R2s are the skill's chains, which have
    // the buff: its own skill's on a weapon with a fixed skill, or a picked Ash of War's the weapon
    // can take
    const fixedSkill = ashes.weapons[weapon.weaponName]?.skill;
    const r2Skill =
      uniqueSkillEffects && fixedSkill
        ? fixedSkill
        : weaponBuff?.kind === "skill" && weaponBuffApplies && buffedR2Skills.has(weaponBuff.name)
        ? weaponBuff.name
        : undefined;
    // (or for a skill that changes the weapon's own attacks, e.g. Flare, O Serpent's R2s, that
    // attack with the skill's hits added)
    const skillChain =
      attackActive && r2Skill && attack !== ashAttack && attack !== "Standard Shot"
        ? getAshAttack(
            ashes,
            movesets,
            weapon,
            withFollowUp(r2Skill, `${attack} chain`),
            weaponTwoHanding,
            chainWeight,
            sumChains,
            limit,
          )
        : undefined;
    const uniqueSkillChain =
      skillChain &&
      "attack" in skillChain &&
      (skillChain.attack.chain || weaponAttackSkills.has(r2Skill!))
        ? skillChain.attack
        : undefined;
    // A weapon's own skill's buff that has to be cast again when it runs out (e.g. Flare, O
    // Serpent's), picked: all its attacks spend some time casting it
    const upkeep =
      uniqueSkillEffects && fixedSkill
        ? getSkillUpkeep(ashes, weapon.weaponName, fixedSkill)
        : undefined;
    // (its buffed chain too slow for the time to dodge, the weapon's own unbuffed ones aren't used)
    const skillChainTooSlow =
      !!skillChain &&
      "unavailableReason" in skillChain &&
      skillChain.unavailableReason === tooSlowReason;
    return skillAttacks.map(({ ash, variant }): BuildRequest => {
      const chosenAttackData = !attackActive
        ? undefined
        : ash && "attack" in ash
        ? ash.attack
        : attack === ashAttack
        ? undefined
        : uniqueSkillChain ??
          (skillChainTooSlow
            ? undefined
            : getAttackData(
                movesets,
                weapon,
                attack,
                weaponTwoHanding,
                chainWeight,
                sumChains,
                limit,
              ));
      // A skill's enemy debuff is picked separately, so it's noted when it isn't
      const debuffName = chosenAttackData?.fixedSkill && skillDebuffs[chosenAttackData.fixedSkill];
      // (not the attacks it changes, which already cast it each time)
      const withUpkeep =
        chosenAttackData &&
        upkeep &&
        !chosenAttackData.upkeep &&
        !(chosenAttackData === uniqueSkillChain && weaponAttackSkills.has(r2Skill!))
          ? { ...chosenAttackData, upkeep }
          : chosenAttackData;
      const attackData =
        withUpkeep &&
        debuffName &&
        !selectedBuffs.some((buff) => buff.kind === "debuff" && buff.name === debuffName)
          ? {
              ...withUpkeep,
              note: [
                withUpkeep.note,
                `Doesn't count the ${debuffName} enemy debuff the skill applies: pick it in the enemy debuffs`,
              ]
                .filter(Boolean)
                .join(". "),
            }
          : withUpkeep;
      // The skill the attack is, if any: the chosen skill, or the one whose R2s these are
      const attackSkill =
        ash && "attack" in ash
          ? ash.skill
          : chosenAttackData && chosenAttackData === uniqueSkillChain
          ? r2Skill
          : undefined;
      // A powerstance attack with an off hand weapon it powerstances with (not a paired weapon,
      // which is both)
      const offhand =
        attack.startsWith("Powerstance") && offhandWeaponData ? offhandWeaponData : undefined;
      const offhandMismatch = !!offhand && !powerstancesWith(weapon, offhand);
      const usesOffhand = !!offhand && !offhandMismatch;
      // Weapon buffs on the main weapon only apply to its own hits then
      const mainHand = (effects: BuffEffect[]) =>
        usesOffhand ? effects.map((effect) => ({ ...effect, hand: "main" as const })) : effects;
      // A weapon's own skill's buff (picked by the skill's name), or a chosen skill that puts its
      // own weapon buff on the weapon (e.g. Sacred Blade), replaces the chosen weapon buff
      const ownWeaponBuff = !!uniqueSkillEffects || !!attackData?.ownWeaponBuff;
      // A short weapon buff spell (e.g. Black Flame Blade) is cast again whenever it runs out
      const buffUpkeep = weaponBuffApplies && !ownWeaponBuff ? weaponBuff?.upkeep : undefined;
      const upkeptAttackData =
        attackData && buffUpkeep ? { ...attackData, buffUpkeep } : attackData;
      // Named with its attack: the attack, or the skill's name (and its grip, added by the
      // table's rows if it has a row with the other grip)
      const label = !showRowLabels
        ? undefined
        : attack !== ashAttack
        ? attack
        : variant?.label ?? attackData?.fixedSkill ?? ashLabels.get(ashOfWar) ?? "Skill";
      const name = withUpgradeLevel(weapon, weapon.name, upgradeLevel);
      const request: BuildRequest = {
        unavailableReason:
          unavailableReason ??
          (offhandMismatch ? `Doesn't powerstance with ${offhand.name}` : undefined) ??
          (ash && "unavailableReason" in ash ? ash.unavailableReason : undefined) ??
          (!attackActive || attackData
            ? undefined
            : attack === "R1" && catalystTypes.includes(weapon.weaponType)
            ? "A catalyst's R1 casts spells: its melee strikes are its R2"
            : attack === "Mounted R1/L1" && catalystTypes.includes(weapon.weaponType)
            ? "A catalyst's mounted R1 casts spells: its mounted melee strikes are its mounted R2"
            : limit &&
              "seconds" in limit &&
              attack !== ashAttack &&
              getAttackData(movesets, weapon, attack, weaponTwoHanding, chainWeight, sumChains)
            ? tooSlowReason
            : `No ${attack} for this weapon`),
        // The left hand weapon's hits use its own attack rows
        attack:
          usesOffhand && upkeptAttackData
            ? withOffhandRows(upkeptAttackData, movesets, weapon.weaponName, offhand.weaponName)
            : upkeptAttackData,
        physicalNegation,
        enemyHp: countedEnemyHp,
        criticalDamageRate,
        stanceDamageRate,
        enemyTypes,
        scadutreeBlessingRate,
        // A weapon with a unique skill that can also be buffed (the Bonny Butchering Knife) only
        // gets the skill's buff, since they replace each other in game
        buffs: [
          ...buffEffects,
          ...getBuffEffects(
            [
              ...new Set(
                [passives.get(weapon.weaponName), offhandBuff].filter((buff) => buff != null),
              ),
            ],
            stackTier,
            health,
          ),
          // A passive for the ammunition (the Lion Greatbow's for Radahn's Spears) counts from
          // each hand, unlike other passives
          ...getAmmoOffhandEffects(weapon, offhandBuff?.name),
          ...mainHand(weaponBuffApplies && !ownWeaponBuff ? weaponBuffEffects : []),
          // A skill attack that carries its own buff (the Moonlight Greatsword's swings) already
          // has it
          ...mainHand(
            uniqueSkillEffects && !attackData?.ownWeaponBuff
              ? getBuffEffects(
                  [{ ...uniqueSkills!, effects: uniqueSkillEffects }],
                  stackTier,
                  health,
                )
              : [],
          ),
          ...(usesOffhand ? offhandBuffEffects : []),
        ],
        ...(usesOffhand && {
          offhand: {
            weapon: offhand,
            regularUpgradeLevel: offhandUpgradeLevel,
            stanceBase: movesets[offhand.weaponName]?.stance ?? 0,
          },
        }),
        // Unless the skill's buff is the one picked, e.g. War Cry's R2s with War Cry
        ...(ownWeaponBuff &&
          weaponBuffApplies &&
          attackSkill !== weaponBuff?.name && {
            buffNote: "Only its skill's weapon buff applies, since it replaces other weapon buffs",
          }),
        // A weapon buff spell needs its catalyst's and its own requirements to cast
        ...(weaponBuffApplies &&
          !ownWeaponBuff &&
          castingRequirements && { catalyst, catalystUpgradeLevel, castingRequirements }),
        // Saved settings from before the minimum may be lower
        equipWeight: Math.max(equipWeight, minEquipWeight),
        weapon,
        regularUpgradeLevel: upgradeLevel,
        twoHanding: weaponTwoHanding,
        startLevel: planLevel,
        currentLevel: startLevel,
        attributes: planAttributes,
        classAttributes,
        bonusAttributes,
        objective,
        defenses: enemyDefenses,
        limits: enabledLimits,
        meetRequirements,
        fast: fastMode,
        ...(variant && { skillVariant: variant }),
        row: {
          id: getPinKey(weapon.name, variant?.short, choice),
          // (the results table and chart wrap it after the dot; see RowName)
          name: label ? name + labelSeparator + label : name,
        },
      };
      if (
        offhandMismatch ||
        (ash && "unavailableReason" in ash && ash.shown) ||
        request.unavailableReason === tooSlowReason
      ) {
        shownReasonRequests.add(request);
      }
      return request;
    });
  };
}

/** The picked weapons, attacks, and skills, for the table's requests */
export interface TableRequestInput
  extends Pick<
    AppState,
    "affinityIds" | "selectedAmmo" | "onlyBuffable" | "weaponTypes" | "grips"
  > {
  weapons: readonly Weapon[];
  /** The weapons picked by name that exist */
  validSelectedWeapons: readonly string[];
  ammo: readonly AmmoGroup[];
  buffable: Buffable;
  ashes: Ashes;
  getWeaponRequests: ReturnType<typeof getWeaponRequestBuilder>;
  attackActive: boolean;
  /** The picked attacks that are choices */
  attacks: AppState["attacks"];
  /** The picked skills that are choices */
  ashesOfWar: readonly string[];
  /** The picked upgrade levels, each once, lowest first */
  upgradeLevels: readonly number[];
}

/**
 * @returns the table's requests: every picked weapon's rows, and whether a weapon was left out
 * because it has none of the chosen attacks or skills
 */
export function getTableRequests(input: TableRequestInput) {
  const {
    weapons,
    validSelectedWeapons,
    affinityIds,
    ammo,
    selectedAmmo,
    buffable,
    ashes,
    onlyBuffable,
    weaponTypes,
    getWeaponRequests,
    attackActive,
    attacks,
    ashesOfWar,
    upgradeLevels,
    grips,
  } = input;
  const selected = new Set(validSelectedWeapons);
  const selectedWeaponTypes = new Set(weaponTypes);
  const selectedAffinityIds = new Set(affinityIds);

  const weaponsInSelection = weapons.filter(
    ({ weaponName, weaponType, affinityId, sorceryTool, incantationTool }) => {
      // Weapons picked by name are included in each selected affinity, or as themselves if
      // they can't be infused
      if (
        selected.has(weaponName) &&
        (affinityId === uniqueAffinityId || selectedAffinityIds.has(affinityId))
      ) {
        return true;
      }
      // Weapons of a checked type are included if their affinity (including Unique) is
      // selected. Weapons that can cast count as staves or seals, like in the original
      // calculator. Ones that can't be infused but take Ashes of War (e.g. bows, staves, and
      // torches) count as Standard too.
      const takesAshes = affinityId === uniqueAffinityId && !!ashes.weapons[weaponName]?.canChange;
      return (
        (selectedWeaponTypes.has(weaponType) ||
          (sorceryTool && selectedWeaponTypes.has(WeaponType.GLINTSTONE_STAFF)) ||
          (incantationTool && selectedWeaponTypes.has(WeaponType.SACRED_SEAL))) &&
        (selectedAffinityIds.has(affinityId) || (takesAshes && selectedAffinityIds.has(0)))
      );
    },
  );
  const visibleWeapons = onlyBuffable
    ? weaponsInSelection.filter((weapon) => isBuffable(buffable, weapon))
    : weaponsInSelection;

  // Weapons picked by name that can't be buffed in any selected affinity are listed rather than
  // silently left out
  const unbuffableWeapons = onlyBuffable
    ? validSelectedWeapons.flatMap((name) => {
        const versions = weaponsInSelection.filter(({ weaponName }) => weaponName === name);
        if (versions.length === 0 || versions.some((weapon) => isBuffable(buffable, weapon))) {
          return [];
        }
        const unique = versions[0].affinityId === uniqueAffinityId;
        return [
          {
            weapon: versions[0],
            unavailableReason: unique ? "Can't be buffed" : "Can't be buffed in these affinities",
          },
        ];
      })
    : [];

  // Ranged weapons are calculated once for each selected ammunition they can fire, and not at
  // all without any
  const selectedAmmoGroups = ammo.filter((group) => selectedAmmo.includes(getAmmoKey(group)));
  const weaponsWithAmmo = visibleWeapons.flatMap(
    (
      weapon,
    ): {
      weapon: Weapon;
      unavailableReason?: string;
    }[] => {
      const ammoClass = weaponTypeAmmoClasses.get(weapon.weaponType);
      if (!ammoClass) return [{ weapon }];
      const groups = selectedAmmoGroups.filter((group) => group.class === ammoClass);
      return groups.length > 0
        ? groups.map((group) => ({ weapon: withAmmo(weapon, group) }))
        : [{ weapon, unavailableReason: "No ammunition selected" }];
    },
  );

  // Infusable weapons picked by name with none of their affinities selected are listed (as their
  // Standard version) rather than silently left out
  const noAffinityWeapons = validSelectedWeapons.flatMap((name) => {
    const infusable = weapons.filter(
      ({ weaponName, affinityId }) => weaponName === name && affinityId !== uniqueAffinityId,
    );
    if (
      infusable.length === 0 ||
      infusable.some(({ affinityId }) => selectedAffinityIds.has(affinityId))
    ) {
      return [];
    }
    const standard = infusable.find(({ affinityId }) => affinityId === 0) ?? infusable[0];
    return [{ weapon: standard, unavailableReason: "No affinity selected" }];
  });

  // A row for each upgrade level with each attack, and each skill the weapon can use: its own
  // fixed skill, or the Ashes of War picked. Spell scaling doesn't use an attack.
  type Choice = Omit<RowChoice, "upgradeLevel" | "twoHanding">;
  const getChoices = (weapon: Weapon): Choice[] => {
    if (!attackActive) return [{ attack: attacks[0] ?? "R1", ashOfWar: "" }];
    const info = ashes.weapons[weapon.weaponName];
    const skills =
      info && !info.canChange
        ? ashesOfWar.includes(fixedSkillsChoice)
          ? [""]
          : []
        : ashesOfWar.filter((choice) => choice !== fixedSkillsChoice);
    return [
      ...attacks.map((attackName): Choice => ({ attack: attackName, ashOfWar: "" })),
      ...skills.map((ashOfWar): Choice => ({ attack: ashAttack, ashOfWar })),
    ];
  };
  let movesetsMissing = false;
  const requests = [...weaponsWithAmmo, ...noAffinityWeapons, ...unbuffableWeapons].flatMap(
    ({ weapon, unavailableReason }): BuildRequest[] => {
      const choices = getChoices(weapon);
      // Somber weapons' levels are coarser, so several picked levels can be the same one
      const seen = new Set<string>();
      const weaponRequests = upgradeLevels.flatMap((upgradeLevel) =>
        choices.flatMap((choice) => {
          const withGrip = (grip: Grip) =>
            getWeaponRequests(weapon, unavailableReason, {
              ...choice,
              upgradeLevel,
              twoHanding: grip === "2h",
            });
          const [first, second] = grips.includes("1h")
            ? [withGrip("1h"), grips.includes("2h") ? withGrip("2h") : undefined]
            : [withGrip("2h"), undefined];
          // With both grips, a row for each, unless it's the same either way (e.g. it can't be
          // two handed), when it's the one handed row unlabeled
          const gripRequests = !second
            ? first
            : [
                ...first.map((request) => {
                  const other = second.find(
                    (candidate) => candidate.skillVariant?.short === request.skillVariant?.short,
                  );
                  return other && !sameWithEitherGrip(request, other)
                    ? withGripLabel(request)
                    : request;
                }),
                ...second.flatMap((request) => {
                  const other = first.find(
                    (candidate) => candidate.skillVariant?.short === request.skillVariant?.short,
                  );
                  if (other && sameWithEitherGrip(other, request)) return [];
                  return [other ? withGripLabel(request) : request];
                }),
              ];
          return gripRequests.filter((request) => {
            const key = JSON.stringify([
              getWeaponUpgradeLevel(weapon, upgradeLevel),
              choice.attack,
              choice.ashOfWar,
              request.skillVariant?.short,
              request.twoHanding,
            ]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }),
      );
      // A weapon left out for itself (e.g. no ammunition) is shown with the reason, but only
      // the attacks and skills a weapon has are, unless it has them but they can't be used here
      if (unavailableReason) return weaponRequests.slice(0, 1);
      const available = weaponRequests.filter((request) => !request.unavailableReason);
      if (available.length) return available;
      const shown = weaponRequests.find((request) => shownReasonRequests.has(request));
      if (shown) return [shown];
      if (attacks.length > 0 || ashesOfWar.length > 0) movesetsMissing = true;
      return [];
    },
  );
  return { unfilteredRequests: requests, movesetsMissing: movesetsMissing && !requests.length };
}
