import { memo, useMemo } from "react";
import { Autocomplete, TextField } from "@mui/material";
import type { Weapon } from "../calculator/weapon.ts";
import { compareWeaponTypes, weaponTypeLabels } from "./uiUtils.ts";

interface Props {
  weapons: Weapon[];
  /** Each weapon name's position in the game's order. Others go last, alphabetically. */
  weaponOrder: ReadonlyMap<string, number>;
  selectedWeapons: string[];
  onSelectedWeaponsChanged(selectedWeapons: string[]): void;
}

/**
 * An Autocomplete for choosing weapons to compare. Affinities are chosen separately.
 */
function WeaponPicker({ weapons, weaponOrder, selectedWeapons, onSelectedWeaponsChanged }: Props) {
  const { options, typeLabels } = useMemo(() => {
    const order = (weapon: Weapon) => weaponOrder.get(weapon.weaponName) ?? Infinity;
    const sorted = [...weapons].sort(
      (a, b) =>
        compareWeaponTypes(a.weaponType, b.weaponType) ||
        order(a) - order(b) ||
        a.weaponName.localeCompare(b.weaponName),
    );
    const typeLabels = new Map(
      sorted.map((weapon) => [weapon.weaponName, weaponTypeLabels.get(weapon.weaponType) ?? ""]),
    );
    return { options: [...typeLabels.keys()], typeLabels };
  }, [weapons, weaponOrder]);

  return (
    <Autocomplete
      multiple
      options={options}
      value={selectedWeapons}
      onChange={(_, newSelection) => onSelectedWeaponsChanged(newSelection)}
      groupBy={(name) => typeLabels.get(name) ?? ""}
      renderInput={(params) => (
        <TextField {...params} label="Weapons" placeholder="Add a weapon, e.g. Claymore" />
      )}
      size="small"
      disableCloseOnSelect
    />
  );
}

export default memo(WeaponPicker);
