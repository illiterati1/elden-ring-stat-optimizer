import { memo } from "react";
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Typography,
} from "@mui/material";
import NumberTextField from "./NumberTextField.tsx";
import Section from "./Section.tsx";
import type { AppState, ChainLimitSetting, TooltipTimings, UpdateAppState } from "./useAppState.ts";

interface Props {
  showDps: AppState["showDps"];
  tooltipTimings: AppState["tooltipTimings"];
  chainLimit: AppState["chainLimit"];
  /** The chosen attack is on horseback, where there's no rolling (so no time to dodge) */
  mounted: boolean;
  onChange: UpdateAppState;
}

// The hits tooltip's timings, each cumulative from the start of the chain
const tooltipTimingLabels: [keyof TooltipTimings, string][] = [
  ["hits", "Hit times"],
  ["nextChain", "Same attack/skill"],
  ["cancel", "Earliest attack"],
  ["roll", "Roll"],
  ["block", "Block"],
  ["move", "Movement"],
];

const chainLimitModes: [ChainLimitSetting["mode"], string][] = [
  ["none", "Whole chain"],
  ["steps", "Steps"],
  ["seconds", "Time to dodge"],
];

/**
 * Settings for attacks' timing: showing values per second, which timings the hits tooltip shows,
 * and cutting chains short
 */
function TimingSettings({ showDps, tooltipTimings, chainLimit, mounted, onChange }: Props) {
  return (
    <Section
      id="timing"
      title="Timing"
      action={
        <Switch
          size="small"
          title="Per second: scale values by time"
          inputProps={{ "aria-label": "Per second" }}
          checked={showDps}
          onChange={(evt) => onChange({ showDps: evt.currentTarget.checked })}
        />
      }
    >
      <Box display="grid" gap={1}>
        <Typography variant="body2" color="text.secondary">
          In the hits tooltip, from the start of the chain
        </Typography>
        <Box display="flex" flexWrap="wrap" columnGap={2}>
          {tooltipTimingLabels.map(([key, label]) => (
            <FormControlLabel
              key={key}
              label={label}
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={tooltipTimings[key]}
                  onChange={(evt) =>
                    onChange({
                      tooltipTimings: { ...tooltipTimings, [key]: evt.currentTarget.checked },
                    })
                  }
                />
              }
            />
          ))}
        </Box>
        <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1} mt={1}>
          <FormControl fullWidth size="small">
            <InputLabel id="chainLimitLabel">Chains</InputLabel>
            <Select
              labelId="chainLimitLabel"
              label="Chains"
              value={chainLimit.mode}
              onChange={(evt) =>
                onChange({
                  chainLimit: {
                    ...chainLimit,
                    mode: evt.target.value as ChainLimitSetting["mode"],
                  },
                })
              }
            >
              {chainLimitModes.map(([mode, label]) => (
                <MenuItem key={mode} value={mode} disabled={mounted && mode === "seconds"}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {chainLimit.mode === "steps" && (
            <NumberTextField
              label="Steps"
              size="small"
              spinButtons
              value={chainLimit.steps}
              min={1}
              max={10}
              onChange={(steps) => onChange({ chainLimit: { ...chainLimit, steps } })}
            />
          )}
          {chainLimit.mode === "seconds" && (
            <NumberTextField
              label="Seconds"
              size="small"
              spinButtons
              value={chainLimit.seconds}
              min={0.1}
              step={0.1}
              onChange={(seconds) => onChange({ chainLimit: { ...chainLimit, seconds } })}
            />
          )}
        </Box>
        {chainLimit.mode === "seconds" && mounted && (
          <Typography variant="body2" color="text.secondary">
            Mounted attacks can't roll, so they use the whole chain
          </Typography>
        )}
        {chainLimit.mode === "seconds" && !mounted && (
          <Typography variant="body2" color="text.secondary">
            The steps that fit from the first attack until a roll can start after them
          </Typography>
        )}
        {chainLimit.mode === "steps" && (
          <Typography variant="body2" color="text.secondary">
            For time scaling, a chain cut short lasts until anything but an attack can follow its
            last step (more steps than the chain has repeat it)
          </Typography>
        )}
        {chainLimit.mode === "seconds" && !mounted && (
          <Typography variant="body2" color="text.secondary">
            For time scaling, a chain cut short lasts until a roll can start (at least one step)
          </Typography>
        )}
      </Box>
    </Section>
  );
}

export default memo(TimingSettings);
