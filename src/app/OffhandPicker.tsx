import { memo, useMemo } from "react";
import {
  Autocomplete,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { maxRegularUpgradeLevel, toSpecialUpgradeLevel } from "../optimizer/build.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import { getBuffKey, type Buff } from "./useBuffs.ts";
import { BuffOption, compareBuffs, groupByKind, typedKinds } from "./buffListing.tsx";
import { affinityOptions } from "./uiUtils.ts";

interface Props {
  offhandWeapon: AppState["offhandWeapon"];
  offhandUpgradeLevel: AppState["offhandUpgradeLevel"];
  offhandAffinityId: AppState["offhandAffinityId"];
  offhandBuff: AppState["offhandBuff"];
  /** Weapons that can be held in the off hand for powerstance attacks, by base name */
  weaponChoices: readonly string[];
  /** Each weapon choice's weapon type label, to group them by like the weapon picker */
  weaponTypes: ReadonlyMap<string, string>;
  /** The chosen off hand weapon's affinities */
  affinityChoices: readonly number[];
  /** Weapon buffs that can go on the chosen off hand weapon */
  buffChoices: readonly Buff[];
  onChange: UpdateAppState;
}

/**
 * Pickers for a powerstance attack's off hand weapon, its upgrade level, and optionally its affinity
 * and weapon buff: one combination, compared with every main hand weapon
 */
function OffhandPicker({
  offhandWeapon,
  offhandUpgradeLevel,
  offhandAffinityId,
  offhandBuff,
  weaponChoices,
  weaponTypes,
  affinityChoices,
  buffChoices,
  onChange,
}: Props) {
  const buff = buffChoices.find((choice) => getBuffKey(choice) === offhandBuff) ?? null;
  // Like the weapon buffs picker: by kind, then name
  const sortedBuffChoices = useMemo(() => {
    const kindOrder = typedKinds.map(([kind]) => kind);
    return [...buffChoices].sort(
      (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || compareBuffs(a, b),
    );
  }, [buffChoices]);
  return (
    <Box gridColumn="1 / -1" display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
      <Autocomplete
        size="small"
        sx={{ gridColumn: "1 / -1" }}
        options={weaponChoices}
        groupBy={(name) => weaponTypes.get(name) ?? ""}
        value={offhandWeapon}
        onChange={(_, weapon) =>
          onChange({ offhandWeapon: weapon, offhandAffinityId: null, offhandBuff: null })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Left hand weapon"
            title="For powerstance attacks: the weapon in the left hand, if not the same one"
          />
        )}
      />
      <FormControl fullWidth size="small" disabled={!offhandWeapon}>
        <InputLabel id="offhandUpgradeLevelLabel">Left hand level</InputLabel>
        <Select
          labelId="offhandUpgradeLevelLabel"
          label="Left hand level"
          value={offhandUpgradeLevel}
          onChange={(evt) => onChange({ offhandUpgradeLevel: +evt.target.value })}
        >
          {Array.from({ length: maxRegularUpgradeLevel + 1 }, (_, level) => (
            <MenuItem key={level} value={level}>
              +{level} / +{toSpecialUpgradeLevel(level)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {offhandWeapon && affinityChoices.length > 1 && (
        <FormControl fullWidth size="small">
          <InputLabel id="offhandAffinityLabel">Left hand affinity</InputLabel>
          <Select
            labelId="offhandAffinityLabel"
            label="Left hand affinity"
            value={offhandAffinityId ?? affinityChoices[0]}
            onChange={(evt) => onChange({ offhandAffinityId: +evt.target.value })}
          >
            {affinityChoices.map((affinityId) => (
              <MenuItem key={affinityId} value={affinityId}>
                {affinityOptions.get(affinityId)?.text ?? affinityId}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {offhandWeapon && (
        <Autocomplete
          size="small"
          sx={{ gridColumn: "1 / -1" }}
          options={sortedBuffChoices}
          groupBy={groupByKind}
          value={buff}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(option, other) => getBuffKey(option) === getBuffKey(other)}
          renderOption={BuffOption}
          onChange={(_, choice) => onChange({ offhandBuff: choice ? getBuffKey(choice) : null })}
          renderInput={(params) => <TextField {...params} label="Left hand weapon buff" />}
        />
      )}
    </Box>
  );
}

export default memo(OffhandPicker);
