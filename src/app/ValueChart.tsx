import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { maxCharacterLevel } from "../optimizer/runes.ts";
import NumberTextField from "./NumberTextField.tsx";
import { colors } from "./theme.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import type { BuildResult } from "../optimizer/build.ts";
import { getAllocationAtLevel, getValueAtLevel } from "./results.ts";
import { allAttributes } from "../calculator/calculator.ts";
import { getStatLabel } from "../optimizer/startingClasses.ts";

interface Props {
  /** Results to chart, in display order. Only the first few are shown. */
  results: BuildResult[];
  startLevel: number;
  valueLabel: string;
  range: AppState["chartRange"];
  onChange: UpdateAppState;
}

/** Categorical palette (dark steps), validated against the chart surface below */
const seriesColors = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
export const maxSeries = seriesColors.length;

const surface = colors.surface;
const textPrimary = colors.text;
const textSecondary = colors.textSecondary;
const gridColor = "#2e2a22";

const height = 280;
const margin = { top: 12, right: 16, bottom: 32, left: 48 };
/** Room on the right for direct labels when there are few enough series */
const labelWidth = 150;

function niceTicks(min: number, max: number, count: number) {
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const niceStep = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= count) ?? step * 10;
  const ticks = [];
  for (let tick = Math.ceil(min / niceStep) * niceStep; tick <= max; tick += niceStep) {
    ticks.push(tick);
  }
  return ticks;
}

/**
 * Line chart of the best value at each character level for the top weapons
 */
