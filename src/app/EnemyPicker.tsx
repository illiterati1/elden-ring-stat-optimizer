import { memo, useMemo } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { AttackPowerType } from "../calculator/calculator.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import useEnemies, {
  getAreaDefense,
  getEnemyCategory,
  getEnemyKey,
  getEnemyStats,
  getNgPlusLabel,
  maxNgPlus,
  type Enemy,
  type EnemyArea,
} from "./useEnemies.ts";
import { debug } from "./uiUtils.ts";

interface Props {
  enemyArea: AppState["enemyArea"];
  enemyKey: AppState["enemyKey"];
  ngPlus: AppState["ngPlus"];
  radahnBeaten: AppState["radahnBeaten"];
  onChange: UpdateAppState;
}

/**
 * Pickers for an area, an enemy in it, and the NG+ level, which fill in the enemy defense fields
 */
function EnemyPicker({ enemyArea, enemyKey, ngPlus, radahnBeaten, onChange }: Props) {
  const { areas, error } = useEnemies();

  const area = areas.find(({ name }) => name === enemyArea) ?? null;
  const enemy = area?.enemies.find((enemy) => getEnemyKey(enemy) === enemyKey) ?? null;

  // Entries' names tell them apart (scripts/enemy_curation.py identifies those sharing a name).
  // Enemies are grouped by category, so bosses' "[Boss]" tag is left out.
  // A name still shared (none in the areas reviewed so far) gets the HP as a last resort.
  const enemyLabels = useMemo(() => {
    const labels = new Map<Enemy, string>();
    for (const enemy of area?.enemies ?? []) {
      // (within its section: e.g. Witch-Hunter Jerren is both an enemy and a friendly character)
      const sameName = area!.enemies.filter(
        (other) => other.name === enemy.name && getEnemyCategory(other) === getEnemyCategory(enemy),
      );
      const label = enemy.name.replace(" [Boss]", "");
      labels.set(enemy, sameName.length > 1 ? `${label} (${enemy.hp.toLocaleString()} HP)` : label);
    }
    return labels;
  }, [area]);

  // An area without an enemy gets the defenses most of its enemies have, without negation
  function selectArea(newArea: EnemyArea | null, newNgPlus = ngPlus) {
    if (!newArea) {
      onChange({ enemyArea: null, enemyKey: null, enemyInRealmOfShadow: null });
      return;
    }
    const [phys, mag, fire, lightning, holy] = getAreaDefense(newArea, newNgPlus).map(Math.round);
    onChange({
      enemyArea: newArea.name,
      enemyKey: null,
      enemyInRealmOfShadow: null,
      enemyHp: 0,
      criticalDamageRate: 1,
      poiseDamageRate: 1,
      enemyRipostes: null,
      enemyTypes: [],
      defenses: {
        [AttackPowerType.PHYSICAL]: { defense: phys, negation: 0 },
        [AttackPowerType.MAGIC]: { defense: mag, negation: 0 },
        [AttackPowerType.FIRE]: { defense: fire, negation: 0 },
        [AttackPowerType.LIGHTNING]: { defense: lightning, negation: 0 },
        [AttackPowerType.HOLY]: { defense: holy, negation: 0 },
      },
      physicalNegation: { standard: 0, slash: 0, strike: 0, pierce: 0 },
    });
  }

  function selectEnemy(newEnemy: Enemy | null, newNgPlus = ngPlus, newRadahnBeaten = radahnBeaten) {
    // Clearing the enemy goes back to the area's defaults
    if (!newEnemy) {
      selectArea(area, newNgPlus);
      return;
    }
    const stats = getEnemyStats(newEnemy, newNgPlus, newRadahnBeaten);
    const [phys, mag, fire, lightning, holy] = stats.defense.map(Math.round);
    const [standard, slash, strike, pierce, magN, fireN, lightningN, holyN] = newEnemy.negation.map(
      Math.round,
    );
    onChange({
      enemyKey: getEnemyKey(newEnemy),
      enemyInRealmOfShadow: !!area?.dlc,
      enemyHp: stats.hp,
      criticalDamageRate: newEnemy.criticalDamageRate ?? 1,
      poiseDamageRate: newEnemy.poiseDamageRate ?? 1,
      enemyRipostes: newEnemy.ripostes,
      enemyTypes: newEnemy.types ?? [],
      defenses: {
        [AttackPowerType.PHYSICAL]: { defense: phys, negation: 0 },
        [AttackPowerType.MAGIC]: { defense: mag, negation: magN },
        [AttackPowerType.FIRE]: { defense: fire, negation: fireN },
        [AttackPowerType.LIGHTNING]: { defense: lightning, negation: lightningN },
        [AttackPowerType.HOLY]: { defense: holy, negation: holyN },
      },
      physicalNegation: { standard, slash, strike, pierce },
    });
  }

  if (error) {
    return <Alert severity="error">Couldn't load enemy data: {error.message}</Alert>;
  }

  return (
    <Box display="grid" gap={1} mb={2}>
      <Autocomplete
        size="small"
        options={areas}
        value={area}
        loading={areas.length === 0}
        groupBy={(option) => option.region}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        onChange={(_, newArea) => selectArea(newArea)}
        renderInput={(params) => <TextField {...params} label="Area" />}
      />
      <Autocomplete
        size="small"
        options={area?.enemies ?? []}
        // Grouped by category (in that order in the data)
        groupBy={getEnemyCategory}
        value={enemy}
        disabled={!area}
        getOptionLabel={(option) => enemyLabels.get(option) ?? option.name}
        isOptionEqualToValue={(option, value) => getEnemyKey(option) === getEnemyKey(value)}
        onChange={(_, newEnemy) => selectEnemy(newEnemy)}
        renderInput={(params) => <TextField {...params} label="Enemy" />}
      />
      {debug && (
        <>
          <FormControl
            fullWidth
            size="small"
            disabled={!area}
            title={area ? undefined : "Pick an area or enemy for their HP and defenses in NG+"}
          >
            <InputLabel id="ngPlusLabel">NG+</InputLabel>
            <Select
              labelId="ngPlusLabel"
              label="NG+"
              value={ngPlus}
              onChange={(evt) => {
                const newNgPlus = +evt.target.value;
                onChange({ ngPlus: newNgPlus });
                // Refill the picked enemy's or area's stats
                if (enemy) selectEnemy(enemy, newNgPlus);
                else if (area) selectArea(area, newNgPlus);
              }}
            >
              {Array.from({ length: maxNgPlus + 1 }, (_, level) => (
                <MenuItem key={level} value={level}>
                  {getNgPlusLabel(level)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {enemy && ngPlus === 1 && !enemy.ngPlus && (
            <Typography variant="body2" color="text.secondary">
              Doesn&apos;t get stronger in NG+, only from NG+2
            </Typography>
          )}
          {ngPlus > 0 && (
            <FormControlLabel
              label="Beaten Promised Consort Radahn in an earlier journey"
              title="Raises many of the DLC's enemies' HP (not their defenses)"
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={radahnBeaten}
                  onChange={(evt) => {
                    const newRadahnBeaten = evt.currentTarget.checked;
                    onChange({ radahnBeaten: newRadahnBeaten });
                    if (enemy) selectEnemy(enemy, ngPlus, newRadahnBeaten);
                  }}
                />
              }
            />
          )}
        </>
      )}
      {enemy?.criticalDamageRate && (
        <Typography variant="body2" color="text.secondary">
          Takes {Math.round((1 - enemy.criticalDamageRate) * 100)}% less damage from backstabs and
          ripostes
        </Typography>
      )}
      {enemy?.poiseDamageRate != null && (
        <Typography variant="body2" color="text.secondary">
          Takes {enemy.poiseDamageRate}× poise damage
        </Typography>
      )}
      {enemy?.poiseNote && (
        <Typography variant="body2" color="text.secondary">
          {enemy.poiseNote}
        </Typography>
      )}
      {enemy?.weakPartDamageRate != null && (
        <Typography variant="body2" color="text.secondary">
          Takes {enemy.weakPartDamageRate}× damage on its weak spot
        </Typography>
      )}
      {enemy?.riposteNotes &&
        Object.entries(enemy.riposteNotes).map(([riposte, note]) => (
          <Typography key={riposte} variant="body2" color="text.secondary">
            {riposte}: {note}
          </Typography>
        ))}
      {debug && enemy && (
        <Typography variant="body2" color="text.secondary">
          NpcParam {enemy.npcParamIds.join(", ")}
        </Typography>
      )}
    </Box>
  );
}

export default memo(EnemyPicker);
