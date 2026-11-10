import { memo } from "react";
import { Box, Button, Checkbox, FormControlLabel, Typography } from "@mui/material";
import {
  allDamageTypes,
  allEnemyTypes,
  AttackPowerType,
  type EnemyType,
} from "../calculator/calculator.ts";
import NumberTextField from "./NumberTextField.tsx";
import EnemyPicker from "./EnemyPicker.tsx";
import Section from "./Section.tsx";
import {
  allPhysicalTypes,
  type AppState,
  type DamageTypeDefenses,
  type PhysicalType,
  type UpdateAppState,
} from "./useAppState.ts";
import { damageTypeIcons, damageTypeLabels, physicalTypeLabels } from "./uiUtils.ts";

interface Props {
  defenses: AppState["defenses"];
  physicalNegation: AppState["physicalNegation"];
  enemyArea: AppState["enemyArea"];
  enemyKey: AppState["enemyKey"];
  enemyHp: AppState["enemyHp"];
  enemyTypes: AppState["enemyTypes"];
  onChange: UpdateAppState;
}

/** Labels for enemy types, with examples as tooltips */
const enemyTypeLabels: Record<EnemyType, [label: string, title: string]> = {
  death: [
    "Lives in death",
    "Those who live in death, e.g. skeletons and Death Rite Birds: Sacred Blade, the Golden Epitaph, etc. do more damage",
  ],
  dragon: [
    "Dragon",
    "e.g. Agheel, Glintstone Dragons, and Magma Wyrms (not Placidusax or Dragonkin Soldiers): dragon weapons and greases do more damage",
  ],
  ancientDragon: [
    "Ancient dragon",
    "e.g. Lansseax and Fortissax: dragon weapons and greases do more damage, less than to other dragons",
  ],
  star: [
    "Star creature",
    "Fallingstar Beasts, Astel, Onyx Lords, Malformed Stars, and Metyr: gravity weapons (e.g. the Starscourge Greatsword) do more damage",
  ],
};

/**
 * Form controls for the enemy's types, and its defense and damage negation against each damage type
 */

function DefenseSettings({
  defenses,
  physicalNegation,
  enemyArea,
  enemyKey,
  enemyHp,
  enemyTypes,
  onChange,
}: Props) {
  // Editing defenses by hand means they no longer match the picked enemy
  const editDefenses: UpdateAppState = (update) =>
    onChange({
      ...update,
      enemyKey: null,
      criticalDamageRate: 1,
      poiseDamageRate: 1,
      enemyRipostes: null,
    });

  return (
    <Section id="enemy" title="Enemy">
      <>
        <EnemyPicker enemyArea={enemyArea} enemyKey={enemyKey} onChange={onChange} />
        <NumberTextField
          label="HP"
          title="For damage that's a percentage of the enemy's max HP, e.g. black flame (0 if unknown)"
          size="small"
          sx={{ mb: 1 }}
          value={enemyHp}
          min={0}
          step={100}
          onChange={(hp) => editDefenses({ enemyHp: hp })}
        />
        <Box display="grid" gridTemplateColumns="1fr 1fr" mb={1}>
          {(Object.keys(enemyTypeLabels) as EnemyType[]).map((enemyType) => (
            <FormControlLabel
              key={enemyType}
              label={enemyTypeLabels[enemyType][0]}
              title={enemyTypeLabels[enemyType][1]}
              control={
                <Checkbox
                  size="small"
                  checked={enemyTypes.includes(enemyType)}
                  onChange={(event) =>
                    editDefenses({
                      enemyTypes: event.target.checked
                        ? allEnemyTypes.filter(
                            (type) => type === enemyType || enemyTypes.includes(type),
                          )
                        : enemyTypes.filter((type) => type !== enemyType),
                    })
                  }
                />
              }
            />
          ))}
        </Box>
        <Button
          size="small"
          sx={{ mb: 1 }}
          onClick={() => {
            const { defense } = defenses[AttackPowerType.PHYSICAL];
            const newDefenses = { ...defenses };
            for (const damageType of allDamageTypes as (keyof DamageTypeDefenses)[]) {
              newDefenses[damageType] = { ...defenses[damageType], defense };
            }
            editDefenses({ defenses: newDefenses });
          }}
        >
          Copy physical defense to all
        </Button>
        <Box display="grid" gridTemplateColumns="auto 1fr 1fr" alignItems="center" gap={1}>
          {(allDamageTypes as (keyof DamageTypeDefenses)[]).map((damageType) => {
            const update = (patch: Partial<DamageTypeDefenses[typeof damageType]>) =>
              editDefenses({
                defenses: { ...defenses, [damageType]: { ...defenses[damageType], ...patch } },
              });
            const isPhysical = damageType === AttackPowerType.PHYSICAL;
            return [
              <img
                key={`${damageType}-icon`}
                src={damageTypeIcons.get(damageType)}
                alt={damageTypeLabels.get(damageType)}
                title={damageTypeLabels.get(damageType)}
                width={24}
                height={24}
              />,
              <NumberTextField
                key={`${damageType}-defense`}
                label={`${damageTypeLabels.get(damageType)} defense`}
                size="small"
                spinButtons
                allowDecimals
                // Physical negation is split by type on the next row
                sx={isPhysical ? { gridColumn: "span 2" } : undefined}
                value={defenses[damageType].defense}
                min={0}
                onChange={(defense) => update({ defense })}
              />,
              isPhysical ? (
                <Box
                  key="physical-negation"
                  gridColumn="2 / span 2"
                  display="grid"
                  gridTemplateColumns="repeat(4, 1fr)"
                  gap={1}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    gridColumn="1 / -1"
                    mb={-0.5}
                    // Line up with the floating labels of the fields above (MUI insets them 14px)
                    sx={{ pl: "14px", letterSpacing: "0.00938em" }}
                  >
                    Physical negation
                  </Typography>
                  {allPhysicalTypes.map((physicalType) => (
                    <NumberTextField
                      key={physicalType}
                      label={physicalTypeLabels[physicalType]}
                      title={`${physicalTypeLabels[physicalType]} negation`}
                      size="small"
                      spinButtons
                      allowDecimals
                      value={physicalNegation[physicalType]}
                      min={-1000}
                      max={100}
                      step={10}
                      onChange={(negation) =>
                        editDefenses({
                          physicalNegation: { ...physicalNegation, [physicalType]: negation },
                        })
                      }
                    />
                  ))}
                </Box>
              ) : (
                <NumberTextField
                  key={`${damageType}-negation`}
                  label="Negation"
                  size="small"
                  spinButtons
                  allowDecimals
                  value={defenses[damageType].negation}
                  min={-1000}
                  max={100}
                  step={10}
                  onChange={(negation) => update({ negation })}
                />
              ),
            ];
          })}
        </Box>
        <Typography variant="body2" color="text.secondary" mt={1.5}>
          Negative negation is a weakness. Each hit&apos;s physical damage type, from the attack
          chosen in the Weapon panel, picks which physical negation applies. Doesn&apos;t apply to
          spell scaling.
        </Typography>
      </>
    </Section>
  );
}

export default memo(DefenseSettings);
