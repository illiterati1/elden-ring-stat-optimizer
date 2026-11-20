import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Box,
  CircularProgress,
  CssBaseline,
  Drawer,
  Fab,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  SvgIcon,
  ThemeProvider,
  Typography,
} from "@mui/material";
import {
  allAttributes,
  AttackPowerType,
  WeaponType,
  type Attribute,
  type Attributes,
} from "../calculator/calculator.ts";
import {
  scadutreeBlessingRates,
  type BuffEffect,
  type BuildRequest,
  type BuildResult,
} from "../optimizer/build.ts";
import type { Limits } from "../optimizer/limits.ts";
import {
  allStats,
  getCharacterLevel,
  getPlannedStats,
  startingClasses,
  type Stats,
} from "../optimizer/startingClasses.ts";
import theme from "./theme.ts";
import { CloseIcon, useBackClosable, useTouch } from "./Details.tsx";
import useAppState, {
  defaultAppState,
  minEquipWeight,
  statusSortBy,
  type AppState,
  type PlannedStats,
} from "./useAppState.ts";
import useWeapons from "./useWeapons.ts";
import type { Weapon } from "../calculator/weapon.ts";
import useBuffable, { isBuffable } from "./useBuffable.ts";
import useBuffs, {
  getBuffEffects,
  isWeaponOnlyBuff,
  getBuffKey,
  getBuffStats,
  getSpellScalingAttribute,
  type Buff,
} from "./useBuffs.ts";
import BuffSettings from "./BuffSettings.tsx";
import ReportIssueDialog from "./ReportIssueDialog.tsx";
import useAshes, {
  ashAttack,
  buffedR2Skills,
  getAshAttack,
  getAshAttacks,
  getAshChoices,
  getSkillUpkeep,
  parseAshChoice,
  weaponAttackSkills,
  withFollowUp,
  type AshAttack,
  type SkillVariant,
} from "./useAshes.ts";
import useMovesets, {
  allAttacks,
  attackTimingNotes,
  canTwoHand,
  getAttackData,
  mountedAttacks,
  oneOffAttacks,
  riposteAttacks,
  withOffhandRows,
  type ChainLimit,
} from "./useMovesets.ts";
import useAmmo, { getAmmoKey, getAmmoLabel, weaponTypeAmmoClasses, withAmmo } from "./useAmmo.ts";
import useBuildResults, { useDpsCurves } from "./useBuildResults.ts";
import CharacterSettings from "./CharacterSettings.tsx";
import BuildSettings from "./BuildSettings.tsx";
import TimingSettings from "./TimingSettings.tsx";
import LimitSettings from "./LimitSettings.tsx";
import DefenseSettings from "./DefenseSettings.tsx";
import WeaponPicker from "./WeaponPicker.tsx";
import ResultsTable, { type PinnedRow } from "./ResultsTable.tsx";
import {
  describePinSettings,
  getKeyOfPin,
  getPinChartKey,
  getPinKey,
  getFrozenKey,
  getPinSettings,
  restoreRequest,
  storeRequest,
  type Pin,
} from "./pins.ts";
import ValueChart from "./ValueChart.tsx";
import { getResultStatus, sortResults } from "./results.ts";
import { defaultWeaponFilters, passesFilters } from "./filters.ts";
import { maxCharacterLevel } from "../optimizer/runes.ts";
import {
  compareWeaponTypes,
  damageTypeLabels,
  objectiveOptions,
  statusTypes,
  uniqueAffinityId,
  weaponTypeLabels,
  catalystTypes,
  debug,
} from "./uiUtils.ts";

/** Skills that apply an enemy debuff, which is picked separately (in the enemy debuffs), by name */
const skillDebuffs: Partial<Record<string, string>> = { "Shriek of Milos": "Shriek of Milos" };

/**
 * Weapons that also powerstance with another weapon type, in the left hand only or either hand
 * (exceptions in the game; their own attack rows for it are in its data, see withOffhandRows): the
 * Wakizashi with katanas (tested in game with an Uchigatana), the Main-gauche with thrusting swords
 * (tested with a Rapier), and the Pickaxe, a Great Hammer with greataxes' animations
 * (wepmotionCategory 32), with greataxes (tested with the Rusted Anchor)
 */
/** Identifies a request's result: the weapon, and which version of its fixed skill */
const getRequestKey = (request: BuildRequest) =>
  `${request.weapon.name}\n${request.skillVariant?.short ?? ""}`;
const getResultKey = (result: BuildResult) =>
  `${result.weaponName}\n${result.skillVariant?.short ?? ""}`;

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

/** The frozen pins' keys (getFrozenKey), to not freeze the same row with the same settings twice */
const getFrozenKeys = (pins: readonly Pin[]) =>
  new Set(pins.flatMap((pin) => (pin.frozen ? [getFrozenKey(pin.frozen.request)] : [])));

/** @returns why a live pin with this request can't be frozen, if it can't */
function getFreezeBlocked(request: BuildRequest | undefined, frozenKeys: ReadonlySet<string>) {
  if (!request) return "Can't be frozen: the weapon or its attack wasn't found";
  if (frozenKeys.has(getFrozenKey(storeRequest(request)))) {
    return "Already frozen with these settings";
  }
  return undefined;
}