function ValueChart({ results, startLevel, valueLabel, range, onChange }: Props) {
  const [width, setWidth] = useState(600);
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);

  // The chart isn't rendered until there are results, so the container is measured whenever it
  // appears rather than once on mount. React calls this with null when it goes away, which
  // disconnects the observer.
  const observerRef = useRef<ResizeObserver>();
  const containerRef = useCallback((container: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (container) {
      observerRef.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
      observerRef.current.observe(container);
    }
  }, []);

  const series = results.filter((result) => result.curve.values.length > 0).slice(0, maxSeries);

  // Colors follow the weapon, not its rank, so re-sorting doesn't repaint a weapon that stays in
  // the chart
  const slotsRef = useRef(new Map<string, number>());
  const slots = useMemo(() => {
    const previous = slotsRef.current;
    const next = new Map<string, number>();
    for (const { weaponName } of series) {
      if (previous.has(weaponName)) next.set(weaponName, previous.get(weaponName)!);
    }
    for (const { weaponName } of series) {
      if (!next.has(weaponName)) {
        let slot = 0;
        while ([...next.values()].includes(slot)) slot++;
        next.set(weaponName, slot);
      }
    }
    return next;
  }, [series]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  if (series.length === 0) {
    return null;
  }

  const directLabels = series.length <= 4;
  const plotRight = width - margin.right - (directLabels ? labelWidth : 0);
  const plotBottom = height - margin.bottom;

  // By default, from the current level to a little past the furthest leveled weapon
  const autoMaxLevel = Math.min(
    maxCharacterLevel,
    Math.max(...series.map((result) => result.finalLevel), startLevel + 10) + 10,
  );
  const minLevel = Math.min(range.min ?? startLevel, maxCharacterLevel - 1);
  const maxLevel = Math.max(range.max ?? autoMaxLevel, minLevel + 1);

  const valuesInRange = series.flatMap((result) => {
    const { startLevel: curveStart, values } = result.curve;
    const inRange = values.filter((_, i) => {
      const level = curveStart + i;
      return level >= minLevel && level <= maxLevel;
    });
    // Include the flat part after the curve ends
    if (curveStart + values.length - 1 < maxLevel && values.length > 0) {
      inRange.push(values[values.length - 1]);
    }
    return inRange;
  });
  const minValue = valuesInRange.length ? Math.min(...valuesInRange) : 0;
  const maxValue = valuesInRange.length ? Math.max(...valuesInRange) : 1;
  const padding = (maxValue - minValue) * 0.05 || 1;
  const yMin = Math.max(0, minValue - padding);
  const yMax = maxValue + padding;

  const x = (level: number) =>
    margin.left + ((level - minLevel) / (maxLevel - minLevel)) * (plotRight - margin.left);
  const y = (value: number) =>
    plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - margin.top);

  const paths = series.map((result) => {
    const { startLevel: curveStart, values } = result.curve;
    const points = values
      .map((value, i) => [curveStart + i, value] as const)
      .filter(([level]) => level >= minLevel && level <= maxLevel);
    // A curve ends when every useful stat is at 99, and stays flat after that
    const lastLevel = curveStart + values.length - 1;
    if (lastLevel < maxLevel && values.length > 0) {
      if (lastLevel < minLevel) points.push([minLevel, values[values.length - 1]]);
      points.push([maxLevel, values[values.length - 1]]);
    }
    return points.map(([level, value], i) => `${i ? "L" : "M"}${x(level)},${y(value)}`).join("");
  });

  // Direct labels at the end of each line, nudged apart so they don't overlap
  const labels = series
    .filter((result) => result.curve.values.length > 0 && result.curve.startLevel <= maxLevel)
    .map((result, i) => ({
      result,
      i,
      y: y(getValueAtLevel(result.curve, maxLevel) ?? result.curve.values.at(-1)!),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
  }

  const handlePointerMove = (evt: React.PointerEvent<SVGRectElement>) => {
    const bounds = evt.currentTarget.getBoundingClientRect();
    const fraction = (evt.clientX - bounds.left) / bounds.width;
    setHoverLevel(Math.round(minLevel + fraction * (maxLevel - minLevel)));
  };

  const hoverValues =
    hoverLevel == null
      ? []
      : series
          .map((result) => ({
            result,
            value: getValueAtLevel(result.curve, hoverLevel),
            allocation: getAllocationAtLevel(result.curve, hoverLevel),
          }))
          .filter((entry) => entry.value != null)
          .sort((a, b) => b.value! - a.value!);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        bgcolor: surface,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        color: textPrimary,
      }}
    >
      <Box
        display="flex"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        mb={1}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="subtitle2">{valueLabel} by character level</Typography>
          {/* Unchecks every weapon in the table, which hides the chart */}
          <Button size="small" onClick={() => onChange({ chartWeapons: [] })}>
            Clear all
          </Button>
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          {(
            [
              ["min", "From level", minLevel],
              ["max", "To level", maxLevel],
            ] as const
          ).map(([bound, label, value]) => (
            <Box key={bound} display="flex" alignItems="center">
              <NumberTextField
                label={range[bound] == null ? `${label} (auto)` : label}
                size="small"
                spinButtons
                sx={{ width: 150 }}
                value={value}
                min={1}
                max={maxCharacterLevel}
                onChange={(newValue) => onChange({ chartRange: { ...range, [bound]: newValue } })}
              />
              {/* Always takes up space, so the fields don't shift when it appears */}
              <Button
                size="small"
                sx={{ visibility: range[bound] == null ? "hidden" : "visible" }}
                onClick={() => onChange({ chartRange: { ...range, [bound]: null } })}
              >
                Auto
              </Button>
            </Box>
          ))}
        </Box>
      </Box>

      <svg width={width} height={height} role="img" aria-label={`${valueLabel} by level`}>
        {niceTicks(yMin, yMax, 5).map((tick) => (
          <g key={`y${tick}`}>
            <line x1={margin.left} x2={plotRight} y1={y(tick)} y2={y(tick)} stroke={gridColor} />
            <text
              x={margin.left - 6}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              fontSize={11}
              fill={textSecondary}
            >
              {tick}
            </text>
          </g>
        ))}
        {niceTicks(minLevel, maxLevel, 8).map((tick) => (
          <text
            key={`x${tick}`}
            x={x(tick)}
            y={plotBottom + 16}
            textAnchor="middle"
            fontSize={11}
            fill={textSecondary}
          >
            {tick}
          </text>
        ))}
        <text
          x={(margin.left + plotRight) / 2}
          y={height - 2}
          textAnchor="middle"
          fontSize={11}
          fill={textSecondary}
        >
          Character level
        </text>

        {paths.map((path, i) => (
          <path
            key={series[i].weaponName}
            d={path}
            fill="none"
            stroke={seriesColors[slots.get(series[i].weaponName)!]}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {directLabels &&
          labels.map(({ result, y: labelY }) => (
            <g key={result.weaponName}>
              <circle
                cx={plotRight + 8}
                cy={labelY}
                r={4}
                fill={seriesColors[slots.get(result.weaponName)!]}
              />
              <text x={plotRight + 16} y={labelY} dy="0.32em" fontSize={11} fill={textPrimary}>
                {result.weaponName.length > 20
                  ? `${result.weaponName.slice(0, 19)}…`
                  : result.weaponName}
              </text>
            </g>
          ))}

        {hoverLevel != null && (
          <g pointerEvents="none">
            <line
              x1={x(hoverLevel)}
              x2={x(hoverLevel)}
              y1={margin.top}
              y2={plotBottom}
              stroke={textSecondary}
            />
            {hoverValues.map(({ result, value }) => (
              <circle
                key={result.weaponName}
                cx={x(hoverLevel)}
                cy={y(value!)}
                r={4}
                fill={seriesColors[slots.get(result.weaponName)!]}
                stroke={surface}
                strokeWidth={2}
              />
            ))}
          </g>
        )}

        {/* Hit target for the crosshair, covering the whole plot area */}
        <rect
          x={margin.left}
          y={margin.top}
          width={Math.max(0, plotRight - margin.left)}
          height={plotBottom - margin.top}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverLevel(null)}
        />
      </svg>

      {hoverLevel != null && hoverValues.length > 0 && (
        <Box
          sx={{
            position: "absolute",
            top: 40,
            left: Math.min(x(hoverLevel) + 24, width - 240),
            bgcolor: colors.surfaceRaised,
            border: 1,
            borderColor: gridColor,
            borderRadius: 1,
            px: 1,
            py: 0.5,
            pointerEvents: "none",
            minWidth: 180,
          }}
        >
          {/* Each weapon's value and the stats that achieve it, in columns */}
          <Box
            display="grid"
            gridTemplateColumns={`auto 1fr auto repeat(${allAttributes.length}, auto)`}
            alignItems="center"
            columnGap={1}
          >
            <Typography variant="caption" sx={{ color: textSecondary, gridColumn: "1 / 4" }}>
              Level {hoverLevel}
            </Typography>
            {allAttributes.map((attribute) => (
              <Typography
                key={attribute}
                variant="caption"
                align="right"
                sx={{ color: textSecondary }}
              >
                {getStatLabel(attribute).slice(0, 3)}
              </Typography>
            ))}
            {hoverValues.map(({ result, value, allocation }) => [
              <Box
                key={`${result.weaponName}-dot`}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: seriesColors[slots.get(result.weaponName)!],
                }}
              />,
              <Typography key={`${result.weaponName}-name`} variant="caption">
                {result.weaponName}
              </Typography>,
              <Typography key={`${result.weaponName}-value`} variant="caption" align="right">
                {Math.floor(value! + 1e-9)}
              </Typography>,
              ...allAttributes.map((attribute) => (
                <Typography
                  key={`${result.weaponName}-${attribute}`}
                  variant="caption"
                  align="right"
                  sx={{ color: textSecondary }}
                >
                  {allocation?.[attribute] ?? "–"}
                </Typography>
              )),
            ])}
          </Box>
        </Box>
      )}

      {/* Legend */}
      <Box display="flex" flexWrap="wrap" columnGap={2} rowGap={0.5} mt={1}>
        {series.map((result) => (
          <Box key={result.weaponName} display="flex" alignItems="center" gap={0.75}>
            <Box
              sx={{
                width: 12,
                height: 2,
                bgcolor: seriesColors[slots.get(result.weaponName)!],
              }}
            />
            <Typography variant="caption">{result.weaponName}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default memo(ValueChart);
