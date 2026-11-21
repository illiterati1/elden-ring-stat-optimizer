import { memo, useMemo, useState, type Key, type ReactNode } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import {
  maxRegularUpgradeLevel,
  scadutreeBlessingRates,
  toSpecialUpgradeLevel,
} from "../optimizer/build.ts";
import type { Objective } from "../optimizer/optimizer.ts";
import Section from "./Section.tsx";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import {
  damageTypeIcons,
  damageTypeLabels,
  debug,
  objectiveOptions,
  statusTypes,
} from "./uiUtils.ts";
import { countActiveFilters, type WeaponFilters } from "./filters.ts";
import WeaponTypePicker from "./WeaponTypePicker.tsx";
import NumberTextField from "./NumberTextField.tsx";
import { chainAttacks, type AttackName } from "./useMovesets.ts";
import { fixedSkillsChoice } from "./useAshes.ts";
import AffinityPicker from "./AffinityPicker.tsx";
import AmmoPicker from "./AmmoPicker.tsx";
import type { AmmoGroup } from "./useAmmo.ts";
import OffhandPicker from "./OffhandPicker.tsx";
import type { Buff } from "./useBuffs.ts";

interface Props {
  /** The picked upgrade levels, lowest first */
  upgradeLevels: AppState["upgradeLevels"];
  twoHanding: AppState["twoHanding"];
  showScaling: AppState["showScaling"];
  showStatus: AppState["showStatus"];
  showStance: AppState["showStance"];
  showStamina: AppState["showStamina"];
  showDamagePerStamina: AppState["showDamagePerStamina"];
  showStancePerStamina: AppState["showStancePerStamina"];
  showPotential: AppState["showPotential"];
  showRequirements: AppState["showRequirements"];
  closedAlerts: AppState["closedAlerts"];
  onlyBuffable: AppState["onlyBuffable"];
  weaponFilters: AppState["weaponFilters"];
  objective: AppState["objective"];
  weaponTypes: AppState["weaponTypes"];
  attacks: AppState["attacks"];
  chainWeight: AppState["chainWeight"];
  sumChains: AppState["sumChains"];
  /** True if any weapon's attack is a chain, e.g. a weapon's own skill, so its options apply */
  hasChain: boolean;
  ashesOfWar: AppState["ashesOfWar"];
  /** The Ash of War picker's choices: every Ash of War, and with each of its follow-ups */
  ashChoices: { value: string; label: string }[];
  /** The attacks to offer, e.g. only the ripostes the picked enemy can take */
  attackChoices: readonly AttackName[];
  affinityIds: AppState["affinityIds"];
  ammo: AmmoGroup[];
  selectedAmmo: AppState["selectedAmmo"];
  /** What one point of the objective is called: "damage" or "scaling" */
  pointLabel: string;
  offhandWeapon: AppState["offhandWeapon"];
  offhandUpgradeLevel: AppState["offhandUpgradeLevel"];
  offhandAffinityId: AppState["offhandAffinityId"];
  offhandBuff: AppState["offhandBuff"];
  /** Weapons that can be held in the off hand for powerstance attacks */
  offhandWeaponChoices: readonly string[];
  /** Each off hand weapon choice's weapon type label, to group them by */
  offhandWeaponTypes: ReadonlyMap<string, string>;
  /** The chosen off hand weapon's affinities */
  offhandAffinityChoices: readonly number[];
  /** Weapon buffs that can go on the chosen off hand weapon */
  offhandBuffChoices: readonly Buff[];
  /** Whether the Scadutree Blessing applies: the checkbox's, or the picked enemy's area's */
  scadutreeBlessing: boolean;
  scadutreeBlessingLevel: AppState["scadutreeBlessingLevel"];
  /** True if a picked enemy decides whether the blessing applies, rather than the checkbox */
  scadutreeBlessingFromEnemy: boolean;
  onChange: UpdateAppState;
}

