import { memo } from "react";
import { Box, Checkbox, FormControlLabel } from "@mui/material";
import {
  ammoClassLabels,
  getAmmoKey,
  getAmmoLabel,
  type AmmoClass,
  type AmmoGroup,
} from "./useAmmo.ts";

interface Props {
  ammo: AmmoGroup[];
  selectedAmmo: string[];
  onSelectedAmmoChanged(selectedAmmo: string[]): void;
}

const checkboxSx = {
  display: "flex",
  mr: 0,
  my: "-4px",
  // Room between the lines of long names that wrap
  "& .MuiFormControlLabel-label": { lineHeight: 1.4, py: 0.5 },
};

/**
 * Checkboxes for ammunition to fire from ranged weapons, grouped by class
 */
function AmmoPicker({ ammo, selectedAmmo, onSelectedAmmoChanged }: Props) {
  return (
    <Box>
      {(Object.keys(ammoClassLabels) as AmmoClass[]).map((ammoClass) => {
        const keys = ammo.filter((group) => group.class === ammoClass).map(getAmmoKey);
        const selectedCount = keys.filter((key) => selectedAmmo.includes(key)).length;
        return (
          <Box key={ammoClass}>
            <FormControlLabel
              label={ammoClassLabels[ammoClass]}
              sx={checkboxSx}
              control={
                <Checkbox
                  size="small"
                  checked={keys.length > 0 && selectedCount === keys.length}
                  indeterminate={selectedCount > 0 && selectedCount < keys.length}
                  onChange={(evt) =>
                    onSelectedAmmoChanged(
                      evt.currentTarget.checked
                        ? [...new Set([...selectedAmmo, ...keys])]
                        : selectedAmmo.filter((key) => !keys.includes(key)),
                    )
                  }
                />
              }
            />
            <Box sx={{ ml: 3 }}>
              {ammo
                .filter((group) => group.class === ammoClass)
                .map((group) => {
                  const key = getAmmoKey(group);
                  return (
                    <FormControlLabel
                      key={key}
                      label={getAmmoLabel(group)}
                      sx={checkboxSx}
                      control={
                        <Checkbox
                          size="small"
                          checked={selectedAmmo.includes(key)}
                          onChange={(evt) =>
                            onSelectedAmmoChanged(
                              evt.currentTarget.checked
                                ? [...selectedAmmo, key]
                                : selectedAmmo.filter((value) => value !== key),
                            )
                          }
                        />
                      }
                    />
                  );
                })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default memo(AmmoPicker);
