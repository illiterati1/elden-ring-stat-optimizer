import { memo } from "react";
import { Box, Checkbox, FormControlLabel } from "@mui/material";
import type { WeaponType } from "../calculator/calculator.ts";
import {
  catalystTypes,
  compareWeaponTypes,
  meleeWeaponTypes,
  rangedWeaponTypes,
  shieldTypes,
  weaponTypeLabels,
} from "./uiUtils.ts";

interface Props {
  weaponTypes: readonly WeaponType[];
  onWeaponTypesChanged(weaponTypes: WeaponType[]): void;
}

const checkboxSx = { display: "block", mr: 0, my: "-4px" };

/**
 * Set of checkboxes for adding every weapon of some types, grouped by category
 */
function WeaponTypePicker({ weaponTypes, onWeaponTypesChanged }: Props) {
  const renderWeaponCategory = (label: string, weaponTypesInCategory: WeaponType[]) => {
    const checked = weaponTypesInCategory.every((weaponType) => weaponTypes.includes(weaponType));
    const indeterminate =
      !checked && weaponTypesInCategory.some((weaponType) => weaponTypes.includes(weaponType));

    return (
      <FormControlLabel
        label={label}
        sx={checkboxSx}
        control={
          <Checkbox
            size="small"
            checked={checked}
            indeterminate={indeterminate}
            name={label}
            onChange={(evt) =>
              onWeaponTypesChanged(
                evt.currentTarget.checked
                  ? [...new Set([...weaponTypes, ...weaponTypesInCategory])]
                  : weaponTypes.filter((weaponType) => !weaponTypesInCategory.includes(weaponType)),
              )
            }
          />
        }
      />
    );
  };

  const renderWeaponType = (weaponType: WeaponType) => {
    const label = weaponTypeLabels.get(weaponType)!;
    return (
      <FormControlLabel
        key={weaponType}
        label={label}
        sx={checkboxSx}
        control={
          <Checkbox
            size="small"
            checked={weaponTypes.includes(weaponType)}
            name={label}
            onChange={(evt) =>
              onWeaponTypesChanged(
                evt.currentTarget.checked
                  ? [...weaponTypes, weaponType]
                  : weaponTypes.filter((value) => value !== weaponType),
              )
            }
          />
        }
      />
    );
  };

  const categories: [string, WeaponType[]][] = [
    ["Melee Weapons", meleeWeaponTypes],
    ["Ranged Weapons", rangedWeaponTypes],
    ["Catalysts", catalystTypes],
    ["Shields", shieldTypes],
  ];

  return (
    <Box>
      {categories.map(([label, weaponTypesInCategory]) => (
        <Box key={label}>
          {renderWeaponCategory(label, weaponTypesInCategory)}
          <Box sx={{ ml: 3 }}>
            {
              // The game's order, like the weapon picker
              [...weaponTypesInCategory].sort(compareWeaponTypes).map(renderWeaponType)
            }
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default memo(WeaponTypePicker);
