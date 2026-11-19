import { memo } from "react";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import { allAttributes } from "../calculator/calculator.ts";
import {
  allStats,
  getCharacterLevel,
  getOptimalStartingClasses,
  getPlannedStats,
  getShownPlannedStats,
  getStatLabel,
  getPlanMinimums,
  startingClasses,
  type StartingClassName,
} from "../optimizer/startingClasses.ts";
import { tooltipCueSx } from "./Details.tsx";
import NumberTextField from "./NumberTextField.tsx";
import Section from "./Section.tsx";
import type { AppState, UpdateAppState } from "./useAppState.ts";

interface Props {
  startingClass: AppState["startingClass"];
  stats: AppState["stats"];
  plannedStats: AppState["plannedStats"];
  statsEdited: AppState["statsEdited"];
  /** Restores the planned stats from before a row's final stats were planned, if that can be undone */
  onUndoPlan?: () => void;
  onChange: UpdateAppState;
}

/**
 * Form controls for the starting class and current stats
 */
function CharacterSettings({
  startingClass,
  stats,
  plannedStats,
  statsEdited,
  onUndoPlan,
  onChange,
}: Props) {
  const baseStats = startingClasses[startingClass];
  const plan = getPlannedStats(stats, plannedStats, baseStats);
  // The class can only be picked until a current stat is changed, so that's the only time the
  // planned stats go below its base and the best class is shown
  const minimums = getPlanMinimums(statsEdited, baseStats);
  const shownPlan = getShownPlannedStats(stats, plannedStats, baseStats, minimums);
  const bestClass = !statsEdited && getOptimalStartingClasses(shownPlan);

  return (
    <Section id="character" title={`Character — Level ${getCharacterLevel(stats)}`}>
      <FormControl fullWidth size="small" sx={{ mb: 2 }}>
        <InputLabel id="startingClassLabel">Starting Class</InputLabel>
        <Select
          labelId="startingClassLabel"
          label="Starting Class"
          value={startingClass}
          onChange={(evt) => {
            const newClass = evt.target.value as StartingClassName;
            onChange({
              startingClass: newClass,
              stats: startingClasses[newClass],
              plannedStats: {},
              statsEdited: false,
            });
          }}
        >
          {Object.keys(startingClasses).map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Current stats
      </Typography>
      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1} mb={2}>
        {allStats.map((stat) => (
          <NumberTextField
            // Remount when the class changes so the field shows the new class's stats
            key={`${startingClass}-${stat}`}
            label={getStatLabel(stat).slice(0, 3)}
            title={getStatLabel(stat)}
            size="small"
            spinButtons
            value={stats[stat]}
            min={baseStats[stat]}
            max={99}
            onChange={(value) =>
              onChange({ stats: { ...stats, [stat]: value }, statsEdited: true })
            }
          />
        ))}
      </Box>

      <Box display="flex" alignItems="center" justifyContent="space-between" mt={2} mb={0.5}>
        <Typography variant="subtitle2" color="text.secondary">
          Planned stats — level {getCharacterLevel(plan)}
        </Typography>
        {onUndoPlan ? (
          <Button size="small" onClick={onUndoPlan}>
            Undo
          </Button>
        ) : (
          <Button
            size="small"
            disabled={Object.keys(plannedStats).length === 0 && !statsEdited}
            onClick={() => onChange({ plannedStats: {}, statsEdited: false })}
          >
            Reset
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Stats to respec into or level towards before damage stats are optimized. A stat at its
        lowest ("-") doesn't matter. Until a current stat is changed, that's the lowest any class
        starts with, and the best class for the plan is shown.
      </Typography>
      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
        {allStats.map((stat) => (
          <NumberTextField
            key={`${startingClass}-planned-${stat}`}
            label={getStatLabel(stat).slice(0, 3)}
            title={`Planned ${getStatLabel(stat)}`}
            size="small"
            spinButtons
            value={shownPlan[stat]}
            min={minimums[stat]}
            minLabel="-"
            max={99}
            onChange={(value) => {
              // "-" is what an unplanned stat at the class's base is already
              const { [stat]: _, ...others } = plannedStats;
              onChange({
                plannedStats:
                  value === minimums[stat] && stats[stat] <= baseStats[stat]
                    ? others
                    : { ...plannedStats, [stat]: value },
              });
            }}
          />
        ))}
      </Box>
      {bestClass && (
        <Typography variant="body2" mt={1}>
          Best class:{" "}
          <Tooltip
            title={[
              `${bestClass.runes.toLocaleString()} runes`,
              ...bestClass.classes.map(
                (name, i) =>
                  `${name}: level ${bestClass.levels[i].start} to ${bestClass.levels[i].end}`,
              ),
            ].join(" · ")}
          >
            <Box component="span" sx={tooltipCueSx}>
              {bestClass.classes.length === Object.keys(startingClasses).length
                ? "Any"
                : bestClass.classes.join(", ")}
            </Box>
          </Tooltip>
        </Typography>
      )}
    </Section>
  );
}

export default memo(CharacterSettings);