export default function App() {
  const [appState, updateAppState] = useAppState();
  const [reportOpen, setReportOpen] = useState(false);
  // On touch devices, the settings are in a drawer opened from a menu button, closed with the back
  // button too
  const touch = useTouch();
  const settingsDrawer = useBackClosable();
  const {
    startingClass,
    stats,
    buffs: selectedBuffKeys,
    stackTier,
    health,
    catalyst: catalystName,
    catalystUpgradeLevel,
    equipWeight,
    upgradeLevel,
    twoHanding,
    showScaling,
    showStatus: savedShowStatus,
    showStance: savedShowStance,
    showStamina: savedShowStamina,
    showDamagePerStamina: savedShowDamagePerStamina,
    showStancePerStamina: savedShowStancePerStamina,
    showPotential,
    showDps: savedShowDps,
    tooltipTimings,
    chainLimit,
    showRequirements,
    closedAlerts,
    meetRequirements,
    onlyBuffable,
    weaponFilters,
    sortBy,
    reverse,
    chartWeapons,
    pins,
    fastMode,
    chartRange,
    objective,
    limits,
    plannedStats,
    defenses,
    physicalNegation,
    enemyArea,
    enemyKey,
    enemyHp,
    criticalDamageRate,
    stanceDamageRate,
    enemyRipostes,
    enemyTypes,
    enemyInRealmOfShadow,
    ngPlus: savedNgPlus,
    radahnBeaten,
    scadutreeBlessing: savedScadutreeBlessing,
    scadutreeBlessingLevel,
    attack: savedAttack,
    chainWeight,
    sumChains,
    ashOfWar: savedAshOfWar,
    offhandWeapon: offhandWeaponName,
    offhandUpgradeLevel,
    offhandAffinityId,
    offhandBuff: offhandBuffKey,
    selectedWeapons,
    affinityIds,
    selectedAmmo,
    weaponTypes,
  } = appState;
  // Spell scaling has no attack, so no stance, stamina, status, or timing (the settings are kept)
  const spellScalingMode = objective === "spellScaling";
  const showStatus = savedShowStatus && !spellScalingMode;
  const showStance = savedShowStance && !spellScalingMode;
  const showStamina = savedShowStamina && !spellScalingMode;
  const showDamagePerStamina = savedShowDamagePerStamina && !spellScalingMode;
  const showStancePerStamina = savedShowStancePerStamina && !spellScalingMode;
  const showDps = savedShowDps && !spellScalingMode;

  const { weapons, loading, error } = useWeapons();
  const ammo = useAmmo();
  const movesets = useMovesets();
  const ashes = useAshes();
  const allAshChoices = useMemo(() => getAshChoices(ashes), [ashes]);
  const closeAlert = (id: string) => updateAppState({ closedAlerts: [...closedAlerts, id] });
  // The enemy's HP, for damage that's a percentage of it, if known
  const countedEnemyHp = enemyHp > 0 ? enemyHp : undefined;
  // NG+ and the Scadutree Blessing are only offered with ?debug; otherwise they're off
  const ngPlus = debug ? savedNgPlus : 0;
  // A picked enemy decides whether the Scadutree Blessing applies: only in the Realm of Shadow
  const scadutreeBlessing = !debug
    ? false
    : enemyKey != null && enemyInRealmOfShadow != null
    ? enemyInRealmOfShadow
    : savedScadutreeBlessing;
  const scadutreeBlessingRate = scadutreeBlessing
    ? scadutreeBlessingRates[scadutreeBlessingLevel] ?? 1
    : 1;
  const buffable = useBuffable();
  // Buffs give bonus stats (not counted towards level) and damage multipliers
  const allBuffs = useBuffs();
  const selectedBuffs = useMemo(
    () => allBuffs.filter((buff) => selectedBuffKeys.includes(getBuffKey(buff))),
    [allBuffs, selectedBuffKeys],
  );
  const bonusAttributes = useMemo(() => getBuffStats(selectedBuffs), [selectedBuffs]);
  // Weapon buffs only apply to weapons that can be buffed (greases and spells) or can take the Ash
  // of War (skills, which include affinities that can't be buffed, e.g. Cold), and unique skills'
  // only to their own weapons
  // A weapon's passive (e.g. Freyja's Greatsword's for Redmane skills) applies in either hand, so
  // to the weapon itself too, but not twice when the off-hand weapon is the same one. Ones with a
  // condition (e.g. the Madding Hand's, after madness nearby) are weapon effects, picked like unique
  // buffs.
  const passives = useMemo(
    () =>
      new Map(allBuffs.filter((buff) => buff.kind === "offhand").map((buff) => [buff.name, buff])),
    [allBuffs],
  );
  const { buffEffects, offhandBuff, weaponBuff, weaponBuffEffects, uniqueSkills, oneHandedBuffs } =
    useMemo(() => {
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
    }, [selectedBuffs, stackTier, health]);

  // Staves and seals for weapon buff spells that scale with them (one of each), and the chosen one
  // if it can cast the weapon buff
  const catalysts = useMemo(
    () =>
      weapons.filter(
        (weapon, index) =>
          (weapon.sorceryTool || weapon.incantationTool) &&
          weapons.findIndex((other) => other.weaponName === weapon.weaponName) === index,
      ),
    [weapons],
  );
  const { catalyst, castingRequirements } = useMemo(() => {
    const spellScaling = weaponBuff && getSpellScalingAttribute([weaponBuff]);
    if (!spellScaling) return {};
    const catalyst = catalysts.find(
      (weapon) =>
        weapon.weaponName === catalystName &&
        (spellScaling === "int" ? weapon.sorceryTool : weapon.incantationTool),
    );
    // The catalyst's and spell's requirements, whichever is higher
    const castingRequirements: Partial<Record<Attribute, number>> = {};
    for (const requirements of [catalyst?.requirements ?? {}, weaponBuff.requirements ?? {}]) {
      for (const [attribute, value] of Object.entries(requirements) as [Attribute, number][]) {
        castingRequirements[attribute] = Math.max(castingRequirements[attribute] ?? 0, value);
      }
    }
    return { catalyst, castingRequirements };
  }, [catalysts, catalystName, weaponBuff]);

  // The moveset data lists weapons in the game's order
  const weaponOrder = useMemo(
    () => new Map(Object.keys(movesets).map((weaponName, index) => [weaponName, index])),
    [movesets],
  );

  // The class's base damage stats, the lowest they can go
  const classAttributes = useMemo(() => {
    const attributes = {} as Attributes;
    for (const attribute of allAttributes) {
      attributes[attribute] = startingClasses[startingClass][attribute];
    }
    return attributes;
  }, [startingClass]);

  const startAttributes = useMemo(() => {
    const attributes = {} as Attributes;
    for (const attribute of allAttributes) attributes[attribute] = stats[attribute];
    return attributes;
  }, [stats]);

  // Ignore any saved selections that aren't valid weapon names
  const validSelectedWeapons = useMemo(() => {
    const weaponNames = new Set(weapons.map((weapon) => weapon.weaponName));
    return selectedWeapons.filter((name) => weaponNames.has(name));
  }, [weapons, selectedWeapons]);

  // Weapons picked by name or type, for buffs only some weapons get (their own skills'). Weapons
  // that can cast count as staves or seals, like in the weapon selection.
  const pickedWeapons = useMemo(() => {
    const types = new Set(weaponTypes);
    return new Set([
      ...validSelectedWeapons,
      ...weapons
        .filter(
          (weapon) =>
            types.has(weapon.weaponType) ||
            (weapon.sorceryTool && types.has(WeaponType.GLINTSTONE_STAFF)) ||
            (weapon.incantationTool && types.has(WeaponType.SACRED_SEAL)),
        )
        .map((weapon) => weapon.weaponName),
    ]);
  }, [weapons, validSelectedWeapons, weaponTypes]);
  // One version of each picked weapon, for which attacks and skills they can use
  const pickedWeaponList = useMemo(() => {
    const byName = new Map<string, Weapon>();
    for (const weapon of weapons) {
      if (pickedWeapons.has(weapon.weaponName) && !byName.has(weapon.weaponName)) {
        byName.set(weapon.weaponName, weapon);
      }
    }
    return [...byName.values()];
  }, [weapons, pickedWeapons]);

  // Attacks some picked weapon has (all of them with none picked). With an enemy picked, only the
  // ripostes it can take are offered. An attack that isn't one of the choices becomes the first.
  const attackChoices = useMemo(
    () =>
      allAttacks.filter(
        (attackName) =>
          (!enemyRipostes ||
            !riposteAttacks.has(attackName) ||
            enemyRipostes.includes(attackName)) &&
          (!pickedWeaponList.length ||
            pickedWeaponList.some(
              (weapon) =>
                !!getAttackData(movesets, weapon, attackName, false, 0.5) ||
                !!getAttackData(movesets, weapon, attackName, true, 0.5),
            )),
      ),
    [enemyRipostes, pickedWeaponList, movesets],
  );
  // Spell scaling doesn't use an attack
  const attackActive = objective !== "spellScaling";
  const attack =
    savedAttack === ashAttack || (attackChoices as readonly string[]).includes(savedAttack)
      ? savedAttack
      : riposteAttacks.has(savedAttack)
      ? attackChoices.find((attackName) => riposteAttacks.has(attackName)) ??
        attackChoices[0] ??
        "R1"
      : attackChoices[0] ?? "R1";
  // Skills some picked weapon can use: an Ash of War it can take, or its own built-in skill (all
  // of them with none picked). Weapons with a fixed skill use it whichever is picked.
  const ashChoices = useMemo(() => {
    if (!pickedWeaponList.length) return allAshChoices;
    const usable = new Set<string>();
    for (const weapon of pickedWeaponList) {
      const info = ashes.weapons[weapon.weaponName];
      if (!info?.canChange) continue;
      usable.add(info.skill);
      for (const ash of ashes.ashes) {
        if (ash.mounts.includes(weapon.weaponType)) usable.add(ash.name);
      }
    }
    return allAshChoices.filter(({ value }) => usable.has(parseAshChoice(value)[0]));
  }, [allAshChoices, pickedWeaponList, ashes]);
  // The saved Ash of War, or the first if it isn't one of the choices (e.g. from an earlier version)
  const ashOfWar = ashChoices.some(({ value }) => value === savedAshOfWar)
    ? savedAshOfWar
    : ashChoices[0]?.value ?? "";

  // Each hit's physical damage type picks which physical negation applies. Standard is only
  // used for a weapon without attack data.
  const enemyDefenses = useMemo(
    () => ({
      ...defenses,
      [AttackPowerType.PHYSICAL]: {
        defense: defenses[AttackPowerType.PHYSICAL].defense,
        negation: physicalNegation.standard,
      },
    }),
    [defenses, physicalNegation],
  );

  // The optimizer starts from the planned stats, which may be above the current level (levels
  // to gain first) or below it (a respec, freeing levels that cost no runes)
  const startLevel = getCharacterLevel(stats);
  const plan = useMemo(
    () => getPlannedStats(stats, plannedStats, startingClasses[startingClass]),
    [stats, plannedStats, startingClass],
  );
  const planLevel = getCharacterLevel(plan);
  const planAttributes = useMemo(() => {
    const attributes = {} as Attributes;
    for (const attribute of allAttributes) attributes[attribute] = plan[attribute];
    return attributes;
  }, [plan]);

  // A powerstance attack's off hand weapon, if one is picked: any weapon (by base name) with
  // powerstance attacks that isn't paired, in one affinity, with an optional weapon buff
  // Like the weapon picker: grouped by weapon type, in the game's order
  const offhandWeaponTypes = useMemo(() => {
    const order = (weapon: Weapon) => weaponOrder.get(weapon.weaponName) ?? Infinity;
    return new Map(
      weapons
        .filter(
          (weapon) => !weapon.paired && movesets[weapon.weaponName]?.["1h"]?.["Powerstance L1"],
        )
        .sort(
          (a, b) =>
            compareWeaponTypes(a.weaponType, b.weaponType) ||
            order(a) - order(b) ||
            a.weaponName.localeCompare(b.weaponName),
        )
        .map((weapon) => [weapon.weaponName, weaponTypeLabels.get(weapon.weaponType) ?? ""]),
    );
  }, [weapons, movesets, weaponOrder]);
  const offhandWeaponChoices = useMemo(() => [...offhandWeaponTypes.keys()], [offhandWeaponTypes]);
  const offhandVersions = useMemo(
    () => weapons.filter((weapon) => weapon.weaponName === offhandWeaponName),
    [weapons, offhandWeaponName],
  );
  const offhandAffinityChoices = useMemo(
    () => offhandVersions.map((weapon) => weapon.affinityId),
    [offhandVersions],
  );
  const offhandWeaponData =
    offhandVersions.find((weapon) => weapon.affinityId === offhandAffinityId) ??
    offhandVersions.find((weapon) => weapon.affinityId === 0) ??
    offhandVersions[0];
  // Weapon buffs it can take: greases and spells if it can be buffed, Ashes of War's if it can take
  // the Ash of War
  const offhandBuffChoices = useMemo(
    () =>
      offhandWeaponData
        ? allBuffs.filter((buff) => {
            if (buff.type !== "weapon" || isWeaponOnlyBuff(buff)) return false;
            if (buff.kind !== "skill") return isBuffable(buffable, offhandWeaponData);
            const ash = ashes.ashes.find((candidate) => candidate.name === buff.name);
            return (
              !!ashes.weapons[offhandWeaponData.weaponName]?.canChange &&
              !!ash &&
              ash.mounts.includes(offhandWeaponData.weaponType) &&
              ash.affinities.includes(offhandWeaponData.affinityId)
            );
          })
        : [],
    [offhandWeaponData, allBuffs, buffable, ashes],
  );
  const offhandBuffEffects = useMemo(() => {
    const buff = offhandBuffChoices.find((choice) => getBuffKey(choice) === offhandBuffKey);
    return buff
      ? getBuffEffects([buff], stackTier, health).map((effect) => ({
          ...effect,
          hand: "off" as const,
        }))
      : [];
  }, [offhandBuffChoices, offhandBuffKey, stackTier, health]);

  // Chains cut short, if set
  const limit = useMemo<ChainLimit | undefined>(
    () =>
      chainLimit.mode === "steps"
        ? { steps: chainLimit.steps }
        : chainLimit.mode === "seconds"
        ? { seconds: chainLimit.seconds }
        : undefined,
    [chainLimit],
  );

  /**
   * The requests for one weapon with an attack (each version of a fixed skill that has several is its
   * own), with the other settings: for the table's weapons with the chosen attack, and for each
   * pinned row with its own
   */
  const getWeaponRequests = useMemo(() => {
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
      attack: AppState["attack"],
      ashOfWar: string,
    ): BuildRequest[] => {
      // The two handing setting doesn't apply to weapons that can't be two handed
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
        ? getAshAttacks(ashes, movesets, weapon, ashOfWar, weaponTwoHanding, chainWeight, sumChains)
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
      return skillAttacks.map(({ ash, variant }): BuildRequest => {
        const chosenAttackData = !attackActive
          ? undefined
          : ash && "attack" in ash
          ? ash.attack
          : attack === ashAttack
          ? undefined
          : uniqueSkillChain ??
            getAttackData(
              movesets,
              weapon,
              attack,
              weaponTwoHanding,
              chainWeight,
              sumChains,
              limit,
            );
        // A skill's enemy debuff is picked separately, so it's noted when it isn't
        const debuffName =
          chosenAttackData?.fixedSkill && skillDebuffs[chosenAttackData.fixedSkill];
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
        return {
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
              buffNote:
                "Only its skill's weapon buff applies, since it replaces other weapon buffs",
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
        };
      });
    };
  }, [
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
    upgradeLevel,
    twoHanding,
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
  ]);

  const unfilteredRequests = useMemo<BuildRequest[]>(() => {
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
        const takesAshes =
          affinityId === uniqueAffinityId && !!ashes.weapons[weaponName]?.canChange;
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

    return [...weaponsWithAmmo, ...noAffinityWeapons, ...unbuffableWeapons].flatMap(
      ({ weapon, unavailableReason }) =>
        getWeaponRequests(weapon, unavailableReason, attack, ashOfWar),
    );
  }, [
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
    attack,
    ashOfWar,
  ]);
  // Filtered before optimizing, so weapons filtered out aren't calculated at all. (Top N needs the
  // results, so it's applied after sorting.)
  const {
    baseGameOnly,
    damageTypes: filterDamageTypes,
    statusTypes: filterStatusTypes,
    maxWeight,
  } = weaponFilters;
  const requests = useMemo(() => {
    const filters = {
      ...defaultWeaponFilters,
      baseGameOnly,
      damageTypes: filterDamageTypes,
      statusTypes: filterStatusTypes,
      maxWeight,
    };
    return unfilteredRequests.filter((request) => passesFilters(request, filters));
  }, [unfilteredRequests, baseGameOnly, filterDamageTypes, filterStatusTypes, maxWeight]);

  // Weapons that are no longer picked come off the chart, rather than coming back if they're picked
  // again (or taking up its slots). Only after the selection changes, since on page load the data
  // the weapons are picked from is still loading.
  const selection = [
    selectedWeapons,
    weaponTypes,
    affinityIds,
    selectedAmmo,
    onlyBuffable,
    baseGameOnly,
    filterDamageTypes,
    filterStatusTypes,
    maxWeight,
  ];
  const lastSelection = useRef(selection);
  useEffect(() => {
    if (selection.every((value, i) => value === lastSelection.current[i])) return;
    lastSelection.current = selection;
    const requested = new Set(requests.map((request) => request.weapon.name));
    const kept = chartWeapons.filter((name) => requested.has(name) || name.startsWith("pin:"));
    if (kept.length < chartWeapons.length) updateAppState({ chartWeapons: kept });
  });

  // With Top N, the worker only fully calculates the first weapons by the sort column, sorted as
  // below. A status column it can't know is hidden yet (no weapon builds that status up) sorts
  // every weapon the same, so they fall back to the total like the table.
  const { topN } = weaponFilters;
  const workerSortHidden =
    (sortBy === "stance" && !showStance) ||
    (sortBy === "stamina" && !showStamina) ||
    (sortBy === "damagePerStamina" && !showDamagePerStamina) ||
    (sortBy === "stancePerStamina" && !showStancePerStamina) ||
    (sortBy === "potential" && !showPotential) ||
    (sortBy.startsWith("status:") && !showStatus);
  const workerTopN = useMemo(
    () =>
      topN.enabled
        ? {
            count: Math.max(topN.value, 1),
            sortBy: workerSortHidden ? ("total" as const) : sortBy,
            reverse: !workerSortHidden && reverse,
            perSecond: !workerSortHidden && showDps,
          }
        : undefined,
    [topN, workerSortHidden, sortBy, reverse, showDps],
  );
  const { results, pending: mainPending, poolRef } = useBuildResults(requests, workerTopN);

  // Pinned rows, whether their weapons are picked or not: a live pin's values use the current
  // settings with its own weapon and attack, and a frozen pin's the request it was frozen with.
  // They're worked out by a worker of their own, so they don't wait for the table or count towards
  // top N.
  const weaponsByName = useMemo(
    () => new Map(weapons.map((weapon) => [weapon.name, weapon])),
    [weapons],
  );
  // (a ranged weapon's name includes its ammunition, e.g. "Longbow (Arrow)")
  const findPinWeapon = (name: string) => {
    const weapon = weaponsByName.get(name);
    if (weapon) return weapon;
    for (const group of ammo) {
      const suffix = ` (${getAmmoLabel(group)})`;
      const base = name.endsWith(suffix) && weaponsByName.get(name.slice(0, -suffix.length));
      if (base && weaponTypeAmmoClasses.get(base.weaponType) === group.class) {
        return withAmmo(base, group);
      }
    }
    return undefined;
  };
  // Which pin each request sent to the pins' worker is for, so results are matched to pins even
  // when they're for earlier requests
  const [pinRequestIds] = useState(() => new WeakMap<BuildRequest, string>());
  // (frozen pins' only when the pins or the weapon data change, so they aren't sent to the worker
  // again whenever the settings change)
  const frozenRequests = useMemo(
    () =>
      new Map(
        pins.flatMap((pin): [string, BuildRequest][] => {
          const request = pin.frozen && restoreRequest(pin.frozen.request, findPinWeapon);
          return request ? [[pin.id, request]] : [];
        }),
      ),
    [pins, weaponsByName, ammo],
  );
  const pinRequests = useMemo(
    () =>
      new Map(
        pins.flatMap((pin): [string, BuildRequest][] => {
          const request = pin.frozen
            ? frozenRequests.get(pin.id)
            : (() => {
                const weapon = findPinWeapon(pin.weaponName);
                return weapon
                  ? getWeaponRequests(weapon, undefined, pin.attack, pin.ashOfWar).find(
                      (candidate) => candidate.skillVariant?.short === pin.skillVariant,
                    )
                  : undefined;
              })();
          if (!request) return [];
          pinRequestIds.set(request, pin.id);
          return [[pin.id, request]];
        }),
      ),
    [pins, frozenRequests, weaponsByName, ammo, getWeaponRequests],
  );
  const pinRequestList = useMemo(() => [...pinRequests.values()], [pinRequests]);
  const {
    results: pinResults,
    resultRequests: pinResultRequests,
    pending: pinsPending,
    poolRef: pinPoolRef,
  } = useBuildResults(pinRequestList, undefined, 1);
  const pending = mainPending || (pins.length > 0 && pinsPending);
  const pinResultsById = useMemo(
    () =>
      new Map(pinResultRequests.map((request, i) => [pinRequestIds.get(request), pinResults[i]])),
    [pinResultRequests, pinResults, pinRequestIds],
  );

  // A column for each status effect that any weapon in the table builds up
  const statusTypesShown = useMemo(
    () =>
      showStatus
        ? [...statusTypes.keys()].filter((statusType) =>
            [...results, ...pinResults].some(
              (result) => result.applicable && getResultStatus(result)[statusType],
            ),
          )
        : [],
    [showStatus, results, pinResults],
  );

  // Sorting by a hidden column falls back to the highest total first
  const sortHidden =
    (sortBy === "stance" && !showStance) ||
    (sortBy === "stamina" && !showStamina) ||
    (sortBy === "damagePerStamina" && !showDamagePerStamina) ||
    (sortBy === "stancePerStamina" && !showStancePerStamina) ||
    (sortBy === "potential" && !showPotential) ||
    (sortBy.startsWith("status:") &&
      !statusTypesShown.some((statusType) => statusSortBy(statusType) === sortBy));
  const effectiveSortBy = sortHidden ? "total" : sortBy;
  const effectiveReverse = sortHidden ? false : reverse;
  const sortedResults = useMemo(() => {
    const sorted = sortResults(results, effectiveSortBy, effectiveReverse, !sortHidden && showDps);
    // Top N keeps the first weapons in the table's order, leaving out ones that aren't applicable
    return topN.enabled
      ? sorted.filter((result) => result.applicable).slice(0, Math.max(topN.value, 1))
      : sorted;
  }, [results, effectiveSortBy, effectiveReverse, sortHidden, showDps, topN]);

  // Each pinned row with what it's shown with: its own attack's, and a frozen one's settings.
  // They're sorted like the table, after any that aren't worked out yet.
  const currentPinSettings = useMemo(() => getPinSettings(appState), [appState]);
  const pinnedRows = useMemo(() => {
    const defaultPinSettings = getPinSettings(defaultAppState);
    const frozenKeys = getFrozenKeys(pins);
    const rows = pins.map((pin): PinnedRow => {
      const settings = pin.frozen?.settings ?? currentPinSettings;
      const oneOffAttack = oneOffAttacks.has(pin.attack);
      const result =
        pinResultsById.get(pin.id) ??
        // (only what the table shows for a row that isn't applicable)
        ({
          weaponName: pin.weaponName,
          url: null,
          applicable: false,
          unavailableReason: pinRequests.has(pin.id)
            ? "Calculating…"
            : pin.frozen
            ? "Not available: a weapon it was frozen with wasn't found"
            : "Not available: the weapon or its attack wasn't found",
        } as BuildResult);
      return {
        pin,
        result,
        // (kept together with the weapon's last word, so it doesn't wrap onto a line alone)
        name: pin.label ? `${pin.weaponName}\u00a0·\u00a0${pin.label}` : pin.weaponName,
        chartKey: getPinChartKey(pin),
        ...(!pin.frozen && {
          freezeBlocked: getFreezeBlocked(pinRequests.get(pin.id), frozenKeys),
        }),
        skill: pin.attack === ashAttack,
        oneOffAttack,
        hitsNote: attackTimingNotes[pin.attack],
        tooltipTimings: oneOffAttack ? { ...tooltipTimings, nextChain: false } : tooltipTimings,
        startAttributes: Object.fromEntries(
          allAttributes.map((attribute) => [attribute, settings.stats[attribute]]),
        ) as Attributes,
        planStats: getPlannedStats(
          settings.stats,
          settings.plannedStats,
          startingClasses[settings.startingClass],
        ),
        settingLines:
          pin.frozen &&
          describePinSettings(
            pin.frozen.settings,
            currentPinSettings,
            defaultPinSettings,
            pin.attack,
            !!pin.frozen.request.attack?.chain,
            allBuffs,
          ),
      };
    });
    const worked = rows.filter((row) => row.result.curve);
    const byResult = new Map(worked.map((row) => [row.result, row]));
    return [
      ...sortResults(
        worked.map((row) => row.result),
        effectiveSortBy,
        effectiveReverse,
        !sortHidden && showDps,
      ).map((result) => byResult.get(result)!),
      ...rows.filter((row) => !row.result.curve),
    ];
  }, [
    pins,
    pinResultsById,
    pinRequests,
    currentPinSettings,
    allBuffs,
    tooltipTimings,
    effectiveSortBy,
    effectiveReverse,
    sortHidden,
    showDps,
  ]);
  // The table's rows that are pinned too: with the chosen attack, a live pin's are the same row. (A
  // frozen pin isn't, so the row can be pinned again to compare it with the current settings.)
  const rowPins = useMemo(() => {
    const pinsByKey = new Map(
      pins.filter((pin) => !pin.frozen).map((pin) => [getKeyOfPin(pin), pin]),
    );
    return new Map(
      sortedResults.flatMap((result): [BuildResult, Pin][] => {
        const pin = pinsByKey.get(
          getPinKey(result.weaponName, result.skillVariant?.short, attack, ashOfWar),
        );
        return pin ? [[result, pin]] : [];
      }),
    );
  }, [pins, sortedResults, attack, ashOfWar]);

  // Pinning, freezing, and restoring a frozen pin's settings, with the latest state (so the table
  // gets the same functions every time)
  const latest = useRef({
    pins,
    chartWeapons,
    pinRequests,
    appState,
    attack,
    ashOfWar,
    ashChoices,
  });
  latest.current = { pins, chartWeapons, pinRequests, appState, attack, ashOfWar, ashChoices };
  const [pinActions] = useState(() => ({
    pin: (result: BuildResult) => {
      const { pins, attack, ashOfWar, ashChoices, appState } = latest.current;
      const label =
        appState.objective === "spellScaling"
          ? ""
          : attack === ashAttack
          ? result.skillVariant?.label ??
            result.fixedSkill ??
            ashChoices.find(({ value }) => value === ashOfWar)?.label ??
            "Skill"
          : attack;
      const pin: Pin = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        weaponName: result.weaponName,
        attack,
        ashOfWar,
        ...(result.skillVariant && { skillVariant: result.skillVariant.short }),
        label,
      };
      updateAppState({ pins: [...pins, pin] });
    },
    unpin: (id: string) => {
      const { pins, chartWeapons } = latest.current;
      const chartKey = `pin:${id}`;
      updateAppState({
        pins: pins.filter((pin) => pin.id !== id),
        ...(chartWeapons.includes(chartKey) && {
          chartWeapons: chartWeapons.filter((key) => key !== chartKey),
        }),
      });
    },
    unpinAll: () => {
      const { chartWeapons } = latest.current;
      updateAppState({
        pins: [],
        chartWeapons: chartWeapons.filter((key) => !key.startsWith("pin:")),
      });
    },
    toggleFreeze: (id: string) => {
      const { pins, pinRequests, appState } = latest.current;
      updateAppState({
        // Unfreezing a pin that's also pinned live just leaves the live one, which is the same
        pins: pins.flatMap((pin): Pin[] => {
          if (pin.id !== id) return [pin];
          if (pin.frozen) {
            const { frozen: _, ...live } = pin;
            const key = getKeyOfPin(pin);
            return pins.some((other) => !other.frozen && getKeyOfPin(other) === key) ? [] : [live];
          }
          const request = pinRequests.get(id);
          if (getFreezeBlocked(request, getFrozenKeys(pins))) return [pin];
          return [
            request
              ? {
                  ...pin,
                  frozen: { request: storeRequest(request), settings: getPinSettings(appState) },
                }
              : pin,
          ];
        }),
      });
    },
    restore: (id: string) => {
      const settings = latest.current.pins.find((pin) => pin.id === id)?.frozen?.settings;
      // Pins frozen before a limit was added don't have it
      if (settings) {
        updateAppState({ ...settings, limits: { ...defaultAppState.limits, ...settings.limits } });
      }
    },
  }));

  // The planned stats before a row's final stats were planned, to undo it (not saved). Undo is only
  // offered while the plan is still the one the row set: changing it in any other way drops it.
  const [planUndo, setPlanUndo] = useState<{ previous: PlannedStats; applied: PlannedStats }>();

  // Plans a row's final stats, leaving stats that are the same as the current ones unplanned
  const [planFinalStats] = useState(() => (finalStats: Stats) => {
    const { stats, plannedStats: previous } = latest.current.appState;
    const applied: PlannedStats = Object.fromEntries(
      allStats
        .filter((stat) => finalStats[stat] !== stats[stat])
        .map((stat) => [stat, finalStats[stat]]),
    );
    setPlanUndo({ previous, applied });
    updateAppState({ plannedStats: applied });
  });
  const undoPlan = useMemo(
    () =>
      planUndo &&
      (() => {
        setPlanUndo(undefined);
        updateAppState({ plannedStats: planUndo.previous });
      }),
    [planUndo, updateAppState],
  );

  // The chart shows the weapons checked in the table, each version of a fixed skill (e.g. Moonveil's
  // R1 and R2) as its own line, and pinned rows checked, named with their attacks
  const chartedResults = useMemo(
    () =>
      sortedResults.filter(
        (result) => result.applicable && chartWeapons.includes(result.weaponName),
      ),
    [sortedResults, chartWeapons],
  );
  const chartedPins = useMemo(
    () =>
      fastMode
        ? []
        : pinnedRows.filter((row) => row.result.applicable && chartWeapons.includes(row.chartKey)),
    [fastMode, pinnedRows, chartWeapons],
  );
  // With DPS shown it plots damage per second like the table, worked out only for the weapons
  // charted, and leaves out weapons whose attack's timing isn't known
  const dpsRequests = useMemo(
    () =>
      showDps && !fastMode
        ? requests.filter((request) =>
            chartedResults.some((result) => getResultKey(result) === getRequestKey(request)),
          )
        : [],
    [showDps, fastMode, requests, chartedResults],
  );
  const dpsCurves = useDpsCurves(poolRef, dpsRequests);
  const pinDpsRequests = useMemo(
    () =>
      showDps
        ? chartedPins.flatMap(({ pin }) => {
            const request = pinRequests.get(pin.id);
            return request ? [request] : [];
          })
        : [],
    [showDps, chartedPins, pinRequests],
  );
  const pinDpsCurves = useDpsCurves(pinPoolRef, pinDpsRequests);
  const chartResults = chartedResults.map((result) => ({
    ...result,
    ...(result.skillVariant && {
      weaponName: `${result.weaponName} (${result.skillVariant.short})`,
    }),
    // (until they're worked out, the last ones for the weapon)
    ...(showDps && {
      curve: {
        ...result.curve,
        values:
          dpsCurves.curves[
            dpsCurves.requests.findIndex(
              (request) => getRequestKey(request) === getResultKey(result),
            )
          ] ?? [],
      },
    }),
  }));
  // A frozen pin's line says so (numbered if the same row is frozen more than once), since the row
  // can be pinned live too
  const frozenCounts = new Map<string, number>();
  for (const { pin, result, name } of chartedPins) {
    const frozenCount = pin.frozen ? (frozenCounts.get(name) ?? 0) + 1 : 0;
    if (pin.frozen) frozenCounts.set(name, frozenCount);
    chartResults.push({
      ...result,
      weaponName: pin.frozen ? `${name} (frozen${frozenCount > 1 ? ` ${frozenCount}` : ""})` : name,
      ...(showDps && {
        curve: {
          ...result.curve,
          values:
            pinDpsCurves.curves[
              pinDpsCurves.requests.findIndex((request) => pinRequestIds.get(request) === pin.id)
            ] ?? [],
        },
      }),
    });
  }

  // Attacks other than the base one have hits to show. They don't apply to spell scaling.
  const attackMode = attackActive;
  // Also show hits for the base attack when a weapon fires several, e.g. the Spread Crossbow
  const showHits =
    attackMode ||
    (objective !== "spellScaling" &&
      sortedResults.some((result) => (result.attackSteps?.flat().length ?? 0) > 1));
  const objectiveLabel = objectiveOptions.find(([value]) => value === objective)![1];
  // The Ash of War isn't named, since weapons with a fixed skill use their own (named by their hits)
  // One-off attacks (running, backstep, guard counters, critical hits) don't say when they could
  // start again
  const tooltipTimingsShown = useMemo(
    () => (oneOffAttacks.has(attack) ? { ...tooltipTimings, nextChain: false } : tooltipTimings),
    [attack, tooltipTimings],
  );
  const valueLabel = objectiveLabel + (attackMode && attack !== ashAttack ? ` (${attack})` : "");
  const pointLabel = objective === "spellScaling" ? "scaling" : "damage";
  // Per second, e.g. "DPS (R1)", as the table labels it
  const chartValueLabel = showDps
    ? (pointLabel === "damage" ? "DPS" : "AR/s") +
      (valueLabel.includes(" (") ? valueLabel.slice(valueLabel.indexOf(" (")) : "")
    : valueLabel;
  const notApplicableLabel =
    objective === "spellScaling"
      ? "Not a catalyst"
      : objective === "totalAttack"
      ? "No damage"
      : `No ${damageTypeLabels.get(objective as AttackPowerType)} damage`;

  const settings = (
    <Stack spacing={2}>
      <CharacterSettings
        startingClass={startingClass}
        stats={stats}
        plannedStats={plannedStats}
        onUndoPlan={planUndo?.applied === plannedStats ? undoPlan : undefined}
        onChange={updateAppState}
      />
      <LimitSettings
        limits={limits}
        fastMode={fastMode}
        meetRequirements={meetRequirements}
        pointLabel={pointLabel}
        currentLevel={startLevel}
        planLevel={planLevel}
        closedAlerts={closedAlerts}
        onChange={updateAppState}
      />
      <BuildSettings
        upgradeLevel={upgradeLevel}
        twoHanding={twoHanding}
        showScaling={showScaling}
        showStatus={savedShowStatus}
        showStance={savedShowStance}
        showStamina={savedShowStamina}
        showDamagePerStamina={savedShowDamagePerStamina}
        showStancePerStamina={savedShowStancePerStamina}
        showPotential={showPotential}
        showRequirements={showRequirements}
        closedAlerts={closedAlerts}
        onlyBuffable={onlyBuffable}
        weaponFilters={weaponFilters}
        weaponTypes={weaponTypes}
        attack={attack}
        chainWeight={chainWeight}
        sumChains={sumChains}
        hasChain={requests.some((request) => request.attack?.chain)}
        ashOfWar={ashOfWar}
        ashChoices={ashChoices}
        attackChoices={attackChoices}
        affinityIds={affinityIds}
        ammo={ammo}
        selectedAmmo={selectedAmmo}
        pointLabel={pointLabel}
        objective={objective}
        offhandWeapon={offhandWeaponName}
        offhandUpgradeLevel={offhandUpgradeLevel}
        offhandAffinityId={offhandAffinityId}
        offhandBuff={offhandBuffKey}
        offhandWeaponChoices={offhandWeaponChoices}
        offhandWeaponTypes={offhandWeaponTypes}
        offhandAffinityChoices={offhandAffinityChoices}
        offhandBuffChoices={offhandBuffChoices}
        scadutreeBlessing={scadutreeBlessing}
        scadutreeBlessingLevel={scadutreeBlessingLevel}
        scadutreeBlessingFromEnemy={enemyKey != null && enemyInRealmOfShadow != null}
        onChange={updateAppState}
      />
      <TimingSettings
        showDps={savedShowDps}
        spellScaling={spellScalingMode}
        tooltipTimings={tooltipTimings}
        chainLimit={chainLimit}
        mounted={mountedAttacks.has(attack)}
        closedAlerts={closedAlerts}
        onChange={updateAppState}
      />
      <BuffSettings
        buffs={allBuffs}
        selectedBuffs={selectedBuffKeys}
        stackTier={stackTier}
        catalysts={catalysts}
        catalyst={catalystName}
        catalystUpgradeLevel={catalystUpgradeLevel}
        equipWeight={equipWeight}
        health={health}
        leftHandWeapon={
          attack.startsWith("Powerstance") && offhandWeaponData ? offhandWeaponData.name : null
        }
        pickedWeapons={pickedWeapons}
        closedAlerts={closedAlerts}
        onChange={updateAppState}
      />
      <DefenseSettings
        defenses={defenses}
        physicalNegation={physicalNegation}
        enemyArea={enemyArea}
        enemyKey={enemyKey}
        enemyHp={enemyHp}
        enemyTypes={enemyTypes}
        ngPlus={ngPlus}
        radahnBeaten={radahnBeaten}
        closedAlerts={closedAlerts}
        onChange={updateAppState}
      />
      {/* Brings back any alerts the user closed */}
      <Button
        size="small"
        sx={{ alignSelf: "flex-start" }}
        disabled={closedAlerts.length === 0}
        onClick={() => updateAppState({ closedAlerts: [] })}
      >
        Show closed notes
      </Button>
    </Stack>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Room at the bottom for the settings button on touch devices */}
      <Box sx={{ maxWidth: 1600, mx: "auto", px: 2, pt: 3, pb: touch ? 10 : 3 }}>
        <Typography variant="h1" component="h1" sx={{ mb: 0.5 }}>
          Elden&nbsp;Ring Stat&nbsp;Optimizer
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Enter your current stats and the weapons you're considering to see where your next levels
          should go. Patch 1.17.2.
          <br />
          This is still a work in progress, see{" "}
          <Link
            href="https://github.com/illiterati1/elden-ring-stat-optimizer/blob/main/known-issues.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            known issues
          </Link>
          .
          <Box
            component="span"
            sx={{ display: "none", "@media (hover: none)": { display: "inline" } }}
          >
            {/* Only on touch-first devices, i.e. phones and tablets */}
            <br />
            Apologies to mobile users, this was developed with a desktop in mind, so some text may
            be cut off. This will be fixed in the future.
          </Box>
        </Typography>
        {!closedAlerts.includes("levels") && (
          <Alert severity="warning" onClose={() => closeAlert("levels")} sx={{ mb: 3 }}>
            The best allocation at each level is found separately, so levels don&apos;t necessarily
            build on each other: one more level can move points between stats rather than just
            adding one. A level can also have several allocations with the same best value, of which
            only one is shown.
            <Box sx={{ mt: 1 }}>
              For mouse &amp; keyboard players: R1 is light attack, R2 is heavy attack, L1 is left
              hand or powerstance attack, and L2 is weapon skill.
            </Box>
          </Alert>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: touch ? "1fr" : { xs: "1fr", lg: "400px 1fr" },
            gap: 2,
            alignItems: "start",
          }}
        >
          {!touch && settings}

          <Stack spacing={2} sx={{ minWidth: 0 }}>
            {error ? (
              <Alert severity="error">Couldn't load weapon data: {error.message}</Alert>
            ) : loading ? (
              <Box display="flex" justifyContent="center" p={4}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <WeaponPicker
                  weapons={weapons}
                  weaponOrder={weaponOrder}
                  selectedWeapons={validSelectedWeapons}
                  onSelectedWeaponsChanged={(newSelection) =>
                    updateAppState({ selectedWeapons: newSelection })
                  }
                />
                <Box>
                  <LinearProgress sx={{ visibility: pending ? "visible" : "hidden" }} />
                  {requests.length > 0 || pins.length > 0 ? (
                    <Stack spacing={2}>
                      {chartResults.length > 0 && !fastMode && (
                        <ValueChart
                          results={chartResults}
                          startLevel={planLevel}
                          valueLabel={chartValueLabel}
                          range={chartRange}
                          onChange={updateAppState}
                        />
                      )}
                      <ResultsTable
                        results={sortedResults}
                        pinnedRows={pinnedRows}
                        rowPins={rowPins}
                        pinActions={pinActions}
                        chartWeapons={chartWeapons}
                        chartDisabled={fastMode}
                        startAttributes={startAttributes}
                        planStats={plan}
                        valueLabel={valueLabel}
                        pointLabel={pointLabel}
                        notApplicableLabel={notApplicableLabel}
                        showScaling={showScaling}
                        statusTypes={statusTypesShown}
                        showHits={showHits}
                        showStance={showStance}
                        showStamina={showStamina}
                        showDamagePerStamina={showDamagePerStamina}
                        showStancePerStamina={showStancePerStamina}
                        showPotential={showPotential}
                        showDps={showDps}
                        oneOffAttack={oneOffAttacks.has(attack)}
                        tooltipTimings={tooltipTimingsShown}
                        skill={attack === ashAttack}
                        hitsNote={attackTimingNotes[attack]}
                        showRequirements={showRequirements}
                        sortBy={sortBy}
                        reverse={reverse}
                        onPlanStats={planFinalStats}
                        onChange={updateAppState}
                      />
                    </Stack>
                  ) : (
                    <Typography color="text.secondary" p={2}>
                      {validSelectedWeapons.length > 0 || weaponTypes.length > 0
                        ? "Pick at least one affinity, or a weapon that can't be infused."
                        : "Pick some weapons or weapon types to compare."}
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </Stack>
        </Box>

        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 4 }}>
          Found a bug or inaccuracy?{" "}
          <Link component="button" variant="body2" onClick={() => setReportOpen(true)}>
            Report it here
          </Link>
          .
        </Typography>
        {touch && (
          <>
            <Fab
              color="primary"
              aria-label="Settings"
              onClick={settingsDrawer.show}
              sx={{ position: "fixed", right: 16, bottom: 16 }}
            >
              <SvgIcon>
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
              </SvgIcon>
            </Fab>
            <Drawer
              anchor="left"
              open={settingsDrawer.open}
              onClose={settingsDrawer.hide}
              // Kept mounted, so the settings keep any state of their own while it's closed
              ModalProps={{ keepMounted: true }}
              PaperProps={{ sx: { width: "min(400px, 90vw)", p: 2, pt: 1 } }}
            >
              <Box display="flex" alignItems="center" mb={1}>
                <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
                  Settings
                </Typography>
                <IconButton aria-label="Close settings" onClick={settingsDrawer.hide}>
                  <CloseIcon />
                </IconButton>
              </Box>
              {settings}
            </Drawer>
          </>
        )}
        <ReportIssueDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          appState={appState}
        />
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 1 }}>
          Weapon data and damage calculations are adapted from the{" "}
          <Link href="https://eldenring.tclark.io/" target="_blank" rel="noopener noreferrer">
            Elden Ring Weapon Calculator
          </Link>
          . Attack motion values come from the{" "}
          <Link
            href="https://docs.google.com/spreadsheets/d/1j4bpTbsnp5Xsgw9TP2xv6d8R4qk0ErpE9r_5LGIDraU"
            target="_blank"
            rel="noopener noreferrer"
          >
            ER - Motion Values and Attack Data
          </Link>{" "}
          spreadsheet, and skill damage follows the{" "}
          <Link
            href="https://docs.google.com/document/d/17og1zLnCfdL9TFvTnI4A9Nf9EwkBbutishHPTGBDAE8"
            target="_blank"
            rel="noopener noreferrer"
          >
            Weapon Art Damage Guide
          </Link>
          . Enemy data is extracted from the game files, with names cross-referenced against a{" "}
          <Link
            href="https://docs.google.com/spreadsheets/d/1BVwmKqB8pvuyJkSTGYOM2kAJxFMQ0jVsc6aKYz_Upes"
            target="_blank"
            rel="noopener noreferrer"
          >
            community datamining spreadsheet
          </Link>
          . ELDEN RING is a trademark of FromSoftware.
        </Typography>
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 1 }}>
          <Link
            href="https://github.com/illiterati1/elden-ring-stat-optimizer"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source code on GitHub
          </Link>
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
