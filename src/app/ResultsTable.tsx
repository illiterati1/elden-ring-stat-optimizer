import { memo, type ReactNode } from "react";
import {
  Box,
  Checkbox,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from "@mui/material";
import { allAttributes, type AttackPowerType, type Attributes } from "../calculator/calculator.ts";
import type { AttackResultHit, BuildResult, StepTimes } from "../optimizer/build.ts";
import { getStatLabel } from "../optimizer/startingClasses.ts";
import { limitReasonLabels, physicalTypeLabels, statusTypes } from "./uiUtils.ts";
import { getDamagePerStamina, getStancePerStamina, getResultStatus } from "./results.ts";
import { statusSortBy } from "./useAppState.ts";
import BreakdownTable from "./BreakdownTable.tsx";
import Details, { detailsBackground, tooltipCueSx } from "./Details.tsx";
import type { AppState, SortBy, TooltipTimings, UpdateAppState } from "./useAppState.ts";
import { maxSeries } from "./ValueChart.tsx";

interface Props {
  /** Results, already sorted */
  results: BuildResult[];
  chartWeapons: AppState["chartWeapons"];
  /** True if there's no chart (fast mode), so weapons can't be added to it */
  chartDisabled?: boolean;
  startAttributes: Attributes;
  valueLabel: string;
  /** What one point of the objective is called: "damage" or "scaling" */
  pointLabel: string;
  notApplicableLabel: string;
  showScaling: boolean;
  showRequirements: boolean;
  /** A column for each of these status effects */
  statusTypes: AttackPowerType[];
  /** Show each hit of the chosen attack */
  showHits: boolean;
  /** Show the chosen attack's stance damage */
  showStance: boolean;
  /** Show the chosen attack's stamina cost */
  showStamina: boolean;
  /** Show the chosen attack's damage per point of stamina */
  showDamagePerStamina: boolean;
  /** Show the chosen attack's stance damage per point of stamina */
  showStancePerStamina: boolean;
  /** Show the chosen attack's damage per second */
  showDps: boolean;
  /**
   * The chosen attack is done once from a run, a backstep, a block, or a critical hit
   * (oneOffAttacks): its values per second only count the attack itself, not setting it up again
   */
  oneOffAttack: boolean;
  /** Timings shown in the hits tooltip */
  tooltipTimings: TooltipTimings;
  /** The chosen attack is a skill (Ash of War) */
  skill: boolean;
  /** A note on the chosen attack's timing, shown under its hits */
  hitsNote?: string;
  sortBy: AppState["sortBy"];
  reverse: AppState["reverse"];
  onChange: UpdateAppState;
}

function formatValue(value: number) {
  return Math.floor(value + 1e-9).toString();
}

/** Stance damage is small, so it keeps one decimal place */
function formatStance(value: number) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Damage per point of stamina keeps one decimal place */
function formatDamagePerStamina(value: number) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Stance damage per point of stamina is mostly below a few points, so it keeps two */
function formatStancePerStamina(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** A value per point of stamina, blank if the attack's stamina cost isn't known */
function perStaminaCell(value: number | undefined, format: (value: number) => string) {
  return value != null ? format(value) : "";
}

/** Stamina costs are mostly whole numbers, but a chain's weighted average keeps one decimal place */
function formatStamina(value: number) {
  return (Math.round(value * 10) / 10).toString();
}

/** Borders around the final stats and scaling column groups */
const leftBorderSx = { borderLeft: 1, borderLeftColor: "divider" };
const bothBordersSx = { ...leftBorderSx, borderRight: 1, borderRightColor: "divider" };

/** Seconds without trailing zeros, e.g. "0.7s" */
const formatSeconds = (seconds: number) => `${+seconds.toFixed(2)}s`;

/** A hit's status buildup: per tick for a tick, e.g. "120/0.7s (×5)" for a lingering cloud */
function formatStatus(hit: AttackResultHit, buildup: number) {
  if (!hit.tick || !hit.tickInterval) return formatValue(buildup);
  return (
    `${formatValue(buildup)}/${formatSeconds(hit.tickInterval)}` +
    (hit.tickCount ? ` (×${hit.tickCount})` : "")
  );
}

/**
 * Each step of an attack's damage, e.g. "312 | 315 | 150 + 160", with a tooltip of each hit's
 * damage, stance damage, and status buildup
 */
function AttackHits({
  steps,
  stepTimes,
  repeatFrom,
  timings,
  label,
  skill,
  title,
  notes,
}: {
  steps: AttackResultHit[][];
  stepTimes?: StepTimes[];
  /** The step the chain goes back to, if not the first */
  repeatFrom?: number;
  timings: TooltipTimings;
  label: string;
  /** The attack is a skill, repeated as the same skill rather than the same attack */
  skill: boolean;
  /** The heading of the details drawer on touch devices */
  title: string;
  /** Notes on the attack's timing, under its hits */
  notes: string[];
}) {
  // When each step starts, from the start of the chain (as far as the steps' lengths are known),
  // or for a loop, from the press (after its opening)
  const opening = stepTimes?.[0]?.opening;
  const loop = !!stepTimes?.[0]?.loop;
  const stepStarts: (number | undefined)[] = [];
  let elapsed: number | undefined = opening ?? 0;
  for (const times of stepTimes ?? []) {
    stepStarts.push(elapsed);
    elapsed = elapsed != null && times.cycle != null ? elapsed + times.cycle : undefined;
  }
  const chainTime = stepTimes ? elapsed : undefined;
  // When the attack can actually start again, if sooner than its cycle (its effects don't stack)
  const lastTimes = stepTimes?.[stepTimes.length - 1];
  const recastTime =
    chainTime != null && lastTimes?.recast != null && lastTimes.cycle != null
      ? chainTime - lastTimes.cycle + lastTimes.recast
      : undefined;
  const at = (stepIndex: number, time: number | undefined) =>
    stepStarts[stepIndex] != null && time != null ? stepStarts[stepIndex]! + time : undefined;
  const hitRows = steps.flatMap((step, i) =>
    step.map((hit, j) => {
      const times = stepTimes?.[i];
      // Each hit's own time if known, or if the animations have as many, or else the step's first's
      const ownTimes = times?.hitTimes?.length === step.length ? times.hitTimes : undefined;
      const hitTime =
        times &&
        (ownTimes
          ? ownTimes[j]
          : times.hits.length === step.length
          ? times.hits[j]
          : j === 0
          ? times.hits[0]
          : null);
      return {
        step: i,
        hit,
        hitAt: hitTime != null ? at(i, hitTime) : undefined,
        // Projectiles' times are when they're created, or measured at one distance
        approximate: !!(ownTimes && times?.approximate?.[j]),
      };
    }),
  );
  // In order of when they hit (a hit without a time stays after the one before it), e.g. a
  // projectile landing after the next step's swing, and numbered in that order
  let previousTime = -Infinity;
  const sortedHitRows = hitRows
    .map((row, index) => {
      previousTime = row.hitAt ?? previousTime;
      return { row, time: previousTime, index };
    })
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ row }) => row);
  // Each step's cancels, on its last hit to land
  const lastRows = new Map(sortedHitRows.map((row, index) => [row.step, index]));
  // Each step's early roll-outs (before its last hit, skipping the rest), on the last hit before
  // each (by row)
  const earlyRolls = new Map<number, number>();
  stepTimes?.forEach((times, step) => {
    for (const time of times?.earlyRolls ?? []) {
      let before: number | undefined;
      sortedHitRows.forEach((row, index) => {
        if (row.step === step && row.hitAt != null && row.hitAt <= (at(step, time) ?? -Infinity)) {
          before = index;
        }
      });
      if (before != null && !earlyRolls.has(before)) earlyRolls.set(before, at(step, time)!);
    }
  });
  // Each hit numbered within its step in that order ("step.hit")
  const hitNumbers = new Map<number, number>();
  const rows = sortedHitRows.map((row, index) => {
    const times = stepTimes?.[row.step];
    const last = lastRows.get(row.step) === index;
    const number = (hitNumbers.get(row.step) ?? 0) + 1;
    hitNumbers.set(row.step, number);
    return {
      ...row,
      label: steps[row.step].length > 1 ? `${row.step + 1}.${number}` : `${row.step + 1}`,
      earliest:
        last && times?.earliest
          ? { ...times.earliest, time: at(row.step, times.earliest.time) }
          : undefined,
      // (a window open since before the last hit shows only when it opens)
      roll:
        earlyRolls.get(index) ??
        (last && !times?.earlyRollStaysOpen ? at(row.step, times?.roll) : undefined),
      earlyRoll: earlyRolls.has(index),
      block: last ? at(row.step, times?.block) : undefined,
      move: last ? at(row.step, times?.move) : undefined,
    };
  });
  const showHitTimes = timings.hits && rows.some((row) => row.hitAt != null);
  const showEarliest = timings.cancel && rows.some((row) => row.earliest?.time != null);
  const showRoll = timings.roll && rows.some((row) => row.roll != null);
  const showBlock = timings.block && rows.some((row) => row.block != null);
  const showMove = timings.move && rows.some((row) => row.move != null);
  const showNextChain = timings.nextChain && chainTime != null;
  // Damage over time is shown per second, or per tick if its interval isn't known (just 0 for ticks
  // that only build up status, e.g. Chilling Mist's cloud)
  const formatHit = (hit: AttackResultHit) =>
    hit.damage === 0
      ? "0"
      : hit.perSecond != null
      ? `${formatValue(hit.perSecond)}/s`
      : hit.tick
      ? `${formatValue(hit.damage)}/tick`
      : formatValue(hit.damage);
  // Damage of a percentage of the enemy's HP (e.g. black flame) follows the hit in parentheses
  // A hit that isn't counted (e.g. Dragonform Flame's ground fire) is in parentheses
  const formatHitWithHpDamage = (hit: AttackResultHit) => {
    const text = formatHit(hit) + (hit.hpDamage ? ` (+${formatValue(hit.hpDamage.damage)})` : "");
    return hit.notCounted ? `(${text})` : text;
  };
  // Hits that only do stance damage (e.g. War Cry's charged R2 ticks) are left out of the text, but
  // shown in the tooltip
  // Repeated hits are shown once with how many there are, e.g. "619 + 125×4"
  const formatStep = (step: AttackResultHit[]) => {
    const damaging = step.filter((hit) => hit.damage > 0);
    const counts = new Map<string, number>();
    for (const text of (damaging.length ? damaging : step).map(formatHitWithHpDamage)) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    return [...counts].map(([text, count]) => (count > 1 ? `${text}×${count}` : text)).join(" + ");
  };
  const statusTypesShown = [...statusTypes].filter(([statusType]) =>
    rows.some(({ hit }) => hit.status[statusType]),
  );
  // Only attacks with projectiles, area attacks, etc. need a column saying which hits they are
  const showKind = rows.some(({ hit }) => hit.kind);
  // Each step's stamina cost, on its first hit
  const showStaminaColumn = rows.some(({ hit }) => hit.stamina != null);
  const hpDamageLabel = rows.find(({ hit }) => hit.hpDamage)?.hit.hpDamage!.label;
  const cellSx = { color: "inherit", px: 1, py: 0.25 };
  // The hit's label stays in view when the table scrolls sideways (in the drawer on touch devices)
  const labelCellSx = {
    ...cellSx,
    position: "sticky",
    left: 0,
    zIndex: 1,
    backgroundColor: detailsBackground,
  };
  return (
    <Details
      title={title}
      triggerSx={{ whiteSpace: "nowrap" }}
      content={
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={labelCellSx}>Hit</TableCell>
              {showKind && <TableCell sx={cellSx}>Kind</TableCell>}
              <TableCell sx={cellSx}>Physical</TableCell>
              <TableCell sx={cellSx} align="right">
                {label}
              </TableCell>
              {hpDamageLabel && (
                <TableCell sx={cellSx} align="right">
                  {hpDamageLabel}
                </TableCell>
              )}
              <TableCell sx={cellSx} align="right">
                Stance
              </TableCell>
              {showStaminaColumn && (
                <TableCell sx={cellSx} align="right">
                  Stamina
                </TableCell>
              )}
              {statusTypesShown.map(([statusType, { label, icon }]) => (
                <TableCell key={statusType} sx={cellSx} align="right">
                  <img src={icon} alt={label} title={label} width={16} height={16} />
                </TableCell>
              ))}
              {showHitTimes && (
                <TableCell
                  sx={cellSx}
                  align="right"
                  title="When the hit lands (~: approximate, a projectile's, which depends on how far away the target is)"
                >
                  Hit at
                </TableCell>
              )}
              {showEarliest && (
                <TableCell
                  sx={cellSx}
                  title="When the step can first be cancelled into another attack, and which (R1/R2: either right hand attack)"
                >
                  Earliest attack
                </TableCell>
              )}
              {showRoll && (
                <TableCell sx={cellSx} align="right" title="When the step can be rolled out of">
                  Roll
                </TableCell>
              )}
              {showBlock && (
                <TableCell sx={cellSx} align="right" title="When the step can be blocked out of">
                  Block
                </TableCell>
              )}
              {showMove && (
                <TableCell sx={cellSx} align="right" title="When moving can end the step">
                  Move
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {opening != null && (showHitTimes || showNextChain) && (
              <TableRow>
                <TableCell sx={cellSx} colSpan={99}>
                  {loop ? "Loop starts" : "Step 1 starts (after the stance)"} at{" "}
                  {formatSeconds(opening)}
                </TableCell>
              </TableRow>
            )}
            {rows.map(
              ({ label, hit, hitAt, approximate, earliest, roll, earlyRoll, block, move }) => (
                <TableRow key={label}>
                  <TableCell sx={labelCellSx}>{label}</TableCell>
                  {showKind && <TableCell sx={cellSx}>{hit.kind ?? "Weapon"}</TableCell>}
                  <TableCell sx={cellSx}>
                    {hit.physicalType ? physicalTypeLabels[hit.physicalType] : "–"}
                  </TableCell>
                  <TableCell sx={cellSx} align="right">
                    {formatHit(hit)}
                  </TableCell>
                  {hpDamageLabel && (
                    <TableCell sx={cellSx} align="right">
                      {hit.hpDamage ? formatValue(hit.hpDamage.damage) : "–"}
                    </TableCell>
                  )}
                  <TableCell sx={cellSx} align="right">
                    {formatStance(hit.stance)}
                  </TableCell>
                  {showStaminaColumn && (
                    <TableCell sx={cellSx} align="right">
                      {hit.stamina != null
                        ? hit.moveStamina
                          ? `${formatStamina(hit.stamina)} (${formatStamina(
                              hit.stamina - hit.moveStamina.stamina,
                            )} + ${formatStamina(hit.moveStamina.stamina)} ${
                              hit.moveStamina.action
                            })`
                          : formatStamina(hit.stamina)
                        : ""}
                    </TableCell>
                  )}
                  {statusTypesShown.map(([statusType]) => (
                    <TableCell key={statusType} sx={cellSx} align="right">
                      {hit.status[statusType] ? formatStatus(hit, hit.status[statusType]!) : "–"}
                    </TableCell>
                  ))}
                  {showHitTimes && (
                    <TableCell sx={cellSx} align="right">
                      {hitAt != null ? `${approximate ? "~" : ""}${formatSeconds(hitAt)}` : ""}
                    </TableCell>
                  )}
                  {showEarliest && (
                    <TableCell sx={cellSx}>
                      {earliest?.time != null
                        ? `${formatSeconds(earliest.time)} (${earliest.attack})`
                        : ""}
                    </TableCell>
                  )}
                  {showRoll && (
                    <TableCell
                      sx={cellSx}
                      align="right"
                      title={earlyRoll ? "Rolling here skips the step's later hits" : undefined}
                    >
                      {roll != null ? formatSeconds(roll) : ""}
                    </TableCell>
                  )}
                  {showBlock && (
                    <TableCell sx={cellSx} align="right">
                      {block != null ? formatSeconds(block) : ""}
                    </TableCell>
                  )}
                  {showMove && (
                    <TableCell sx={cellSx} align="right">
                      {move != null ? formatSeconds(move) : ""}
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
            {showNextChain && (
              <TableRow>
                <TableCell sx={cellSx} colSpan={99}>
                  {stepTimes?.[stepTimes.length - 1]?.cutShort
                    ? `${stepTimes.length > 1 ? "Chain over" : "Over"} at ${formatSeconds(
                        chainTime!,
                      )}`
                    : repeatFrom
                    ? `Back to step ${repeatFrom + 1} at ${formatSeconds(chainTime!)}`
                    : loop
                    ? `Next pass at ${formatSeconds(chainTime!)}`
                    : `Same ${skill ? "skill" : "attack"} at ${formatSeconds(
                        recastTime ?? chainTime!,
                      )}`}
                </TableCell>
              </TableRow>
            )}
            {notes.map((note) => (
              <TableRow key={note}>
                <TableCell sx={cellSx} colSpan={99}>
                  {note}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      {/* Kept on one line, since wrapped chains are hard to read */}
      {steps.map(formatStep).join(" | ")}
    </Details>
  );
}

/** Status columns are narrow, so they're packed closer together than other columns */
const statusCellSx = { px: 0.75 };

function formatScaling(scaling: number | undefined) {
  return scaling ? Math.round(scaling * 100).toString() : "–";
}

/**
 * Compares the optimized build for each selected weapon
 */
function ResultsTable({
  results: sorted,
  chartWeapons,
  chartDisabled = false,
  startAttributes,
  valueLabel,
  pointLabel,
  notApplicableLabel,
  showScaling,
  showRequirements,
  statusTypes: statusColumns,
  showHits,
  showStance,
  showStamina,
  showDamagePerStamina,
  showStancePerStamina,
  showDps,
  oneOffAttack,
  tooltipTimings,
  skill,
  hitsNote,
  sortBy,
  reverse,
  onChange,
}: Props) {
  /**
   * @param compact for narrow columns: the arrow sits in the cell's left padding instead of
   * widening the column
   */
  const sortLabel = (
    column: SortBy,
    label: ReactNode,
    defaultDirection: "asc" | "desc",
    compact = false,
  ) => {
    const flip = (direction: "asc" | "desc") => (direction === "asc" ? "desc" : "asc");
    return (
      <TableSortLabel
        sx={
          compact
            ? {
                position: "relative",
                "& .MuiTableSortLabel-icon": { position: "absolute", left: -18, mx: 0 },
              }
            : undefined
        }
        active={sortBy === column}
        direction={sortBy === column && reverse ? flip(defaultDirection) : defaultDirection}
        onClick={() =>
          onChange(sortBy === column ? { reverse: !reverse } : { sortBy: column, reverse: false })
        }
      >
        {label}
      </TableSortLabel>
    );
  };

  const chartCheckbox = (weaponName: string) => {
    const checked = chartWeapons.includes(weaponName);
    const full = !checked && chartWeapons.length >= maxSeries;
    return (
      <Tooltip
        title={
          chartDisabled
            ? "No chart in fast mode"
            : full
            ? `The chart shows up to ${maxSeries} weapons`
            : "Show on chart"
        }
      >
        {/* Wrapped so the tooltip still works when the checkbox is disabled */}
        <span>
          <Checkbox
            size="small"
            checked={checked && !chartDisabled}
            disabled={full || chartDisabled}
            inputProps={{ "aria-label": `Show ${weaponName} on chart` }}
            onChange={(evt) =>
              onChange({
                chartWeapons: evt.currentTarget.checked
                  ? [...chartWeapons, weaponName]
                  : chartWeapons.filter((name) => name !== weaponName),
              })
            }
          />
        </span>
      </Tooltip>
    );
  };

  // Columns for each attribute, grouped: final stats, then scaling and requirements if shown
  const groups = [
    ["stats", "Final stats"],
    ...(showScaling ? [["scaling", "Scaling"]] : []),
    ...(showRequirements ? [["requirements", "Requirements"]] : []),
  ] as const;
  const lastGroup = groups[groups.length - 1][0];
  const headerRows = groups.length > 1 ? 2 : 1;

  // Each attribute column group gets a border on its left, and the last group also gets one on its
  // right
  const groupBorderSx = (i: number, lastGroup: boolean) => {
    if (i === 0) return leftBorderSx;
    if (lastGroup && i === allAttributes.length - 1) {
      return { borderRight: 1, borderRightColor: "divider" };
    }
    return undefined;
  };

  // Scaling (highest first) and requirement (lowest first) columns can be sorted by
  const attributeHeaders = (group: typeof groups[number][0], lastGroup = false) =>
    allAttributes.map((attribute, i) => {
      const label = getStatLabel(attribute).slice(0, 3);
      return (
        <TableCell
          key={`${group}-${attribute}`}
          align="right"
          title={getStatLabel(attribute)}
          sx={groupBorderSx(i, lastGroup)}
        >
          {group === "scaling"
            ? sortLabel(`scaling:${attribute}`, label, "desc", true)
            : group === "requirements"
            ? sortLabel(`requirement:${attribute}`, label, "asc", true)
            : label}
        </TableCell>
      );
    });

  // Values per second: a one-off attack's don't count the time to set it up again, noted briefly in
  // the hits' timings (and at length in the timing settings)
  const oneOffPerSecond = showDps && oneOffAttack;
  const oneOffNote = "Per second without the time to repeat it";
  const perSecondOver = oneOffAttack
    ? " over the attack itself, until anything can follow it, not counting the time to repeat it"
    : ", repeating the attack as fast as the game allows";
  // Per second, e.g. "DPS (R1)"
  const perSecondLabel =
    (pointLabel === "damage" ? "DPS" : "AR/s") +
    (valueLabel.includes(" (") ? valueLabel.slice(valueLabel.indexOf(" (")) : "");

  return (
    // Scrolls within the viewport's height, since the header can only stick to the top of the
    // container that scrolls the table sideways
    <TableContainer component={Paper} sx={{ maxHeight: "100vh" }}>
      <Table
        size="small"
        sx={{
          // Match the row borders to the column group borders
          "& .MuiTableCell-root": { borderBottomColor: "divider" },
          // The whole header sticks, rather than each cell, since its second row (the attribute
          // groups) sits under the first
          "& .MuiTableHead-root": {
            position: "sticky",
            top: 0,
            zIndex: 2,
            backgroundColor: "background.paper",
          },
        }}
      >
        <TableHead>
          <TableRow>
            {/* Chart checkboxes */}
            <TableCell rowSpan={headerRows} padding="checkbox" />
            <TableCell rowSpan={headerRows}>{sortLabel("name", "Weapon", "asc")}</TableCell>
            <TableCell rowSpan={headerRows} align="right">
              {showDps ? (
                <Tooltip
                  title={
                    oneOffAttack
                      ? `${
                          pointLabel === "damage" ? "Damage" : "Attack power"
                        } per second${perSecondOver}, from its animations`
                      : `${
                          pointLabel === "damage" ? "Damage" : "Attack power"
                        } per second${perSecondOver} (a chain starts again after its last step), from its animations`
                  }
                >
                  {sortLabel("total", perSecondLabel, "desc")}
                </Tooltip>
              ) : (
                sortLabel("total", valueLabel, "desc")
              )}
            </TableCell>
            {showDamagePerStamina && (
              <TableCell rowSpan={headerRows} align="right">
                <Tooltip
                  title={
                    showDps
                      ? `${perSecondLabel.replace(
                          / \(.*/,
                          "",
                        )} per point of stamina the attack costs (rewards attacks that are both fast and cheap)`
                      : `${
                          pointLabel === "damage" ? "Damage" : "Attack power"
                        } per point of stamina, each weighted across a chain the same way`
                  }
                >
                  {sortLabel(
                    "damagePerStamina",
                    showDps ? "Damage/stamina/s" : "Damage/stamina",
                    "desc",
                  )}
                </Tooltip>
              </TableCell>
            )}
            {showHits && <TableCell rowSpan={headerRows}>Hits</TableCell>}
            {showStance && (
              <TableCell rowSpan={headerRows} align="right">
                <Tooltip
                  title={
                    showDps
                      ? `Stance damage (often called poise damage) per second${perSecondOver}`
                      : "Stance damage (often called poise damage), weighted across a chain the same way as damage"
                  }
                >
                  {sortLabel("stance", showDps ? "Stance/s" : "Stance", "desc")}
                </Tooltip>
              </TableCell>
            )}
            {showStancePerStamina && (
              <TableCell rowSpan={headerRows} align="right">
                <Tooltip
                  title={
                    showDps
                      ? "Stance damage per second per point of stamina the attack costs (rewards attacks that are both fast and cheap)"
                      : "Stance damage per point of stamina, each weighted across a chain the same way"
                  }
                >
                  {sortLabel(
                    "stancePerStamina",
                    showDps ? "Stance/stamina/s" : "Stance/stamina",
                    "desc",
                  )}
                </Tooltip>
              </TableCell>
            )}
            {showStamina && (
              <TableCell rowSpan={headerRows} align="right">
                <Tooltip
                  title={
                    showDps
                      ? `Stamina spent per second${perSecondOver} (not counting stamina recovery)`
                      : "Stamina cost, weighted across a chain the same way as damage"
                  }
                >
                  {sortLabel("stamina", showDps ? "Stamina/s" : "Stamina", "asc")}
                </Tooltip>
              </TableCell>
            )}
            {statusColumns.map((statusType) => {
              const { label, icon } = statusTypes.get(statusType)!;
              return (
                <TableCell key={statusType} rowSpan={headerRows} align="right" sx={statusCellSx}>
                  {sortLabel(
                    statusSortBy(statusType),
                    // One element, since right-aligned sort labels reverse their children
                    <Box component="span" display="inline-flex" alignItems="center">
                      <img
                        src={icon}
                        alt={showDps ? `${label} per second` : label}
                        title={
                          showDps
                            ? `${label} buildup per second${perSecondOver}`
                            : `${label} buildup`
                        }
                        width={20}
                        height={20}
                      />
                      {showDps && "/s"}
                    </Box>,
                    "desc",
                  )}
                </TableCell>
              );
            })}
            <TableCell rowSpan={headerRows} align="right">
              {sortLabel("level", "Level", "asc")}
            </TableCell>
            {headerRows > 1
              ? groups.map(([group, label]) => (
                  <TableCell
                    key={group}
                    colSpan={allAttributes.length}
                    align="center"
                    sx={group === lastGroup ? bothBordersSx : leftBorderSx}
                  >
                    {label}
                  </TableCell>
                ))
              : attributeHeaders("stats", true)}
            <TableCell rowSpan={headerRows}>Stopped by</TableCell>
          </TableRow>
          {headerRows > 1 && (
            <TableRow>
              {groups.map(([group]) => attributeHeaders(group, group === lastGroup))}
            </TableRow>
          )}
        </TableHead>
        <TableBody>
          {sorted.map((result) => {
            // Notes on the value, shown above its breakdown
            const valueNotes = [result.attackNote, result.buffNote]
              .filter((note): note is string => !!note)
              .map((note) => (note.endsWith(".") ? note : `${note}.`));
            return (
              <TableRow key={`${result.weaponName} ${result.skillVariant?.label ?? ""}`}>
                <TableCell padding="checkbox">
                  {result.applicable && chartCheckbox(result.weaponName)}
                </TableCell>
                <TableCell>
                  {result.url ? (
                    <Link
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      color="inherit"
                    >
                      {result.weaponName}
                    </Link>
                  ) : (
                    result.weaponName
                  )}
                </TableCell>
                {result.applicable ? (
                  <>
                    <TableCell
                      align="right"
                      sx={
                        result.ineffectiveAttributes.length > 0
                          ? { color: "error.main" }
                          : undefined
                      }
                    >
                      {result.skillRequirementsUnmet ? (
                        // A skill can't be used without the weapon's requirements
                        "Skill requirements not met"
                      ) : (
                        <>
                          {!result.exact && (
                            <Tooltip title="This weapon scales with many stats, so a faster approximate search was used. The result may be slightly below optimal.">
                              <span>≈</span>
                            </Tooltip>
                          )}
                          <Details
                            title={`${result.weaponName}: ${valueLabel}`}
                            content={
                              (result.breakdown.length > 0 || valueNotes.length > 0) && (
                                <>
                                  {valueNotes.map((note) => (
                                    <Box key={note} sx={{ maxWidth: 360, px: 1, mb: 1 }}>
                                      {note}
                                    </Box>
                                  ))}
                                  {result.hpDamage && (
                                    <Box sx={{ maxWidth: 360, px: 1, mb: 1 }}>
                                      Includes {formatValue(result.hpDamage.damage)}{" "}
                                      {result.hpDamage.label.toLowerCase()} damage, a percentage of
                                      the enemy&apos;s max HP, which stats don&apos;t change.
                                    </Box>
                                  )}
                                  {result.uncountedHpDamage && (
                                    <Box sx={{ maxWidth: 360, px: 1, mb: 1 }}>
                                      {result.uncountedHpDamage.label} isn&apos;t counted: it does{" "}
                                      {result.uncountedHpDamage.rate * 100}% of the enemy&apos;s max
                                      HP
                                      {result.uncountedHpDamage.flat
                                        ? ` plus ${result.uncountedHpDamage.flat}`
                                        : ""}{" "}
                                      {result.uncountedHpDamage.ticks} times after each hit. Enter
                                      the enemy&apos;s HP in the enemy defenses, or pick an enemy,
                                      to include it.
                                    </Box>
                                  )}
                                  {result.breakdown.length > 0 && (
                                    <BreakdownTable
                                      rows={result.breakdown}
                                      pointLabel={pointLabel}
                                    />
                                  )}
                                  {result.menuAttackPower && (
                                    <Box sx={{ maxWidth: 360, px: 1, mt: 1 }}>
                                      This is the attack power the game&apos;s menu shows, which
                                      uses the catalyst&apos;s own scaling, but its melee attacks
                                      scale like regular weapons (Strength and Dexterity), so
                                      it&apos;s misleading. Choose the R1 chain attack to see its
                                      actual melee damage.
                                    </Box>
                                  )}
                                </>
                              )
                            }
                          >
                            {showDps
                              ? result.attackDps != null
                                ? formatValue(result.attackDps)
                                : "–"
                              : formatValue(result.finalValue)}
                            {/* Marks a value with notes, which are in its details (the value is
                              easier to tap than a lone asterisk) */}
                            {(valueNotes.length > 0 || result.uncountedHpDamage) && "*"}
                          </Details>
                        </>
                      )}
                    </TableCell>
                    {showDamagePerStamina && (
                      <TableCell align="right">
                        {perStaminaCell(
                          getDamagePerStamina(result, showDps),
                          formatDamagePerStamina,
                        )}
                      </TableCell>
                    )}
                    {showHits && (
                      <TableCell>
                        {result.fixedSkill && (
                          <Typography
                            variant="caption"
                            display="block"
                            color="text.secondary"
                            whiteSpace="nowrap"
                          >
                            {result.skillVariant?.label ?? result.fixedSkill}
                          </Typography>
                        )}
                        {result.attackSteps && (
                          <AttackHits
                            steps={result.attackSteps}
                            stepTimes={result.attackStepTimes}
                            repeatFrom={result.attackRepeatFrom}
                            timings={tooltipTimings}
                            skill={skill}
                            label={pointLabel === "damage" ? "Damage" : "AR"}
                            title={`${result.weaponName}: hits`}
                            notes={[hitsNote, oneOffPerSecond && oneOffNote].filter(
                              (note): note is string => !!note,
                            )}
                          />
                        )}
                      </TableCell>
                    )}
                    {showStance && (
                      <TableCell align="right">
                        {showDps
                          ? result.attackStancePerSecond != null
                            ? formatStance(result.attackStancePerSecond)
                            : ""
                          : result.attackStance != null
                          ? formatStance(result.attackStance)
                          : ""}
                      </TableCell>
                    )}
                    {showStancePerStamina && (
                      <TableCell align="right">
                        {perStaminaCell(
                          getStancePerStamina(result, showDps),
                          formatStancePerStamina,
                        )}
                      </TableCell>
                    )}
                    {showStamina && (
                      <TableCell align="right">
                        {showDps
                          ? result.attackStaminaPerSecond != null
                            ? formatStamina(result.attackStaminaPerSecond)
                            : ""
                          : result.attackStamina != null
                          ? formatStamina(result.attackStamina)
                          : ""}
                      </TableCell>
                    )}
                    {statusColumns.map((statusType) => {
                      const buildup = getResultStatus(result, showDps)[statusType];
                      // Status that scales with Arcane when damage doesn't is left to the user (noted
                      // per hit, not per second)
                      const atMaxArcane = showDps
                        ? undefined
                        : result.statusAtMaxArcane?.[statusType];
                      return (
                        <TableCell key={statusType} align="right" sx={statusCellSx}>
                          {buildup && atMaxArcane ? (
                            <Tooltip
                              title={`${
                                statusTypes.get(statusType)!.label
                              } buildup scales with Arcane, but this weapon's damage doesn't, so Arcane isn't raised for it. At 99 Arcane: ${formatValue(
                                atMaxArcane,
                              )}`}
                            >
                              <Box component="span" sx={tooltipCueSx}>
                                {formatValue(buildup)}
                              </Box>
                            </Tooltip>
                          ) : buildup ? (
                            formatValue(buildup)
                          ) : (
                            "–"
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell align="right">
                      <Tooltip title={`${result.runes.toLocaleString()} runes`}>
                        <Box component="span" sx={tooltipCueSx}>
                          {result.finalLevel} (+{result.levels})
                        </Box>
                      </Tooltip>
                    </TableCell>
                    {allAttributes.map((attribute, i) => {
                      const leveled = result.attributes[attribute];
                      const effective = result.effectiveAttributes[attribute];
                      const added = leveled - startAttributes[attribute];
                      const ineffective = result.ineffectiveAttributes.includes(attribute);
                      const details = [
                        ineffective &&
                          `Requires ${result.requirements[attribute]} ${getStatLabel(attribute)}`,
                        effective !== leveled &&
                          `Counts as ${effective} (bonus stats${
                            attribute === "str" ? " and two handing" : ""
                          } included)`,
                        added > 0 && `+${added} levels`,
                      ].filter(Boolean);
                      const value = (
                        <Box
                          component="span"
                          color={
                            ineffective
                              ? "error.main"
                              : added > 0
                              ? "primary.main"
                              : "text.secondary"
                          }
                          // Mark values that count as something else, e.g. two handed Strength
                          sx={
                            effective !== leveled
                              ? { textDecoration: "underline dotted", textUnderlineOffset: 3 }
                              : undefined
                          }
                        >
                          {leveled}
                        </Box>
                      );
                      return (
                        <TableCell
                          key={attribute}
                          align="right"
                          sx={groupBorderSx(i, lastGroup === "stats")}
                        >
                          {details.length > 0 ? (
                            <Tooltip title={details.join(" · ")}>{value}</Tooltip>
                          ) : (
                            value
                          )}
                        </TableCell>
                      );
                    })}
                    {showScaling &&
                      allAttributes.map((attribute, i) => (
                        <TableCell
                          key={`${attribute}-scaling`}
                          align="right"
                          sx={groupBorderSx(i, lastGroup === "scaling")}
                        >
                          {formatScaling(result.scaling[attribute])}
                        </TableCell>
                      ))}
                    {showRequirements &&
                      allAttributes.map((attribute, i) => (
                        <TableCell
                          key={`${attribute}-requirement`}
                          align="right"
                          sx={groupBorderSx(i, lastGroup === "requirements")}
                        >
                          {result.requirements[attribute] ?? "–"}
                        </TableCell>
                      ))}
                    <TableCell>{limitReasonLabels[result.reason]}</TableCell>
                  </>
                ) : (
                  <TableCell
                    colSpan={
                      3 +
                      statusColumns.length +
                      +showHits +
                      +showStance +
                      +showStamina +
                      +showDamagePerStamina +
                      +showStancePerStamina +
                      allAttributes.length * groups.length
                    }
                  >
                    <Typography variant="body2" color="text.secondary">
                      {result.unavailableReason ?? notApplicableLabel}
                    </Typography>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default memo(ResultsTable);
