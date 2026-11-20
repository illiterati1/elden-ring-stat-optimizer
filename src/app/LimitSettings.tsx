import { memo, type ReactNode } from "react";
import {
  Box,
  Checkbox,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import NumberTextField from "./NumberTextField.tsx";
import Section from "./Section.tsx";
import DismissableNote from "./DismissableNote.tsx";
import type {
  AppState,
  LevelLimitMode,
  LimitSettings as LimitSettingsState,
  UpdateAppState,
} from "./useAppState.ts";

interface Props {
  limits: AppState["limits"];
  fastMode: AppState["fastMode"];
  meetRequirements: AppState["meetRequirements"];
  /** What one point of the objective is called: "damage" or "scaling" */
  pointLabel: string;
  /** The character's current level */
  currentLevel: number;
  /** The planned stats' level, which leveling starts from */
  planLevel: number;
  /** Alerts and notes the user closed */
  closedAlerts: AppState["closedAlerts"];
  onChange: UpdateAppState;
}

function Unit({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
      {children}
    </Typography>
  );
}

/**
 * A small two option switch, e.g. between points and percent
 */
function Switch<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: [T, string][];
  disabled: boolean;
  onChange(value: T): void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      disabled={disabled}
      value={value}
      onChange={(_, newValue: T | null) => newValue != null && onChange(newValue)}
    >
      {options.map(([option, label]) => (
        <ToggleButton key={option} value={option} sx={{ px: 1, py: 0.25 }}>
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

// The additional levels field's label is "Level <start> +", set where it's rendered
const levelLimitFields: Record<LevelLimitMode, { label: string; max: number; step: number }> = {
  additional: { label: "", max: 713, step: 1 },
  absolute: { label: "Reaching level", max: 713, step: 1 },
  runes: { label: "Rune budget", max: 1e10, step: 100000 },
};

/**
 * Form controls for the conditions that decide when to stop leveling
 */
function LimitSettings({
  limits,
  fastMode,
  meetRequirements,
  pointLabel,
  currentLevel,
  planLevel,
  closedAlerts,
  onChange,
}: Props) {
  const update = <K extends keyof LimitSettingsState>(
    key: K,
    patch: Partial<LimitSettingsState[K]>,
  ) => onChange({ limits: { ...limits, [key]: { ...limits[key], ...patch } } });

  // Fast mode only calculates where the level limit stops, so limits that need every level's value
  // don't apply
  const needsCurve = (key: keyof LimitSettingsState) => fastMode && key !== "maxLevels";
  const enabledCheckbox = (key: keyof LimitSettingsState, label: string) => (
    <Checkbox
      size="small"
      checked={limits[key].enabled}
      disabled={needsCurve(key)}
      inputProps={{ "aria-label": label }}
      onChange={(evt) => update(key, { enabled: evt.currentTarget.checked })}
    />
  );

  const { maxLevels, minGain, targetValue, targetPotential, minPotentialPerRemainingLevel } =
    limits;
  const levelField = levelLimitFields[maxLevels.mode];
  // Leveling starts from the planned level, so a level limit below it means no levels: when it's
  // above the current level, that's the least the limit can be. Additional levels count from
  // whichever is higher, so they can't go below it.
  const levelMin = maxLevels.mode === "absolute" && planLevel > currentLevel ? planLevel : 0;

  return (
    <Section id="limits" title="Stop leveling when">
      <Box
        display="grid"
        gridTemplateColumns="auto 1fr auto"
        alignItems="center"
        columnGap={1}
        rowGap={1}
      >
        {enabledCheckbox("maxLevels", "Level limit")}
        <NumberTextField
          // Remount when the mode changes so the field shows that mode's value
          key={maxLevels.mode}
          label={
            maxLevels.mode === "additional"
              ? `Level ${Math.max(currentLevel, planLevel)} +`
              : levelField.label
          }
          size="small"
          spinButtons
          disabled={!maxLevels.enabled}
          value={Math.max(maxLevels.values[maxLevels.mode], levelMin)}
          min={levelMin}
          max={levelField.max}
          step={levelField.step}
          onChange={(value) =>
            update("maxLevels", { values: { ...maxLevels.values, [maxLevels.mode]: value } })
          }
        />
        <Switch
          value={maxLevels.mode}
          options={[
            ["additional", "+ Levels"],
            ["absolute", "Level"],
            ["runes", "Runes"],
          ]}
          disabled={!maxLevels.enabled}
          onChange={(mode) => update("maxLevels", { mode })}
        />

        {enabledCheckbox("minGain", "Minimum gain per level")}
        <NumberTextField
          label="Min gain per level"
          size="small"
          disabled={!minGain.enabled || fastMode}
          value={minGain.value}
          min={0}
          step={minGain.relative ? 0.1 : 0.5}
          onChange={(value) => update("minGain", { value })}
        />
        <Switch
          value={minGain.relative ? "percent" : "points"}
          options={[
            ["points", pointLabel],
            ["percent", "%"],
          ]}
          disabled={!minGain.enabled || fastMode}
          onChange={(mode) => update("minGain", { relative: mode === "percent" })}
        />

        {enabledCheckbox("targetValue", "Target value")}
        <NumberTextField
          label={`Target ${pointLabel}`}
          size="small"
          spinButtons
          disabled={!targetValue.enabled || fastMode}
          value={targetValue.value}
          min={0}
          step={10}
          onChange={(value) => update("targetValue", { value })}
        />
        <Unit>{pointLabel}</Unit>

        {enabledCheckbox("targetPotential", "Target potential")}
        <NumberTextField
          label="Target potential"
          size="small"
          spinButtons
          disabled={!targetPotential.enabled || fastMode}
          value={targetPotential.value}
          min={0}
          max={100}
          step={5}
          onChange={(value) => update("targetPotential", { value })}
        />
        <Unit>%</Unit>

        {enabledCheckbox("minPotentialPerRemainingLevel", "Minimum potential left per level")}
        <NumberTextField
          label="Min left per level"
          size="small"
          disabled={!minPotentialPerRemainingLevel.enabled || fastMode}
          value={minPotentialPerRemainingLevel.value}
          min={0}
          step={0.1}
          onChange={(value) => update("minPotentialPerRemainingLevel", { value })}
        />
        <Unit>% potential</Unit>
      </Box>
      <FormControlLabel
        label="Always meet requirements"
        sx={{ mt: 1 }}
        control={
          <Checkbox
            size="small"
            checked={meetRequirements}
            onChange={(evt) => onChange({ meetRequirements: evt.currentTarget.checked })}
          />
        }
      />
      <FormControlLabel
        label="Fast mode: only calculate the level where leveling stops"
        control={
          <Checkbox
            size="small"
            checked={fastMode}
            onChange={(evt) => onChange({ fastMode: evt.currentTarget.checked })}
          />
        }
      />
      {fastMode && (
        <Typography variant="body2" color="text.secondary">
          Much faster with many weapons, e.g. for a respec at a fixed level, but there&apos;s no
          chart, and the minimum gain, target, and potential limits don&apos;t apply.
        </Typography>
      )}
      <DismissableNote
        id="levelingNote"
        closedAlerts={closedAlerts}
        onChange={onChange}
        sx={{ mt: 1.5 }}
      >
        Additional levels are counted from your current or planned level, whichever is higher. Runes
        are counted from your current level, including any needed to reach your planned stats. Gains
        are averaged over stretches where a requirement takes several levels to reach. Potential is
        0% with each damage stat at the higher of the weapon&apos;s requirement and the class&apos;s
        base, and 100% with 99 in each. Potential left per level is the potential still to gain
        divided by the levels it takes to gain it.
      </DismissableNote>
    </Section>
  );
}

export default memo(LimitSettings);
