import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Box,
  CircularProgress,
  Collapse,
  CssBaseline,
  Drawer,
  Fab,
  IconButton,
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
  maxRegularUpgradeLevel,
  scadutreeBlessingRates,
  type BuildRequest,
  type BuildResult,
} from "../optimizer/build.ts";
import {
  getCharacterLevel,
  getPlannedStats,
  startingClasses,
  type Stats,
} from "../optimizer/startingClasses.ts";
import theme from "./theme.ts";
import { CloseIcon, useBackClosable, useTouch } from "./Details.tsx";
import useAppState, { defaultAppState, statusSortBy, type AppState } from "./useAppState.ts";
import useWeapons from "./useWeapons.ts";
import type { Weapon } from "../calculator/weapon.ts";
import useBuffable, { isBuffable } from "./useBuffable.ts";
import useBuffs, {
  getBuffEffects,
  isWeaponOnlyBuff,
  getBuffKey,
  getBuffStats,
  getSpellScalingAttribute,
} from "./useBuffs.ts";
import BuffSettings from "./BuffSettings.tsx";
import ReportIssueDialog from "./ReportIssueDialog.tsx";
import useAshes, {
  ashAttack,
  fixedSkillsChoice,
  getAshChoices,
  parseAshChoice,
} from "./useAshes.ts";
import useMovesets, {
  allAttacks,
  attackTimingNotes,
  getAttackData,
  mountedAttacks,
  oneOffAttacks,
  riposteAttacks,
  type ChainLimit,
} from "./useMovesets.ts";
import useAmmo, { getAmmoLabel, weaponTypeAmmoClasses, withAmmo } from "./useAmmo.ts";
import useBuildResults, { useDpsCurves } from "./useBuildResults.ts";
import useStableArray from "./useStableArray.ts";
import CharacterSettings from "./CharacterSettings.tsx";
import SaveImport from "./SaveImport.tsx";
import BuildSettings from "./BuildSettings.tsx";
import TimingSettings from "./TimingSettings.tsx";
import LimitSettings from "./LimitSettings.tsx";
import DefenseSettings from "./DefenseSettings.tsx";
import WeaponPicker from "./WeaponPicker.tsx";
import ResultsTable, { type PinnedRow } from "./ResultsTable.tsx";
import RunProgressBar from "./RunProgressBar.tsx";
import {
  describePinSettings,
  getKeyOfPin,
  getPinChartKey,
  getPinSettings,
  parseRowKey,
  pinSettingKeys,
  restoreRequest,
  type Pin,
  type PinSettings,
} from "./pins.ts";
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
import ValueChart from "./ValueChart.tsx";
import { getResultStatus, sortResults } from "./results.ts";
import { defaultWeaponFilters, passesFilters } from "./filters.ts";
import {
  compareWeaponTypes,
  damageTypeLabels,
  objectiveOptions,
  statusTypes,
  weaponTypeLabels,
} from "./uiUtils.ts";
import { countRender } from "./perfProbe.ts";
import { isMobile } from "./mobile.ts";
import {
  getBuffSelection,
  getTableRequests,
  getWeaponRequestBuilder,
  labelSeparator,
  withGrip,
  withUpgradeLevel,
} from "./weaponRequests.ts";

/**
 * Identifies a request's result: its row (the weapon, which version of its fixed skill, the attack,
 * and the upgrade level)
 */
const getRequestKey = (request: BuildRequest) => request.row?.id ?? request.weapon.name;
const getResultKey = (result: BuildResult) => result.row?.id ?? result.weaponName;

/** A row's final stats assumed for every other row (see App's assumed) */
interface AssumedStats {
  /** The row's: a table row's result key, or "pin:" and a pinned row's pin ID */
  key: string;
  stats: Stats;
}

/** A request worked out with the assumed stats instead of optimized */
function withAssumedStats(request: BuildRequest, stats: Stats): BuildRequest {
  return {
    ...request,
    startLevel: getCharacterLevel(stats),
    attributes: Object.fromEntries(
      allAttributes.map((attribute) => [attribute, stats[attribute]]),
    ) as Attributes,
    fixedAttributes: true,
  };
}

