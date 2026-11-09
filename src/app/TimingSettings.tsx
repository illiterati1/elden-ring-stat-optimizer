import { memo } from "react";
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import NumberTextField from "./NumberTextField.tsx";
import Section from "./Section.tsx";
import type { AppState, ChainLimitSetting, TooltipTimings, UpdateAppState } from "./useAppState.ts";

interface Props {
  showDps: AppState["showDps"];
  tooltipTimings: AppState["tooltipTimings"];
  chainLimit: AppState["chainLimit"];
  onChange: UpdateAppState;
}

// The hits tooltip's timings, each cumulative from the start of the chain
const tooltipTimingLabels: [keyof TooltipTimings, string][] = [
  ["hits", "Hit times"],
  ["cancel", "Next attack"],
  ["roll", "Roll"],
  ["block", "Block"],
  ["nextChain", "Next chain"],
];

const chainLimitModes: [ChainLimitSetting["mode"], string][] = [
  ["none", "Whole chain"],
  ["steps", "Steps"],
  ["seconds", "Seconds"],
];

/**
 * Settings for attacks' timing: showing values per second, which timings the hits tooltip shows,
 * and cutting chains short
 */
function TimingSettings({ showDps, tooltipTimings, chainLimit, onChange }: Props) {
  return (
    <Section id="timing" title="Timing">
      <Box display="grid" gap={1}>
        <FormControlLabel
          label="Per second"
          title="Damage, poise, stamina, and status per second, repeating the attack as fast as the game allows (a chain starts again after its last step)"
          control={
            <Checkbox
              size="small"
              checked={showDps}
              onChange={(evt) => onChange({ showDps: evt.currentTarget.checked })}
            />
          }
        />
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
                <MenuItem key={mode} value={mode}>
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
        {chainLimit.mode === "seconds" && (
          <Typography variant="body2" color="text.secondary">
            The steps that fit from the button press until a roll can start after them
          </Typography>
        )}
        {chainLimit.mode !== "none" && (
          <Typography variant="body2" color="text.secondary">
            A chain cut short starts again once an R1 or R2 can (at least one step)
          </Typography>
        )}
      </Box>
    </Section>
  );
}

export default memo(TimingSettings);
