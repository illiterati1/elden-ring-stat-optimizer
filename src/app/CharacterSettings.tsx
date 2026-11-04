import { memo } from "react";
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography } from "@mui/material";
import { allAttributes } from "../calculator/calculator.ts";
import {
  allStats,
  getCharacterLevel,
  getPlannedStats,
  getStatLabel,
  startingClasses,
  type StartingClassName,
} from "../optimizer/startingClasses.ts";
import NumberTextField from "./NumberTextField.tsx";
import Section from "./Section.tsx";
import type { AppState, UpdateAppState } from "./useAppState.ts";

interface Props {
  startingClass: AppState["startingClass"];
  stats: AppState["stats"];
  plannedStats: AppState["plannedStats"];
  onChange: UpdateAppState;
}

/**
 * Form controls for the starting class and current stats
 */
function CharacterSettings({ startingClass, stats, plannedStats, onChange }: Props) {
  const baseStats = startingClasses[startingClass];
  const plan = getPlannedStats(stats, plannedStats, baseStats);

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
            onChange={(value) => onChange({ stats: { ...stats, [stat]: value } })}
          />
        ))}
      </Box>

      <Box display="flex" alignItems="center" justifyContent="space-between" mt={2} mb={0.5}>
        <Typography variant="subtitle2" color="text.secondary">
          Planned stats — level {getCharacterLevel(plan)}
        </Typography>
        <Button
          size="small"
          disabled={Object.keys(plannedStats).length === 0}
          onClick={() => onChange({ plannedStats: {} })}
        >
          Reset
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Stats to respec into or level towards before damage stats are optimized
      </Typography>
      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
        {allStats.map((stat) => (
          <NumberTextField
            key={`${startingClass}-planned-${stat}`}
            label={getStatLabel(stat).slice(0, 3)}
            title={`Planned ${getStatLabel(stat)}`}
            size="small"
            spinButtons
            value={plan[stat]}
            min={baseStats[stat]}
            max={99}
            onChange={(value) => onChange({ plannedStats: { ...plannedStats, [stat]: value } })}
          />
        ))}
      </Box>
    </Section>
  );
}

export default memo(CharacterSettings);