export default function App() {
  countRender("App");
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
    buffSetups,
    upgradeLevels: savedUpgradeLevels,
    grips,
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
    ngPlus,
    radahnBeaten,
    scadutreeBlessing: savedScadutreeBlessing,
    scadutreeBlessingLevel,
    attacks: savedAttacks,
    chainWeight,
    sumChains,
    ashesOfWar: savedAshesOfWar,
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
  // A picked enemy decides whether the Scadutree Blessing applies: only in the Realm of Shadow
  const scadutreeBlessing =
    enemyKey != null && enemyInRealmOfShadow != null
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
  // condition (e.g. the Madding Hand's, after madness nearby) are active weapon effects, picked
  // separately like other buffs.
  const passives = useMemo(
    () =>
      new Map(allBuffs.filter((buff) => buff.kind === "offhand").map((buff) => [buff.name, buff])),
    [allBuffs],
  );
  const { buffEffects, offhandBuff, weaponBuff, weaponBuffEffects, uniqueSkills, oneHandedBuffs } =
    useMemo(
      () => getBuffSelection(selectedBuffs, stackTier, health),
      [selectedBuffs, stackTier, health],
    );

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
  // ripostes it can take are offered.
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
  // The picked attacks that are choices: a riposte the picked enemy can't take becomes one it can
  const attacks = useMemo(
    (): AppState["attacks"] => [
      ...new Set(
        savedAttacks.flatMap((attackName): AppState["attacks"][number][] =>
          (attackChoices as readonly string[]).includes(attackName)
            ? [attackName]
            : riposteAttacks.has(attackName)
            ? attackChoices.filter((choice) => riposteAttacks.has(choice)).slice(0, 1)
            : [],
        ),
      ),
    ],
    [savedAttacks, attackChoices],
  );
  // (each once, lowest first)
  const upgradeLevels = useMemo(
    () =>
      [...new Set(savedUpgradeLevels)]
        .filter((level) => level >= 0 && level <= maxRegularUpgradeLevel)
        .sort((a, b) => a - b),
    [savedUpgradeLevels],
  );
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
  // The picked skills that are choices
  const ashesOfWar = useMemo(
    () =>
      savedAshesOfWar.filter(
        (choice) =>
          choice === fixedSkillsChoice || ashChoices.some(({ value }) => value === choice),
      ),
    [savedAshesOfWar, ashChoices],
  );
  const ashLabels = useMemo(
    () => new Map(ashChoices.map(({ value, label }) => [value, label])),
    [ashChoices],
  );
  // Each row's name says which attack or skill it is
  const showRowLabels = attackActive && attacks.length + ashesOfWar.length > 0;

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
  // What importing from a save file needs, once it's all loaded
  const saveImportData = useMemo(
    () =>
      weapons.length && allBuffs.length && ashes.ashes.length && ammo.length
        ? {
            weapons,
            buffs: allBuffs,
            ashes,
            ashChoices: allAshChoices.map(({ value }) => value),
            offhandChoices: new Set(offhandWeaponChoices),
            catalystNames: new Set(catalysts.map((weapon) => weapon.weaponName)),
            ammo,
          }
        : undefined,
    [weapons, allBuffs, ashes, allAshChoices, offhandWeaponChoices, catalysts, ammo],
  );
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
  const getWeaponRequests = useMemo(
    () =>
      getWeaponRequestBuilder({
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
      }),
    [
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
    ],
  );

  // (and whether a weapon was left out because it has none of the chosen attacks or skills)
  const { unfilteredRequests, movesetsMissing } = useMemo(
    () =>
      getTableRequests({
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
      }),
    [
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
    ],
  );
  // Filtered before optimizing, so weapons filtered out aren't calculated at all. (Top N needs the
  // results, so it's applied after sorting.)
  const {
    baseGameOnly,
    damageTypes: filterDamageTypes,
    statusTypes: filterStatusTypes,
    maxWeight,
    maxRequirements,
    scalesWith,
    physicalTypes: filterPhysicalTypes,
  } = weaponFilters;
  const requests = useMemo(() => {
    const filters = {
      ...defaultWeaponFilters,
      baseGameOnly,
      damageTypes: filterDamageTypes,
      statusTypes: filterStatusTypes,
      maxWeight,
      maxRequirements,
      scalesWith,
      physicalTypes: filterPhysicalTypes,
    };
    return unfilteredRequests.filter((request) => passesFilters(request, filters, movesets));
  }, [
    unfilteredRequests,
    baseGameOnly,
    filterDamageTypes,
    filterStatusTypes,
    maxWeight,
    maxRequirements,
    scalesWith,
    filterPhysicalTypes,
    movesets,
  ]);

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
    maxRequirements,
    scalesWith,
    filterPhysicalTypes,
    savedUpgradeLevels,
    savedAttacks,
    savedAshesOfWar,
  ];
  const lastSelection = useRef(selection);
  useEffect(() => {
    if (selection.every((value, i) => value === lastSelection.current[i])) return;
    lastSelection.current = selection;
    const requested = new Set(requests.map(getRequestKey));
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
  // The table shows the stats its results were worked out from, so it doesn't render again with
  // the old results whenever they change
  const tableContext = useMemo(() => ({ startAttributes, plan }), [startAttributes, plan]);
  const {
    results: optimizedResults,
    resultContext: resultTableContext = tableContext,
    pending: mainPending,
    poolRef,
    progress,
  } = useBuildResults(requests, workerTopN, undefined, tableContext);

  // Pinned rows, whether their weapons are picked or not: a live pin's values use the current
  // settings with its own weapon and attack, and a frozen pin's the request it was frozen with.
  // They're worked out by a worker of their own, so they don't wait for the table or count towards
  // top N.
  const weaponsByName = useMemo(
    () => new Map(weapons.map((weapon) => [weapon.name, weapon])),
    [weapons],
  );
  // (a ranged weapon's name includes its ammunition, e.g. "Longbow (Arrow)")
  const findPinWeapon = useCallback(
    (name: string) => {
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
    },
    [weaponsByName, ammo],
  );
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
    [pins, findPinWeapon],
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
                  ? getWeaponRequests(weapon, undefined, pin).find(
                      (candidate) => candidate.skillVariant?.short === pin.skillVariant,
                    )
                  : undefined;
              })();
          if (!request) return [];
          pinRequestIds.set(request, pin.id);
          return [[pin.id, request]];
        }),
      ),
    [pins, frozenRequests, findPinWeapon, getWeaponRequests, pinRequestIds],
  );
  const pinRequestList = useMemo(() => [...pinRequests.values()], [pinRequests]);
  // The settings the pinned rows are shown with: other settings, like the chart's range, don't
  // change them, and they're kept with the pins' results like the table's
  const pinSettingsRef = useRef<PinSettings>();
  const currentPinSettings = useMemo(() => {
    const settings = getPinSettings(appState);
    const previous = pinSettingsRef.current;
    if (previous && pinSettingKeys.every((key) => previous[key] === settings[key])) return previous;
    return (pinSettingsRef.current = settings);
  }, [appState]);
  const {
    results: pinResults,
    resultRequests: pinResultRequests,
    resultContext: pinResultSettings = currentPinSettings,
    pending: pinsPending,
    poolRef: pinPoolRef,
  } = useBuildResults(pinRequestList, undefined, 1, currentPinSettings);
  const pinResultsById = useMemo(
    () =>
      new Map(pinResultRequests.map((request, i) => [pinRequestIds.get(request), pinResults[i]])),
    [pinResultRequests, pinResults, pinRequestIds],
  );
  const pinResultRequestsById = useMemo(
    () => new Map(pinResultRequests.map((request) => [pinRequestIds.get(request), request])),
    [pinResultRequests, pinRequestIds],
  );
  // (the same array until a pin gains or loses its request, rather than whenever settings change)
  const pinIdsWithRequests = useStableArray(useMemo(() => [...pinRequests.keys()], [pinRequests]));

  // A row's final stats can be assumed for every other row (but frozen pins): they're all worked out
  // with those stats instead, without the optimizer, by workers of their own, so the optimized
  // results stay as they are (for the chart, and for assuming another row's stats). Not saved.
  const [assumed, setAssumed] = useState<AssumedStats>();
  const [toggleAssumed] = useState(
    () => (key: string, stats: Stats) =>
      setAssumed((previous) => (previous?.key === key ? undefined : { key, stats })),
  );
  const assumedTableRequests = useMemo(
    () => (assumed ? requests.map((request) => withAssumedStats(request, assumed.stats)) : []),
    [assumed, requests],
  );
  const assumedPinRequests = useMemo(
    () =>
      assumed
        ? pins.flatMap((pin) => {
            const request = !pin.frozen && pinRequests.get(pin.id);
            if (!request) return [];
            const assumedRequest = withAssumedStats(request, assumed.stats);
            pinRequestIds.set(assumedRequest, pin.id);
            return [assumedRequest];
          })
        : [],
    [assumed, pins, pinRequests, pinRequestIds],
  );
  const assumedRequestList = useMemo(
    () => [...assumedTableRequests, ...assumedPinRequests],
    [assumedTableRequests, assumedPinRequests],
  );
  const {
    results: assumedResults,
    resultRequests: assumedResultRequests,
    resultContext: assumedResultStats,
    pending: assumedPending,
  } = useBuildResults(assumedRequestList, undefined, undefined, assumed);
  // (shown once they're worked out with the stats assumed now, until then the optimized ones)
  const assumedShown = assumed && assumedResultStats === assumed ? assumed : undefined;
  const assumedPinResults = useMemo(
    () =>
      new Map(
        assumedResultRequests.flatMap((request, i): [string, BuildResult][] => {
          const pinId = pinRequestIds.get(request);
          return pinId ? [[pinId, assumedResults[i]]] : [];
        }),
      ),
    [assumedResultRequests, assumedResults, pinRequestIds],
  );
  const assumedTableResults = useMemo(
    () => assumedResults.filter((_, i) => !pinRequestIds.has(assumedResultRequests[i])),
    [assumedResultRequests, assumedResults, pinRequestIds],
  );
  // The table's results
  const results = assumedShown ? assumedTableResults : optimizedResults;
  // With stats assumed, the optimized result of each table row, whose final stats its button
  // assumes
  const assumeSources = useMemo(
    () =>
      assumedShown
        ? new Map(optimizedResults.map((result) => [getResultKey(result), result]))
        : undefined,
    [assumedShown, optimizedResults],
  );

  const pending = mainPending || (pins.length > 0 && pinsPending) || (!!assumed && assumedPending);

  // A column for each status effect that any weapon in the table builds up
  const statusTypesShown = useStableArray(
    useMemo(
      () =>
        showStatus
          ? [...statusTypes.keys()].filter((statusType) =>
              [...results, ...pinResults].some(
                (result) => result.applicable && getResultStatus(result)[statusType],
              ),
            )
          : [],
      [showStatus, results, pinResults],
    ),
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
  const sortForTable = useCallback(
    (unsorted: BuildResult[]) => {
      const sorted = sortResults(
        unsorted,
        effectiveSortBy,
        effectiveReverse,
        !sortHidden && showDps,
      );
      // Top N keeps the first weapons in the table's order, leaving out ones that aren't applicable
      return topN.enabled
        ? sorted.filter((result) => result.applicable).slice(0, Math.max(topN.value, 1))
        : sorted;
    },
    [effectiveSortBy, effectiveReverse, sortHidden, showDps, topN],
  );
  const sortedResults = useMemo(() => sortForTable(results), [sortForTable, results]);
  // (the chart's, which are the optimized ones with stats assumed too)
  const sortedOptimizedResults = useMemo(
    () => (assumedShown ? sortForTable(optimizedResults) : sortedResults),
    [assumedShown, sortForTable, optimizedResults, sortedResults],
  );

  // Each pinned row with what it's shown with: its own attack's, and a frozen one's settings.
  // They're sorted like the table, after any that aren't worked out yet.
  const unstablePinnedRows = useMemo(() => {
    const defaultPinSettings = getPinSettings(defaultAppState);
    const frozenKeys = getFrozenKeys(pins);
    const rows = pins.map((pin): PinnedRow => {
      const settings = pin.frozen?.settings ?? pinResultSettings;
      const oneOffAttack = oneOffAttacks.has(pin.attack);
      const result =
        pinResultsById.get(pin.id) ??
        // (only what the table shows for a row that isn't applicable)
        ({
          weaponName: pin.weaponName,
          url: null,
          applicable: false,
          unavailableReason: pinIdsWithRequests.includes(pin.id)
            ? "Calculating…"
            : pin.frozen
            ? "Not available: a weapon it was frozen with wasn't found"
            : "Not available: the weapon or its attack wasn't found",
        } as BuildResult);
      return {
        pin,
        result,
        // (kept together with the weapon's last word, so it doesn't wrap onto a line alone)
        name: (() => {
          const name = withUpgradeLevel(
            findPinWeapon(pin.weaponName),
            pin.weaponName,
            pin.upgradeLevel,
          );
          return pin.label ? name + labelSeparator + pin.label : name;
        })(),
        chartKey: getPinChartKey(pin),
        ...(!pin.frozen && {
          freezeBlocked: getFreezeBlocked(pinResultRequestsById.get(pin.id), frozenKeys),
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
            pinResultSettings,
            defaultPinSettings,
            pin.attack,
            !!pin.frozen.request.attack?.chain,
            allBuffs,
          ),
        ...(pin.frozen && {
          restorable: restoreChangesSettings(pin, {
            ...currentPinSettings,
            upgradeLevels,
            grips,
          }),
        }),
      };
    });
    // With stats assumed, a live pin shows its result with them, and its button assumes its
    // optimized final stats
    const shownRows = assumedShown
      ? rows.map((row): PinnedRow => {
          const assumedResult = !row.pin.frozen && assumedPinResults.get(row.pin.id);
          return assumedResult
            ? {
                ...row,
                result: assumedResult,
                planStats: assumedShown.stats,
                assumeResult: row.result,
                assumePlanStats: row.planStats,
              }
            : row;
        })
      : rows;
    const worked = shownRows.filter((row) => row.result.curve);
    const byResult = new Map(worked.map((row) => [row.result, row]));
    return [
      ...sortResults(
        worked.map((row) => row.result),
        effectiveSortBy,
        effectiveReverse,
        !sortHidden && showDps,
      ).map((result) => byResult.get(result)!),
      ...shownRows.filter((row) => !row.result.curve),
    ];
  }, [
    assumedShown,
    assumedPinResults,
    pins,
    pinResultsById,
    pinResultRequestsById,
    pinIdsWithRequests,
    pinResultSettings,
    currentPinSettings,
    upgradeLevels,
    grips,
    allBuffs,
    tooltipTimings,
    findPinWeapon,
    effectiveSortBy,
    effectiveReverse,
    sortHidden,
    showDps,
  ]);
  // (the same empty array while there are no pins)
  const pinnedRows = useStableArray(unstablePinnedRows);
  // The table's rows that are pinned too: a live pin's are the same row. (A frozen pin isn't, so the
  // row can be pinned again to compare it with the current settings.)
  const rowPins = useMemo(() => {
    const pinsByKey = new Map(
      pins.filter((pin) => !pin.frozen).map((pin) => [getKeyOfPin(pin), pin]),
    );
    return new Map(
      sortedResults.flatMap((result): [BuildResult, Pin][] => {
        const pin = result.row && pinsByKey.get(result.row.id);
        return pin ? [[result, pin]] : [];
      }),
    );
  }, [pins, sortedResults]);

  // A row pinned live is charted by its pin's key (when it's pinned, a pin is unfrozen, or from
  // before they were merged)
  useEffect(() => {
    const merged = mergeChartKeys(chartWeapons, pins);
    if (merged.length !== chartWeapons.length || merged.some((key, i) => key !== chartWeapons[i])) {
      updateAppState({ chartWeapons: merged });
    }
  }, [chartWeapons, pins, updateAppState]);
  // The keys of the table's rows that are pinned live, by their pins' chart keys
  const rowKeysByPinChartKey = useMemo(
    () =>
      new Map(
        [...rowPins].map(([result, pin]) => [getPinChartKey(pin), getResultKey(result)] as const),
      ),
    [rowPins],
  );

  // Pinning, freezing, and restoring a frozen pin's settings, with the latest state (so the table
  // gets the same functions every time)
  const latest = useRef({
    pins,
    chartWeapons,
    pinRequests,
    appState,
    ashLabels,
    rowKeysByPinChartKey,
  });
  latest.current = { pins, chartWeapons, pinRequests, appState, ashLabels, rowKeysByPinChartKey };
  const [pinActions] = useState(() => ({
    pin: (result: BuildResult) => {
      const { pins, ashLabels, appState } = latest.current;
      if (!result.row) return;
      const choice = parseRowKey(result.row.id);
      const { attack, ashOfWar } = choice;
      const attackLabel =
        appState.objective === "spellScaling"
          ? ""
          : attack === ashAttack
          ? result.skillVariant?.label ?? result.fixedSkill ?? ashLabels.get(ashOfWar) ?? "Skill"
          : attack;
      // With its grip if the row has it (it has a row with the other grip)
      const label = result.row.name.includes(
        labelSeparator + withGrip(attackLabel, choice.twoHanding),
      )
        ? withGrip(attackLabel, choice.twoHanding)
        : attackLabel;
      const pin: Pin = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        weaponName: result.weaponName,
        ...choice,
        ...(result.skillVariant && { skillVariant: result.skillVariant.short }),
        label,
      };
      updateAppState({ pins: [...pins, pin] });
    },
    unpin: (id: string) => {
      const { pins, chartWeapons, rowKeysByPinChartKey } = latest.current;
      updateAppState(unpin({ pins, chartWeapons }, id, rowKeysByPinChartKey));
    },
    unpinAll: () => {
      const { chartWeapons, rowKeysByPinChartKey } = latest.current;
      updateAppState(unpinAll({ chartWeapons }, rowKeysByPinChartKey));
    },
    toggleFreeze: (id: string) => {
      const { pins, pinRequests, appState } = latest.current;
      updateAppState({
        pins: toggleFreeze(pins, id, pinRequests.get(id), getPinSettings(appState)),
      });
    },
    restore: (id: string) => {
      const { pins, appState } = latest.current;
      const pin = pins.find((other) => other.id === id);
      const settings = pin && getRestoredSettings(pin, appState);
      if (settings) updateAppState(settings);
    },
  }));

  // The chart shows the weapons checked in the table, each version of a fixed skill (e.g. Moonveil's
  // R1 and R2) as its own line, and pinned rows checked, named with their attacks
  const livePinKeys = useMemo(
    () => new Set(pins.filter((pin) => !pin.frozen).map(getKeyOfPin)),
    [pins],
  );
  const chartedResults = useMemo(
    () =>
      sortedOptimizedResults.filter(
        (result) =>
          result.applicable &&
          !(result.row && livePinKeys.has(result.row.id)) &&
          chartWeapons.includes(getResultKey(result)),
      ),
    [sortedOptimizedResults, chartWeapons, livePinKeys],
  );
  const chartedPins = useMemo(
    () =>
      fastMode
        ? []
        : pinnedRows
            .map((row) => (row.assumeResult ? { ...row, result: row.assumeResult } : row))
            .filter((row) => row.result.applicable && chartWeapons.includes(row.chartKey)),
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
    weaponName:
      (result.row?.name ?? result.weaponName) +
      // (named with its skill already when rows are named with their attacks)
      (result.skillVariant && !showRowLabels ? ` (${result.skillVariant.short})` : ""),
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

  const showChart = chartResults.length > 0 && !fastMode;
  // The chart's last results, so it keeps its curves while it collapses away
  const shownChartResults = useRef(chartResults);
  if (showChart) shownChartResults.current = chartResults;

  // Attacks other than the base one have hits to show. They don't apply to spell scaling.
  const attackMode = attackActive;
  // Also show hits for the base attack when a weapon fires several, e.g. the Spread Crossbow
  const showHits =
    attackMode ||
    (objective !== "spellScaling" &&
      sortedResults.some((result) => (result.attackSteps?.flat().length ?? 0) > 1));
  const objectiveLabel = objectiveOptions.find(([value]) => value === objective)![1];
  // One-off attacks (running, backstep, guard counters, critical hits) don't say when they could
  // start again
  const oneOffTimings = useMemo(() => ({ ...tooltipTimings, nextChain: false }), [tooltipTimings]);
  // What each row's attack is shown with
  const rowAttacks = useMemo(
    () =>
      new Map(
        sortedResults.map((result) => {
          const attack = result.row ? parseRowKey(result.row.id).attack : "R1";
          const oneOffAttack = oneOffAttacks.has(attack);
          return [
            result,
            {
              skill: attack === ashAttack,
              oneOffAttack,
              hitsNote: attackTimingNotes[attack],
              tooltipTimings: oneOffAttack ? oneOffTimings : tooltipTimings,
            },
          ];
        }),
      ),
    [sortedResults, oneOffTimings, tooltipTimings],
  );
  // (the attack is in each row's name)
  const valueLabel = objectiveLabel;
  const pointLabel = objective === "spellScaling" ? "scaling" : "damage";
  // As the table's header labels it, without the attack, e.g. "DPS" or "Total damage"
  const chartValueLabel = showDps ? "DPS" : objectiveLabel;
  const movesetsMissingMessage = "No selected weapon has the chosen moveset(s).";
  const notApplicableLabel =
    objective === "spellScaling"
      ? "Not a catalyst"
      : objective === "totalAttack"
      ? "No damage"
      : `No ${damageTypeLabels.get(objective as AttackPowerType)} damage`;

  const settings = (
    <Stack spacing={2}>
      {/* No save file to open on a phone or tablet */}
      {!isMobile && (
        <SaveImport
          data={saveImportData}
          selectedBuffs={selectedBuffKeys}
          onChange={updateAppState}
        />
      )}
      <CharacterSettings
        startingClass={startingClass}
        stats={stats}
        plannedStats={plannedStats}
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
        upgradeLevels={upgradeLevels}
        grips={grips}
        showScaling={showScaling}
        showStatus={savedShowStatus}
        showStance={savedShowStance}
        showStamina={savedShowStamina}
        showDamagePerStamina={savedShowDamagePerStamina}
        showStancePerStamina={savedShowStancePerStamina}
        showPotential={showPotential}
        showRequirements={showRequirements}
        onlyBuffable={onlyBuffable}
        weaponFilters={weaponFilters}
        weaponTypes={weaponTypes}
        attacks={attacks}
        chainWeight={chainWeight}
        sumChains={sumChains}
        hasChain={requests.some((request) => request.attack?.chain)}
        ashesOfWar={ashesOfWar}
        ashChoices={ashChoices}
        attackChoices={attackChoices}
        affinityIds={affinityIds}
        ammo={ammo}
        selectedAmmo={selectedAmmo}
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
        mounted={attacks.some((attackName) => mountedAttacks.has(attackName))}
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
        buffSetups={buffSetups}
        leftHandWeapon={
          attacks.some((attackName) => attackName.startsWith("Powerstance")) && offhandWeaponData
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
                  <RunProgressBar progress={progress} pending={pending} />
                  {requests.length > 0 || pins.length > 0 ? (
                    <Stack spacing={2}>
                      <Collapse in={showChart} timeout={150} unmountOnExit>
                        <ValueChart
                          results={shownChartResults.current}
                          startLevel={planLevel}
                          valueLabel={chartValueLabel}
                          range={chartRange}
                          onChange={updateAppState}
                        />
                      </Collapse>
                      {movesetsMissing && (
                        <Typography color="text.secondary" px={2}>
                          {movesetsMissingMessage}
                        </Typography>
                      )}
                      {assumed && (
                        <Alert
                          severity="info"
                          action={
                            <Button
                              color="inherit"
                              size="small"
                              onClick={() => setAssumed(undefined)}
                            >
                              Stop
                            </Button>
                          }
                        >
                          Using assumed stats
                        </Alert>
                      )}
                      <ResultsTable
                        results={sortedResults}
                        pinnedRows={pinnedRows}
                        rowPins={rowPins}
                        pinActions={pinActions}
                        chartWeapons={chartWeapons}
                        chartDisabled={fastMode}
                        startAttributes={resultTableContext.startAttributes}
                        planStats={assumedShown?.stats ?? resultTableContext.plan}
                        assumedKey={assumed?.key}
                        assumeSources={assumeSources}
                        assumePlanStats={resultTableContext.plan}
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
                        oneOffAttack={
                          attacks.length > 0 &&
                          !ashesOfWar.length &&
                          attacks.every((attackName) => oneOffAttacks.has(attackName))
                        }
                        rowAttacks={rowAttacks}
                        showRequirements={showRequirements}
                        sortBy={sortBy}
                        reverse={reverse}
                        onAssumeStats={toggleAssumed}
                        onChange={updateAppState}
                      />
                    </Stack>
                  ) : (
                    <Typography color="text.secondary" p={2}>
                      {validSelectedWeapons.length === 0 && weaponTypes.length === 0
                        ? "Pick some weapons or weapon types to compare."
                        : upgradeLevels.length === 0
                        ? "Pick at least one weapon level."
                        : attackActive && attacks.length === 0 && ashesOfWar.length === 0
                        ? "Pick at least one attack or Ash of War."
                        : movesetsMissing
                        ? movesetsMissingMessage
                        : "Pick at least one affinity, or a weapon that can't be infused."}
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
