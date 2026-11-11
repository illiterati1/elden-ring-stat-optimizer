import { memo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { maxRegularUpgradeLevel, toSpecialUpgradeLevel } from "../optimizer/build.ts";
import type { Objective } from "../optimizer/optimizer.ts";
import Section from "./Section.tsx";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import { objectiveOptions } from "./uiUtils.ts";
import WeaponTypePicker from "./WeaponTypePicker.tsx";
import NumberTextField from "./NumberTextField.tsx";
import { chainAttacks, type AttackName } from "./useMovesets.ts";
import { ashAttack } from "./useAshes.ts";
import AffinityPicker from "./AffinityPicker.tsx";
import AmmoPicker from "./AmmoPicker.tsx";
import type { AmmoGroup } from "./useAmmo.ts";
import OffhandPicker from "./OffhandPicker.tsx";
import type { Buff } from "./useBuffs.ts";

interface Props {
  upgradeLevel: AppState["upgradeLevel"];
  twoHanding: AppState["twoHanding"];
  showScaling: AppState["showScaling"];
  showStatus: AppState["showStatus"];
  showStance: AppState["showStance"];
  showStamina: AppState["showStamina"];
  showRequirements: AppState["showRequirements"];
  closedAlerts: AppState["closedAlerts"];
  meetRequirements: AppState["meetRequirements"];
  onlyBuffable: AppState["onlyBuffable"];
  objective: AppState["objective"];
  weaponTypes: AppState["weaponTypes"];
  attack: AppState["attack"];
  chainWeight: AppState["chainWeight"];
  sumChains: AppState["sumChains"];
  /** True if any weapon's attack is a chain, e.g. a weapon's own skill, so its options apply */
  hasChain: boolean;
  ashOfWar: AppState["ashOfWar"];
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

/**
 * Form controls for weapon upgrade level, two handing, what to maximize, weapon types, and
 * affinities
 */
function BuildSettings({
  upgradeLevel,
  twoHanding,
  showScaling,
  showStatus,
  showStance,
  showStamina,
  showRequirements,
  closedAlerts,
  meetRequirements,
  onlyBuffable,
  objective,
  weaponTypes,
  attack,
  chainWeight,
  sumChains,
  hasChain,
  ashOfWar,
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
  onChange,
}: Props) {
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

        <FormControl fullWidth size="small">
          <InputLabel id="upgradeLevelLabel">Weapon Level</InputLabel>
          <Select
            labelId="upgradeLevelLabel"
            label="Weapon Level"
            value={upgradeLevel}
            onChange={(evt) => onChange({ upgradeLevel: +evt.target.value })}
          >
            {Array.from({ length: maxRegularUpgradeLevel + 1 }, (_, level) => (
              <MenuItem key={level} value={level}>
                +{level} / +{toSpecialUpgradeLevel(level)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Spell scaling doesn't use an attack */}
        {objective !== "spellScaling" && (
          <FormControl fullWidth size="small">
            <InputLabel id="attackLabel">Attack</InputLabel>
            <Select
              labelId="attackLabel"
              label="Attack"
              value={attack}
              onChange={(evt) => onChange({ attack: evt.target.value as AppState["attack"] })}
            >
              <MenuItem value={ashAttack}>Ash of War</MenuItem>
              {attackChoices.map((attackName) => (
                <MenuItem key={attackName} value={attackName} title={attackNotes[attackName]}>
                  {attackName}
                  {chainAttacks.has(attackName) ? " chain" : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {objective !== "spellScaling" && attack in attackNotes && (
          <Typography variant="body2" color="text.secondary" alignSelf="center">
            {attackNotes[attack as AttackName]}
          </Typography>
        )}
        {objective !== "spellScaling" && attack === ashAttack && !ashChoices.length && (
          <Typography variant="body2" color="text.secondary" alignSelf="center">
            The weapons picked use their own skills
          </Typography>
        )}
        {objective !== "spellScaling" && attack === ashAttack && ashChoices.length > 0 && (
          <FormControl fullWidth size="small">
            <InputLabel id="ashOfWarLabel">Ash of War</InputLabel>
            <Select
              labelId="ashOfWarLabel"
              label="Ash of War"
              value={ashChoices.length ? ashOfWar : ""}
              onChange={(evt) => onChange({ ashOfWar: evt.target.value })}
              MenuProps={{ PaperProps: { sx: { maxHeight: 400 } } }}
            >
              {ashChoices.map(({ value, label }) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {objective !== "spellScaling" && attack.startsWith("Powerstance") && (
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
        <FormControlLabel
          label="Meet requirements"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={meetRequirements}
              onChange={(evt) => onChange({ meetRequirements: evt.currentTarget.checked })}
            />
          }
        />
        <FormControlLabel
          label="Only buffable"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={onlyBuffable}
              onChange={(evt) => onChange({ onlyBuffable: evt.currentTarget.checked })}
            />
          }
        />
      </Box>
      <Box display="flex" flexWrap="wrap" columnGap={3}>
        <FormControlLabel
          label="Show scaling"
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
          label="Show status"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={showStatus}
              onChange={(evt) => onChange({ showStatus: evt.currentTarget.checked })}
            />
          }
        />
        <FormControlLabel
          label="Show poise"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={showStance}
              onChange={(evt) => onChange({ showStance: evt.currentTarget.checked })}
            />
          }
        />
        <FormControlLabel
          label="Show stamina cost"
          sx={{ mr: 0 }}
          control={
            <Checkbox
              size="small"
              checked={showStamina}
              onChange={(evt) => onChange({ showStamina: evt.currentTarget.checked })}
            />
          }
        />
        <FormControlLabel
          label="Show requirements"
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