/** Notes on which enemies some attacks are for, shown as the attack picker's tooltips */
const attackNotes: Partial<Record<AttackName, string>> = {
  Riposte: "For roughly human-sized enemies",
  "Large Riposte": "Generally for anything larger than a Crucible Knight",
  "Small Riposte": "Generally for Vulgar Militia and some dismounted enemies",
  "Jump Shot + Landing Shot":
    "Light bows (and the Black Bow and Ansbach's Longbow): a jumping shot, then a shot as soon as it lands",
};

const upgradeLevelChoices = Array.from({ length: maxRegularUpgradeLevel + 1 }, (_, level) => level);
const upgradeLevelLabel = (level: number) => `+${level} / +${toSpecialUpgradeLevel(level)}`;

/** Like the weapon picker: an autocomplete to pick several of, which stays open while picking */
function MultiPicker<T extends string | number>({
  label,
  placeholder,
  options,
  value,
  getOptionLabel,
  getOptionTitle,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: readonly T[];
  value: readonly T[];
  getOptionLabel: (option: T) => string;
  /** A tooltip for an option */
  getOptionTitle?: (option: T) => string | undefined;
  onChange: (value: T[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      options={options}
      value={value as T[]}
      onChange={(_, newValue) => onChange(newValue)}
      getOptionLabel={getOptionLabel}
      renderOption={(props, option) => (
        <li {...props} key={option} title={getOptionTitle?.(option)}>
          {getOptionLabel(option)}
        </li>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={value.length ? undefined : placeholder} />
      )}
      size="small"
      disableCloseOnSelect
      // On a row of its own, since it grows with what's picked
      sx={{ gridColumn: "1 / -1" }}
    />
  );
}

/**
 * A section of the weapon settings that can be expanded and collapsed, starting collapsed
 */
function CollapsibleGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="small"
        sx={{ mt: 1, ml: -1, display: "flex" }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "▾" : "▸"} {title}
      </Button>
      <Collapse in={open}>{children}</Collapse>
    </>
  );
}

/** Toggles a value in a list, e.g. a checked damage type */
function toggle<T>(values: readonly T[], value: T, checked: boolean) {
  return checked ? [...values, value] : values.filter((other) => other !== value);
}

/**
 * Filters on the weapons calculated: all but Top N leave weapons out before optimizing, so they
 * also make calculation faster
 */
