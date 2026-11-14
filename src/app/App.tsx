import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Box,
  CircularProgress,
  CssBaseline,
  LinearProgress,
  Link,
  Stack,
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
import type { BuffEffect, BuildRequest } from "../optimizer/build.ts";
import type { Limits } from "../optimizer/limits.ts";
import {
  getCharacterLevel,
  getPlannedStats,
  startingClasses,
} from "../optimizer/startingClasses.ts";
import theme from "./theme.ts";
import useAppState, { minEquipWeight, statusSortBy } from "./useAppState.ts";
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
  canTwoHand,
  getAttackData,
  mountedAttacks,
  oneOffAttacks,
  riposteAttacks,
  withOffhandRows,
  type ChainLimit,
} from "./useMovesets.ts";
import useAmmo, { getAmmoKey, weaponTypeAmmoClasses, withAmmo } from "./useAmmo.ts";
import useBuildResults from "./useBuildResults.ts";
import CharacterSettings from "./CharacterSettings.tsx";
import BuildSettings from "./BuildSettings.tsx";
import TimingSettings from "./TimingSettings.tsx";
import LimitSettings from "./LimitSettings.tsx";
import DefenseSettings from "./DefenseSettings.tsx";
import WeaponPicker from "./WeaponPicker.tsx";
import ResultsTable from "./ResultsTable.tsx";
import ValueChart from "./ValueChart.tsx";
import { getResultStatus, sortResults } from "./results.ts";
import { maxCharacterLevel } from "../optimizer/runes.ts";
import {
  compareWeaponTypes,
  damageTypeLabels,
  objectiveOptions,
  statusTypes,
  uniqueAffinityId,
  weaponTypeLabels,
  catalystTypes,
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

export default function App() {
  const [appState, updateAppState] = useAppState();
  const [reportOpen, setReportOpen] = useState(false);
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
    showDps: savedShowDps,
    tooltipTimings,
    chainLimit,
    showRequirements,
    closedAlerts,
    meetRequirements,
    onlyBuffable,
    sortBy,
    reverse,
    chartWeapons,
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
    poiseDamageRate,
    enemyRipostes,
    enemyTypes,
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
  // Spell scaling has no attack, so no poise, stamina, status, or timing (the settings are kept)
  const spellScalingMode = objective === "spellScaling";
  const showStatus = savedShowStatus && !spellScalingMode;
  const showStance = savedShowStance && !spellScalingMode;
  const showStamina = savedShowStamina && !spellScalingMode;
  const showDps = savedShowDps && !spellScalingMode;

  const { weapons, loading, error } = useWeapons();
  const ammo = useAmmo();
  const movesets = useMovesets();
  const ashes = useAshes();
  const allAshChoices = useMemo(() => getAshChoices(ashes), [ashes]);
  const closeAlert = (id: string) => updateAppState({ closedAlerts: [...closedAlerts, id] });
  // The enemy's HP, for damage that's a percentage of it, if known
  const countedEnemyHp = enemyHp > 0 ? enemyHp : undefined;
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

  const requests = useMemo<BuildRequest[]>(() => {
    const selected = new Set(validSelectedWeapons);
    const selectedWeaponTypes = new Set(weaponTypes);
    const selectedAffinityIds = new Set(affinityIds);
    const { maxLevels, minGain, targetValue } = limits;
    const levelLimit = maxLevels.enabled ? maxLevels.values[maxLevels.mode] : null;
    const enabledLimits: Limits = {
      // Level limits are relative to the current level, but the optimizer counts from the plan
      maxLevels:
        levelLimit != null && maxLevels.mode !== "runes"
          ? Math.max(
              0,
              (maxLevels.mode === "absolute" ? levelLimit : startLevel + levelLimit) - planLevel,
            )
          : null,
      // Fast mode only calculates where the level limit stops, so these don't apply
      minGainPerLevel: minGain.enabled && !minGain.relative && !fastMode ? minGain.value : null,
      minRelativeGainPerLevel:
        minGain.enabled && minGain.relative && !fastMode ? minGain.value : null,
      runeBudget: levelLimit != null && maxLevels.mode === "runes" ? levelLimit : null,
      targetValue: targetValue.enabled && !fastMode ? targetValue.value : null,
    };

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
      ({ weapon, unavailableReason }) => {
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
          ? getAshAttacks(
              ashes,
              movesets,
              weapon,
              ashOfWar,
              weaponTwoHanding,
              chainWeight,
              sumChains,
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
            : weaponBuff?.kind === "skill" &&
              weaponBuffApplies &&
              buffedR2Skills.has(weaponBuff.name)
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
            poiseDamageRate,
            enemyTypes,
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
                poiseBase: movesets[offhand.weaponName]?.poise ?? 0,
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
            bonusAttributes,
            objective,
            defenses: enemyDefenses,
            limits: enabledLimits,
            meetRequirements,
            fast: fastMode,
            ...(variant && { skillVariant: variant }),
          };
        });
      },
    );
  }, [
    weapons,
    validSelectedWeapons,
    affinityIds,
    ammo,
    selectedAmmo,
    movesets,
    buffable,
    ashes,
    ashOfWar,
    onlyBuffable,
    attack,
    chainWeight,
    sumChains,
    limit,
    physicalNegation,
    countedEnemyHp,
    criticalDamageRate,
    poiseDamageRate,
    enemyTypes,
    offhandWeaponData,
    offhandUpgradeLevel,
    offhandBuffEffects,
    weaponTypes,
    upgradeLevel,
    twoHanding,
    bonusAttributes,
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

  // Weapons that are no longer picked come off the chart, rather than coming back if they're picked
  // again (or taking up its slots). Only after the selection changes, since on page load the data
  // the weapons are picked from is still loading.
  const selection = [selectedWeapons, weaponTypes, affinityIds, selectedAmmo, onlyBuffable];
  const lastSelection = useRef(selection);
  useEffect(() => {
    if (selection.every((value, i) => value === lastSelection.current[i])) return;
    lastSelection.current = selection;
    const requested = new Set(requests.map((request) => request.weapon.name));
    const kept = chartWeapons.filter((name) => requested.has(name));
    if (kept.length < chartWeapons.length) updateAppState({ chartWeapons: kept });
  });

  const { results, pending } = useBuildResults(requests);

  // A column for each status effect that any weapon in the table builds up
  const statusTypesShown = useMemo(
    () =>
      showStatus
        ? [...statusTypes.keys()].filter((statusType) =>
            results.some((result) => result.applicable && getResultStatus(result)[statusType]),
          )
        : [],
    [showStatus, results],
  );

  const sortedResults = useMemo(() => {
    // Sorting by a hidden column falls back to the highest total first
    const hidden =
      (sortBy === "stance" && !showStance) ||
      (sortBy === "stamina" && !showStamina) ||
      (sortBy.startsWith("status:") &&
        !statusTypesShown.some((statusType) => statusSortBy(statusType) === sortBy));
    return hidden
      ? sortResults(results, "total", false)
      : sortResults(results, sortBy, reverse, showDps);
  }, [results, sortBy, reverse, showStance, showStamina, showDps, statusTypesShown]);

  // The chart shows the weapons checked in the table, each version of a fixed skill (e.g. Moonveil's
  // R1 and R2) as its own line
  const chartResults = sortedResults
    .filter((result) => result.applicable && chartWeapons.includes(result.weaponName))
    .map((result) =>
      result.skillVariant
        ? { ...result, weaponName: `${result.weaponName} (${result.skillVariant.short})` }
        : result,
    );

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
  const notApplicableLabel =
    objective === "spellScaling"
      ? "Not a catalyst"
      : objective === "totalAttack"
      ? "No damage"
      : `No ${damageTypeLabels.get(objective as AttackPowerType)} damage`;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ maxWidth: 1600, mx: "auto", px: 2, py: 3 }}>
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
          {/* Only on touch-first devices, where the tooltips this note is about don't work well */}
          <Box
            component="span"
            sx={{ display: "none", "@media (hover: none)": { display: "inline" } }}
          >
            <br />
            Apologies to mobile users, this was developed with a desktop in mind and as a result
            much of the more interesting data is in tooltips that don&apos;t display well on mobile.
            Support for mobile is planned, just not quite there yet.
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
            gridTemplateColumns: { xs: "1fr", lg: "400px 1fr" },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Stack spacing={2}>
            <CharacterSettings
              startingClass={startingClass}
              stats={stats}
              plannedStats={plannedStats}
              onChange={updateAppState}
            />
            <LimitSettings
              limits={limits}
              fastMode={fastMode}
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
              showRequirements={showRequirements}
              closedAlerts={closedAlerts}
              meetRequirements={meetRequirements}
              onlyBuffable={onlyBuffable}
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
              onChange={updateAppState}
            />
            <TimingSettings
              showDps={savedShowDps}
              spellScaling={spellScalingMode}
              tooltipTimings={tooltipTimings}
              chainLimit={chainLimit}
              mounted={mountedAttacks.has(attack)}
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
                attack.startsWith("Powerstance") && offhandWeaponData
                  ? offhandWeaponData.name
                  : null
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
              Show all alerts
            </Button>
          </Stack>

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
                  {requests.length > 0 ? (
                    <Stack spacing={2}>
                      {chartResults.length > 0 && !fastMode && (
                        <ValueChart
                          results={chartResults}
                          startLevel={planLevel}
                          valueLabel={valueLabel}
                          range={chartRange}
                          onChange={updateAppState}
                        />
                      )}
                      <ResultsTable
                        results={sortedResults}
                        chartWeapons={chartWeapons}
                        chartDisabled={fastMode}
                        startAttributes={startAttributes}
                        valueLabel={valueLabel}
                        pointLabel={pointLabel}
                        notApplicableLabel={notApplicableLabel}
                        showScaling={showScaling}
                        statusTypes={statusTypesShown}
                        showHits={showHits}
                        showStance={showStance}
                        showStamina={showStamina}
                        showDps={showDps}
                        tooltipTimings={tooltipTimingsShown}
                        skill={attack === ashAttack}
                        showRequirements={showRequirements}
                        sortBy={sortBy}
                        reverse={reverse}
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
