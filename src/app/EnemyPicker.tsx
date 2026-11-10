import { memo, useMemo } from "react";
import { Alert, Autocomplete, Box, TextField, Typography } from "@mui/material";
import { AttackPowerType } from "../calculator/calculator.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import useEnemies, {
  getEnemyCategory,
  getEnemyKey,
  type Enemy,
  type EnemyArea,
} from "./useEnemies.ts";
import { debug } from "./uiUtils.ts";

interface Props {
  enemyArea: AppState["enemyArea"];
  enemyKey: AppState["enemyKey"];
  onChange: UpdateAppState;
}

/**
 * Pickers for an area and an enemy in it, which fill in the enemy defense fields
 */
function EnemyPicker({ enemyArea, enemyKey, onChange }: Props) {
  const { areas, error } = useEnemies();

  const area = areas.find(({ name }) => name === enemyArea) ?? null;
  const enemy = area?.enemies.find((enemy) => getEnemyKey(enemy) === enemyKey) ?? null;

  // Entries' names tell them apart (scripts/enemy_curation.py identifies those sharing a name).
  // Only bosses are listed (or they're grouped, in debug mode), so their "[Boss]" tag is left out.
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
  function selectArea(newArea: EnemyArea | null) {
    if (!newArea) {
      onChange({ enemyArea: null, enemyKey: null });
      return;
    }
    const [phys, mag, fire, lightning, holy] = newArea.defense.map(Math.round);
    onChange({
      enemyArea: newArea.name,
      enemyKey: null,
      enemyHp: 0,
      criticalDamageRate: 1,
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

  function selectEnemy(newEnemy: Enemy | null) {
    // Clearing the enemy goes back to the area's defaults
    if (!newEnemy) {
      selectArea(area);
      return;
    }
    const [phys, mag, fire, lightning, holy] = newEnemy.defense.map(Math.round);
    const [standard, slash, strike, pierce, magN, fireN, lightningN, holyN] = newEnemy.negation.map(
      Math.round,
    );
    onChange({
      enemyKey: getEnemyKey(newEnemy),
      enemyHp: newEnemy.hp,
      criticalDamageRate: newEnemy.criticalDamageRate ?? 1,
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
        // In debug mode every enemy is listed, by category (in that order in the data)
        groupBy={debug ? getEnemyCategory : undefined}
        value={enemy}
        disabled={!area}
        getOptionLabel={(option) => enemyLabels.get(option) ?? option.name}
        isOptionEqualToValue={(option, value) => getEnemyKey(option) === getEnemyKey(value)}
        onChange={(_, newEnemy) => selectEnemy(newEnemy)}
        renderInput={(params) => <TextField {...params} label="Enemy" />}
      />
      {enemy?.criticalDamageRate && (
        <Typography variant="body2" color="text.secondary">
          Takes {Math.round((1 - enemy.criticalDamageRate) * 100)}% less damage from backstabs and
          ripostes
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