function FilterSettings({
  onlyBuffable,
  weaponFilters,
  onChange,
}: {
  onlyBuffable: AppState["onlyBuffable"];
  weaponFilters: AppState["weaponFilters"];
  onChange: UpdateAppState;
}) {
  const { damageTypes, statusTypes: filterStatusTypes, maxWeight, topN } = weaponFilters;
  const update = (update: Partial<WeaponFilters>) =>
    onChange({ weaponFilters: { ...weaponFilters, ...update } });
  const active = countActiveFilters(weaponFilters, onlyBuffable);
  const checkbox = (
    label: ReactNode,
    checked: boolean,
    onToggle: (checked: boolean) => void,
    key?: Key,
  ) => (
    <FormControlLabel
      key={key}
      label={label}
      sx={{ mr: 0 }}
      control={
        <Checkbox
          size="small"
          checked={checked}
          onChange={(evt) => onToggle(evt.currentTarget.checked)}
        />
      }
    />
  );
  const icon = (src: string) => (
    <img
      src={src}
      alt=""
      width={20}
      height={20}
      style={{ verticalAlign: "middle", marginRight: 4 }}
    />
  );
  return (
    <CollapsibleGroup title={`Filters${active > 0 ? ` (${active} active)` : ""}`}>
      <Box display="flex" flexWrap="wrap" columnGap={3}>
        {checkbox("Buffable", onlyBuffable, (checked) => onChange({ onlyBuffable: checked }))}
        {checkbox("Base game only", weaponFilters.baseGameOnly, (baseGameOnly) =>
          update({ baseGameOnly }),
        )}
      </Box>

      <Box
        display="grid"
        gridTemplateColumns="auto 1fr"
        alignItems="center"
        columnGap={2}
        rowGap={1}
        mt={1}
      >
        {checkbox("Top", topN.enabled, (enabled) => update({ topN: { ...topN, enabled } }))}
        <NumberTextField
          label="Weapons"
          size="small"
          spinButtons
          disabled={!topN.enabled}
          value={topN.value}
          min={1}
          step={1}
          onChange={(value) => update({ topN: { ...topN, value } })}
        />
        {checkbox("Max weapon weight", maxWeight.enabled, (enabled) =>
          update({ maxWeight: { ...maxWeight, enabled } }),
        )}
        <NumberTextField
          label="Max weight"
          size="small"
          spinButtons
          allowDecimals
          disabled={!maxWeight.enabled}
          value={maxWeight.value}
          min={0}
          step={0.5}
          onChange={(value) => update({ maxWeight: { ...maxWeight, value } })}
        />
      </Box>

      <Typography variant="body2" color="text.secondary" mt={1}>
        Deals any of (includes buffs)
      </Typography>
      <Box display="flex" flexWrap="wrap" columnGap={3}>
        {[...damageTypeLabels].map(([type, label]) =>
          checkbox(
            <>
              {icon(damageTypeIcons.get(type)!)}
              {label}
            </>,
            damageTypes.includes(type),
            (checked) => update({ damageTypes: toggle(damageTypes, type, checked) }),
            type,
          ),
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" mt={1}>
        Builds up any of
      </Typography>
      <Box display="flex" flexWrap="wrap" columnGap={3}>
        {[...statusTypes].map(([type, { label, icon: src }]) =>
          checkbox(
            <>
              {icon(src)}
              {label}
            </>,
            filterStatusTypes.includes(type),
            (checked) => update({ statusTypes: toggle(filterStatusTypes, type, checked) }),
            type,
          ),
        )}
      </Box>
    </CollapsibleGroup>
  );
}

/**
 * Form controls for weapon upgrade level, two handing, what to maximize, weapon types, and
 * affinities
 */
function BuildSettings({
  upgradeLevels,
  twoHanding,
  showScaling,
  showStatus,
  showStance,
  showStamina,
  showDamagePerStamina,
  showStancePerStamina,
  showPotential,
  showRequirements,
  closedAlerts,
  onlyBuffable,
  weaponFilters,
  objective,
  weaponTypes,
  attacks,
  chainWeight,
  sumChains,
  hasChain,
  ashesOfWar,
  ashChoices,
  attackChoices,
  affinityIds,
  ammo,
  selectedAmmo,
  pointLabel,
  offhandWeapon,
  offhandUpgradeLevel,
  offhandAffinityId,
  offhandBuff,
  offhandWeaponChoices,
  offhandWeaponTypes,
  offhandAffinityChoices,
  offhandBuffChoices,
  scadutreeBlessing,
  scadutreeBlessingLevel,
  scadutreeBlessingFromEnemy,
  onChange,
}: Props) {
  const spellScaling = objective === "spellScaling";
  // Weapons' fixed skills first, then the Ashes of War
  const ashOptions = useMemo(
    () => [fixedSkillsChoice, ...ashChoices.map(({ value }) => value)],
    [ashChoices],
  );
  const ashLabels = useMemo(
    () =>
      new Map([
        [fixedSkillsChoice, "Fixed skills"],
        ...ashChoices.map(({ value, label }): [string, string] => [value, label]),
      ]),
    [ashChoices],
  );
  return (
    <Section id="weapon" title="Weapon">
      <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
        <FormControl fullWidth size="small">
          <InputLabel id="objectiveLabel">Maximize</InputLabel>
          <Select
            labelId="objectiveLabel"
            label="Maximize"
            value={objectiveOptions.findIndex(([value]) => value === objective)}
            onChange={(evt) => onChange({ objective: objectiveOptions[+evt.target.value][0] })}
          >
            {objectiveOptions.map(([value, label], index) => (
              <MenuItem key={String(value as Objective)} value={index}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <MultiPicker
          label="Weapon Levels"
          placeholder="Add a level"
          options={upgradeLevelChoices}
          value={upgradeLevels}
          getOptionLabel={upgradeLevelLabel}
          onChange={(levels) => onChange({ upgradeLevels: levels.sort((a, b) => a - b) })}
        />

        {/* Spell scaling doesn't use an attack */}
        {objective !== "spellScaling" && (
          <>
            <MultiPicker
              label="Attacks"
              placeholder="Add an attack"
              options={attackChoices}
              value={attacks}
              getOptionLabel={(attackName) =>
                attackName + (chainAttacks.has(attackName) ? " chain" : "")
              }
              getOptionTitle={(attackName) => attackNotes[attackName]}
              onChange={(newAttacks) => onChange({ attacks: newAttacks })}
            />
            {attacks
              .filter((attackName) => attackName in attackNotes)
              .map((attackName) => (
                <Typography
                  key={attackName}
                  variant="body2"
                  color="text.secondary"
                  gridColumn="1 / -1"
                >
                  {attacks.length > 1 && `${attackName}: `}
                  {attackNotes[attackName]}
                </Typography>
              ))}
            <MultiPicker
              label="Ashes of War"
              placeholder="Add a skill"
              options={ashOptions}
              value={ashesOfWar}
              getOptionLabel={(choice) => ashLabels.get(choice) ?? choice}
              getOptionTitle={(choice) =>
                choice === fixedSkillsChoice
                  ? "Weapons' own skills, for weapons that can't take an Ash of War"
                  : undefined
              }
              onChange={(newAshes) => onChange({ ashesOfWar: newAshes })}
            />
          </>
        )}
        {objective !== "spellScaling" &&
          attacks.some((attackName) => attackName.startsWith("Powerstance")) && (
            <OffhandPicker
              offhandWeapon={offhandWeapon}
              offhandUpgradeLevel={offhandUpgradeLevel}
              offhandAffinityId={offhandAffinityId}
              offhandBuff={offhandBuff}
              weaponChoices={offhandWeaponChoices}
              weaponTypes={offhandWeaponTypes}
              affinityChoices={offhandAffinityChoices}
              buffChoices={offhandBuffChoices}
              onChange={onChange}
            />
          )}
        {objective !== "spellScaling" && hasChain && (
          <>
            <NumberTextField
              label="Chain weighting"
              title="How much each hit of the chain counts relative to the one before it. At 0, stats are optimized for the first hit of each chain only."
              size="small"
              spinButtons
              // On a row of its own, with the sum checkbox beside it
              sx={{ gridColumn: 1 }}
              disabled={sumChains}
              value={chainWeight}
              min={0}
              max={1}
              step={0.1}
              onChange={(value) => onChange({ chainWeight: value })}
            />
            <FormControlLabel
              label="Sum chain steps"
              title="Add up every step of the chain, rather than taking their weighted average"
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={sumChains}
                  onChange={(evt) => onChange({ sumChains: evt.currentTarget.checked })}
                />
              }
            />
          </>
        )}

        {/* Spell scaling isn't affected by damage multipliers */}
        {debug && (
          <>
            <FormControlLabel
              label="Scadutree Blessing"
              title={
                spellScaling
                  ? "Doesn't apply to spell scaling"
                  : scadutreeBlessingFromEnemy
                  ? `Set by the enemy picked: ${
                      scadutreeBlessing ? "it's" : "it isn't"
                    } in the Realm of Shadow`
                  : "The blessing's damage bonus, which applies in the Realm of Shadow"
              }
              sx={{ mr: 0, gridColumn: 1 }}
              disabled={spellScaling || scadutreeBlessingFromEnemy}
              control={
                <Checkbox
                  size="small"
                  checked={scadutreeBlessing}
                  onChange={(evt) => onChange({ scadutreeBlessing: evt.currentTarget.checked })}
                />
              }
            />
            <FormControl fullWidth size="small" disabled={spellScaling}>
              <InputLabel id="scadutreeBlessingLevelLabel">Blessing Level</InputLabel>
              <Select
                labelId="scadutreeBlessingLevelLabel"
                label="Blessing Level"
                value={scadutreeBlessingLevel}
                onChange={(evt) => onChange({ scadutreeBlessingLevel: +evt.target.value })}
              >
                {scadutreeBlessingRates.map((rate, level) => (
                  <MenuItem key={level} value={level}>
                    +{level} ({rate}×)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {!spellScaling && scadutreeBlessingFromEnemy && (
              <Typography variant="body2" color="text.secondary" gridColumn="1 / -1">
                {scadutreeBlessing
                  ? "The enemy picked is in the Realm of Shadow, so the blessing applies"
                  : "The enemy picked isn't in the Realm of Shadow, so the blessing doesn't apply"}
              </Typography>
            )}
          </>
        )}
      </Box>

      <Box display="flex" flexWrap="wrap" columnGap={3} mt={1}>
        <FormControlLabel
          label="Two handing"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={twoHanding}
              onChange={(evt) => onChange({ twoHanding: evt.currentTarget.checked })}
            />
          }
        />
      </Box>
      <CollapsibleGroup title="Columns">
        {/* Spell scaling has no attack to show stance, stamina, or status for */}
        <Box display="flex" flexWrap="wrap" columnGap={3}>
          <FormControlLabel
            label="Stance"
            sx={{ mr: 0 }}
            disabled={spellScaling}
            control={
              <Checkbox
                size="small"
                checked={showStance}
                onChange={(evt) => onChange({ showStance: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Stamina cost"
            sx={{ mr: 0 }}
            disabled={spellScaling}
            control={
              <Checkbox
                size="small"
                checked={showStamina}
                onChange={(evt) => onChange({ showStamina: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Damage/stamina"
            sx={{ mr: 0 }}
            disabled={spellScaling}
            control={
              <Checkbox
                size="small"
                checked={showDamagePerStamina}
                onChange={(evt) => onChange({ showDamagePerStamina: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Stance/stamina"
            sx={{ mr: 0 }}
            disabled={spellScaling}
            control={
              <Checkbox
                size="small"
                checked={showStancePerStamina}
                onChange={(evt) => onChange({ showStancePerStamina: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Potential"
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={showPotential}
                onChange={(evt) => onChange({ showPotential: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Status"
            sx={{ mr: 0 }}
            disabled={spellScaling}
            control={
              <Checkbox
                size="small"
                checked={showStatus}
                onChange={(evt) => onChange({ showStatus: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Scaling"
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={showScaling}
                onChange={(evt) => onChange({ showScaling: evt.currentTarget.checked })}
              />
            }
          />
          <FormControlLabel
            label="Requirements"
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={showRequirements}
                onChange={(evt) => onChange({ showRequirements: evt.currentTarget.checked })}
              />
            }
          />
        </Box>
      </CollapsibleGroup>
      <CollapsibleGroup
        title={`Weapon types${weaponTypes.length > 0 ? ` (${weaponTypes.length} selected)` : ""}`}
      >
        {!closedAlerts.includes("weaponTypes") && (
          <Alert
            severity="warning"
            onClose={() => onChange({ closedAlerts: [...closedAlerts, "weaponTypes"] })}
            sx={{ my: 1 }}
          >
            Every weapon of a checked type is calculated for each selected affinity, so checking
            many types and affinities can make calculation slow.
          </Alert>
        )}
        <WeaponTypePicker
          weaponTypes={weaponTypes}
          onWeaponTypesChanged={(newWeaponTypes) => onChange({ weaponTypes: newWeaponTypes })}
        />
      </CollapsibleGroup>
      <CollapsibleGroup title={`Affinities (${affinityIds.length} selected)`}>
        <AffinityPicker affinityIds={affinityIds} onChange={onChange} />
      </CollapsibleGroup>
      <FilterSettings
        onlyBuffable={onlyBuffable}
        weaponFilters={weaponFilters}
        onChange={onChange}
      />
      <CollapsibleGroup
        title={`Ammunition${selectedAmmo.length > 0 ? ` (${selectedAmmo.length} selected)` : ""}`}
      >
        <AmmoPicker
          ammo={ammo}
          selectedAmmo={selectedAmmo}
          onSelectedAmmoChanged={(newSelectedAmmo) => onChange({ selectedAmmo: newSelectedAmmo })}
        />
      </CollapsibleGroup>
    </Section>
  );
}

export default memo(BuildSettings);
